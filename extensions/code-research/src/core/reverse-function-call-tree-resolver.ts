import type { FunctionCallTreeInput, FunctionCallTreeResult } from '../types.js';
import { executeJavaReverseFunctionCallTree } from '../languages/java/reverse-function-call-tree.js';
import { executeTypeScriptReverseFunctionCallTree } from '../languages/typescript/reverse-function-call-tree.js';
import { loadCodeResearchConfig } from '../config.js';
import { readWorkspaceGraphManifest, readWorkspaceGraphState } from './graph-persistence.js';
import { evaluateGraphUsability } from './graph-policy.js';
import { queryReverseFunctionCallTreeFromGraph } from './reverse-graph-queries.js';

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
  if (graphResult) return { status: 'ok', ...graphResult };

  const language = input.language ?? 'java';

  switch (language) {
    case 'java':
      return executeJavaReverseFunctionCallTree(cwd, input);
    case 'ts':
    case 'js':
      return executeTypeScriptReverseFunctionCallTree(cwd, input);
    case 'auto':
      throw new Error('reverse_function_call_tree does not support auto language detection yet');
    default:
      throw new Error(`Unsupported language: ${language}`);
  }
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
