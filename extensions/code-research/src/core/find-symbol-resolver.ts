import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
import { loadCodeResearchConfig } from '../config.js';
import { readWorkspaceGraphManifest, readWorkspaceGraphState, readSubprojectGraphShard } from './graph-persistence.js';
import { evaluateGraphUsability } from './graph-policy.js';
import { getParserForFile, parseSource } from './parser.js';
import { detectLanguage, resolveTargetFiles } from './shared.js';
import { SymbolQueryDiagnosticsBuilder } from './symbol-query-diagnostics.js';
import { matchesCanonicalSymbol, reconcileSymbolRecords } from './symbol-query.js';
import {
  buildSymbolLocation as buildTypeScriptSymbolLocation,
  extractSymbols as extractTypeScriptSymbols,
  findImplementationsOf as findTypeScriptImplementationsOf,
} from '../languages/typescript/find-symbol.js';
import type { CanonicalTypeScriptSymbolRecord } from '../languages/typescript/symbol-model.js';
import { buildSymbolLocation as buildJavaSymbolLocation, extractSymbols as extractJavaSymbols, findImplementationsOf as findJavaImplementationsOf } from '../languages/java/find-symbol.js';
import { buildSymbolLocation as buildGoSymbolLocation, extractSymbols as extractGoSymbols, findImplementationsOf as findGoImplementationsOf } from '../languages/go/find-symbol.js';
import { queryInclusionForJavaDeclarationKind } from '../languages/java/symbol-model.js';
import { resolveJavaIndexRoot } from '../languages/java/function-call-tree.js';
import { collectWorkspaceSourceFiles } from './source-policy.js';
import type {
  CanonicalSymbolRecord,
  FindSymbolInput,
  FindSymbolResolution,
  GraphNode,
  SubprojectGraphShard,
  SearchMode,
  SupportedLanguage,
  SymbolLocation,
  SymbolQueryGraphStatus,
} from '../types.js';

interface IndexedSymbolShard {
  fileNodes: Set<string>;
  symbolsByFile: Map<string, Array<Extract<GraphNode, { kind: 'symbol' }>>>;
}

interface GraphFileSnapshot {
  hash?: string;
  mtimeMs: number;
  size: number;
  subprojectId: string;
}

interface GraphFileValidationResult {
  filePath: string;
  issue?: 'snapshot_mismatch' | 'coverage_unproven' | 'input_unreadable';
  records?: CanonicalSymbolRecord[];
}

// Weak keys keep this derived index bounded by the validated shard cache's LRU lifetime.
// Rebuilds and artifact replacement produce a new shard object, so stale indexes cannot match.
let indexedSymbolShardCache = new WeakMap<SubprojectGraphShard, IndexedSymbolShard>();
const indexedSymbolShardCacheStats = { hits: 0, misses: 0 };
const sourceHashCache = new Map<string, string>();
const MAX_SOURCE_HASH_CACHE_ENTRIES = 20_000;
export const GRAPH_FILE_VALIDATION_CONCURRENCY = 64;

export function clearFindSymbolGraphQueryCache(): void {
  indexedSymbolShardCache = new WeakMap();
  sourceHashCache.clear();
  indexedSymbolShardCacheStats.hits = 0;
  indexedSymbolShardCacheStats.misses = 0;
}

export function getFindSymbolGraphQueryCacheStats(): { hits: number; misses: number } {
  return { ...indexedSymbolShardCacheStats };
}

interface ParsedFile {
  path: string;
  language: Exclude<SupportedLanguage, 'auto'>;
  rootNode: any;
  source: string;
}

interface LanguageAdapter {
  extractSymbols(rootNode: any): Array<{ name: string; kind: any; node: any; isDefinition: boolean; isImplementation: boolean }>;
  findImplementationsOf(symbolName: string, files: Array<{ path: string; rootNode: any; language: Exclude<SupportedLanguage, 'auto'> }>): SymbolLocation[];
  buildSymbolLocation(filePath: string, symbolName: string, kind: any, node: any, isDefinition: boolean, isImplementation: boolean, includeSignature?: boolean, includeCode?: boolean, source?: string): SymbolLocation;
}

const typeScriptAdapter: LanguageAdapter = {
  extractSymbols: extractTypeScriptSymbols,
  findImplementationsOf: findTypeScriptImplementationsOf,
  buildSymbolLocation: buildTypeScriptSymbolLocation,
};

