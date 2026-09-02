import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve as resolvePath } from 'node:path';
import { resolveFindReferences } from './find-references-resolver.js';
import { resolveFindSymbol } from './find-symbol-resolver.js';
import { executeReverseFunctionCallTree } from './reverse-function-call-tree-resolver.js';
import { readSubprojectGraphShard, readWorkspaceGraphManifest, readWorkspaceGraphState } from './graph-persistence.js';
import type { CallTreeNode, FindReferencesInput, FindSymbolInput, GraphNode, ReferenceLocation, SupportedLanguage, SymbolKind, SymbolLocation } from '../types.js';

const SUPPORTED_LANGUAGES: Exclude<SupportedLanguage, 'auto'>[] = ['ts', 'js', 'java', 'go'];
const SECTION_LIMIT = 5;
const RELATED_TEST_QUERY_LIMIT = 10;
const MAX_EXHAUSTIVE_SECTION_LIMIT = 100;

type FollowUp = { tool: 'code_find' | 'code_call_hierarchy'; params: Record<string, unknown>; reason: string };
type BoundedSection<T> = { items: T[]; returned: number; total: number; omitted: number; follow_up?: FollowUp };
type SurfaceMode = 'representative' | 'exhaustive';
type TestReportingMode = 'complete' | 'representative' | 'exhaustive' | 'exhaustive-truncated';
type SectionReporting = { mode: TestReportingMode; evidence_total: number; files_total?: number; limit?: number; reason?: string };

export interface CodeChangeSurfaceInput {
  path: string;
  query: string;
  language?: SupportedLanguage;
  kind?: Extract<SymbolKind, 'function' | 'class' | 'method' | 'interface' | 'variable'>;
  scope?: 'file' | 'directory';
  glob?: string;
  test_mode?: SurfaceMode;
  caller_mode?: SurfaceMode;
  max_tests?: number;
  max_callers?: number;
}

export interface CodeChangeSurfaceResult {
  status: 'ready' | 'needs_fallback';
  query: string;
  path: string;
  language: SupportedLanguage;
  kind?: CodeChangeSurfaceInput['kind'];
  contract: BoundedSection<SymbolLocation>;
  implementations: BoundedSection<SymbolLocation>;
  callers: BoundedSection<CallTreeNode>;
  likely_tests: BoundedSection<ReferenceLocation>;
  caller_reporting: SectionReporting;
  test_reporting: SectionReporting;
  validation_suggestions: string[];
  risks: string[];
  trust: { level: 'high' | 'medium' | 'low'; reasons: string[] };
  fallback: { required: boolean; reason?: string; actions: FollowUp[] };
  summary: Record<string, { returned: number; total: number; omitted: number }>;
  content: string;
  diagnostics: Record<string, unknown>;
}

function isTestLike(file: string): boolean {
  return /(^|\/)(test|tests|spec|__tests__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|Test\.(java|go)$/u.test(file.replace(/\\/g, '/'));
}

function keyForLocation(item: { file?: string; symbol?: string; start_line?: number; start_column?: number; line?: number; column?: number; context_symbol?: string; class?: string }): string {
  return [item.file, item.symbol, item.context_symbol, item.class, item.start_line ?? item.line, item.start_column ?? item.column].join('::');
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) continue;
    seen.add(value);
    unique.push(item);
  }
  return unique;
}

function uniqueBestBy<T>(items: T[], key: (item: T) => string, score: (item: T) => number): T[] {
  const selected = new Map<string, T>();
  for (const item of items) {
    const value = key(item);
    const existing = selected.get(value);
    if (!existing || score(item) > score(existing)) selected.set(value, item);
  }
  return [...selected.values()];
}

function bounded<T>(items: T[], follow_up?: FollowUp, limit = SECTION_LIMIT): BoundedSection<T> {
  const selected = items.slice(0, limit);
  const omitted = Math.max(0, items.length - selected.length);
  return { items: selected, returned: selected.length, total: items.length, omitted, ...(omitted > 0 && follow_up ? { follow_up } : {}) };
}

function normalizedLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(MAX_EXHAUSTIVE_SECTION_LIMIT, Math.floor(value as number)));
}

function sectionSummary<T>(section: BoundedSection<T>): { returned: number; total: number; omitted: number } {
  return { returned: section.returned, total: section.total, omitted: section.omitted };
}

function rel(cwd: string, file: string | undefined): string {
  if (!file) return '<unknown>';
  const value = relative(cwd, file) || file;
  return value.startsWith('..') ? file : value;
}

function canonicalFile(cwd: string, file: string | undefined): string {
  if (!file) return '<unknown>';
  const absolute = isAbsolute(file) ? file : resolvePath(cwd, file);
  const value = relative(cwd, absolute).replace(/\\/g, '/');
  return value && !value.startsWith('..') ? value : absolute.replace(/\\/g, '/');
}

function searchRootForInput(cwd: string, inputPath: string): string {
  const normalized = canonicalFile(cwd, inputPath);
  const srcIndex = normalized.indexOf('/src/');
  if (srcIndex > 0) return normalized.slice(0, srcIndex);
  if (normalized.startsWith('src/')) return 'src';
  return dirname(normalized) === '.' ? normalized : dirname(normalized);
}

function ownerName(item: SymbolLocation): string | undefined {
  return item.owner ?? item.qualified_name?.split('.').slice(0, -1).join('.');
}

function simpleName(value: string | undefined): string | undefined {
  return value?.split('.').pop();
}

function callerKey(cwd: string, item: CallTreeNode): string {
  return [canonicalFile(cwd, item.file), item.class ?? '', item.symbol, item.call_line ?? item.line ?? '', item.call_column ?? item.column ?? ''].join('::');
}

function callerMetadataScore(item: CallTreeNode): number {
  return [item.called_as, item.receiver_name, item.receiver_type, item.classification, item.reason, item.signature].filter(Boolean).length;
}

function referenceMetadataScore(item: ReferenceLocation): number {
  return [item.called_as, item.receiver_name, item.receiver_type, item.context_symbol, item.context_class, item.classification, item.reason, item.source_line].filter(Boolean).length;
}

function isFileLevelTestImport(item: ReferenceLocation): boolean {
  return item.context_symbol === '<test-file-import>' || item.reason === 'test imports change-surface file';
}

function likelyTestScore(cwd: string, item: ReferenceLocation, query: string): number {
  const file = canonicalFile(cwd, item.file);
  let score = referenceMetadataScore(item);
  if (/(^|\/)unit(\/|$)/u.test(file)) score += 40;
  if (/(^|\/)integration(\/|$)/u.test(file)) score += 10;
  if (item.reference_kind === 'call' || item.reference_kind === 'callback' || item.reference_kind === 'method_reference') score += 40;
  if (item.reference_kind === 'import') score += isFileLevelTestImport(item) ? 1 : 5;
  if ((item.called_as ?? item.source_line ?? '').includes(query)) score += 20;
  return score;
}

