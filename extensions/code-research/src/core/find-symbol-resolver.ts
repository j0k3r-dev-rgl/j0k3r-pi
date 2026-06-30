import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadCodeResearchConfig } from '../config.js';
import { readWorkspaceGraphManifest, readWorkspaceGraphState, readSubprojectGraphShard } from './graph-persistence.js';
import { evaluateGraphUsability } from './graph-policy.js';
import { getParser, parseSource } from './parser.js';
import { detectLanguage, resolveTargetFiles } from './shared.js';
import {
  buildSymbolLocation as buildTypeScriptSymbolLocation,
  extractSymbols as extractTypeScriptSymbols,
  findImplementationsOf as findTypeScriptImplementationsOf,
} from '../languages/typescript/find-symbol.js';
import {
  buildSymbolLocation as buildJavaSymbolLocation,
  extractSymbols as extractJavaSymbols,
  findImplementationsOf as findJavaImplementationsOf,
} from '../languages/java/find-symbol.js';
import type { FindSymbolInput, SearchMode, SupportedLanguage, SymbolLocation } from '../types.js';

interface LanguageAdapter {
  extractSymbols(rootNode: any): Array<{
    name: string;
    kind: import('../types.js').SymbolKind;
    node: any;
    isDefinition: boolean;
    isImplementation: boolean;
  }>;
  findImplementationsOf(
    symbolName: string,
    files: Array<{ path: string; rootNode: any; language: Exclude<SupportedLanguage, 'auto'> }>
  ): SymbolLocation[];
  buildSymbolLocation(
    filePath: string,
    symbolName: string,
    kind: import('../types.js').SymbolKind,
    node: any,
    isDefinition: boolean,
    isImplementation: boolean,
    includeSignature?: boolean,
    includeCode?: boolean,
    source?: string
  ): SymbolLocation;
}

interface ParsedFile {
  path: string;
  language: Exclude<SupportedLanguage, 'auto'>;
  rootNode: any;
  source: string;
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

function getLanguageAdapter(language: Exclude<SupportedLanguage, 'auto'>): LanguageAdapter {
  if (language === 'java') return javaAdapter;
  return typeScriptAdapter;
}


export async function findSymbol(
  cwd: string,
  input: FindSymbolInput
): Promise<SymbolLocation[]> {
  const config = await loadCodeResearchConfig(cwd);
  const graphResults = config.graph.enable ? await findSymbolFromGraph(cwd, input) : undefined;
  if (graphResults) return graphResults;
  return findSymbolDirect(cwd, input);
}

async function findSymbolDirect(
  cwd: string,
  input: FindSymbolInput
): Promise<SymbolLocation[]> {
  // In-memory cache scoped to this single tool invocation
  const parseCache = new Map<string, ParsedFile>();

  const explicitLanguage = input.language ?? 'auto';
  const includeSignature = input.include_signature ?? false;
  const searchMode = input.search_mode ?? 'exact';
  let includeCode = input.include_code ?? false;

  // include_code is only allowed for functions and methods to avoid huge payloads
  if (includeCode && input.kind && input.kind !== 'function' && input.kind !== 'method') {
    includeCode = false;
  }

  // include_code is disabled for non-exact searches to avoid flooding context
  if (includeCode && searchMode !== 'exact') {
    includeCode = false;
  }

  const { filesToScan } = await resolveTargetFiles(cwd, input.path, input.glob);

  const parsedFiles: ParsedFile[] = [];
  for (const filePath of filesToScan) {
    let parsed = parseCache.get(filePath);
    if (!parsed) {
      const language = detectLanguage(filePath, explicitLanguage);
      const source = await readFile(filePath, 'utf8');
      const parser = getParser(language);

      let tree: any;
      try {
        tree = parseSource(parser, source);
      } catch (error: any) {
        if (filesToScan.length === 1) {
          throw new Error(`Failed to parse file: ${filePath} (${error?.message ?? 'unknown parse error'})`);
        }
        continue;
      }

      parsed = { path: filePath, language, rootNode: tree.rootNode, source };
      parseCache.set(filePath, parsed);
    }
    parsedFiles.push(parsed);
  }

  const matches: SymbolLocation[] = [];

  for (const file of parsedFiles) {
    const adapter = getLanguageAdapter(file.language);
    const symbols = adapter.extractSymbols(file.rootNode);
    for (const sym of symbols) {
      if (!matchesSymbol(sym.name, input.symbol, searchMode)) continue;
      if (input.kind && sym.kind !== input.kind) continue;

      const location = adapter.buildSymbolLocation(
        file.path,
        sym.name,
        sym.kind,
        sym.node,
        sym.isDefinition,
        sym.isImplementation,
        includeSignature,
        includeCode,
        file.source
      );

      matches.push(location);
    }
  }

  // Enrich interface definitions with implementation locations
  for (const match of matches) {
    if (match.kind === 'interface' && match.is_definition) {
      const adapter = getLanguageAdapter(detectLanguage(match.file, 'auto'));
      match.implementation_locations = adapter.findImplementationsOf(
        match.symbol,
        parsedFiles
      );
    }
  }

  // If the matched symbol is an implementation, try to find its definition
  for (const match of matches) {
    if (match.is_implementation && !match.is_definition) {
      const definition = findDefinitionFor(match, parsedFiles, includeSignature);
      if (definition) {
        match.definition_location = definition;
      }
    }
  }

  return matches;
}

async function findSymbolFromGraph(cwd: string, input: FindSymbolInput): Promise<SymbolLocation[] | undefined> {
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
  });
  if (!decision.usable || state.status !== 'ok' || manifest.status !== 'ok') return undefined;

  const includeSignature = input.include_signature ?? false;
  const searchMode = input.search_mode ?? 'exact';
  let includeCode = input.include_code ?? false;
  if (includeCode && input.kind && input.kind !== 'function' && input.kind !== 'method') includeCode = false;
  if (includeCode && searchMode !== 'exact') includeCode = false;

  const { targetPath, isDirectory } = await resolveTargetFiles(cwd, input.path, input.glob);
  const relativeTarget = targetPath.startsWith(cwd) ? targetPath.slice(cwd.length + 1).replace(/\\/g, '/') : input.path.replace(/\\/g, '/');

  const shards = await Promise.all(
    manifest.data.subprojects.map(async (subproject) => {
      const shard = await readSubprojectGraphShard(cwd, subproject.id);
      return shard.status === 'ok' ? shard.data : undefined;
    })
  );
  const allShards = shards.filter(Boolean);
  if (allShards.length === 0) return undefined;

  const allNodes = allShards.flatMap((shard) => shard!.nodes);
  const allEdges = allShards.flatMap((shard) => shard!.edges);
  const symbolNodes = allNodes.filter((node): node is Extract<(typeof allNodes)[number], { kind: 'symbol' }> => node.kind === 'symbol');

  const matches = symbolNodes.filter((node) => {
    if (!matchesSymbol(node.name, input.symbol, searchMode)) return false;
    if (input.kind && node.symbolKind !== input.kind) return false;
    if (!isDirectory) {
      return node.file === relativeTarget || node.file.endsWith(`/${relativeTarget}`) || relativeTarget.endsWith(node.file);
    }
    return node.file === relativeTarget || node.file.endsWith(`/${relativeTarget}`) || node.file.startsWith(`${relativeTarget}/`) || relativeTarget === '.';
  });

  const results = await Promise.all(matches.map(async (node) => {
    const location: SymbolLocation = {
      file: resolve(cwd, node.file),
      symbol: node.name,
      kind: node.symbolKind,
      start_line: node.range.startLine,
      start_column: node.range.startColumn,
      end_line: node.range.endLine,
      end_column: node.range.endColumn,
      is_definition: node.symbolKind !== 'interface' ? true : true,
      is_implementation: node.symbolKind !== 'interface',
    };

    if (includeSignature && node.signature) location.signature = node.signature;
    if (includeCode) {
      const source = await readFile(resolve(cwd, node.file), 'utf8').catch(() => undefined);
      if (source) location.code = extractCodeRange(source, node.range.startLine, node.range.startColumn, node.range.endLine, node.range.endColumn);
    }

    if (node.symbolKind === 'interface') {
      location.implementation_locations = buildImplementationLocationsFromGraph(node.id, allNodes, allEdges, cwd);
    }

    return location;
  }));

  return results.length > 0 ? results : undefined;
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