const javaAdapter: LanguageAdapter = {
  extractSymbols: extractJavaSymbols,
  findImplementationsOf: findJavaImplementationsOf,
  buildSymbolLocation: buildJavaSymbolLocation,
};

const goAdapter: LanguageAdapter = {
  extractSymbols: extractGoSymbols,
  findImplementationsOf: findGoImplementationsOf,
  buildSymbolLocation: buildGoSymbolLocation,
};

function getLanguageAdapter(language: Exclude<SupportedLanguage, 'auto'>): LanguageAdapter {
  if (language === 'java') return javaAdapter;
  if (language === 'go') return goAdapter;
  return typeScriptAdapter;
}

export async function resolveFindSymbol(cwd: string, input: FindSymbolInput): Promise<FindSymbolResolution> {
  const config = await loadCodeResearchConfig(cwd);
  const explicitLanguage = input.language ?? 'auto';
  const includeSignature = input.include_signature ?? false;
  const searchMode = input.search_mode ?? 'exact';
  const includeCode = Boolean(input.include_code && searchMode === 'exact');
  const resolved = await resolveTargetFiles(cwd, input.path, input.glob, input.scope, explicitLanguage);
  const diagnostics = new SymbolQueryDiagnosticsBuilder().setScannedFilesCount(resolved.filesToScan.length);
  const effectiveScope = input.scope ?? (resolved.filesToScan.length > 1 ? 'directory' : 'file');

  let graphRecords = new Map<string, CanonicalSymbolRecord[]>();
  let graphCompleteFiles = new Set<string>();
  if (config.graph.enable && (explicitLanguage === 'auto' || explicitLanguage === 'ts' || explicitLanguage === 'js' || explicitLanguage === 'java' || explicitLanguage === 'go')) {
    const graph = await loadGraphRecords(cwd, resolved.filesToScan, input);
    diagnostics.setGraph(graph.graphStatus, graph.graphGeneration);
    diagnostics.setSourceMode(graph.sourceMode);
    if (graph.fallbackReason) diagnostics.setCompleteness(graph.completeness, graph.fallbackReason);
    diagnostics.incrementUnreadableShardsCount(graph.unreadableShardsCount);
    diagnostics.incrementSkippedFilesCount(graph.skippedFilesCount);
    graphRecords = graph.records;
    graphCompleteFiles = graph.completeFiles;
  } else {
    diagnostics.setGraph(config.graph.enable ? 'fresh' : 'disabled');
    diagnostics.setSourceMode('direct').setCompleteness('fallback', config.graph.enable ? 'coverage_unproven' : 'graph_disabled');
  }

  const requiresCanonicalDirectContext = input.kind === 'interface' || input.declaration_kind === 'interface';
  const directFiles = resolved.filesToScan.filter((file) => requiresCanonicalDirectContext || !graphCompleteFiles.has(file));
  const parsedFiles = await parseFiles(cwd, directFiles, explicitLanguage, diagnostics);
  const directResults = collectDirectMatches(parsedFiles, input, includeSignature, includeCode, searchMode, effectiveScope);
  const implementationContextFiles = await loadJavaInterfaceMethodImplementationContext(cwd, resolved.targetPath, resolved.isDirectory, explicitLanguage, input, directResults, parsedFiles, diagnostics);

  const graphLocations: SymbolLocation[] = [];
  for (const file of resolved.filesToScan) {
    let source = parsedFiles.find((entry) => entry.path === file)?.source;
    if (!source && includeCode && graphCompleteFiles.has(file)) source = await readFile(file, 'utf8').catch(() => undefined);
    for (const record of graphRecords.get(file) ?? []) {
      if (!matchesCanonicalSymbol(record, input.symbol, searchMode, input.kind, input.declaration_kind, effectiveScope)) continue;
      const builder = detectLanguage(file, explicitLanguage) === 'java'
        ? buildJavaSymbolLocation
        : detectLanguage(file, explicitLanguage) === 'go'
          ? buildGoSymbolLocation
          : buildTypeScriptSymbolLocation;
      graphLocations.push(builder(file, record.name, record.coarseKind, record, record.isDefinition, record.isImplementation, includeSignature, includeCode, source));
    }
  }

  const results = reconcileLocations([...directResults, ...graphLocations]);
  hydrateInterfaceImplementationLocations(results, explicitLanguage, graphRecords, implementationContextFiles);
  const currentDiagnostics = diagnostics.build();
  if (graphCompleteFiles.size === resolved.filesToScan.length && directFiles.length === 0 && currentDiagnostics.graph_status === 'fresh') {
    diagnostics.setSourceMode('graph').setCompleteness('complete', null);
  } else if (graphLocations.length > 0 && currentDiagnostics.completeness !== 'partial') {
    diagnostics.setSourceMode('hybrid').setCompleteness('fallback', currentDiagnostics.fallback_reason);
  }

  return { results, diagnostics: diagnostics.build() };
}