async function resolveReferencesAcrossLanguages(cwd: string, input: FindReferencesInput) {
  const graphFirstInput = { ...input, compare_direct_fallback: false };
  if (input.language && input.language !== 'auto') return resolveFindReferences(cwd, graphFirstInput);
  const results: ReferenceLocation[] = [];
  const diagnostics: unknown[] = [];
  for (const language of SUPPORTED_LANGUAGES) {
    try {
      const resolved = await resolveFindReferences(cwd, { ...graphFirstInput, language });
      results.push(...resolved.results);
      diagnostics.push({ language, found: resolved.results.length, diagnostics: resolved.diagnostics });
    } catch (error) {
      diagnostics.push({ language, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { results, diagnostics: { languages: diagnostics } };
}

async function findImplementationMethods(cwd: string, input: CodeChangeSurfaceInput, contractItems: SymbolLocation[]): Promise<{ implementations: SymbolLocation[]; diagnostics: unknown[] }> {
  if (input.kind && input.kind !== 'method') return { implementations: [], diagnostics: [] };
  const searchPath = searchRootForInput(cwd, input.path);
  const diagnostics: unknown[] = [];
  const implementationOwners = new Set<string>();

  for (const contract of contractItems) {
    const owner = ownerName(contract);
    if (!owner) continue;
    try {
      const implementers = await resolveReferencesAcrossLanguages(cwd, {
        path: searchPath,
        symbol: simpleName(owner) ?? owner,
        language: input.language ?? 'auto',
        kind: 'interface',
        scope: 'directory',
        reference_kinds: ['implements'],
      });
      diagnostics.push({ owner, implementations: implementers.results.length, diagnostics: implementers.diagnostics });
      for (const item of implementers.results) {
        if (item.context_class) implementationOwners.add(item.context_class);
        if (item.context_symbol) implementationOwners.add(item.context_symbol);
      }
    } catch (error) {
      diagnostics.push({ owner, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const contractOwners = new Set(contractItems.map(ownerName).filter((value): value is string => Boolean(value)));
  const contractOwnerSimple = new Set([...contractOwners].map(simpleName).filter((value): value is string => Boolean(value)));
  try {
    const symbols = await resolveFindSymbol(cwd, {
      path: searchPath,
      symbol: input.query,
      language: input.language ?? 'auto',
      kind: 'method',
      include_signature: true,
      scope: 'directory',
    });
    diagnostics.push({ method_search: symbols.diagnostics, found: symbols.results.length });
    const implementations = symbols.results.filter((item) => {
      if (!item.is_implementation || isTestLike(item.file)) return false;
      const owner = ownerName(item);
      const simpleOwner = simpleName(owner);
      if (!owner || contractOwners.has(owner) || contractOwnerSimple.has(simpleOwner ?? '')) return false;
      if (implementationOwners.size > 0) return implementationOwners.has(owner) || implementationOwners.has(simpleOwner ?? '');
      return contractItems.some((contract) => contract.declaration_kind === 'interface_method' || contract.kind === 'interface');
    });
    return { implementations: uniqueBestBy(implementations, (item) => keyForLocation(item), () => 1), diagnostics };
  } catch (error) {
    diagnostics.push({ method_search_error: error instanceof Error ? error.message : String(error) });
    return { implementations: [], diagnostics };
  }
}

async function incomingCallers(cwd: string, input: CodeChangeSurfaceInput): Promise<{ callers: CallTreeNode[]; diagnostics: unknown[] }> {
  const languages = input.language && input.language !== 'auto' ? [input.language] : SUPPORTED_LANGUAGES;
  const diagnostics: unknown[] = [];
  for (const language of languages) {
    try {
      const execution = await executeReverseFunctionCallTree(cwd, {
        path: input.path,
        symbol: input.query,
        language,
        kind: input.kind,
        max_depth: 2,
      });
      diagnostics.push({ language, status: execution.status });
      if (execution.status === 'ok') return { callers: execution.result.root.callers ?? [], diagnostics };
      if (execution.status === 'ambiguous') return { callers: [], diagnostics: [...diagnostics, execution.details] };
    } catch (error) {
      diagnostics.push({ language, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { callers: [], diagnostics };
}

function referenceToCaller(reference: ReferenceLocation): CallTreeNode {
  return {
    file: reference.file,
    symbol: reference.context_symbol ?? '<top-level>',
    kind: reference.context_kind ?? 'function',
    node_type: 'application',
    class: reference.context_class,
    owner_kind: reference.owner_kind ?? 'module',
    line: reference.line,
    column: reference.column,
    start_line: reference.line,
    start_column: reference.column,
    end_line: reference.end_line ?? reference.line,
    end_column: reference.end_column ?? reference.column,
    called_as: reference.called_as,
    receiver_name: reference.receiver_name,
    receiver_type: reference.receiver_type,
    call_line: reference.line,
    call_column: reference.column,
    is_application: true,
    is_external: false,
    source: reference.source,
    classification: reference.classification,
    reason: reference.reason,
  };
}

function followUpCodeFind(input: CodeChangeSurfaceInput, relation: 'declaration' | 'implementation' | 'references', reason: string): FollowUp {
  return {
    tool: 'code_find',
    params: { path: input.path, query: input.query, relation, language: input.language ?? 'auto', ...(input.kind ? { kind: input.kind } : {}), ...(input.scope ? { scope: input.scope } : {}), ...(input.glob ? { glob: input.glob } : {}) },
    reason,
  };
}

async function implementationCallers(cwd: string, input: CodeChangeSurfaceInput, implementations: SymbolLocation[]): Promise<{ callers: CallTreeNode[]; diagnostics: unknown[] }> {
  const callers: CallTreeNode[] = [];
  const diagnostics: unknown[] = [];
  for (const implementation of implementations.filter((item) => !isTestLike(item.file)).slice(0, RELATED_TEST_QUERY_LIMIT)) {
    try {
      const result = await incomingCallers(cwd, { ...input, path: implementation.file, query: implementation.symbol, kind: implementation.kind === 'method' ? 'method' : input.kind });
      callers.push(...result.callers);
      diagnostics.push({ implementation: implementation.qualified_name ?? implementation.symbol, diagnostics: result.diagnostics });
    } catch (error) {
      diagnostics.push({ implementation: implementation.qualified_name ?? implementation.symbol, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { callers, diagnostics };
}

function findNearestTestName(lines: string[], lineIndex: number): string | undefined {
  for (let index = lineIndex; index >= 0; index -= 1) {
    const line = lines[index] ?? '';
    const match = line.match(/\b(?:it|test)\s*\(\s*['"`]([^'"`]+)/u) ?? line.match(/@Test\b/u);
    if (match?.[1]) return match[1];
    if (match) {
      for (let cursor = index + 1; cursor < Math.min(lines.length, index + 6); cursor += 1) {
        const method = lines[cursor]?.match(/\b(?:void|public\s+void|private\s+void)\s+([A-Za-z_$][\w$]*)\s*\(/u);
        if (method?.[1]) return method[1];
      }
    }
  }
  return undefined;
}

async function enrichFileLevelTestImports(cwd: string, imports: ReferenceLocation[], terms: string[]): Promise<ReferenceLocation[]> {
  const uniqueTerms = [...new Set(terms.filter(Boolean))];
  if (uniqueTerms.length === 0) return imports;
  const enriched: ReferenceLocation[] = [];
  for (const item of imports) {
    if (!isFileLevelTestImport(item) && item.reference_kind !== 'import') {
      enriched.push(item);
      continue;
    }
    const source = await readFile(item.file, 'utf8').catch(() => undefined);
    if (!source) {
      enriched.push(item);
      continue;
    }
    const lines = source.split('\n');
    let best: ReferenceLocation | undefined;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      const term = uniqueTerms.find((candidate) => line.includes(candidate));
      if (!term) continue;
      const column = line.indexOf(term);
      const candidate: ReferenceLocation = {
        ...item,
        line: index + 1,
        column: Math.max(0, column),
        reference_kind: line.includes(`${term}(`) || line.includes(`.${term}`) ? 'call' : 'read',
        called_as: line.trim(),
        source_line: line.trim(),
        context_symbol: findNearestTestName(lines, index) ?? term,
        reason: `test references ${term}`,
      };
      if (!best || likelyTestScore(cwd, candidate, term) > likelyTestScore(cwd, best, term)) best = candidate;
    }
    enriched.push(best ?? item);
  }
  return enriched;
}

async function graphTestImportsForFiles(cwd: string, input: CodeChangeSurfaceInput, files: string[]): Promise<ReferenceLocation[]> {
  const state = await readWorkspaceGraphState(cwd);
  const manifest = await readWorkspaceGraphManifest(cwd);
  if (state.status !== 'ok' || manifest.status !== 'ok') return [];
  if (state.data.status !== 'fresh' && state.data.status !== 'stale') return [];

  const candidateFiles = new Set(files.map((file) => canonicalFile(cwd, file)));
  if (candidateFiles.size === 0) return [];

  const references: ReferenceLocation[] = [];
  for (const subproject of manifest.data.subprojects) {
    const shard = await readSubprojectGraphShard(cwd, subproject.id, { generation: subproject.generation });
    if (shard.status !== 'ok') continue;
    const nodeById = new Map<string, GraphNode>(shard.data.nodes.map((node) => [node.id, node]));
    for (const edge of shard.data.edges) {
      if (edge.kind !== 'imports') continue;
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (from?.kind !== 'file' || to?.kind !== 'file') continue;
      if (!isTestLike(from.path) || !candidateFiles.has(to.path)) continue;
      references.push({
        file: resolvePath(cwd, from.path),
        line: 1,
        column: 0,
        symbol: input.query,
        kind: input.kind ?? 'unknown',
        context_symbol: '<test-file-import>',
        context_kind: 'function',
        owner_kind: 'module',
        reference_kind: 'import',
        called_as: edge.importSource,
        is_application: true,
        source: 'application',
        reason: 'test imports change-surface file',
      });
    }
  }
  return references;
}

async function relatedTestReferences(cwd: string, input: CodeChangeSurfaceInput, callers: CallTreeNode[], implementations: SymbolLocation[]): Promise<ReferenceLocation[]> {
  const queries = uniqueBy([
    ...callers.map((item) => ({ path: item.file, query: item.symbol, kind: item.kind === 'method' || item.kind === 'function' ? item.kind : undefined })),
    ...implementations.map((item) => ({ path: item.file, query: item.symbol, kind: item.kind === 'class' || item.kind === 'function' || item.kind === 'method' || item.kind === 'interface' || item.kind === 'variable' ? item.kind : undefined })),
  ].filter((item): item is { path: string; query: string; kind?: CodeChangeSurfaceInput['kind'] } => Boolean(item.path && item.query && item.query !== '<top-level>')), (item) => `${item.path}:${item.query}:${item.kind ?? ''}`).slice(0, RELATED_TEST_QUERY_LIMIT);

  const tests: ReferenceLocation[] = [];
  for (const query of queries) {
    try {
      const references = await resolveReferencesAcrossLanguages(cwd, {
        path: query.path,
        symbol: query.query,
        language: input.language ?? 'auto',
        kind: query.kind,
        scope: input.scope,
        glob: input.glob,
      });
      tests.push(...references.results.filter((item) => isTestLike(item.file)));
    } catch {
      // Related test discovery is best-effort; fallback actions already cover uncertain surfaces.
    }
  }
  return tests;
}

function followUpHierarchy(input: CodeChangeSurfaceInput, reason: string): FollowUp {
  return {
    tool: 'code_call_hierarchy',
    params: { path: input.path, symbol: input.query, direction: 'incoming', language: input.language ?? 'auto', ...(input.kind && input.kind !== 'interface' && input.kind !== 'variable' ? { kind: input.kind } : {}), max_depth: 3 },
    reason,
  };
}

function formatContent(cwd: string, result: Omit<CodeChangeSurfaceResult, 'content'>): string {
  const count = (label: string, section: BoundedSection<unknown>) => `${label}: ${section.returned}/${section.total}${section.omitted > 0 ? ` (${section.omitted} omitted)` : ''}`;
  const reporting = (item: SectionReporting): string => {
    const label = item.mode === 'exhaustive' || item.mode === 'exhaustive-truncated' ? `${item.mode} over Code Research semantic evidence` : item.mode;
    const parts = [label];
    if (item.mode === 'representative' || item.files_total !== undefined) parts.push(`${item.evidence_total} evidence matches${item.files_total !== undefined ? ` across ${item.files_total} files` : ''}`);
    if (item.limit !== undefined && (item.mode === 'exhaustive' || item.mode === 'exhaustive-truncated')) parts.push(`limit ${item.limit}`);
    return parts.length > 1 ? `${parts[0]} (${parts.slice(1).join('; ')})` : parts[0];
  };
  const lines = [
    `Change surface for '${result.query}' in ${result.path}`,
    `Status: ${result.status}; trust=${result.trust.level}; fallback=${result.fallback.required ? 'yes' : 'no'}`,
    count('Contract', result.contract),
    ...result.contract.items.map((item) => `- contract ${rel(cwd, item.file)}:${item.start_line} ${item.qualified_name ?? item.symbol} [${item.kind}]`),
    count('Implementations', result.implementations),
    ...result.implementations.items.map((item) => `- implementation ${rel(cwd, item.file)}:${item.start_line} ${item.qualified_name ?? item.symbol} [${item.kind}]`),
    count('Callers to inspect', result.callers),
    `Caller reporting: ${reporting(result.caller_reporting)}`,
    ...result.callers.items.map((item) => `- caller ${rel(cwd, item.file)}:${item.call_line ?? item.line ?? '?'} ${item.class ? `${item.class}.` : ''}${item.symbol}${item.reason ? ` (${item.reason})` : ''}`),
    count('Likely tests', result.likely_tests),
    `Test reporting: ${reporting(result.test_reporting)}`,
    ...result.likely_tests.items.map((item) => `- test ${rel(cwd, item.file)}:${item.line} ${item.context_symbol ?? item.called_as ?? item.symbol}`),
    'Validation suggestions:',
    ...result.validation_suggestions.map((item) => `- ${item}`),
    'Risks:',
    ...result.risks.map((item) => `- ${item}`),
  ];
  if (result.fallback.actions.length > 0) {
    lines.push('Follow-up inspection actions:');
    for (const action of result.fallback.actions) lines.push(`- ${action.tool} ${JSON.stringify(action.params)} — ${action.reason}`);
  }
  return lines.join('\n');
}

export async function buildCodeChangeSurface(cwd: string, input: CodeChangeSurfaceInput): Promise<CodeChangeSurfaceResult> {
  const language = input.language ?? 'auto';
  const symbolInput: FindSymbolInput = { path: input.path, symbol: input.query, language, kind: input.kind, include_signature: true, scope: input.scope, glob: input.glob };
  const declarations = await resolveFindSymbol(cwd, symbolInput);
  const references = await resolveReferencesAcrossLanguages(cwd, { path: input.path, symbol: input.query, language, kind: input.kind, scope: input.scope, glob: input.glob });
  const hierarchy = input.kind === 'function' || input.kind === 'method' || input.kind === 'class' || !input.kind ? await incomingCallers(cwd, input) : { callers: [], diagnostics: [] };

  const allSymbols = declarations.results;
  const contractCandidates = allSymbols.filter((item) => item.kind === 'interface' || item.declaration_kind === 'interface_method' || item.is_definition && !item.is_implementation);
  const contractItems = contractCandidates.length > 0 ? contractCandidates : allSymbols.filter((item) => item.is_definition).slice(0, 1);
  const expandedImplementations = await findImplementationMethods(cwd, input, contractItems);
  const implementationItems = uniqueBestBy([
    ...allSymbols.filter((item) => item.is_implementation && !contractItems.some((contract) => keyForLocation(contract) === keyForLocation(item))),
    ...allSymbols.flatMap((item) => item.implementation_locations ?? []),
    ...expandedImplementations.implementations,
  ], keyForLocation, () => 1);

  const implementationIncoming = await implementationCallers(cwd, input, implementationItems);
  const referenceCallers = references.results.filter((item) => !isTestLike(item.file) && (item.reference_kind === 'call' || item.reference_kind === 'callback')).map(referenceToCaller);
  const callers = uniqueBestBy([...hierarchy.callers.filter((item) => !isTestLike(item.file ?? '')), ...implementationIncoming.callers.filter((item) => !isTestLike(item.file ?? '')), ...referenceCallers], (item) => callerKey(cwd, item), callerMetadataScore);
  const callerLimit = input.caller_mode === 'exhaustive' ? normalizedLimit(input.max_callers, 50) : SECTION_LIMIT;
  const surfaceFiles = [...contractItems, ...implementationItems, ...callers].map((item: any) => item.file).filter((file: unknown): file is string => typeof file === 'string');
  const testTerms = [input.query, ...callers.map((item) => item.symbol), ...implementationItems.map((item) => item.symbol), ...implementationItems.map((item) => simpleName(ownerName(item)) ?? '')];
  const rawTestReferences = await enrichFileLevelTestImports(cwd, [
    ...references.results.filter((item) => isTestLike(item.file)),
    ...await relatedTestReferences(cwd, input, callers, implementationItems),
    ...await graphTestImportsForFiles(cwd, input, surfaceFiles),
  ], testTerms);
  const representativeTestReferences = uniqueBestBy(rawTestReferences, (item) => canonicalFile(cwd, item.file), (item) => likelyTestScore(cwd, item, input.query));
  const exhaustiveTestReferences = uniqueBestBy(rawTestReferences, (item) => keyForLocation(item), (item) => likelyTestScore(cwd, item, input.query));
  const testReferences = (input.test_mode === 'exhaustive' ? exhaustiveTestReferences : representativeTestReferences)
    .sort((a, b) => likelyTestScore(cwd, b, input.query) - likelyTestScore(cwd, a, input.query) || canonicalFile(cwd, a.file).localeCompare(canonicalFile(cwd, b.file)) || (a.line ?? 0) - (b.line ?? 0));
  const testLimit = input.test_mode === 'exhaustive' ? normalizedLimit(input.max_tests, 50) : SECTION_LIMIT;
  const test_reporting: SectionReporting = input.test_mode === 'exhaustive'
    ? { mode: testReferences.length > testLimit ? 'exhaustive-truncated' as const : 'exhaustive' as const, evidence_total: exhaustiveTestReferences.length, files_total: representativeTestReferences.length, limit: testLimit, ...(testReferences.length > testLimit ? { reason: `Exhaustive test evidence was truncated to max_tests=${testLimit}.` } : {}) }
    : rawTestReferences.length > representativeTestReferences.length
      ? { mode: 'representative' as const, evidence_total: rawTestReferences.length, files_total: representativeTestReferences.length, reason: 'Multiple test evidence matches were collapsed to one representative entry per file.' }
      : { mode: 'complete' as const, evidence_total: rawTestReferences.length, files_total: representativeTestReferences.length };

  const fallbackActions: FollowUp[] = [];
  let status: CodeChangeSurfaceResult['status'] = 'ready';
  let fallbackReason: string | undefined;
  if (contractItems.length === 0) {
    status = 'needs_fallback';
    fallbackReason = 'No declaration or contract anchor was found; no edits are guessed.';
    fallbackActions.push(followUpCodeFind(input, 'declaration', 'Confirm the symbol name, kind, language, or path.'));
    fallbackActions.push(followUpCodeFind(input, 'references', 'Check whether usages exist under a different declaration shape.'));
  }

  const risks = new Set<string>();
  if (references.results.some((item) => item.reason === 'receiver-type-contract-method' || item.classification === 'probable') || (contractItems.some((item) => item.declaration_kind === 'interface_method' || item.kind === 'interface') && callers.length > 0)) risks.add('Interface-mediated or heuristic edges are present; inspect contract and concrete implementations before editing.');
  if ((declarations.diagnostics as any).completeness !== 'complete') risks.add('Symbol lookup used direct or fallback inspection; generated/dynamic code may be incomplete.');
  if (implementationItems.length === 0 && contractItems.some((item) => item.kind === 'interface' || item.declaration_kind === 'interface_method')) risks.add('No concrete implementation was confirmed; inspect implementers before editing.');
  if (callers.length === 0 && status === 'ready') risks.add('No callers were confirmed; validate with a focused references query before assuming no impact.');

  const contract = bounded(contractItems, followUpCodeFind(input, 'declaration', 'Continue contract/declaration inspection for omitted matches.'));
  const implementations = bounded(implementationItems, followUpCodeFind(input, 'implementation', 'Continue implementation inspection for omitted matches.'));
  const callerSection = bounded(callers, followUpCodeFind(input, 'references', 'Continue caller/reference inspection for omitted matches.'), callerLimit);
  const likely_tests = bounded(testReferences, followUpCodeFind(input, 'references', 'Continue test reference inspection for omitted matches.'), testLimit);
  const caller_reporting: SectionReporting = input.caller_mode === 'exhaustive'
    ? { mode: callerSection.omitted > 0 ? 'exhaustive-truncated' : 'exhaustive', evidence_total: callers.length, limit: callerLimit, ...(callerSection.omitted > 0 ? { reason: `Exhaustive caller evidence was truncated to max_callers=${callerLimit}.` } : {}) }
    : { mode: callerSection.omitted > 0 ? 'representative' : 'complete', evidence_total: callers.length, limit: callerLimit, ...(callerSection.omitted > 0 ? { reason: 'Caller evidence was capped to representative entries.' } : {}) };

  for (const section of [contract, implementations, callerSection, likely_tests]) {
    if (section.follow_up) fallbackActions.push(section.follow_up);
  }
  if (status === 'ready' && callers.length === 0 && (input.kind === 'function' || input.kind === 'method' || input.kind === 'class' || !input.kind)) fallbackActions.push(followUpHierarchy(input, 'Inspect incoming hierarchy if reference lookup is incomplete.'));

  const validation_suggestions = [
    likely_tests.total > 0 ? 'Review likely affected test files before editing; run the repository-specific test command for those files when known.' : 'No exact test runner is inferred; search for nearby test files and run the repository-specific focused tests when known.',
    ...uniqueBy([...contract.items, ...implementations.items, ...callerSection.items], (item: any) => canonicalFile(cwd, item.file)).slice(0, 4).map((item: any) => `Include file-oriented validation around ${rel(cwd, item.file)}.`),
  ];

  const trustReasons: string[] = [];
  if (status === 'needs_fallback') trustReasons.push(fallbackReason ?? 'Fallback inspection is required.');
  if (risks.size > 0) trustReasons.push(...risks);
  const omitted = [contract, implementations, callerSection, likely_tests].some((section) => section.omitted > 0);
  if (omitted) trustReasons.push('One or more sections were capped; use follow-up actions for the omitted items.');
  const trust = { level: (status === 'needs_fallback' ? 'low' : risks.size > 0 || omitted ? 'medium' : 'high') as 'high' | 'medium' | 'low', reasons: trustReasons };

  const fallback = { required: status === 'needs_fallback' || omitted, ...(fallbackReason ? { reason: fallbackReason } : {}), actions: uniqueBy(fallbackActions, (action) => `${action.tool}:${JSON.stringify(action.params)}`) };
  const summary = { contract: sectionSummary(contract), implementations: sectionSummary(implementations), callers: sectionSummary(callerSection), likely_tests: sectionSummary(likely_tests) };
  const partial: Omit<CodeChangeSurfaceResult, 'content'> = {
    status,
    query: input.query,
    path: input.path,
    language,
    kind: input.kind,
    contract,
    implementations,
    callers: callerSection,
    likely_tests,
    caller_reporting,
    test_reporting,
    validation_suggestions,
    risks: [...risks],
    trust,
    fallback,
    summary,
    diagnostics: { declarations: declarations.diagnostics, references: references.diagnostics, hierarchy: hierarchy.diagnostics, implementation_expansion: expandedImplementations.diagnostics, implementation_hierarchy: implementationIncoming.diagnostics, caller_reporting, test_reporting },
  };
  return { ...partial, content: formatContent(cwd, partial) };
}
