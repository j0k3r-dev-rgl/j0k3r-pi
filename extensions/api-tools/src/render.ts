import { keyHint, Text } from './pi-runtime.js';
import type { ApiToolResult } from './types.js';

export interface ApiRenderOptions {
  expanded?: boolean;
  isPartial?: boolean;
}

function buildSummary(toolName: string, result: ApiToolResult): string {
  const status = result.isError ? 'error' : String(result.details?.status ?? 'success');
  const action = typeof result.details?.request?.action === 'string' ? ` · ${result.details.request.action}` : '';
  const continuation = result.details?.continuation?.has_more ? ' · more available' : '';
  return `${toolName} · ${status}${action}${continuation}`;
}

function metadataLines(result: ApiToolResult): string[] {
  const lines: string[] = [];
  const request = result.details?.request;
  const response = result.details?.response;
  const continuation = result.details?.continuation;
  const error = result.details?.error;

  if (request && typeof request === 'object') {
    const action = typeof request.action === 'string' ? request.action : undefined;
    const method = typeof request.method === 'string' ? request.method : undefined;
    const path = typeof request.path === 'string' ? request.path : undefined;
    const operation = typeof request.operation_name === 'string' ? request.operation_name : undefined;
    const parts = [action, method && path ? `${method} ${path}` : undefined, operation].filter(Boolean);
    if (parts.length > 0) lines.push(`request: ${parts.join(' · ')}`);
  }

  if (response && typeof response === 'object') {
    const status = (response as Record<string, unknown>).status;
    const statusText = (response as Record<string, unknown>).status_text;
    if (typeof status !== 'undefined') lines.push(`response: ${status}${statusText ? ` ${statusText}` : ''}`);
  }

  if (continuation) {
    const returned = typeof continuation.returned_lines === 'number' ? continuation.returned_lines : undefined;
    const total = typeof continuation.total_lines === 'number' ? continuation.total_lines : undefined;
    if (typeof returned === 'number' && typeof total === 'number') lines.push(`continuation: ${returned}/${total} lines`);
    if (typeof continuation.next_cursor === 'string' && continuation.next_cursor.length > 0) lines.push(`cursor: ${continuation.next_cursor.slice(0, 10)}`);
  }

  if (error && typeof error === 'object' && typeof error.code === 'string') lines.push(`error: ${error.code}`);
  return lines;
}

function resultBody(result: ApiToolResult): string {
  return (result.content ?? [])
    .filter((entry) => entry?.type === 'text')
    .map((entry) => entry.text ?? '')
    .join('\n');
}

function safeKeyHint(expanded: boolean): string {
  const fallback = expanded ? 'to collapse' : 'to expand';
  try {
    return keyHint('app.tools.expand', fallback);
  } catch {
    return fallback;
  }
}

export function renderApiToolResult(toolName: string, result: ApiToolResult, options: ApiRenderOptions = {}, _theme?: any, _context?: any) {
  if (options.isPartial) return new Text(`${toolName} · running…`, 0, 0);

  const summary = buildSummary(toolName, result);
  if (!options.expanded) return new Text(`${summary}\n${safeKeyHint(false)}`, 0, 0);

  const detailLines = metadataLines(result);
  const body = resultBody(result);
  const sections = [
    summary,
    safeKeyHint(true),
    ...detailLines,
    body,
  ].filter((value) => typeof value === 'string' && value.length > 0);

  return new Text(sections.join('\n'), 0, 0);
}