export async function findSymbol(cwd: string, input: FindSymbolInput): Promise<SymbolLocation[]> {
  return (await resolveFindSymbol(cwd, input)).results;
}

async function parseFiles(cwd: string, filesToScan: string[], explicitLanguage: SupportedLanguage, diagnostics: SymbolQueryDiagnosticsBuilder): Promise<ParsedFile[]> {
  const parsedFiles: ParsedFile[] = [];
  for (const filePath of filesToScan) {
    const language = detectLanguage(filePath, explicitLanguage);
    try {
      const source = await readFile(filePath, 'utf8');
      if (language === 'java' || language === 'go') {
        const parser = getParserForFile(filePath, language);
        const tree = parseSource(parser, source);
        (tree.rootNode as any).__filePath = filePath;
        (tree.rootNode as any).__source = source;
        parsedFiles.push({ path: filePath, language, rootNode: tree.rootNode, source });
      } else {
        const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : filePath.endsWith('.jsx') ? ts.ScriptKind.JSX : filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
        const canonicalFilePath = filePath.startsWith(`${cwd}/`) ? filePath.slice(cwd.length + 1).replace(/\\/g, '/') : filePath.replace(/\\/g, '/');
        const sourceFile = ts.createSourceFile(canonicalFilePath, source, ts.ScriptTarget.Latest, true, scriptKind);
        parsedFiles.push({ path: filePath, language, rootNode: sourceFile, source });
      }
    } catch {
      diagnostics.incrementSkippedFilesCount();
    }
  }
  return parsedFiles;
}

function collectDirectMatches(
  parsedFiles: ParsedFile[],
  input: FindSymbolInput,
  includeSignature: boolean,
  includeCode: boolean,
  searchMode: SearchMode,
  scope: 'file' | 'directory'
): SymbolLocation[] {
  const matches: SymbolLocation[] = [];
  for (const file of parsedFiles) {
    const adapter = getLanguageAdapter(file.language);
    const symbols = adapter.extractSymbols(file.rootNode);
    for (const sym of symbols) {
      const record = isCanonicalRecord(sym.node) ? (sym.node as CanonicalSymbolRecord) : undefined;
      const matchedKind = input.kind === 'function' && sym.kind === 'variable' && sym.isImplementation ? 'function' : sym.kind;
      if (record) {
        if (!matchesCanonicalSymbol(record, input.symbol, searchMode, input.kind, input.declaration_kind, scope)) continue;
      } else {
        if (!matchesSymbol(sym.name, input.symbol, searchMode)) continue;
        if (input.kind && matchedKind !== input.kind) continue;
      }
      matches.push(adapter.buildSymbolLocation(file.path, sym.name, matchedKind, sym.node, sym.isDefinition, sym.isImplementation, includeSignature, includeCode, file.source));
    }
  }

  for (const match of matches) {
    if (match.kind === 'interface' && match.is_definition) {
      const adapter = getLanguageAdapter(detectLanguage(match.file, 'auto'));
      match.implementation_locations = adapter.findImplementationsOf(match.symbol, parsedFiles);
    }
  }

  return matches;
}

async function loadJavaInterfaceMethodImplementationContext(
  cwd: string,
  targetPath: string,
  isDirectory: boolean,
  explicitLanguage: SupportedLanguage,
  input: FindSymbolInput,
  directResults: SymbolLocation[],
  parsedFiles: ParsedFile[],
  diagnostics: SymbolQueryDiagnosticsBuilder
): Promise<ParsedFile[]> {
  if (isDirectory || explicitLanguage !== 'java' || input.kind !== 'method') return parsedFiles;
  if (directResults.length === 0) return parsedFiles;
  const indexRoot = await resolveJavaIndexRoot(targetPath).catch(() => undefined);
  if (!indexRoot) return parsedFiles;
  const files = (await collectWorkspaceSourceFiles(indexRoot).catch(() => [])).filter((file) => file.endsWith('.java') && !parsedFiles.some((entry) => entry.path === file));
  if (files.length === 0) return parsedFiles;
  return [...parsedFiles, ...await parseFiles(cwd, files, explicitLanguage, diagnostics)];
}

