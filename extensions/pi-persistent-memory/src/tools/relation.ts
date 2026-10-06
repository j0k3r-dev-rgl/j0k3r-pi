import { saveRelation, deleteRelation } from '../graph/service.ts';
import { withDatabase } from '../storage/db.ts';
import type { OperationContext } from './types.ts';
import { formatSuccessResult, formatErrorResult } from './result-helper.ts';
import type { AgentToolResult } from '@earendil-works/pi-coding-agent';

export async function executeRelationTool(
  args: any,
  opCtx: OperationContext,
): Promise<AgentToolResult> {
  const action = args?.action;
  if (!action || (action !== 'save' && action !== 'delete')) {
    return formatErrorResult("invalid_parameter: 'action' is required and must be 'save' or 'delete'");
  }

  const targetScope = args?.scope === 'global' ? ({ kind: 'global' as const }) : opCtx.scope;

  if (action === 'save') {
    if (!args?.source || typeof args.source !== 'string') {
      return formatErrorResult("invalid_parameter: 'source' is required for action 'save'");
    }
    if (!args?.target || typeof args.target !== 'string') {
      return formatErrorResult("invalid_parameter: 'target' is required for action 'save'");
    }
    if (!args?.relation_type || typeof args.relation_type !== 'string') {
      return formatErrorResult("invalid_parameter: 'relation_type' is required for action 'save'");
    }

    try {
      opCtx.assertActive();
      let record: any;
      withDatabase(opCtx.dbPath, (db) => {
        opCtx.assertActive();
        record = saveRelation(
          db,
          {
            id: args.id,
            sourceEntityId: args.source,
            targetEntityId: args.target,
            relationType: args.relation_type,
            scope: targetScope,
          },
          {
            sessionId: opCtx.sessionId,
            explicitGlobalWrite: targetScope.kind === 'global',
          },
        );
      });

      return formatSuccessResult(record, {
        id: record.id,
        relation_type: record.relation_type,
      });
    } catch (err: any) {
      return formatErrorResult(err.message);
    }
  }

  // action === 'delete'
  if (!args?.id || typeof args.id !== 'string') {
    return formatErrorResult("invalid_parameter: 'id' is required for action 'delete'");
  }

  try {
    opCtx.assertActive();
    let record: any;
    withDatabase(opCtx.dbPath, (db) => {
      opCtx.assertActive();
      record = deleteRelation(
        db,
        {
          id: args.id,
          scope: targetScope,
        },
        {
          signal: opCtx.signal,
          assertActive: opCtx.assertActive,
        },
      );
    });

    return formatSuccessResult(record, {
      id: record.id,
      status: 'deleted',
    });
  } catch (err: any) {
    return formatErrorResult(err.message);
  }
}
