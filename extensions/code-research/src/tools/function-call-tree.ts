import { Type } from 'typebox';
import { loadCodeResearchConfig } from '../config.js';
import { executeFunctionCallTree } from '../core/function-call-tree-resolver.js';
import { ensureWorkspaceGraphFreshness } from '../core/workspace-graph.js';
import type { FunctionCallTreeInput } from '../types.js';

export function registerFunctionCallTreeTool(pi: any) {
  pi.registerTool({
    name: 'function_call_tree',
    label: 'Function Call Tree',
    description:
      'Build a recursive call tree for a Java, TypeScript, or JavaScript function/method, expanding only application-internal calls. Framework and language calls appear as external leaf nodes.',
    promptSnippet: 'Trace the call tree of a Java, TypeScript, or JavaScript method/function to understand its application-internal dependencies.',
    promptGuidelines: [
      'Use function_call_tree when you need to understand what a Java, TypeScript, or JavaScript method/function does and which application methods it calls.',
      'Set max_depth to control recursion depth (default 10).',
      'Set include_external=true to see framework and language calls as leaf nodes.',
    ],
    parameters: Type.Object({
      path: Type.String({ description: 'Java file containing the root method, or directory to scan for the application index.' }),
      symbol: Type.String({ description: 'Name of the root method/function to trace.' }),
      language: Type.Optional(Type.Union([Type.Literal('java'), Type.Literal('ts'), Type.Literal('js')], { description: 'Language to use. Supported: java, ts, js. Default: java.' })),
      kind: Type.Optional(Type.Union([Type.Literal('method'), Type.Literal('function'), Type.Literal('class')], { description: 'Optional kind filter for the root symbol.' })),
      max_depth: Type.Optional(Type.Number({ description: 'Maximum recursion depth for application-internal calls. Default: 10.' })),
      include_external: Type.Optional(Type.Boolean({ description: 'If true, include framework/language calls as external leaf nodes. Default: false.' })),
      compacted: Type.Optional(Type.Boolean({ description: 'If true, compact trivial data-access sibling nodes while preserving the call tree structure.' })),
    }),

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
      const config = await loadCodeResearchConfig(ctx.cwd);
      if (config.graph.enable) void ensureWorkspaceGraphFreshness(ctx.cwd).catch(() => undefined);

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
