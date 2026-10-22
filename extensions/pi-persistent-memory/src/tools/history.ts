import type { OperationContext } from './types.ts';
import { formatSuccessResult, formatErrorResult } from './result-helper.ts';
import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { resolveHistoryProjectKey } from '../identity.ts';
import { searchHistory, getHistoryDetail } from '../history/service.ts';

export async function executeHistoryTool(
  args: any,
  opCtx: OperationContext,
): Promise<AgentToolResult> {
  try {
    opCtx.assertActive();

    // Server-resolved immutable project authority
    // opCtx is bound to the active session. If it is in global scope, history fails closed!
    if (opCtx.scope.kind === 'global') {
      return formatErrorResult('history_scope_invalid: Message history is not available in global scope');
    }

    const cwd = process.cwd();
    let projectKey: string;
    try {
      projectKey = resolveHistoryProjectKey(cwd);
    } catch (err: any) {
      return formatErrorResult(err.message);
    }

    const action = args?.action;
    if (action === 'search') {
      const searchRes = searchHistory(opCtx.dbPath, projectKey, {
        query: args?.query,
        session_id: args?.session_id,
        limit: args?.limit,
        cursor: args?.cursor,
      });

      return formatSuccessResult(searchRes, {
        action: 'search',
        count: searchRes.count,
        has_more: searchRes.has_more,
        next_cursor: searchRes.next_cursor,
      });
    }

    if (action === 'get') {
      if (args?.id === undefined || !Number.isSafeInteger(args.id) || args.id <= 0) {
        return formatErrorResult("invalid_parameter: 'id' must be a positive integer for action=get");
      }

      const getRes = getHistoryDetail(opCtx.dbPath, projectKey, {
        id: args.id,
        cursor: args?.cursor,
      });

      return formatSuccessResult(getRes, {
        action: 'get',
        id: getRes.id,
        offset: getRes.offset,
        total_bytes: getRes.total_bytes,
        has_more: getRes.has_more,
        next_cursor: getRes.next_cursor,
      });
    }

    return formatErrorResult(`invalid_action: Unknown action '${action}' (expected 'search' or 'get')`);
  } catch (err: any) {
    return formatErrorResult(err.message);
  }
}
