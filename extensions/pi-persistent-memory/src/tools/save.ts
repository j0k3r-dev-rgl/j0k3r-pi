import { saveAndIndexMemory, reindexMemories } from '../indexing/service.ts';
import { encodeScope } from '../identity.ts';
import type { OperationContext } from './types.ts';
import { formatSuccessResult, formatErrorResult } from './result-helper.ts';
import type { AgentToolResult } from '@earendil-works/pi-coding-agent';

export async function executeSaveTool(
  args: any,
  opCtx: OperationContext,
): Promise<AgentToolResult> {
  const action = args?.action ?? 'save';

  if (action === 'reindex') {
    if (args?.title !== undefined || args?.content !== undefined || args?.type !== undefined || args?.topic_key !== undefined) {
      return formatErrorResult("invalid_parameter: Textual fields (title, content, type, topic_key) are forbidden for action 'reindex'");
    }

    try {
      opCtx.assertActive();
      if (args?.id !== undefined) {
        if (args?.cursor) {
          return formatErrorResult('cursor_not_supported_for_id: Cursor is not supported for specific ID reindex');
        }
        if (!Number.isSafeInteger(args.id) || args.id <= 0) {
          return formatErrorResult('invalid_parameter: id must be a positive integer');
        }

        const res = await reindexMemories(
          opCtx.dbPath,
          { target: 'id', id: args.id, scopeKey: opCtx.scopeKey },
          { client: opCtx.client, signal: opCtx.signal, assertActive: opCtx.assertActive },
        );

        return formatSuccessResult(
          {
            action: 'reindex',
            requested_scope: res.requested_scope,
            actual_scope: res.actual_scope,
            processed: res.processed,
            succeeded: res.succeeded,
            failed: res.failed,
            stale: res.stale,
            remaining: res.remaining,
            has_more: res.has_more,
            next_cursor: res.next_cursor,
            notice: res.notice,
          },
          {
            id: args.id,
            processed: res.processed,
            succeeded: res.succeeded,
            failed: res.failed,
          },
        );
      }

      // Bulk pending reindex (max 5 sequential batching enforced by service)
      const isGlobal = !!args?.global;
      const target = isGlobal
        ? { target: 'all_pending' as const, scopeKey: opCtx.scopeKey, explicitAllProjects: true, cursor: args?.cursor }
        : { target: 'scope_pending' as const, scopeKey: opCtx.scopeKey, cursor: args?.cursor };

      const res = await reindexMemories(
        opCtx.dbPath,
        target,
        { client: opCtx.client, signal: opCtx.signal, assertActive: opCtx.assertActive },
      );

      return formatSuccessResult(
        {
          action: 'reindex',
          requested_scope: res.requested_scope,
          actual_scope: res.actual_scope,
          processed: res.processed,
          succeeded: res.succeeded,
          failed: res.failed,
          stale: res.stale,
          remaining: res.remaining,
          has_more: res.has_more,
          next_cursor: res.next_cursor,
          notice: res.notice,
        },
        {
          processed: res.processed,
          succeeded: res.succeeded,
          failed: res.failed,
          has_more: res.has_more,
          next_cursor: res.next_cursor,
        },
      );
    } catch (err: any) {
      return formatErrorResult(err.message);
    }
  }

  // action === 'save'
  if (!args?.title || typeof args.title !== 'string' || args.title.trim().length === 0) {
    return formatErrorResult("invalid_parameter: 'title' is required for action 'save'");
  }
  if (!args?.content || typeof args.content !== 'string' || args.content.trim().length === 0) {
    return formatErrorResult("invalid_parameter: 'content' is required for action 'save'");
  }
  if (!args?.type || typeof args.type !== 'string' || args.type.trim().length === 0) {
    return formatErrorResult("invalid_parameter: 'type' is required for action 'save'");
  }
  if (args?.cursor) {
    return formatErrorResult("invalid_parameter: cursor is not supported for action 'save'");
  }

  let finalTopicKey = args.topic_key ?? null;
  if (args.type === 'session_summary') {
    const expectedKey = `session/${opCtx.sessionId}/summary`;
    if (finalTopicKey && finalTopicKey !== expectedKey) {
      return formatErrorResult(`invalid_parameter: Conflicting topic_key for session_summary. Must be "${expectedKey}"`);
    }
    finalTopicKey = expectedKey;
  }

  if (args.id !== undefined && (!Number.isSafeInteger(args.id) || args.id <= 0)) {
    return formatErrorResult('invalid_parameter: id must be a positive integer');
  }

  const targetScopeKey = args?.scope === 'global'
    ? encodeScope({ kind: 'global' })
    : opCtx.scopeKey;

  try {
    opCtx.assertActive();
    const res = await saveAndIndexMemory(
      opCtx.dbPath,
      targetScopeKey,
      {
        id: args.id,
        topicKey: finalTopicKey,
        title: args.title,
        content: args.content,
        type: args.type,
      },
      {
        sessionId: opCtx.sessionId,
        invokingParentSessionId: opCtx.invokingParentSessionId,
        invocationId: opCtx.invocationId,
      },
      {
        client: opCtx.client,
        signal: opCtx.signal,
        assertActive: opCtx.assertActive,
      },
    );

    const summaryContent: Record<string, any> = {
      action: 'save',
      id: res.memory.id,
      status: 'saved',
      committed: res.committed,
      indexed: res.indexed,
      indexing_status: res.memory.indexing_status,
      scope: args.scope ?? opCtx.scope.kind,
      type: res.memory.type,
      topic_key: res.memory.topic_key,
    };
    if (res.error) {
      summaryContent.notice = `${res.error.category}: ${res.error.message}`;
    }

    return formatSuccessResult(summaryContent, {
      id: res.memory.id,
      status: 'saved',
      indexing_status: res.memory.indexing_status,
      topic_key: res.memory.topic_key,
    });
  } catch (err: any) {
    return formatErrorResult(err.message);
  }
}