async function loadGraphRecords(
  cwd: string,
  filesToScan: string[],
  input: FindSymbolInput
): Promise<{
  records: Map<string, CanonicalSymbolRecord[]>;
  completeFiles: Set<string>;
  sourceMode: 'direct' | 'graph' | 'hybrid';
  completeness: 'complete' | 'partial' | 'fallback';
  fallbackReason: any;
  graphStatus: SymbolQueryGraphStatus;
  graphGeneration?: number;
  unreadableShardsCount: number;
  skippedFilesCount: number;
}> {
  const state = await readWorkspaceGraphState(cwd);
  const manifest = await readWorkspaceGraphManifest(cwd);
  const decision = evaluateGraphUsability({
    graphEnabled: true,
    query: 'find_symbol',
    stateReadStatus: state.status,
    manifestReadStatus: manifest.status,
    stateStatus: state.status === 'ok' ? state.data.status : undefined,
    language: input.language,
    targetPath: input.path,
    allowStale: true,
  });
  if ((state.status !== 'ok' || manifest.status !== 'ok') || (!decision.usable && !(decision.reason === 'status_unusable' && state.status === 'ok' && (state.data.status === 'fresh' || state.data.status === 'stale' || state.data.status === 'partial')))) {
    return {
      records: new Map(),
      completeFiles: new Set(),
      sourceMode: 'direct',
      completeness: 'fallback',
      fallbackReason: mapFallbackReason(state.status, manifest.status, state.status === 'ok' ? state.data.status : undefined),
      graphStatus: mapGraphStatus(state.status, manifest.status, state.status === 'ok' ? state.data.status : undefined),
      graphGeneration: state.status === 'ok' ? state.data.generation : undefined,
      unreadableShardsCount: 0,
      skippedFilesCount: 0,
    };
  }

  if (state.data.status === 'stale' || state.data.status === 'refreshing') {
    return {
      records: new Map(),
      completeFiles: new Set(),
      sourceMode: 'direct',
      completeness: 'fallback',
      fallbackReason: 'graph_stale',
      graphStatus: 'stale',
      graphGeneration: state.data.generation,
      unreadableShardsCount: 0,
      skippedFilesCount: 0,
    };
  }

  const records = new Map<string, CanonicalSymbolRecord[]>();
  const completeFiles = new Set<string>();
  const snapshotByFile = new Map<string, GraphFileSnapshot>();
  const stateSubprojects = new Map(state.data.subprojects.map((subproject) => [subproject.id, subproject]));
  for (const subproject of state.data.subprojects) {
    for (const [file, snapshot] of Object.entries(subproject.snapshot)) {
      snapshotByFile.set(resolve(cwd, file), { ...snapshot, subprojectId: subproject.id });
    }
  }

  const issueCounts = {
    shard_missing: 0,
    shard_corrupt: 0,
    shard_oversized: 0,
    shard_unreadable: 0,
    shard_incompatible: 0,
    snapshot_mismatch: 0,
    coverage_unproven: 0,
    input_unreadable: 0,
  };
  const subprojectFiles = new Map<string, string[]>();
  for (const filePath of filesToScan) {
    const snapshot = snapshotByFile.get(filePath);
    if (!snapshot) {
      issueCounts.snapshot_mismatch += 1;
      continue;
    }
    const values = subprojectFiles.get(snapshot.subprojectId) ?? [];
    values.push(filePath);
    subprojectFiles.set(snapshot.subprojectId, values);
  }

  for (const [subprojectId, shardFiles] of subprojectFiles) {
    const manifestEntry = manifest.data.subprojects.find((subproject) => subproject.id === subprojectId);
    const stateSubproject = stateSubprojects.get(subprojectId);
    if (!manifestEntry || !stateSubproject) {
      issueCounts.shard_missing += shardFiles.length;
      continue;
    }

    const shard = await readSubprojectGraphShard(cwd, subprojectId, { generation: manifestEntry.generation });
    if (shard.status !== 'ok') {
      if (shard.status === 'missing') issueCounts.shard_missing += 1;
      else if (shard.status === 'corrupt') issueCounts.shard_corrupt += 1;
      else if (shard.status === 'oversized') issueCounts.shard_oversized += 1;
      else if (shard.status === 'errored') issueCounts.shard_unreadable += 1;
      else issueCounts.shard_incompatible += 1;
      continue;
    }

    if (manifestEntry.generation !== state.data.generation || shard.data.generation !== state.data.generation) {
      issueCounts.shard_incompatible += shardFiles.length;
      continue;
    }

    const { fileNodes, symbolsByFile } = getIndexedSymbolShard(shard.data);
    const validations = await validateGraphAuthorityForFiles(cwd, shardFiles, {
      snapshotByFile,
      fileNodes,
      symbolsByFile,
      coverage: input.language === 'java' ? shard.data.javaSymbolCoverage : input.language === 'go' ? shard.data.goSymbolCoverage : shard.data.typescriptSymbolCoverage,
      generation: shard.data.generation,
      language: input.language,
    });
    for (const validation of validations) {
      if (validation.issue) {
        issueCounts[validation.issue] += 1;
        continue;
      }
      if (!validation.records) {
        issueCounts.coverage_unproven += 1;
        continue;
      }
      records.set(validation.filePath, validation.records);
      completeFiles.add(validation.filePath);
    }
  }

  let graphStatus: SymbolQueryGraphStatus = 'fresh';
  let fallbackReason: any = null;
  if (issueCounts.shard_corrupt > 0) {
    graphStatus = 'error';
    fallbackReason = 'shard_corrupt';
  } else if (issueCounts.shard_oversized > 0) {
    graphStatus = 'error';
    fallbackReason = 'shard_oversized';
  } else if (issueCounts.shard_unreadable > 0) {
    graphStatus = 'error';
    fallbackReason = 'shard_unreadable';
  } else if (issueCounts.shard_missing > 0) {
    graphStatus = 'missing';
    fallbackReason = 'shard_missing';
  } else if (issueCounts.shard_incompatible > 0) {
    graphStatus = 'incompatible';
    fallbackReason = 'shard_incompatible';
  } else if (issueCounts.snapshot_mismatch > 0) {
    graphStatus = 'stale';
    fallbackReason = 'snapshot_mismatch';
  } else if (state.data.status === 'partial' || issueCounts.coverage_unproven > 0) {
    graphStatus = 'partial';
    fallbackReason = state.data.status === 'partial' ? 'graph_partial' : 'coverage_unproven';
  }

  if (issueCounts.input_unreadable > 0 && !fallbackReason) fallbackReason = 'input_unreadable';
  const sourceMode = completeFiles.size === filesToScan.length && graphStatus === 'fresh'
    ? 'graph'
    : completeFiles.size > 0
      ? 'hybrid'
      : 'direct';
  const completeness = completeFiles.size === filesToScan.length && graphStatus === 'fresh'
    ? 'complete'
    : issueCounts.input_unreadable > 0
      ? 'partial'
      : 'fallback';

  return {
    records,
    completeFiles,
    sourceMode,
    completeness,
    fallbackReason,
    graphStatus,
    graphGeneration: state.data.generation,
    unreadableShardsCount: issueCounts.shard_unreadable,
    skippedFilesCount: issueCounts.input_unreadable,
  };
}

