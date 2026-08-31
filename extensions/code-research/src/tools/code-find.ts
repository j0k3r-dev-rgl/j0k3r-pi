import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { Type } from 'typebox';
import { resolveFindReferences } from '../core/find-references-resolver.js';
import { resolveFindSymbol } from '../core/find-symbol-resolver.js';
import { renderCodeResearchToolResult } from '../render.js';
import type { FindReferencesInput, FindSymbolInput, ReferenceLocation, SupportedLanguage, SymbolLocation } from '../types.js';

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
    return `${file}:${item.start_line}:${item.start_column}: ${item.symbol}${qualified} [${item.kind}]${signature}`;
  });
  const more = nextCursor ? `\n\nMore results available. Re-run code_find with cursor=${nextCursor}.` : '';
  return `Found ${items.length} of ${total} symbol match(es) for '${query}':\n\n${rows.join('\n')}${more}`;
}

function formatReferenceItems(cwd: string, query: string, items: ReferenceLocation[], total: number, nextCursor?: string): string {
  const rows = items.map((item) => {
    const file = relative(cwd, item.file) || item.file;
    const context = item.context_symbol ? ` in ${item.context_symbol}` : '';
    const sourceLine = item.source_line ?? item.called_as ?? '';
    return `${file}:${item.line}:${item.column}: ${sourceLine} (${item.reference_kind}${context})`;
  });
  const more = nextCursor ? `\n\nMore results available. Re-run code_find with cursor=${nextCursor}.` : '';
  return `Found ${items.length} of ${total} reference(s) for '${query}':\n\n${rows.join('\n')}${more}`;
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
    description: 'Universal symbol-aware code finder for TypeScript, JavaScript, Java, and Go. Locate declarations/implementations or references for functions, methods, classes, interfaces, variables, fields, and related symbols.',
    promptSnippet: 'Find declarations, implementations, or references for supported-language symbols across TS/JS/Java/Go code.',
    promptGuidelines: [
      'Use code_find as the default code research entry point for supported-language symbol lookup or references.',
      'Use relation=declaration or relation=implementation to locate symbols; use relation=references for usages and impact analysis.',
      'Use language=auto unless a specific supported language is known; supported languages are ts, js, java, and go only.',
      'Use cursor from a previous code_find result when has_more is true instead of broadening the search unnecessarily.',
    ],
    parameters: Type.Object({
      path: Type.String({ description: 'File or directory to search. Relative paths resolve against the current working directory.' }),
      query: Type.String({ description: 'Symbol name to find, such as a variable, function, method, class, interface, field, or enum.' }),
      relation: Type.Optional(Type.Union([Type.Literal('declaration'), Type.Literal('implementation'), Type.Literal('references')], { description: 'What relationship to find. Default: declaration.' })),
      language: Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('ts'), Type.Literal('js'), Type.Literal('java'), Type.Literal('go')], { description: 'Language filter or auto-detection. Default: auto.' })),
      kind: Type.Optional(Type.Union([Type.Literal('function'), Type.Literal('class'), Type.Literal('method'), Type.Literal('interface'), Type.Literal('variable')], { description: 'Optional coarse symbol kind filter.' })),
      declaration_kind: Type.Optional(Type.Union(declarationKinds.map((kind) => Type.Literal(kind)), { description: 'Optional granular declaration-kind filter for declaration/implementation lookups.' })),
      match: Type.Optional(Type.Union([Type.Literal('exact'), Type.Literal('prefix'), Type.Literal('contains')], { description: 'Symbol-name match mode. Default: exact.' })),
      include_signature: Type.Optional(Type.Boolean({ description: 'For declarations/implementations, include signatures without bodies.' })),
      include_code: Type.Optional(Type.Boolean({ description: 'For exact declaration/implementation lookups, include bounded executable source where supported.' })),
      scope: Type.Optional(Type.Union([Type.Literal('file'), Type.Literal('directory')], { description: 'Override whether path is treated as a file or directory.' })),
      glob: Type.Optional(Type.String({ description: 'Optional glob pattern to filter files while scanning a directory.' })),
      reference_kinds: Type.Optional(Type.Array(Type.Union([Type.Literal('call'), Type.Literal('read'), Type.Literal('implements'), Type.Literal('extends')]), { description: 'Optional reference kind filter for relation=references.' })),
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
        const allResults = await addSourceLines(resolution.results);
        const page = boundedWindow(allResults, params.limit, params.cursor);
        if (allResults.length === 0) {
          return { content: [{ type: 'text', text: `No references found for '${input.symbol}'.` }], details: { relation, found: 0, items: [], results: [], summary: { returned: 0, total: 0, has_more: false }, provenance: resolution.diagnostics, ...resolution.diagnostics } };
        }
        return {
          content: [{ type: 'text', text: formatReferenceItems(ctx.cwd, input.symbol, page.items, allResults.length, page.nextCursor) }],
          details: { relation, found: page.items.length, items: page.items, results: page.items, summary: { returned: page.items.length, total: allResults.length, has_more: Boolean(page.nextCursor), next_cursor: page.nextCursor, offset: page.offset, limit: page.limit }, provenance: resolution.diagnostics, ...resolution.diagnostics },
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
        ? resolution.results.filter((item) => item.is_implementation || (item.implementation_locations?.length ?? 0) > 0)
        : resolution.results;
      const page = boundedWindow(filtered, params.limit, params.cursor);
      if (filtered.length === 0) {
        return { content: [{ type: 'text', text: `No symbol '${input.symbol}' found.` }], details: { relation, found: 0, items: [], results: [], summary: { returned: 0, total: 0, has_more: false }, provenance: resolution.diagnostics, ...resolution.diagnostics } };
      }
      return {
        content: [{ type: 'text', text: formatSymbolItems(ctx.cwd, input.symbol, page.items, filtered.length, page.nextCursor) }],
        details: { relation, found: page.items.length, items: page.items, results: page.items, summary: { returned: page.items.length, total: filtered.length, has_more: Boolean(page.nextCursor), next_cursor: page.nextCursor, offset: page.offset, limit: page.limit }, provenance: resolution.diagnostics, ...resolution.diagnostics },
      };
    },
  });
}
