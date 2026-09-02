import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { Type } from 'typebox';
import { resolveFindReferences } from '../core/find-references-resolver.js';
import { resolveFindSymbol } from '../core/find-symbol-resolver.js';
import { renderCodeResearchToolResult } from '../render.js';
import type { ClassificationCounts, ConfidenceClassification, FindReferencesInput, FindSymbolInput, ReferenceLocation, SupportedLanguage, SymbolLocation } from '../types.js';

const SUPPORTED_LANGUAGES = ['ts', 'js', 'java', 'go'] as const;

const declarationKinds = [
  'function', 'function_overload', 'callable_variable', 'variable', 'class', 'constructor', 'method', 'getter', 'setter', 'field',
  'interface', 'interface_method', 'property', 'call_signature', 'construct_signature', 'index_signature', 'type_alias', 'enum', 'enum_member',
  'namespace', 'module', 'import_alias', 'export_alias', 'object_method', 'object_property', 'assignment', 'commonjs_export', 'package', 'unknown',
] as const;

function numericCursor(cursor: unknown): number {
  if (typeof cursor !== 'string' || cursor.trim() === '') return 0;
  const parsed = Number(cursor);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function boundedWindow<T>(items: T[], limitValue: unknown, cursorValue: unknown): { items: T[]; offset: number; limit: number; nextCursor?: string } {
  const limit = typeof limitValue === 'number' && Number.isFinite(limitValue)
    ? Math.max(1, Math.min(100, Math.floor(limitValue)))
    : 50;
  const offset = numericCursor(cursorValue);
  const selected = items.slice(offset, offset + limit);
  const nextOffset = offset + selected.length;
  return { items: selected, offset, limit, nextCursor: nextOffset < items.length ? String(nextOffset) : undefined };
}

async function addSourceLines(results: ReferenceLocation[]): Promise<ReferenceLocation[]> {
  const sourceCache = new Map<string, string[] | undefined>();

  async function readLines(file: string): Promise<string[] | undefined> {
    if (!sourceCache.has(file)) {
      const source = await readFile(file, 'utf8').catch(() => undefined);
      sourceCache.set(file, source?.split('\n'));
    }
    return sourceCache.get(file);
  }

  return Promise.all(results.map(async (result) => {
    if (result.source_line) return result;
    const lines = await readLines(result.file);
    const sourceLine = lines?.[result.line - 1]?.trim();
    return sourceLine ? { ...result, source_line: sourceLine } : result;
  }));
}

function formatSymbolItems(cwd: string, query: string, items: SymbolLocation[], total: number, nextCursor?: string): string {
  const rows = items.map((item) => {
    const file = relative(cwd, item.file) || item.file;
    const qualified = item.qualified_name && item.qualified_name !== item.symbol ? ` (${item.qualified_name})` : '';
    const signature = item.signature ? ` · ${item.signature}` : '';
    const header = `${file}:${item.start_line}:${item.start_column}: ${item.symbol}${qualified} [${item.kind}]${signature}`;
    return item.code ? `${header}\n\n\`\`\`\n${item.code}\n\`\`\`` : header;
  });
  const more = nextCursor ? `\n\nMore results available. Re-run code_find with cursor=${nextCursor}.` : '';
  return `Found ${items.length} of ${total} symbol match(es) for '${query}':\n\n${rows.join('\n')}${more}`;
}

function classifyInference(item: { source?: string; reason?: string }): ConfidenceClassification | undefined {
  if (item.source === 'framework') return 'framework';
  if (!item.reason) return undefined;
  if (item.reason === 'receiver-type-contract-method') return 'confirmed';
  if (item.reason.includes('framework')) return 'framework';
  return 'probable';
}

function classificationCounts(items: Array<{ classification?: ConfidenceClassification }>): ClassificationCounts | undefined {
  const counts: ClassificationCounts = {};
  for (const item of items) {
    if (!item.classification) continue;
    counts[item.classification] = (counts[item.classification] ?? 0) + 1;
  }
  return Object.keys(counts).length > 0 ? counts : undefined;
}

function formatClassificationCounts(counts: ClassificationCounts | undefined): string {
  if (!counts) return '';
  const ordered = (['confirmed', 'probable', 'framework'] as const)
    .filter((key) => counts[key])
    .map((key) => `${key}=${counts[key]}`)
    .join(', ');
  return ordered ? `\nclassification counts: ${ordered}` : '';
}

function withReferenceClassifications(items: ReferenceLocation[]): ReferenceLocation[] {
  return items.map((item) => {
    const classification = item.classification ?? classifyInference(item);
    return classification ? { ...item, classification } : item;
  });
}

function formatReferenceItems(cwd: string, query: string, items: ReferenceLocation[], total: number, nextCursor?: string, counts?: ClassificationCounts): string {
  const rows = items.map((item) => {
    const file = relative(cwd, item.file) || item.file;
    const context = item.context_symbol ? ` in ${item.context_symbol}` : '';
    const sourceLine = item.source_line ?? item.called_as ?? '';
    const metadata = [item.classification ? `classification: ${item.classification}` : undefined, item.reason ? `reason: ${item.reason}` : undefined].filter(Boolean).join('; ');
    const suffix = metadata ? ` · ${metadata}` : '';
    return `${file}:${item.line}:${item.column}: ${sourceLine} (${item.reference_kind}${context})${suffix}`;
  });
  const more = nextCursor ? `\n\nMore results available. Re-run code_find with cursor=${nextCursor}.` : '';
  return `Found ${items.length} of ${total} reference(s) for '${query}':${formatClassificationCounts(counts)}\n\n${rows.join('\n')}${more}`;
}

function flattenImplementationResults(results: SymbolLocation[]): SymbolLocation[] {
  const flattened = new Map<string, SymbolLocation>();
  for (const item of results) {
    const implementations = item.implementation_locations ?? [];
    const candidates = implementations.length > 0 ? implementations : item.is_implementation ? [item] : [];
    for (const candidate of candidates) {
      const key = `${candidate.file}:${candidate.symbol}:${candidate.kind}:${candidate.start_line}:${candidate.start_column}`;
      flattened.set(key, candidate);
    }
  }
  return [...flattened.values()].sort((a, b) =>
    a.file.localeCompare(b.file) ||
    a.start_line - b.start_line ||
    a.start_column - b.start_column ||
    a.symbol.localeCompare(b.symbol)
  );
}

async function resolveReferencesAcrossLanguages(cwd: string, input: FindReferencesInput) {
  if (input.language && input.language !== 'auto') return resolveFindReferences(cwd, input);
  const results: ReferenceLocation[] = [];
  const diagnostics: any[] = [];
  for (const language of SUPPORTED_LANGUAGES) {
    try {
      const resolution = await resolveFindReferences(cwd, { ...input, language });
      results.push(...resolution.results);
      diagnostics.push({ language, ...resolution.diagnostics, found: resolution.results.length });
    } catch (error) {
      diagnostics.push({ language, error: error instanceof Error ? error.message : String(error), found: 0 });
    }
  }
  return {
    results,
    diagnostics: {
      source_mode: diagnostics.some((item) => item.source_mode === 'graph') ? 'hybrid' : 'direct',
      graph_status: diagnostics.find((item) => item.graph_status)?.graph_status ?? 'disabled',
      completeness: diagnostics.some((item) => item.completeness === 'complete') ? 'complete' : 'fallback',
      fallback_reason: diagnostics.find((item) => item.fallback_reason)?.fallback_reason ?? 'graph_disabled',
      languages: diagnostics,
    },
  };
}

export function registerCodeFindTool(pi: any) {
  pi.registerTool({
    name: 'code_find',
    label: 'Code Find',
    description: 'Primary symbol search tool for TypeScript/JavaScript, Java, and Go. Use it to find declarations, concrete implementations, and reference/call sites before using text search. For impact analysis, use relation=references; omit reference_kinds to search all supported reference kinds, or pass call/read/implements/extends to narrow. Use relation=implementation on an interface/base type to return implementers, not the interface itself.',
    promptSnippet: 'Find declarations, implementations, or references for supported-language symbols across TS/JS/Java/Go code. Prefer this before rg for supported languages, then use rg only to cross-check suspicious or missing results.',
    promptGuidelines: [
      'Use code_find as the default entry point for supported-language symbol lookup. Use rg only as a validation fallback or for unsupported text/config/doc searches.',
      'Choose relation deliberately: declaration finds where a symbol is defined; implementation finds implementers of an interface/base type; references finds usages/call sites for impact analysis.',
      'For references, omit reference_kinds when you want all supported usages. Use reference_kinds=["call"] only for function/method invocations, ["read"] for value/JSX/type-like reads, and ["implements"|"extends"] for inheritance relationships.',
      'For methods with common names such as execute, run, stop, or handle, provide the declaring file path plus kind=method and language when known to avoid unrelated same-name results.',
      'Use include_code=true only with declaration/implementation and exact matching when you need a bounded source snippet; otherwise prefer include_signature=true for lower noise.',
      'Use match=contains only for broad discovery; it is substring-based and may match unrelated names such as main inside remainder. Prefer exact by default.',
      'Use language=auto for unknown code, but pass ts/js/java/go when known, especially in monorepos.',
      'Use cursor from a previous code_find result when has_more is true instead of broadening the search unnecessarily.',
    ],
    parameters: Type.Object({
      path: Type.String({ description: 'File or directory to search. In monorepos, pass the smallest relevant project/file path when known. Relative paths resolve against the current working directory.' }),
      query: Type.String({ description: 'Exact symbol name to find, such as a function, method, class, interface, variable, field, or enum. Do not include receiver/class prefixes; use kind/path/language to disambiguate.' }),
      relation: Type.Optional(Type.Union([Type.Literal('declaration'), Type.Literal('implementation'), Type.Literal('references')], { description: 'Relationship to find. Default: declaration. Use references for usages/callers; use implementation for implementers of an interface/base type.' })),
      language: Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('ts'), Type.Literal('js'), Type.Literal('java'), Type.Literal('go')], { description: 'Language filter or auto-detection. Default: auto. Pass a concrete language when known to avoid monorepo same-name noise.' })),
      kind: Type.Optional(Type.Union([Type.Literal('function'), Type.Literal('class'), Type.Literal('method'), Type.Literal('interface'), Type.Literal('variable')], { description: 'Coarse symbol kind. Strongly recommended for common names and references.' })),
      declaration_kind: Type.Optional(Type.Union(declarationKinds.map((kind) => Type.Literal(kind)), { description: 'Granular declaration-kind filter for declaration/implementation lookups. Leave unset unless you need a specific AST-level kind.' })),
      match: Type.Optional(Type.Union([Type.Literal('exact'), Type.Literal('prefix'), Type.Literal('contains')], { description: 'Symbol-name match mode. Default: exact. contains is substring/noisy and should be used only for exploratory search.' })),
      include_signature: Type.Optional(Type.Boolean({ description: 'For declarations/implementations, include signatures without full bodies. Prefer this before include_code.' })),
      include_code: Type.Optional(Type.Boolean({ description: 'For exact declaration/implementation lookups, include bounded source snippets where supported. Not intended for broad reference searches.' })),
      scope: Type.Optional(Type.Union([Type.Literal('file'), Type.Literal('directory')], { description: 'Override whether path is treated as a file or directory. Use file to disambiguate one declaration; use directory/project for cross-file references.' })),
      glob: Type.Optional(Type.String({ description: 'Optional glob to restrict files while scanning a directory. Use to limit tests/generated areas when needed.' })),
      reference_kinds: Type.Optional(Type.Array(Type.Union([Type.Literal('call'), Type.Literal('read'), Type.Literal('implements'), Type.Literal('extends')]), { description: 'Only for relation=references. Omit to search all supported reference kinds. Use call for invocations, read for JSX/value/type-like usages, implements/extends for type relationships.' })),
      limit: Type.Optional(Type.Number({ description: 'Maximum items to return in this page. Default 50, max 100.' })),
      cursor: Type.Optional(Type.String({ description: 'Continuation cursor returned by a previous code_find result.' })),
    }, { additionalProperties: false }),
    prepareArguments(args: any) {
      if (!args || typeof args !== 'object') return args;
      if (typeof args.symbol === 'string' && typeof args.query !== 'string') return { ...args, query: args.symbol };
      return args;
    },
    renderResult(result: any, options: any, theme: any) {
      return renderCodeResearchToolResult('code_find', result, options, theme);
    },
    async execute(_toolCallId: any, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const relation = params.relation ?? 'declaration';
      const language = (params.language ?? 'auto') as SupportedLanguage;
      if (relation === 'references') {
        const input: FindReferencesInput = {
          path: params.path,
          symbol: params.query,
          language,
          kind: params.kind,
          scope: params.scope,
          glob: params.glob,
          reference_kinds: params.reference_kinds,
        };
        const resolution = await resolveReferencesAcrossLanguages(ctx.cwd, input);
        const allResults = withReferenceClassifications(await addSourceLines(resolution.results));
        const page = boundedWindow(allResults, params.limit, params.cursor);
        const pageClassificationCounts = classificationCounts(page.items);
        if (allResults.length === 0) {
          return { content: [{ type: 'text', text: `No references found for '${input.symbol}'.` }], details: { query: input.symbol, path: input.path, language: input.language, kind: input.kind, match: params.match, relation, found: 0, items: [], results: [], summary: { returned: 0, total: 0, has_more: false }, provenance: resolution.diagnostics, ...resolution.diagnostics } };
        }
        return {
          content: [{ type: 'text', text: formatReferenceItems(ctx.cwd, input.symbol, page.items, allResults.length, page.nextCursor, pageClassificationCounts) }],
          details: { query: input.symbol, path: input.path, language: input.language, kind: input.kind, match: params.match, relation, found: page.items.length, items: page.items, results: page.items, summary: { returned: page.items.length, total: allResults.length, has_more: Boolean(page.nextCursor), next_cursor: page.nextCursor, offset: page.offset, limit: page.limit, classification_counts: pageClassificationCounts }, provenance: resolution.diagnostics, ...resolution.diagnostics },
        };
      }

      const input: FindSymbolInput = {
        path: params.path,
        symbol: params.query,
        language,
        kind: params.kind,
        declaration_kind: params.declaration_kind,
        include_code: params.include_code ?? false,
        include_signature: params.include_signature ?? false,
        scope: params.scope,
        glob: params.glob,
        search_mode: params.match,
      };
      const resolution = await resolveFindSymbol(ctx.cwd, input);
      const filtered = relation === 'implementation'
        ? flattenImplementationResults(resolution.results)
        : resolution.results;
      const page = boundedWindow(filtered, params.limit, params.cursor);
      if (filtered.length === 0) {
        return { content: [{ type: 'text', text: `No symbol '${input.symbol}' found.` }], details: { query: input.symbol, path: input.path, language: input.language, kind: input.kind, declaration_kind: input.declaration_kind, match: params.match, relation, found: 0, items: [], results: [], summary: { returned: 0, total: 0, has_more: false }, provenance: resolution.diagnostics, ...resolution.diagnostics } };
      }
      return {
        content: [{ type: 'text', text: formatSymbolItems(ctx.cwd, input.symbol, page.items, filtered.length, page.nextCursor) }],
        details: { query: input.symbol, path: input.path, language: input.language, kind: input.kind, declaration_kind: input.declaration_kind, match: params.match, relation, found: page.items.length, items: page.items, results: page.items, summary: { returned: page.items.length, total: filtered.length, has_more: Boolean(page.nextCursor), next_cursor: page.nextCursor, offset: page.offset, limit: page.limit }, provenance: resolution.diagnostics, ...resolution.diagnostics },
      };
    },
  });
}