export async function validateGraphAuthorityForFiles(
  cwd: string,
  shardFiles: string[],
  context: {
    snapshotByFile: Map<string, GraphFileSnapshot>;
    fileNodes: Set<string>;
    symbolsByFile: Map<string, Array<Extract<GraphNode, { kind: 'symbol' }>>>;
    coverage: SubprojectGraphShard['typescriptSymbolCoverage'] | SubprojectGraphShard['javaSymbolCoverage'] | SubprojectGraphShard['goSymbolCoverage'];
    generation: number;
    language?: SupportedLanguage;
  },
  options?: {
    concurrency?: number;
    statFile?: typeof stat;
    readSourceHash?: typeof readCurrentSourceHash;
  }
): Promise<GraphFileValidationResult[]> {
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? GRAPH_FILE_VALIDATION_CONCURRENCY, shardFiles.length || 1));
  const statFile = options?.statFile ?? stat;
  const readSourceHash = options?.readSourceHash ?? readCurrentSourceHash;
  const results = new Array<GraphFileValidationResult>(shardFiles.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= shardFiles.length) return;
      const filePath = shardFiles[index];
      const rel = filePath.startsWith(`${cwd}/`) ? filePath.slice(cwd.length + 1).replace(/\\/g, '/') : filePath.replace(/\\/g, '/');
      const snapshot = context.snapshotByFile.get(filePath);
      if (!snapshot || !snapshot.hash) {
        results[index] = { filePath, issue: 'snapshot_mismatch' };
        continue;
      }
      const currentStat = await statFile(filePath).catch(() => undefined);
      if (!currentStat) {
        results[index] = { filePath, issue: 'input_unreadable' };
        continue;
      }
      if (currentStat.size !== snapshot.size || currentStat.mtimeMs !== snapshot.mtimeMs) {
        results[index] = { filePath, issue: 'snapshot_mismatch' };
        continue;
      }
      const currentHash = await readSourceHash(filePath, currentStat);
      if (!currentHash) {
        results[index] = { filePath, issue: 'input_unreadable' };
        continue;
      }
      if (currentHash !== snapshot.hash) {
        results[index] = { filePath, issue: 'snapshot_mismatch' };
        continue;
      }
      if (!context.fileNodes.has(rel) || !context.coverage || context.coverage.generation !== context.generation || !context.coverage.completeFiles.includes(rel)) {
        results[index] = { filePath, issue: 'coverage_unproven' };
        continue;
      }
      const proof: any = (context.coverage as any).fileProofs[rel];
      const graphNodes = context.symbolsByFile.get(rel) ?? [];
      if (!proof || proof.sourceHash !== snapshot.hash || proof.symbolCount !== graphNodes.length || graphNodes.some((node) => !node.declarationKind || !node.symbolId || !node.qualifiedName || !Array.isArray(node.modifiers) || typeof node.isDefinition !== 'boolean' || typeof node.isImplementation !== 'boolean' || node.sourceHash !== snapshot.hash)) {
        results[index] = { filePath, issue: 'coverage_unproven' };
        continue;
      }
      results[index] = {
        filePath,
        records: graphNodes.map((node) => graphNodeToCanonicalRecord(node, rel, snapshot.hash!)),
      };
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function readCurrentSourceHash(filePath: string, fileStat: { size: number; mtimeMs: number; ctimeMs: number; ino: number }): Promise<string | undefined> {
  const cacheKey = `${filePath}:${fileStat.size}:${fileStat.mtimeMs}:${fileStat.ctimeMs}:${fileStat.ino}`;
  const cached = sourceHashCache.get(cacheKey);
  if (cached) {
    sourceHashCache.delete(cacheKey);
    sourceHashCache.set(cacheKey, cached);
    return cached;
  }
  const raw = await readFile(filePath).catch(() => undefined);
  if (!raw) return undefined;
  const hash = createHash('sha256').update(raw).digest('hex');
  sourceHashCache.set(cacheKey, hash);
  while (sourceHashCache.size > MAX_SOURCE_HASH_CACHE_ENTRIES) {
    const oldest = sourceHashCache.keys().next().value;
    if (oldest === undefined) break;
    sourceHashCache.delete(oldest);
  }
  return hash;
}

