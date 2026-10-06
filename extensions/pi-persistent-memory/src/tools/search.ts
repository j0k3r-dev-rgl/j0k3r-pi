import { searchMemories } from '../search/service.ts';
import { traverseGraph } from '../graph/service.ts';
import { withDatabase } from '../storage/db.ts';
import type { OperationContext } from './types.ts';
import {
  formatSuccessResult,
  formatErrorResult,
  measureSerializedToolResult,
  MAX_TOOL_RESULT_BYTES,
} from './result-helper.ts';
import type { AgentToolResult } from '@earendil-works/pi-coding-agent';

export async function executeSearchTool(
  args: any,
  opCtx: OperationContext,
): Promise<AgentToolResult> {
  const mode = args?.mode ?? 'hybrid';

  if (mode === 'graph') {
    if (!args?.entity_id || typeof args.entity_id !== 'string' || args.entity_id.trim().length === 0) {
      return formatErrorResult("invalid_parameter: entity_id is required for mode 'graph'");
    }
    if (args?.query !== undefined && args.query !== null) {
      return formatErrorResult("contradictory_parameter: query is contradictory with mode 'graph'");
    }
    if (args?.cursor !== undefined && args.cursor !== null) {
      return formatErrorResult("contradictory_parameter: cursor is contradictory with mode 'graph'");
    }

    try {
      opCtx.assertActive();
      let envelope: any;
      withDatabase(opCtx.dbPath, (db) => {
        envelope = traverseGraph(db, {
          rootEntityId: args.entity_id,
          scope: opCtx.scope,
          explicitGlobal: !!args.global,
          maxHops: 2,
          maxEntities: 20,
          signal: opCtx.signal,
          assertActive: opCtx.assertActive,
          isWithinBudget: (env) => {
            const details = {
              mode: 'graph',
              entity_id: args.entity_id,
              node_count: env.nodes.length,
              edge_count: env.edges.length,
            };
            return measureSerializedToolResult(env, details) <= MAX_TOOL_RESULT_BYTES;
          },
        });
      });

      return formatSuccessResult(envelope, {
        mode: 'graph',
        entity_id: args.entity_id,
        node_count: envelope.nodes.length,
        edge_count: envelope.edges.length,
      });
    } catch (err: any) {
      return formatErrorResult(err.message);
    }
  }

  // Non-graph search (hybrid, semantic, fts5)
  if (!args?.query || typeof args.query !== 'string' || args.query.trim().length === 0) {
    return formatErrorResult('invalid_parameter: query is required for non-graph search');
  }
  if (args?.entity_id !== undefined && args.entity_id !== null) {
    return formatErrorResult(`contradictory_parameter: entity_id is contradictory with mode '${mode}'`);
  }

  try {
    opCtx.assertActive();
    const envelope = await searchMemories(
      opCtx.dbPath,
      {
        query: args.query,
        mode,
        scope: opCtx.scope,
        explicitGlobal: !!args.global,
        cursor: args.cursor,
        signal: opCtx.signal,
        isWithinBudget: (env) => {
          const details = {
            mode: env.actual_mode,
            count: env.results.length,
            has_more: env.has_more,
            next_cursor: env.next_cursor,
          };
          return measureSerializedToolResult(env, details) <= MAX_TOOL_RESULT_BYTES;
        },
      },
      {
        client: opCtx.client,
        context: {
          assertActive: opCtx.assertActive,
          signal: opCtx.signal,
        },
      },
    );

    return formatSuccessResult(envelope, {
      mode: envelope.actual_mode,
      count: envelope.results.length,
      has_more: envelope.has_more,
      next_cursor: envelope.next_cursor,
    });
  } catch (err: any) {
    return formatErrorResult(err.message);
  }
}
