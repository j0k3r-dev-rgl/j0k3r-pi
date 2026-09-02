import { Type } from 'typebox';
import { buildCodeChangeSurface } from '../core/code-change-surface.js';
import { renderCodeResearchToolResult } from '../render.js';
import type { SupportedLanguage } from '../types.js';

export function registerCodeChangeSurfaceTool(pi: any) {
  pi.registerTool({
    name: 'code_change_surface',
    label: 'Code Change Surface',
    description: 'Build a bounded change map for one supported-language symbol query: contract, implementations, callers, likely tests, validation suggestions, risks, trust, and exact follow-up inspection actions.',
    promptSnippet: 'Use code_change_surface after workspace_graph_status and before editing a symbol-anchored TS/JS/Java/Go change. Treat low trust or fallback actions as required follow-up inspection, not edit instructions.',
    promptGuidelines: [
      'Provide path and query; add language and kind when known to avoid ambiguous symbols.',
      'Use this for one symbol-anchored change surface, not broad natural-language planning.',
      'Inspect fallback actions with code_find or code_call_hierarchy before editing when fallback.required is true.',
      'Validation suggestions are heuristic and file-oriented; do not treat them as exact project runner commands.',
    ],
    parameters: Type.Object({
      path: Type.String({ description: 'File or directory to inspect. Relative paths resolve against the current working directory.' }),
      query: Type.String({ description: 'Exact symbol name anchoring the potential change.' }),
      language: Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('ts'), Type.Literal('js'), Type.Literal('java'), Type.Literal('go')], { description: 'Language filter. Default: auto.' })),
      kind: Type.Optional(Type.Union([Type.Literal('function'), Type.Literal('class'), Type.Literal('method'), Type.Literal('interface'), Type.Literal('variable')], { description: 'Coarse symbol kind for disambiguation.' })),
      scope: Type.Optional(Type.Union([Type.Literal('file'), Type.Literal('directory')], { description: 'Override whether path is treated as a file or directory.' })),
      glob: Type.Optional(Type.String({ description: 'Optional glob to restrict files while scanning a directory.' })),
      test_mode: Type.Optional(Type.Union([Type.Literal('representative'), Type.Literal('exhaustive')], { description: 'Test reporting mode. Default: representative.' })),
      caller_mode: Type.Optional(Type.Union([Type.Literal('representative'), Type.Literal('exhaustive')], { description: 'Caller reporting mode. Default: representative.' })),
      max_tests: Type.Optional(Type.Number({ description: 'Maximum likely test entries when test_mode is exhaustive. Default: 50, max: 100.' })),
      max_callers: Type.Optional(Type.Number({ description: 'Maximum caller entries when caller_mode is exhaustive. Default: 50, max: 100.' })),
    }, { additionalProperties: false }),
    prepareArguments(args: any) {
      if (!args || typeof args !== 'object') return args;
      if (typeof args.symbol === 'string' && typeof args.query !== 'string') return { ...args, query: args.symbol };
      return args;
    },
    renderResult(result: any, options: any, theme: any) {
      return renderCodeResearchToolResult('code_change_surface', result, options, theme);
    },
    async execute(_toolCallId: any, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const surface = await buildCodeChangeSurface(ctx.cwd, {
        path: params.path,
        query: params.query,
        language: (params.language ?? 'auto') as SupportedLanguage,
        kind: params.kind,
        scope: params.scope,
        glob: params.glob,
        test_mode: params.test_mode,
        caller_mode: params.caller_mode,
        max_tests: params.max_tests,
        max_callers: params.max_callers,
      });
      return {
        content: [{ type: 'text', text: surface.content }],
        details: surface,
      };
    },
  });
}
