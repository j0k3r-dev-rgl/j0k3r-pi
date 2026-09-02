import { loadCodeResearchConfig } from '../config.js';
import type { FunctionCallTreeInput, FunctionCallTreeResult } from '../types.js';
import { ensureWorkspaceGraphReadable } from './graph-ensure.js';
import { evaluateGraphUsability } from './graph-policy.js';
import { queryFunctionCallTreeFromGraph } from './graph-queries.js';

export type FunctionCallTreeExecutionResult =
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

export async function executeFunctionCallTree(
  cwd: string,
  input: FunctionCallTreeInput
): Promise<FunctionCallTreeExecutionResult> {
  const graphResult = await tryGraphBackedFunctionCallTree(cwd, input);
  if (graphResult) return { status: 'ok', ...graphResult };

  return {
    status: 'not_found',
    message: 'No graph-backed call hierarchy found. Refresh the workspace graph and retry.',
    details: { found: 0 },
  };
}

async function tryGraphBackedFunctionCallTree(cwd: string, input: FunctionCallTreeInput) {
  const config = await loadCodeResearchConfig(cwd);
  if (!config.graph.enable) return undefined;

  const { state, manifest } = await ensureWorkspaceGraphReadable(cwd);
  const decision = evaluateGraphUsability({
    graphEnabled: config.graph.enable,
    query: 'function_call_tree',
    stateReadStatus: state.status,
    manifestReadStatus: manifest.status,
    stateStatus: state.status === 'ok' ? state.data.status : undefined,
    language: input.language,
    targetPath: input.path,
  });
  if (!decision.usable || state.status !== 'ok' || manifest.status !== 'ok') return undefined;

  return queryFunctionCallTreeFromGraph({
    cwd,
    input,
    state: state.data,
    manifest: manifest.data,
    policy: { allowStale: false },
  });
}
