import type { FunctionCallTreeInput, FunctionCallTreeResult } from '../types.js';
import { executeJavaFunctionCallTree } from '../languages/java/function-call-tree.js';
import { executeTypeScriptFunctionCallTree } from '../languages/typescript/function-call-tree.js';

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
  const language = input.language ?? 'java';

  switch (language) {
    case 'java':
      return executeJavaFunctionCallTree(cwd, input);
    case 'ts':
    case 'js':
      return executeTypeScriptFunctionCallTree(cwd, input);
    case 'auto':
      throw new Error('function_call_tree does not support auto language detection yet');
    default:
      throw new Error(`Unsupported language: ${language}`);
  }
}
