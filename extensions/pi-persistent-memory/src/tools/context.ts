import { readMemoryContext } from '../reading/context.ts';
import type { OperationContext } from './types.ts';
import {
  formatSuccessResult,
  formatErrorResult,
  measureSerializedToolResult,
  MAX_TOOL_RESULT_BYTES,
} from './result-helper.ts';
import type { AgentToolResult } from '@earendil-works/pi-coding-agent';

export async function executeContextTool(
  args: any,
  opCtx: OperationContext,
): Promise<AgentToolResult> {
  try {
    opCtx.assertActive();
    const result = readMemoryContext(
      opCtx.dbPath,
      {
        sessionScope: opCtx.scope,
        sessionId: opCtx.sessionId,
        global: !!args?.global,
        cursor: args?.cursor,
        pageSize: 5,
        isWithinBudget: (res) => {
          const details = {
            count: res.items.length,
            has_more: res.has_more,
            next_cursor: res.next_cursor,
          };
          return measureSerializedToolResult(res, details) <= MAX_TOOL_RESULT_BYTES;
        },
      },
      { assertActive: opCtx.assertActive },
    );

    return formatSuccessResult(result, {
      count: result.items.length,
      has_more: result.has_more,
      next_cursor: result.next_cursor,
    });
  } catch (err: any) {
    return formatErrorResult(err.message);
  }
}
