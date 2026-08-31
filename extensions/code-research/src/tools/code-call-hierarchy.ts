import { Type } from 'typebox';
import { loadCodeResearchConfig } from '../config.js';
import { executeFunctionCallTree } from '../core/function-call-tree-resolver.js';
import { executeReverseFunctionCallTree } from '../core/reverse-function-call-tree-resolver.js';
import { ensureWorkspaceGraphFreshness } from '../core/workspace-graph.js';
import { renderCodeResearchToolResult } from '../render.js';
import type { FunctionCallTreeInput, SupportedLanguage } from '../types.js';

const SUPPORTED_LANGUAGES = ['ts', 'js', 'java', 'go'] as const;

type Direction = 'outgoing' | 'incoming';

async function executeHierarchy(cwd: string, direction: Direction, input: FunctionCallTreeInput) {
  if (input.language && input.language !== 'auto') {
    return direction === 'incoming'
      ? executeReverseFunctionCallTree(cwd, input)
      : executeFunctionCallTree(cwd, input);
  }

  let lastNotFound: any;
  for (const language of SUPPORTED_LANGUAGES) {
    try {
      const execution = direction === 'incoming'
        ? await executeReverseFunctionCallTree(cwd, { ...input, language })
        : await executeFunctionCallTree(cwd, { ...input, language });
      if (execution.status !== 'not_found') return execution;
      lastNotFound = execution;
    } catch {
      // Continue probing supported languages for auto mode.
    }
  }
  return lastNotFound ?? { status: 'not_found' as const, message: `No call hierarchy root found for ${input.symbol}.`, details: { found: 0 } };
}

export function registerCodeCallHierarchyTool(pi: any) {
  pi.registerTool({
    name: 'code_call_hierarchy',
    label: 'Code Call Hierarchy',
    description: 'Trace incoming or outgoing function/method call hierarchy across TypeScript, JavaScript, Java, and Go with one directional tool.',
    promptSnippet: 'Trace incoming or outgoing call hierarchy for supported-language functions and methods.',
    promptGuidelines: [
      'Use code_call_hierarchy when code_find results are not enough and the task needs call flow or caller impact paths.',
      'Set direction=outgoing to understand what a function/method calls; set direction=incoming for impact analysis callers.',
      'Use language=auto unless a specific supported language is known; supported languages are ts, js, java, and go only.',
      'Keep max_depth small unless the user asks for deeper impact or behavior analysis.',
    ],
    parameters: Type.Object({
      path: Type.String({ description: 'File containing the root/target function or method, or directory to scan for project context.' }),
      symbol: Type.String({ description: 'Root or target function/method/class symbol name.' }),
      direction: Type.Union([Type.Literal('outgoing'), Type.Literal('incoming')], { description: 'outgoing traces callees; incoming traces callers.' }),
      language: Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('ts'), Type.Literal('js'), Type.Literal('java'), Type.Literal('go')], { description: 'Language filter or auto-detection. Default: auto.' })),
      kind: Type.Optional(Type.Union([Type.Literal('method'), Type.Literal('function'), Type.Literal('class')], { description: 'Optional kind filter for the root symbol.' })),
      max_depth: Type.Optional(Type.Number({ description: 'Maximum recursion depth. Default 10, max 10.' })),
      include_external: Type.Optional(Type.Boolean({ description: 'For outgoing hierarchy, include framework/library/language calls as external leaves. Default false.' })),
      compacted: Type.Optional(Type.Boolean({ description: 'For outgoing hierarchy, compact trivial data-access siblings where supported. Default false.' })),
    }, { additionalProperties: false }),
    renderResult(result: any, options: any, theme: any) {
      return renderCodeResearchToolResult('code_call_hierarchy', result, options, theme);
    },
    async execute(_toolCallId: any, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const direction = params.direction as Direction;
      const input: FunctionCallTreeInput = {
        path: params.path,
        symbol: params.symbol,
        language: (params.language ?? 'auto') as SupportedLanguage,
        kind: params.kind,
        max_depth: typeof params.max_depth === 'number' ? Math.max(1, Math.min(10, Math.floor(params.max_depth))) : 10,
        include_external: direction === 'outgoing' ? params.include_external ?? false : false,
        compacted: direction === 'outgoing' ? params.compacted ?? false : false,
      };

      const execution = await executeHierarchy(ctx.cwd, direction, input);
      const config = await loadCodeResearchConfig(ctx.cwd);
      if (config.graph.enable) void ensureWorkspaceGraphFreshness(ctx.cwd).catch(() => undefined);

      if (execution.status === 'not_found') {
        return { content: [{ type: 'text', text: execution.message }], details: { query: input.symbol, path: input.path, language: input.language, kind: input.kind, direction, ...execution.details } };
      }
      if (execution.status === 'ambiguous') {
        return { content: [{ type: 'text', text: execution.message }], details: { query: input.symbol, path: input.path, language: input.language, kind: input.kind, direction, ...execution.details } };
      }

      return {
        content: [{ type: 'text', text: `${direction === 'incoming' ? 'Incoming' : 'Outgoing'} call hierarchy for ${execution.rootClassName}.${input.symbol}:\n\n${JSON.stringify(execution.result, null, 2)}` }],
        details: { query: input.symbol, path: input.path, language: input.language, kind: input.kind, direction, ...execution.result },
      };
    },
  });
}
