import { safeErrorMetadataDetails } from '../error-metadata.js';
import type { SubagentTask } from '../types.js';

export function taskFromDetails(result: any): SubagentTask | undefined {
  return result?.details?.tasks?.[0] ?? result?.details?.results?.[0] ?? result?.details?.task;
}

export function sessionIdFromToolContext(ctx: any): string | undefined {
  const direct = ctx?.sessionManager?.getSessionId?.() ?? ctx?.sessionId;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const file = ctx?.sessionManager?.getSessionFile?.();
  return typeof file === 'string' && file.length > 0 ? file : undefined;
}

function compactErrorMetadataForDetails(task: Pick<SubagentTask, 'error_metadata'>): Record<string, unknown> | undefined {
  if (!task.error_metadata) return undefined;
  return safeErrorMetadataDetails(task.error_metadata as any);
}

export function compactTaskForToolResult(task: SubagentTask): Record<string, any> {
  const { thread_snapshot: _threadSnapshot, error_metadata: _errorMetadata, ...compact } = task;
  const error_metadata = compactErrorMetadataForDetails(task);
  return error_metadata ? { ...compact, error_metadata } : compact;
}

export function compactTaskWithoutFinalText(task: SubagentTask): Record<string, any> {
  const { thread_snapshot: _threadSnapshot, transcript: _transcript, result: _result, error: _error, error_metadata: _errorMetadata, ...compact } = task;
  const error_metadata = compactErrorMetadataForDetails(task);
  return error_metadata ? { ...compact, error_metadata } : compact;
}

export function compactResultDetails<T extends Record<string, any>>(details: T): T {
  return {
    ...details,
    task: details.task ? compactTaskForToolResult(details.task) : details.task,
    tasks: Array.isArray(details.tasks) ? details.tasks.map(compactTaskForToolResult) : details.tasks,
    results: Array.isArray(details.results) ? details.results.map(compactTaskForToolResult) : details.results,
  };
}
