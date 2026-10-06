import { readMemoryDetail } from '../reading/get.ts';
import type { OperationContext } from './types.ts';
import { formatSuccessResult, formatErrorResult } from './result-helper.ts';
import type { AgentToolResult } from '@earendil-works/pi-coding-agent';

export async function executeGetTool(
  args: any,
  opCtx: OperationContext,
): Promise<AgentToolResult> {
  if (args?.id === undefined || !Number.isSafeInteger(args.id) || args.id <= 0) {
    return formatErrorResult("invalid_parameter: 'id' must be a positive integer");
  }

  try {
    opCtx.assertActive();
    const detail = readMemoryDetail(
      opCtx.dbPath,
      {
        id: args.id,
        global: !!args.global,
        cursor: args.cursor,
        sessionScope: opCtx.scope,
      },
      { assertActive: opCtx.assertActive },
    );

    return formatSuccessResult(detail, {
      id: detail.id,
      field: detail.field,
      offset: detail.offset,
      has_more: detail.has_more,
      next_cursor: detail.next_cursor,
    });
  } catch (err: any) {
    return formatErrorResult(err.message);
  }
}
