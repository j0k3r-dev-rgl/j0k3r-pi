import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { Type } from 'typebox';
import { resolveFindReferences } from '../core/find-references-resolver.js';
import { renderCodeResearchToolResult } from '../render.js';
import type { FindReferencesInput, ReferenceLocation } from '../types.js';

export function registerFindReferencesTool(pi: any) {
  pi.registerTool({
    name: 'find_references',
    label: 'Find References',
    description:
      'Use this tool when you need to know where a symbol is used in code. It finds application references such as call sites, imports, instantiation, inheritance, variable access, callbacks, method references, and graph-detectable relationships when available, returning structured file and location data useful for refactoring and impact analysis.',
    promptSnippet: 'Locate where a symbol is used across application code, including semantic usages like calls, imports, inheritance, variables, and callbacks.',
    promptGuidelines: [
      'Use find_references when the task is to find where a symbol is called, passed, imported, instantiated, inherited, or otherwise referenced.',
      'Prefer this tool for refactoring and impact analysis when definition lookup alone is not enough.',
      'Use find_symbol to locate the declaration itself; use find_references to locate usages and semantic reference sites.',
      "Pass reference_kinds: ['call'] when you only need direct call sites; this enables the graph-backed fast path. Omit reference_kinds when you need complete references including callbacks, reads/writes, imports, and type references.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: 'File or directory to search. Relative paths resolve against the current working directory.' }),
      symbol: Type.String({ description: 'Name of the target symbol whose usages or references should be found.' }),
      language: Type.Optional(Type.Union([Type.Literal('ts'), Type.Literal('js'), Type.Literal('java')], { description: 'Language to use. Supported: ts, js, java. Default: java.' })),
      kind: Type.Optional(Type.Union([Type.Literal('function'), Type.Literal('class'), Type.Literal('method'), Type.Literal('interface'), Type.Literal('variable')], { description: 'Optional symbol kind filter for the target symbol.' })),
      scope: Type.Optional(Type.Union([Type.Literal('file'), Type.Literal('directory')], { description: 'Override whether path is treated as a single file or scanned as a directory.' })),
      glob: Type.Optional(Type.String({ description: 'Optional glob pattern to filter files when scanning a directory.' })),
      reference_kinds: Type.Optional(Type.Array(Type.Union([
        Type.Literal('call'),
        Type.Literal('read'),
        Type.Literal('implements'),
        Type.Literal('extends'),
      ]), { description: 'Optional fast-path filter for graph-backed references. When set to supported kinds such as call, find_references may use the persisted workspace graph and return only those reference kinds.' })),
    }),
    renderResult(result: any, options: any, theme: any) {
      return renderCodeResearchToolResult('find_references', result, options, theme);
    },

    async execute(_toolCallId: any, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const input: FindReferencesInput = {
        path: params.path,
        symbol: params.symbol,
        language: params.language ?? 'java',
        kind: params.kind,
        scope: params.scope,
        glob: params.glob,
        reference_kinds: params.reference_kinds,
      };

      const resolution = await resolveFindReferences(ctx.cwd, input);
      const results = await addSourceLines(resolution.results);
      if (results.length === 0) {
        return {
          content: [{ type: 'text', text: `No references found for '${input.symbol}'.` }],
          details: { found: 0, results: [], ...resolution.diagnostics },
        };
      }

      return {
        content: [{ type: 'text', text: formatReferenceResults(ctx.cwd, input.symbol, results) }],
        details: { found: results.length, results, ...resolution.diagnostics },
      };
    },
  });
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

function formatReferenceResults(cwd: string, symbol: string, results: ReferenceLocation[]): string {
  const lines = results.map((result) => {
    const file = relative(cwd, result.file) || result.file;
    const context = result.context_symbol ? ` (${result.reference_kind} in ${result.context_symbol})` : ` (${result.reference_kind})`;
    const sourceLine = result.source_line ?? result.called_as ?? '';
    return `${file}:${result.line}:${result.column}: ${sourceLine}${context}`;
  });

  return `Found ${results.length} reference(s) for '${symbol}':\n\n${lines.join('\n')}`;
}
