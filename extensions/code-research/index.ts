import { Type } from 'typebox';
import { findSymbol } from './src/core/resolver.js';
import type { FindSymbolInput } from './src/types.js';

export { findSymbol } from './src/core/resolver.js';
export type { FindSymbolInput, SymbolLocation } from './src/types.js';

export default function findSymbolExtension(pi: any) {
  pi.registerTool({
    name: 'find_symbol',
    label: 'Find Symbol',
    description:
      'Find the definition and/or implementation of a TypeScript/JavaScript symbol in a file or directory. Returns structured location data (file, line, column, kind). Set include_signature=true to return the symbol signature. Set include_code=true (only for functions/methods) to also return the symbol source code.',
    promptSnippet: 'Find definitions and implementations of TS/JS symbols across files.',
    promptGuidelines: [
      'Use find_symbol when the user asks where a function, class, interface, or method is defined or implemented.',
      'Use include_code=true when the user also wants to see the body of the symbol.',
    ],
    parameters: Type.Object({
      path: Type.String({
        description: 'File or directory to search. Relative paths resolve against the current working directory.',
      }),
      symbol: Type.String({
        description: 'Name of the symbol to find (function, class, interface, method, or variable name).',
      }),
      language: Type.Optional(
        Type.Union(
          [Type.Literal('ts'), Type.Literal('js'), Type.Literal('java'), Type.Literal('auto')],
          { description: 'Language to use for parsing. Default: auto (detect from file extension).' }
        )
      ),
      kind: Type.Optional(
        Type.Union(
          [
            Type.Literal('function'),
            Type.Literal('class'),
            Type.Literal('method'),
            Type.Literal('interface'),
            Type.Literal('variable'),
          ],
          { description: 'Optional symbol kind filter.' }
        )
      ),
      include_signature: Type.Optional(
        Type.Boolean({
          description: 'If true, include the symbol signature (e.g. function signature) without the body.',
        })
      ),
      include_code: Type.Optional(
        Type.Boolean({
          description: 'If true and kind is function or method, include the source code text of each matched symbol. Ignored for other kinds to avoid huge payloads.',
        })
      ),
      scope: Type.Optional(
        Type.Union(
          [Type.Literal('file'), Type.Literal('directory')],
          { description: 'Override whether path is treated as a single file or scanned as a directory.' }
        )
      ),
      glob: Type.Optional(
        Type.String({
          description: 'Optional glob pattern to filter files when scanning a directory (e.g. "*.service.ts").',
        })
      ),
      search_mode: Type.Optional(
        Type.Union(
          [Type.Literal('exact'), Type.Literal('prefix'), Type.Literal('contains')],
          { description: 'Search mode for symbol names. Default: exact. When not exact, include_code is disabled.' }
        )
      ),
    }),

    async execute(_toolCallId: any, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const input: FindSymbolInput = {
        path: params.path,
        symbol: params.symbol,
        language: params.language ?? 'auto',
        kind: params.kind,
        include_code: params.include_code ?? false,
        include_signature: params.include_signature ?? false,
        scope: params.scope,
        glob: params.glob,
        search_mode: params.search_mode,
      };

      const results = await findSymbol(ctx.cwd, input);

      if (results.length === 0) {
        return {
          content: [{ type: 'text', text: `No symbol '${input.symbol}' found.` }],
          details: { found: 0 },
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Found ${results.length} match(es) for '${input.symbol}':\n\n${JSON.stringify(results, null, 2)}`,
          },
        ],
        details: { found: results.length, results },
      };
    },
  });
}
