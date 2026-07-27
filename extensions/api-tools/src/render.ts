import { keyHint, Text } from './pi-runtime.js';
import type { ApiToolResult } from './types.js';

export interface ApiRenderOptions {
  expanded?: boolean;
  isPartial?: boolean;
}

function buildSummary(toolName: string, result: ApiToolResult): string {
  const status = result.isError ? 'failure' : String(result.details?.status ?? 'success');
  const action = typeof result.details?.action === 'string' ? result.details.action : 'action';
  const identity = typeof result.details?.identity === 'string' ? ` · ${result.details.identity}` : '';
  const continuation = result.details?.continuation?.has_more ? ' · more available' : '';
  return `${toolName} ${action} · ${status}${identity}${continuation}`;
}

function metadataLines(result: ApiToolResult): string[] {
  const lines: string[] = [];
  const continuation = result.details?.continuation;
  const failure = result.details?.failure;
  const render = result.details?.render;

  if (typeof result.details?.contract_version === 'number') lines.push(`contract_version: ${result.details.contract_version}`);
  if (render?.authorization_state) lines.push(`authorization: ${render.authorization_state}`);
  if (typeof continuation?.returned_count === 'number') {
    lines.push(`returned: ${continuation.returned_count}${typeof continuation.total === 'number' ? `/${continuation.total}` : ''}`);
  }
  if (typeof continuation?.next_cursor === 'string' && continuation.next_cursor.length > 0) lines.push(`cursor: ${continuation.next_cursor.slice(0, 10)}`);
  if (failure?.category) lines.push(`failure: ${failure.category}`);
  if (failure?.code) lines.push(`code: ${failure.code}`);
  if (failure?.next_step) lines.push(`next: ${failure.next_step}`);
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
  const sections = [summary, safeKeyHint(true), ...detailLines, body].filter((value) => typeof value === 'string' && value.length > 0);
  return new Text(sections.join('\n'), 0, 0);
}
