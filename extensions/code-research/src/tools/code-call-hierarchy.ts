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
    description: 'Trace a call graph for one known callable in TypeScript/JavaScript, Java, or Go. Use direction=outgoing to see what a function/method calls. Use direction=incoming to see callers/impact paths after you know the target symbol. This is not a general reference search; use code_find relation=references first when you only need call sites or when the target is ambiguous.',
    promptSnippet: 'Trace incoming or outgoing call hierarchy for one known supported-language function or method. Use code_find first to locate/disambiguate symbols and references.',
    promptGuidelines: [
      'Use code_call_hierarchy only after you know the target callable and need call flow, caller chains, or impact paths. For simple usages, prefer code_find relation=references.',
      'Set direction=outgoing to understand behavior/dependencies inside the target; set direction=incoming to understand who can reach the target.',
      'Pass the declaring file path when possible, especially for common names such as execute, run, stop, handle, main, or process.',
      'Pass kind=function or kind=method and a concrete language when known to avoid unrelated same-name symbols in monorepos.',
      'Keep max_depth small (2-4) for first inspection; increase only when you need wider impact chains.',
      'Set include_external=true only for outgoing traces when library/framework calls are useful; leave false to reduce noise.',
      'Incoming hierarchy may include synthetic <top-level> callers for module-level invocations such as main().catch(...).',
    ],
    parameters: Type.Object({
      path: Type.String({ description: 'Declaring file for the target callable, or a narrow project directory when file is unknown. Prefer file paths to disambiguate same-name methods.' }),
      symbol: Type.String({ description: 'Bare function/method/class symbol name. Do not include receiver/class prefixes; use path, kind, and language to disambiguate.' }),
      direction: Type.Union([Type.Literal('outgoing'), Type.Literal('incoming')], { description: 'outgoing traces callees/dependencies; incoming traces callers/impact paths.' }),
      language: Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('ts'), Type.Literal('js'), Type.Literal('java'), Type.Literal('go')], { description: 'Language filter or auto-detection. Default: auto. Use a concrete language when known in monorepos.' })),
      kind: Type.Optional(Type.Union([Type.Literal('method'), Type.Literal('function'), Type.Literal('class')], { description: 'Root symbol kind. Strongly recommended for common callable names.' })),
      max_depth: Type.Optional(Type.Number({ description: 'Maximum recursion depth. Default 10, max 10. Start with 2-4 unless broad impact is needed.' })),
      include_external: Type.Optional(Type.Boolean({ description: 'Outgoing only: include unresolved/library/framework calls as external leaves. Default false to reduce noise.' })),
      compacted: Type.Optional(Type.Boolean({ description: 'Outgoing only: compact trivial data-access siblings where supported. Default false.' })),
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