function buildImplementationLocationsFromGraph(
  interfaceNodeId: string,
  allNodes: Array<any>,
  allEdges: Array<any>,
  cwd: string
): SymbolLocation[] {
  const nodeById = new Map(allNodes.map((node) => [node.id, node]));
  return allEdges
    .filter((edge) => edge.kind === 'implements' && edge.to === interfaceNodeId)
    .map((edge) => nodeById.get(edge.from))
    .filter((node): node is Extract<(typeof allNodes)[number], { kind: 'symbol' }> => Boolean(node && node.kind === 'symbol'))
    .map((node) => ({
      file: resolve(cwd, node.file),
      symbol: node.name,
      kind: node.symbolKind,
      start_line: node.range.startLine,
      start_column: node.range.startColumn,
      end_line: node.range.endLine,
      end_column: node.range.endColumn,
      is_definition: true,
      is_implementation: true,
      signature: node.signature,
    }));
}

function extractCodeRange(source: string, startLine: number, startColumn: number, endLine: number, endColumn: number): string {
  const lines = source.split('\n');
  const slice = lines.slice(startLine - 1, endLine);
  if (slice.length === 0) return '';
  slice[0] = slice[0].slice(startColumn);
  slice[slice.length - 1] = slice[slice.length - 1].slice(0, endColumn);
  return slice.join('\n');
}

function findDefinitionFor(
  implementation: SymbolLocation,
  files: ParsedFile[],
  includeSignature = false
): SymbolLocation | undefined {
  for (const file of files) {
    const adapter = getLanguageAdapter(file.language);
    const symbols = adapter.extractSymbols(file.rootNode);
    for (const sym of symbols) {
      if (sym.name !== implementation.symbol) continue;
      if (!sym.isDefinition) continue;

      return adapter.buildSymbolLocation(
        file.path,
        sym.name,
        sym.kind,
        sym.node,
        true,
        false,
        includeSignature,
        false
      );
    }
  }

  return undefined;
}
