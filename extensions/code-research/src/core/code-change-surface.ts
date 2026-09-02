import { relative } from 'node:path';
import { resolveFindReferences } from './find-references-resolver.js';
import { resolveFindSymbol } from './find-symbol-resolver.js';
import { executeReverseFunctionCallTree } from './reverse-function-call-tree-resolver.js';
import type { CallTreeNode, FindReferencesInput, FindSymbolInput, ReferenceLocation, SupportedLanguage, SymbolKind, SymbolLocation } from '../types.js';

const SUPPORTED_LANGUAGES: Exclude<SupportedLanguage, 'auto'>[] = ['ts', 'js', 'java', 'go'];
const SECTION_LIMIT = 5;
const RELATED_TEST_QUERY_LIMIT = 10;

type FollowUp = { tool: 'code_find' | 'code_call_hierarchy'; params: Record<string, unknown>; reason: string };
type BoundedSection<T> = { items: T[]; returned: number; total: number; omitted: number; follow_up?: FollowUp };

export interface CodeChangeSurfaceInput {
  path: string;
  query: string;
  language?: SupportedLanguage;
  kind?: Extract<SymbolKind, 'function' | 'class' | 'method' | 'interface' | 'variable'>;
  scope?: 'file' | 'directory';
  glob?: string;
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

function bounded<T>(items: T[], follow_up?: FollowUp): BoundedSection<T> {
  const selected = items.slice(0, SECTION_LIMIT);
  const omitted = Math.max(0, items.length - selected.length);
  return { items: selected, returned: selected.length, total: items.length, omitted, ...(omitted > 0 && follow_up ? { follow_up } : {}) };
}

function sectionSummary<T>(section: BoundedSection<T>): { returned: number; total: number; omitted: number } {
  return { returned: section.returned, total: section.total, omitted: section.omitted };
}

function rel(cwd: string, file: string | undefined): string {
  if (!file) return '<unknown>';
  const value = relative(cwd, file) || file;
  return value.startsWith('..') ? file : value;
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
  const lines = [
    `Change surface for '${result.query}' in ${result.path}`,
    `Status: ${result.status}; trust=${result.trust.level}; fallback=${result.fallback.required ? 'yes' : 'no'}`,
    count('Contract', result.contract),
    ...result.contract.items.map((item) => `- contract ${rel(cwd, item.file)}:${item.start_line} ${item.qualified_name ?? item.symbol} [${item.kind}]`),
    count('Implementations', result.implementations),
    ...result.implementations.items.map((item) => `- implementation ${rel(cwd, item.file)}:${item.start_line} ${item.qualified_name ?? item.symbol} [${item.kind}]`),
    count('Callers to inspect', result.callers),
    ...result.callers.items.map((item) => `- caller ${rel(cwd, item.file)}:${item.call_line ?? item.line ?? '?'} ${item.class ? `${item.class}.` : ''}${item.symbol}${item.reason ? ` (${item.reason})` : ''}`),
    count('Likely tests', result.likely_tests),
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
  const implementationItems = uniqueBy([
    ...allSymbols.filter((item) => item.is_implementation && !contractItems.some((contract) => keyForLocation(contract) === keyForLocation(item))),
    ...allSymbols.flatMap((item) => item.implementation_locations ?? []),
  ], keyForLocation);

  const referenceCallers = references.results.filter((item) => !isTestLike(item.file) && (item.reference_kind === 'call' || item.reference_kind === 'callback')).map(referenceToCaller);
  const callers = uniqueBy([...hierarchy.callers.filter((item) => !isTestLike(item.file ?? '')), ...referenceCallers], (item) => [item.file, item.symbol, item.class].join('::'));
  const testReferences = uniqueBy([
    ...references.results.filter((item) => isTestLike(item.file)),
    ...await relatedTestReferences(cwd, input, callers, implementationItems),
  ], keyForLocation);

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
  const callerSection = bounded(callers, followUpCodeFind(input, 'references', 'Continue caller/reference inspection for omitted matches.'));
  const likely_tests = bounded(testReferences, followUpCodeFind(input, 'references', 'Continue test reference inspection for omitted matches.'));

  for (const section of [contract, implementations, callerSection, likely_tests]) {
    if (section.follow_up) fallbackActions.push(section.follow_up);
  }
  if (status === 'ready' && callers.length === 0 && (input.kind === 'function' || input.kind === 'method' || input.kind === 'class' || !input.kind)) fallbackActions.push(followUpHierarchy(input, 'Inspect incoming hierarchy if reference lookup is incomplete.'));

  const validation_suggestions = [
    likely_tests.total > 0 ? 'Review likely affected test files before editing; run the repository-specific test command for those files when known.' : 'No exact test runner is inferred; search for nearby test files and run the repository-specific focused tests when known.',
    ...uniqueBy([...contract.items, ...implementations.items, ...callerSection.items], (item: any) => item.file).slice(0, 4).map((item: any) => `Include file-oriented validation around ${rel(cwd, item.file)}.`),
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
    validation_suggestions,
    risks: [...risks],
    trust,
    fallback,
    summary,
    diagnostics: { declarations: declarations.diagnostics, references: references.diagnostics, hierarchy: hierarchy.diagnostics },
  };
  return { ...partial, content: formatContent(cwd, partial) };
}
