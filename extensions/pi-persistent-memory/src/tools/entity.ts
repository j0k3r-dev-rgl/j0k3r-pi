import { saveEntity, getEntity, listEntities } from '../graph/service.ts';
import { withDatabase } from '../storage/db.ts';
import type { OperationContext } from './types.ts';
import {
  formatSuccessResult,
  formatErrorResult,
  measureSerializedToolResult,
  MAX_TOOL_RESULT_BYTES,
} from './result-helper.ts';
import type { AgentToolResult } from '@earendil-works/pi-coding-agent';

export async function executeEntityTool(
  args: any,
  opCtx: OperationContext,
): Promise<AgentToolResult> {
  const action = args?.action;
  if (!action || (action !== 'save' && action !== 'get' && action !== 'list')) {
    return formatErrorResult("invalid_parameter: 'action' is required and must be 'save', 'get', or 'list'");
  }

  if (action === 'save') {
    if (!args?.name || typeof args.name !== 'string' || args.name.trim().length === 0) {
      return formatErrorResult("invalid_parameter: 'name' is required for action 'save'");
    }
    if (!args?.type || typeof args.type !== 'string' || args.type.trim().length === 0) {
      return formatErrorResult("invalid_parameter: 'type' is required for action 'save'");
    }

    const targetScope = args?.scope === 'global' ? ({ kind: 'global' as const }) : opCtx.scope;

    try {
      opCtx.assertActive();
      let record: any;
      withDatabase(opCtx.dbPath, (db) => {
        opCtx.assertActive();
        record = saveEntity(
          db,
          {
            id: args.id,
            type: args.type,
            name: args.name,
            aliases: args.aliases,
            memoryId: args.memory_id,
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
        canonical_name: record.canonical_name,
        type: record.type,
      });
    } catch (err: any) {
      return formatErrorResult(err.message);
    }
  }

  if (action === 'get') {
    if (!args?.id || typeof args.id !== 'string') {
      return formatErrorResult("invalid_parameter: 'id' is required for action 'get'");
    }

    try {
      opCtx.assertActive();
      let record: any;
      withDatabase(opCtx.dbPath, (db) => {
        opCtx.assertActive();
        record = getEntity(db, {
          id: args.id,
          scope: opCtx.scope,
          explicitGlobal: !!args.global,
        });
      });

      return formatSuccessResult(record, {
        id: record.id,
        type: record.type,
      });
    } catch (err: any) {
      return formatErrorResult(err.message);
    }
  }

  // action === 'list'
  try {
    opCtx.assertActive();
    let envelope: any;
    withDatabase(opCtx.dbPath, (db) => {
      opCtx.assertActive();
      envelope = listEntities(
        db,
        {
          type: args?.type,
          scope: opCtx.scope,
          explicitGlobal: !!args?.global,
          cursor: args?.cursor,
          signal: opCtx.signal,
          assertActive: opCtx.assertActive,
          isWithinBudget: (env) => {
            const details = {
              count: env.entities.length,
              has_more: env.has_more,
              next_cursor: env.next_cursor,
            };
            return measureSerializedToolResult(env, details) <= MAX_TOOL_RESULT_BYTES;
          },
        },
      );
    });

    return formatSuccessResult(envelope, {
      count: envelope.entities.length,
      has_more: envelope.has_more,
      next_cursor: envelope.next_cursor,
    });
  } catch (err: any) {
    return formatErrorResult(err.message);
  }
}
