import { Type } from 'typebox';
import { resolveFindSymbol } from '../core/find-symbol-resolver.js';
import { renderCodeResearchToolCall, renderCodeResearchToolResult } from '../render.js';
import type { FindSymbolInput } from '../types.js';

const declarationKinds = [
  'function', 'function_overload', 'callable_variable', 'variable', 'class', 'constructor', 'method', 'getter', 'setter', 'field',
  'interface', 'interface_method', 'property', 'call_signature', 'construct_signature', 'index_signature', 'type_alias', 'enum', 'enum_member',
  'namespace', 'module', 'import_alias', 'export_alias', 'object_method', 'object_property', 'assignment', 'commonjs_export', 'package', 'unknown',
] as const;

export function registerFindSymbolTool(pi: any) {
  pi.registerTool({
    name: 'find_symbol',
    label: 'Find Symbol',
    description:
      'Use this tool when you need to locate where a symbol is defined or implemented in code. It searches TypeScript, JavaScript, and Java files and returns structured match data such as file, line, column, symbol kind, and diagnostics describing graph or graph lookup behavior.',
    promptSnippet: 'Locate where a symbol is defined or implemented across TS/JS/Java code.',
    promptGuidelines: [
      'Use find_symbol when the task is to locate a definition, implementation, declaration, or matching symbol by name.',
      'Prefer this tool over broad text search when the agent needs symbol-aware results with file and line metadata.',
      'Use include_signature=true when the signature is enough without reading the full body.',
      'Use include_code=true when the agent needs to inspect the implementation body of an executable declaration.',
    ],
    parameters: Type.Object({
      path: Type.String({ description: 'File or directory to search. Relative paths resolve against the current working directory.' }),
      symbol: Type.String({ description: 'Name of the symbol to find (function, class, interface, method, or variable name).' }),
      language: Type.Optional(Type.Union([Type.Literal('ts'), Type.Literal('js'), Type.Literal('java'), Type.Literal('go'), Type.Literal('auto')], { description: 'Language to use for parsing. Default: auto (detect from file extension).' })),
      kind: Type.Optional(Type.Union([Type.Literal('function'), Type.Literal('class'), Type.Literal('method'), Type.Literal('interface'), Type.Literal('variable')], { description: 'Optional coarse symbol kind filter.' })),
      declaration_kind: Type.Optional(Type.Union(declarationKinds.map((kind) => Type.Literal(kind)), { description: 'Optional granular TypeScript declaration-kind filter.' })),
      include_signature: Type.Optional(Type.Boolean({ description: 'If true, include the symbol signature (e.g. function signature) without the body.' })),
      include_code: Type.Optional(Type.Boolean({ description: 'If true, include source code only for supported executable declaration results. Ignored for unsupported categories and non-exact search.' })),
      scope: Type.Optional(Type.Union([Type.Literal('file'), Type.Literal('directory')], { description: 'Override whether path is treated as a single file or scanned as a directory.' })),
      glob: Type.Optional(Type.String({ description: 'Optional glob pattern to filter files when scanning a directory (e.g. "*.service.ts").' })),
      search_mode: Type.Optional(Type.Union([Type.Literal('exact'), Type.Literal('prefix'), Type.Literal('contains')], { description: 'Search mode for symbol names. Default: exact. When not exact, include_code is disabled.' })),
    }),

    renderShell: 'self' as const,
    renderCall(args: any, theme: any, context?: any) {
      return renderCodeResearchToolCall('find_symbol', args, theme, context);
    },
    renderResult(result: any, options: any, theme: any, context?: any) {
      return renderCodeResearchToolResult('find_symbol', result, options, theme, context);
    },

    async execute(_toolCallId: any, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const input: FindSymbolInput = {
        path: params.path,
        symbol: params.symbol,
        language: params.language ?? 'auto',
        kind: params.kind,
        declaration_kind: params.declaration_kind,
        include_code: params.include_code ?? false,
        include_signature: params.include_signature ?? false,
        scope: params.scope,
        glob: params.glob,
        search_mode: params.search_mode,
      };

      const resolution = await resolveFindSymbol(ctx.cwd, input);
      const { results, diagnostics } = resolution;
      if (results.length === 0) {
        return {
          content: [{ type: 'text', text: `No symbol '${input.symbol}' found.` }],
          details: { found: 0, ...diagnostics },
        };
      }

      return {
        content: [{ type: 'text', text: `Found ${results.length} match(es) for '${input.symbol}':\n\n${JSON.stringify(results, null, 2)}` }],
        details: { found: results.length, results, ...diagnostics },
      };
    },
  });
}
