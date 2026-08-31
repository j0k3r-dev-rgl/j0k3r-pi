import type { CallTreeNode, FunctionCallTreeInput, FunctionCallTreeResult, ReferenceLocation } from '../types.js';
import { executeJavaReverseFunctionCallTree } from '../languages/java/reverse-function-call-tree.js';
import { executeGoReverseFunctionCallTree } from '../languages/go/reverse-function-call-tree.js';
import { executeTypeScriptReverseFunctionCallTree } from '../languages/typescript/reverse-function-call-tree.js';
import { loadCodeResearchConfig } from '../config.js';
import { readWorkspaceGraphManifest, readWorkspaceGraphState } from './graph-persistence.js';
import { evaluateGraphUsability } from './graph-policy.js';
import { queryReverseFunctionCallTreeFromGraph } from './reverse-graph-queries.js';
import { resolveFindReferences } from './find-references-resolver.js';

export type ReverseFunctionCallTreeExecutionResult =
  | {
      status: 'ok';
      rootClassName: string;
      result: FunctionCallTreeResult;
    }
  | {
      status: 'not_found';
      message: string;
      details: { found: 0 };
    }
  | {
      status: 'ambiguous';
      message: string;
      details: { candidates: Array<{ className: string; symbol: string; file: string; line: number }> };
    };

export async function executeReverseFunctionCallTree(
  cwd: string,
  input: FunctionCallTreeInput
): Promise<ReverseFunctionCallTreeExecutionResult> {
  const graphResult = await tryGraphBackedReverseFunctionCallTree(cwd, input);
  if (graphResult) {
    if (hasIncomingCallers(graphResult.result) || (input.language !== 'ts' && input.language !== 'js')) {
      return { status: 'ok', ...graphResult };
    }
    const referenceBacked = await tryReferenceBackedReverseFunctionCallTree(cwd, input, graphResult.result);
    if (referenceBacked) return { status: 'ok', rootClassName: graphResult.rootClassName, result: referenceBacked };
    return { status: 'ok', ...graphResult };
  }

  const language = input.language ?? 'java';

  switch (language) {
    case 'java':
      return executeJavaReverseFunctionCallTree(cwd, input);
    case 'ts':
    case 'js': {
      const direct = await executeTypeScriptReverseFunctionCallTree(cwd, input);
      if (direct.status !== 'ok' || hasIncomingCallers(direct.result)) return direct;
      const referenceBacked = await tryReferenceBackedReverseFunctionCallTree(cwd, input, direct.result);
      return referenceBacked ? { ...direct, result: referenceBacked } : direct;
    }
    case 'go':
      return executeGoReverseFunctionCallTree(cwd, input as any);
    case 'auto':
      throw new Error('reverse_function_call_tree does not support auto language detection yet');
    default:
      throw new Error(`Unsupported language: ${language}`);
  }
}

function hasIncomingCallers(result: FunctionCallTreeResult): boolean {
  return Array.isArray(result.root.callers) && result.root.callers.length > 0;
}

async function tryReferenceBackedReverseFunctionCallTree(cwd: string, input: FunctionCallTreeInput, graphResult: FunctionCallTreeResult): Promise<FunctionCallTreeResult | undefined> {
  const references = await resolveFindReferences(cwd, {
    path: input.path,
    symbol: input.symbol,
    language: input.language,
    kind: input.kind as any,
    reference_kinds: ['call'],
  }).then((result) => result.results).catch(() => [] as ReferenceLocation[]);
  if (references.length === 0) return undefined;

  const callers = references.map(referenceToCallerNode);
  const result: FunctionCallTreeResult = {
    root: { ...graphResult.root, callers },
    stats: { total_nodes: 1 + callers.length, application_nodes: 1 + callers.length, external_nodes: 0, max_depth_reached: callers.length > 0 ? 1 : 0 },
  };
  return result;
}

function referenceToCallerNode(reference: ReferenceLocation): CallTreeNode {
  return {
    file: reference.file,
    symbol: reference.context_symbol ?? '<top-level>',
    kind: reference.context_kind ?? 'function',
    node_type: 'application',
    class: reference.context_class,
    owner_kind: reference.owner_kind ?? 'module',
    line: reference.line,
    column: reference.column,
    start_line: reference.line,
    start_column: reference.column,
    end_line: reference.end_line ?? reference.line,
    end_column: reference.end_column ?? reference.column,
    called_as: reference.called_as,
    receiver_name: reference.receiver_name,
    receiver_type: reference.receiver_type,
    call_line: reference.line,
    call_column: reference.column,
    is_application: true,
    is_external: false,
    source: 'application',
  };
}

async function tryGraphBackedReverseFunctionCallTree(cwd: string, input: FunctionCallTreeInput) {
  const config = await loadCodeResearchConfig(cwd);
  if (!config.graph.enable) return undefined;

  const state = await readWorkspaceGraphState(cwd);
  const manifest = await readWorkspaceGraphManifest(cwd);
  const decision = evaluateGraphUsability({
    graphEnabled: true,
    query: 'reverse_function_call_tree',
    stateReadStatus: state.status,
    manifestReadStatus: manifest.status,
    stateStatus: state.status === 'ok' ? state.data.status : undefined,
    language: input.language,
    targetPath: input.path,
  });
  if (!decision.usable || state.status !== 'ok' || manifest.status !== 'ok') return undefined;

  return queryReverseFunctionCallTreeFromGraph({
    cwd,
    input,
    state: state.data,
    manifest: manifest.data,
    policy: { allowStale: false },
  });
}
