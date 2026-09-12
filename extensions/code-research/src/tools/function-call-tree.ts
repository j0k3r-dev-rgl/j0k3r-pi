import { Type } from 'typebox';
import { executeFunctionCallTree } from '../core/function-call-tree-resolver.js';
import { renderCodeResearchToolCall, renderCodeResearchToolResult } from '../render.js';
import type { FunctionCallTreeInput } from '../types.js';

export function registerFunctionCallTreeTool(pi: any) {
  pi.registerTool({
    name: 'function_call_tree',
    label: 'Function Call Tree',
    description:
      'Use this tool when you need to understand how a function or method flows through application code. It builds a recursive call tree for Java, TypeScript, or JavaScript entry points, expanding application-internal calls and optionally showing framework or language calls as external leaf nodes.',
    promptSnippet: 'Trace how a function or method calls into the rest of the application.',
    promptGuidelines: [
      'Use function_call_tree when the task is to understand behavior by following what a function or method calls next.',
      'Prefer this tool over find_symbol when the agent needs call flow, dependencies, or execution shape rather than just definition lookup.',
      'Set max_depth to limit recursion depth and keep the result focused.',
      'Set include_external=true when framework, library, or language calls are also relevant to the analysis.',
    ],
    parameters: Type.Object({
      path: Type.String({ description: 'Java file containing the root method, or directory to scan for the application index.' }),
      symbol: Type.String({ description: 'Name of the root method/function to trace.' }),
      language: Type.Optional(Type.Union([Type.Literal('java'), Type.Literal('go'), Type.Literal('ts'), Type.Literal('js')], { description: 'Language to use. Supported: java, go, ts, js. Default: java.' })),
      kind: Type.Optional(Type.Union([Type.Literal('method'), Type.Literal('function'), Type.Literal('class')], { description: 'Optional kind filter for the root symbol.' })),
      max_depth: Type.Optional(Type.Number({ description: 'Maximum recursion depth for application-internal calls. Default: 10.' })),
      include_external: Type.Optional(Type.Boolean({ description: 'If true, include framework/language calls as external leaf nodes. Default: false.' })),
      compacted: Type.Optional(Type.Boolean({ description: 'If true, compact trivial data-access sibling nodes while preserving the call tree structure.' })),
    }),

    renderShell: 'self' as const,
    renderCall(args: any, theme: any, context?: any) {
      return renderCodeResearchToolCall('function_call_tree', args, theme, context);
    },
    renderResult(result: any, options: any, theme: any, context?: any) {
      return renderCodeResearchToolResult('function_call_tree', result, options, theme, context);
    },

    async execute(_toolCallId: any, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const input: FunctionCallTreeInput = {
        path: params.path,
        symbol: params.symbol,
        language: params.language ?? 'java',
        kind: params.kind,
        max_depth: params.max_depth ?? 10,
        include_external: params.include_external ?? false,
        compacted: params.compacted ?? false,
      };

      const execution = await executeFunctionCallTree(ctx.cwd, input);

      if (execution.status === 'not_found') {
        return { content: [{ type: 'text', text: execution.message }], details: execution.details };
      }

      if (execution.status === 'ambiguous') {
        return { content: [{ type: 'text', text: execution.message }], details: execution.details };
      }

      return {
        content: [{ type: 'text', text: `Call tree for ${execution.rootClassName}.${input.symbol}:\n\n${JSON.stringify(execution.result, null, 2)}` }],
        details: execution.result,
      };
    },
  });
}
