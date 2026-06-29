import { Type } from 'typebox';
import { findReferences } from '../core/find-references-resolver.js';
import type { FindReferencesInput } from '../types.js';

export function registerFindReferencesTool(pi: any) {
  pi.registerTool({
    name: 'find_references',
    label: 'Find References',
    description:
      'Use this tool when you need to know where a symbol is used in code. It finds application references such as call sites and graph-detectable relationships like implements or extends when available, returning structured file and location data useful for refactoring and impact analysis.',
    promptSnippet: 'Locate where a symbol is used across application code.',
    promptGuidelines: [
      'Use find_references when the task is to find where a symbol is called or otherwise referenced.',
      'Prefer this tool for refactoring and impact analysis when definition lookup alone is not enough.',
      'Use find_symbol to locate the declaration itself; use find_references to locate usages.',
    ],
    parameters: Type.Object({
      path: Type.String({ description: 'File or directory to search. Relative paths resolve against the current working directory.' }),
      symbol: Type.String({ description: 'Name of the target symbol whose usages or references should be found.' }),
      language: Type.Optional(Type.Union([Type.Literal('ts'), Type.Literal('js'), Type.Literal('java')], { description: 'Language to use. Supported: ts, js, java. Default: java.' })),
      kind: Type.Optional(Type.Union([Type.Literal('function'), Type.Literal('class'), Type.Literal('method'), Type.Literal('interface'), Type.Literal('variable')], { description: 'Optional symbol kind filter for the target symbol.' })),
      scope: Type.Optional(Type.Union([Type.Literal('file'), Type.Literal('directory')], { description: 'Override whether path is treated as a single file or scanned as a directory.' })),
      glob: Type.Optional(Type.String({ description: 'Optional glob pattern to filter files when scanning a directory.' })),
    }),
    async execute(_toolCallId: any, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const input: FindReferencesInput = {
        path: params.path,
        symbol: params.symbol,
        language: params.language ?? 'java',
        kind: params.kind,
        scope: params.scope,
        glob: params.glob,
      };

      const results = await findReferences(ctx.cwd, input);
      if (results.length === 0) {
        return {
          content: [{ type: 'text', text: `No references found for '${input.symbol}'.` }],
          details: { found: 0, results: [] },
        };
      }

      return {
        content: [{ type: 'text', text: `Found ${results.length} reference(s) for '${input.symbol}':\n\n${JSON.stringify(results, null, 2)}` }],
        details: { found: results.length, results },
      };
    },
  });
}