function getIndexedSymbolShard(shard: SubprojectGraphShard): IndexedSymbolShard {
  const cached = indexedSymbolShardCache.get(shard);
  if (cached) {
    indexedSymbolShardCacheStats.hits += 1;
    return cached;
  }

  indexedSymbolShardCacheStats.misses += 1;
  const indexed: IndexedSymbolShard = { fileNodes: new Set(), symbolsByFile: new Map() };
  for (const node of shard.nodes) {
    if (node.kind === 'file') indexed.fileNodes.add(node.path);
    else if (node.kind === 'symbol') {
      const values = indexed.symbolsByFile.get(node.file) ?? [];
      values.push(node);
      indexed.symbolsByFile.set(node.file, values);
    }
  }
  indexedSymbolShardCache.set(shard, indexed);
  return indexed;
}

function graphNodeToCanonicalRecord(node: Extract<GraphNode, { kind: 'symbol' }>, relativeFile: string, sourceHash: string): CanonicalSymbolRecord {
  return {
    name: node.name,
    qualifiedName: node.qualifiedName ?? node.name,
    owner: node.owner,
    ownerChain: node.qualifiedName ? node.qualifiedName.split('.').slice(0, -1) : node.owner ? [node.owner] : [],
    declarationKind: node.declarationKind ?? 'unknown',
    coarseKind: node.symbolKind,
    sourceName: node.sourceName,
    exportedName: node.exportedName,
    anonymous: node.anonymous,
    dynamicName: node.dynamicName,
    modifiers: node.modifiers ?? [],
    declarationRange: node.range,
    codeRange: node.codeRange ?? node.range,
    isDefinition: node.isDefinition ?? true,
    isImplementation: node.isImplementation ?? node.symbolKind !== 'interface',
    discriminator: `${node.declarationKind ?? node.symbolKind}:${node.range.startLine}:${node.range.startColumn}`,
    relationshipId: node.relationshipId,
    signature: node.signature,
    symbolId: node.symbolId ?? `${relativeFile}:${node.name}:${node.range.startLine}:${node.range.startColumn}`,
    sourceHash,
    queryInclusion: node.language === 'java' && node.declarationKind
      ? queryInclusionForJavaDeclarationKind(node.declarationKind)
      : 'default',
  };
}

