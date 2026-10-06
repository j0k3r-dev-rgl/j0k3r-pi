import { softDeleteMemory } from '../storage/memory-store.ts';
import { withDatabase } from '../storage/db.ts';
import { encodeScope } from '../identity.ts';
import type { OperationContext } from './types.ts';
import { formatSuccessResult, formatErrorResult } from './result-helper.ts';
import type { AgentToolResult } from '@earendil-works/pi-coding-agent';

export async function executeDeleteTool(
  args: any,
  opCtx: OperationContext,
): Promise<AgentToolResult> {
  if (args?.id === undefined || !Number.isSafeInteger(args.id) || args.id <= 0) {
    return formatErrorResult("invalid_parameter: 'id' must be a positive integer");
  }
  if (!args?.owner_scope || (args.owner_scope !== 'project' && args.owner_scope !== 'global')) {
    return formatErrorResult("invalid_parameter: 'owner_scope' is required and must be 'project' or 'global'");
  }

  const targetScopeKind = args?.scope ?? opCtx.scope.kind;
  if (args.owner_scope !== targetScopeKind) {
    return formatErrorResult(
      `owner_scope_mismatch: Asserted owner_scope "${args.owner_scope}" does not match target scope "${targetScopeKind}"`,
    );
  }

  const targetScopeKey = targetScopeKind === 'global'
    ? encodeScope({ kind: 'global' })
    : opCtx.scopeKey;

  try {
    opCtx.assertActive();
    withDatabase(opCtx.dbPath, (db) => {
      opCtx.assertActive();
      softDeleteMemory(db, args.id, targetScopeKey);
    });

    return formatSuccessResult(
      {
        action: 'delete',
        id: args.id,
        status: 'deleted',
        owner_scope: args.owner_scope,
      },
      {
        id: args.id,
        status: 'deleted',
        owner_scope: args.owner_scope,
      },
    );
  } catch (err: any) {
    return formatErrorResult(err.message);
  }
}
