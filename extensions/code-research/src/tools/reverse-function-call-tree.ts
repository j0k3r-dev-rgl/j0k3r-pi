import { Type } from 'typebox';
import { executeReverseFunctionCallTree } from '../core/reverse-function-call-tree-resolver.js';
import { renderCodeResearchToolResult } from '../render.js';
import type { FunctionCallTreeInput } from '../types.js';

export function registerReverseFunctionCallTreeTool(pi: any) {
  pi.registerTool({
    name: 'reverse_function_call_tree',
    label: 'Reverse Function Call Tree',
    description:
      'Use this tool when you need to understand which application functions or methods may be affected by changing a target function or method. It builds a reverse call tree for Java, TypeScript, or JavaScript code, starting at the target as the root and recursively returning its application callers.',
    promptSnippet: 'Trace which application functions or methods call a target, directly and transitively.',
    promptGuidelines: [
      'Use reverse_function_call_tree when the task is impact analysis: find who calls a target function or method and who calls those callers.',
      'Prefer this tool over function_call_tree when the agent needs incoming call paths rather than outgoing call flow from the target.',
      'The returned tree keeps the target as the root and expands upward through application callers.',
      'Set max_depth to limit recursion depth and keep the impact tree focused.',
    ],
    parameters: Type.Object({
      path: Type.String({ description: 'Java file containing the target method, or directory to scan for the application index.' }),
      symbol: Type.String({ description: 'Name of the target method/function whose callers should be traced.' }),
      language: Type.Optional(Type.Union([Type.Literal('java'), Type.Literal('go'), Type.Literal('ts'), Type.Literal('js')], { description: 'Language to use. Supported: java, go, ts, js. Default: java.' })),
      kind: Type.Optional(Type.Union([Type.Literal('method'), Type.Literal('function'), Type.Literal('class')], { description: 'Optional kind filter for the target symbol.' })),
      max_depth: Type.Optional(Type.Number({ description: 'Maximum recursion depth for caller expansion. Default: 10.' })),
      include_external: Type.Optional(Type.Boolean({ description: 'Reserved for API parity with function_call_tree. Reverse caller expansion returns application callers only. Default: false.' })),
      compacted: Type.Optional(Type.Boolean({ description: 'Reserved for API parity with function_call_tree.' })),
    }),

    renderResult(result: any, options: any, theme: any) {
      return renderCodeResearchToolResult('reverse_function_call_tree', result, options, theme);
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

      const execution = await executeReverseFunctionCallTree(ctx.cwd, input);

      if (execution.status === 'not_found') {
        return { content: [{ type: 'text', text: execution.message }], details: execution.details };
      }

      if (execution.status === 'ambiguous') {
        return { content: [{ type: 'text', text: execution.message }], details: execution.details };
      }

      return {
        content: [{ type: 'text', text: `Reverse call tree for ${execution.rootClassName}.${input.symbol}:\n\n${JSON.stringify(execution.result, null, 2)}` }],
        details: execution.result,
      };
    },
  });
}