function matchesSymbol(name: string, query: string, mode: SearchMode): boolean {
  switch (mode) {
    case 'prefix':
      return name.startsWith(query);
    case 'contains':
      return name.includes(query);
    case 'exact':
    default:
      return name === query;
  }
}

function reconcileLocations(results: SymbolLocation[]): SymbolLocation[] {
  const byId = new Map<string, SymbolLocation>();
  for (const result of results) {
    const key = `${result.file}:${result.symbol}:${result.kind}:${result.declaration_kind ?? 'unknown'}:${result.start_line}:${result.start_column}:${result.end_line}:${result.end_column}`;
    const existing = byId.get(key);
    byId.set(key, existing && existing.implementation_locations && !result.implementation_locations
      ? { ...result, implementation_locations: existing.implementation_locations }
      : result);
  }
  return [...byId.values()].sort((a, b) =>
    a.file.localeCompare(b.file) ||
    a.start_line - b.start_line ||
    a.start_column - b.start_column ||
    (a.declaration_kind ?? a.kind).localeCompare(b.declaration_kind ?? b.kind) ||
    (a.qualified_name ?? a.symbol).localeCompare(b.qualified_name ?? b.symbol)
  );
}

function hydrateInterfaceImplementationLocations(
  results: SymbolLocation[],
  explicitLanguage: SupportedLanguage,
  graphRecords: Map<string, CanonicalSymbolRecord[]>,
  parsedFiles: ParsedFile[]
): void {
  for (const result of results) {
    const language = detectLanguage(result.file, explicitLanguage);
    if (result.kind === 'method' && result.is_definition && (result.implementation_locations?.length ?? 0) === 0 && language === 'java') {
      result.implementation_locations = collectJavaMethodImplementationLocations(result, graphRecords, parsedFiles);
      continue;
    }

    if (result.kind !== 'interface' || !result.is_definition || (result.implementation_locations?.length ?? 0) > 0) continue;
    if (language === 'java') {
      result.implementation_locations = collectJavaImplementationLocationsFromGraph(result, graphRecords);
      if ((result.implementation_locations?.length ?? 0) > 0) continue;
    }
    const adapter = getLanguageAdapter(language);
    result.implementation_locations = dedupeImplementationLocations(adapter.findImplementationsOf(result.symbol, parsedFiles));
  }
}

function collectJavaMethodImplementationLocations(
  target: SymbolLocation,
  graphRecords: Map<string, CanonicalSymbolRecord[]>,
  parsedFiles: ParsedFile[]
): SymbolLocation[] {
  const interfaceOwner = target.owner;
  if (!interfaceOwner) return [];
  const implementationOwners = new Set<string>();
  const ownerSimple = simpleName(interfaceOwner) ?? interfaceOwner;
  const implementsPattern = new RegExp(`\\bimplements\\b[^\\n{]*\\b${escapeRegExp(ownerSimple)}(?:\\b|\\s*<)`, 'u');

  for (const records of graphRecords.values()) {
    for (const record of records) {
      if (record.declarationKind !== 'class' && record.declarationKind !== 'record') continue;
      if (record.signature && implementsPattern.test(record.signature)) implementationOwners.add(record.qualifiedName);
    }
  }

  for (const file of parsedFiles.filter((item) => item.language === 'java')) {
    for (const sym of javaAdapter.extractSymbols(file.rootNode)) {
      if ((sym.node.declarationKind === 'class' || sym.node.declarationKind === 'record') && sym.node.signature && implementsPattern.test(sym.node.signature)) implementationOwners.add(sym.node.qualifiedName);
    }
  }
  for (const location of javaAdapter.findImplementationsOf(ownerSimple, parsedFiles)) {
    if (location.qualified_name) implementationOwners.add(location.qualified_name);
    implementationOwners.add(location.symbol);
  }

  const locations: SymbolLocation[] = [];
  const maybeAdd = (filePath: string, record: CanonicalSymbolRecord) => {
    if (record.name !== target.symbol || record.declarationKind !== 'method') return;
    if (!record.owner || (!implementationOwners.has(record.owner) && !implementationOwners.has(simpleName(record.owner) ?? record.owner))) return;
    locations.push(buildJavaSymbolLocation(filePath, record.name, record.coarseKind, record, true, true));
  };

  for (const [filePath, records] of graphRecords) for (const record of records) maybeAdd(filePath, record);
  for (const file of parsedFiles.filter((item) => item.language === 'java')) {
    for (const sym of javaAdapter.extractSymbols(file.rootNode)) maybeAdd(file.path, sym.node);
  }

  return dedupeImplementationLocations(locations);
}

function collectJavaImplementationLocationsFromGraph(
  target: SymbolLocation,
  graphRecords: Map<string, CanonicalSymbolRecord[]>
): SymbolLocation[] {
  const matches: SymbolLocation[] = [];
  const implementsPattern = new RegExp(`\\bimplements\\b[^\\n{]*\\b${escapeRegExp(target.symbol)}(?:\\b|\\s*<)`, 'u');
  for (const [filePath, records] of graphRecords) {
    for (const record of records) {
      if (record.declarationKind !== 'class' && record.declarationKind !== 'record') continue;
      if (!record.signature || !implementsPattern.test(record.signature)) continue;
      matches.push(buildJavaSymbolLocation(filePath, record.name, record.coarseKind, record, true, true));
    }
  }
  return dedupeImplementationLocations(matches);
}

function dedupeImplementationLocations(locations: SymbolLocation[]): SymbolLocation[] {
  const deduped = new Map<string, SymbolLocation>();
  for (const location of locations) {
    deduped.set(`${location.file}:${location.symbol}:${location.start_line}:${location.start_column}`, location);
  }
  return [...deduped.values()].sort((a, b) =>
    a.file.localeCompare(b.file) ||
    a.start_line - b.start_line ||
    a.start_column - b.start_column ||
    a.symbol.localeCompare(b.symbol)
  );
}

function simpleName(value: string): string | undefined {
  return value.split('.').pop();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mapGraphStatus(stateStatus: string, manifestStatus: string, graphState?: string): SymbolQueryGraphStatus {
  if (stateStatus === 'missing' || manifestStatus === 'missing') return 'missing';
  if (stateStatus === 'incompatible' || manifestStatus === 'incompatible') return 'incompatible';
  if (stateStatus === 'errored' || manifestStatus === 'errored') return 'error';
  if (graphState === 'partial') return 'partial';
  if (graphState === 'stale' || graphState === 'refreshing') return 'stale';
  return 'fresh';
}

function isCanonicalRecord(value: unknown): value is CanonicalTypeScriptSymbolRecord {
  return Boolean(value && typeof value === 'object' && 'declarationKind' in (value as any) && 'qualifiedName' in (value as any));
}

function mapFallbackReason(stateStatus: string, manifestStatus: string, graphState?: string) {
  if (stateStatus === 'missing' || manifestStatus === 'missing') return 'graph_missing';
  if (stateStatus === 'incompatible' || manifestStatus === 'incompatible') return 'graph_incompatible';
  if (stateStatus === 'errored' || manifestStatus === 'errored') return 'graph_read_error';
  if (graphState === 'partial') return 'graph_partial';
  if (graphState === 'stale' || graphState === 'refreshing') return 'graph_stale';
  return 'coverage_unproven';
}
