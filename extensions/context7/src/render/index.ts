import { keyHint, type Theme } from '@earendil-works/pi-coding-agent';
import { Text, type Component } from '@earendil-works/pi-tui';

interface ToolResultLike {
  content?: Array<{ type?: string; text?: string }>;
  details?: Record<string, any>;
  isError?: boolean;
}

export interface Context7RenderOptions {
  expanded?: boolean;
  isPartial?: boolean;
}

function clip(value: unknown, maxChars = 100): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function title(toolName: string, theme: Theme): string {
  return theme.fg('toolTitle', theme.bold(toolName));
}

function dim(text: string, theme: Theme): string {
  return theme.fg('dim', text);
}

function warningCount(details: Record<string, any>): string | undefined {
  const count = Array.isArray(details.warnings) ? details.warnings.length : 0;
  return count > 0 ? `${count} warning${count === 1 ? '' : 's'}` : undefined;
}

function cacheState(cache: any): string | undefined {
  if (!cache || typeof cache !== 'object') return undefined;
  if ('enabled' in cache) {
    if (!cache.enabled) return 'cache off';
    return cache.hit ? 'cache hit' : 'cache miss';
  }
  const entries = Object.values(cache).filter((entry) => entry && typeof entry === 'object') as Array<any>;
  if (entries.length === 0) return undefined;
  if (entries.every((entry) => !entry.enabled)) return 'cache off';
  if (entries.some((entry) => entry.enabled && !entry.hit)) return 'cache miss';
  if (entries.some((entry) => entry.enabled && entry.hit)) return 'cache hit';
  return undefined;
}

function resultText(result: ToolResultLike): string {
  return (result.content ?? [])
    .filter((part) => part?.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n');
}

function requestIdentity(toolName: string, args: Record<string, unknown>): string[] {
  if (toolName === 'context7_status') return [];
  if (toolName === 'context7_search_library') {
    return [clip(args.libraryName, 60), clip(args.query, 100)].filter(Boolean);
  }
  if (toolName === 'context7_get_context') {
    return [clip(args.libraryId, 80), clip(args.query, 100)].filter(Boolean);
  }
  if (toolName === 'context7_resolve_and_get_context') {
    const library = args.version ? `${clip(args.libraryName, 60)}@${clip(args.version, 30)}` : clip(args.libraryName, 60);
    return [library, clip(args.query, 100)].filter(Boolean);
  }
  return [];
}

function statusSummary(details: Record<string, any>): string[] {
  return [
    details.sdkAvailable === false ? 'unavailable' : 'ready',
    details.apiKeyPresent ? 'API key configured' : 'API key missing',
    cacheState(details.cache),
    warningCount(details),
  ].filter(Boolean) as string[];
}

function searchSummary(details: Record<string, any>): string[] {
  const results = Array.isArray(details.results) ? details.results : [];
  const count = typeof details.count === 'number' ? details.count : results.length;
  const firstId = results.find((candidate: any) => candidate?.id)?.id;
  return [
    `${count} candidate${count === 1 ? '' : 's'}`,
    firstId ? `top ${clip(firstId, 80)}` : undefined,
    cacheState(details.cache),
    warningCount(details),
  ].filter(Boolean) as string[];
}

function documentationSummary(details: Record<string, any>): string[] {
  const documentation = details.documentation ?? {};
  const snippets = Array.isArray(documentation.snippets) ? documentation.snippets : [];
  const sources = Array.isArray(documentation.sources) ? documentation.sources : [];
  const textChars = typeof documentation.text === 'string' ? documentation.text.length : undefined;
  return [
    clip(documentation.libraryId ?? details.request?.libraryId ?? '<unknown library>', 80),
    documentation.type === 'txt'
      ? `${textChars ?? 0} chars`
      : `${snippets.length} snippet${snippets.length === 1 ? '' : 's'}`,
    sources.length > 0 ? `${sources.length} source${sources.length === 1 ? '' : 's'}` : undefined,
    details.truncation?.truncated ? 'bounded · full artifact available' : undefined,
    cacheState(details.cache),
    warningCount(details),
  ].filter(Boolean) as string[];
}

function resolveSummary(details: Record<string, any>): string[] {
  const status = String(details.status ?? 'selected');
  const candidates = Array.isArray(details.candidates) ? details.candidates : [];
  const selectedId = details.selected?.id;
  const documentation = details.documentation;
  const snippets = Array.isArray(documentation?.snippets) ? documentation.snippets : [];
  return [
    status,
    selectedId ? clip(selectedId, 80) : undefined,
    status === 'ambiguous' ? `${candidates.length} candidates` : undefined,
    status === 'selected' && documentation?.type === 'json'
      ? `${snippets.length} snippet${snippets.length === 1 ? '' : 's'}`
      : undefined,
    details.truncation?.truncated ? 'bounded · full artifact available' : undefined,
    cacheState(details.cache),
    warningCount(details),
  ].filter(Boolean) as string[];
}

function compactSummary(toolName: string, result: ToolResultLike, theme: Theme): string {
  const details = result.details ?? {};
  let parts: string[];
  if (result.isError) parts = ['error'];
  else if (toolName === 'context7_status') parts = statusSummary(details);
  else if (toolName === 'context7_search_library') parts = searchSummary(details);
  else if (toolName === 'context7_get_context') parts = documentationSummary(details);
  else if (toolName === 'context7_resolve_and_get_context') parts = resolveSummary(details);
  else parts = ['result'];
  const identity = requestIdentity(toolName, details.request ?? {});
  const summaryParts = [...identity, ...parts].filter((part, index, values) => part && values.indexOf(part) === index);
  return `${title(toolName, theme)} · ${summaryParts.join(' · ')}`;
}

export function renderContext7ToolCall(toolName: string, args: Record<string, unknown>, theme: Theme): Component {
  const identity = requestIdentity(toolName, args);
  const suffix = identity.length > 0 ? ` · ${identity.join(' · ')}` : '';
  return new Text(`${title(toolName, theme)}${theme.fg('muted', suffix)}`, 0, 0);
}

export function renderContext7ToolResult(
  toolName: string,
  result: ToolResultLike,
  options: Context7RenderOptions,
  theme: Theme,
): Component {
  if (options.isPartial) {
    return new Text(`${title(toolName, theme)} · ${theme.fg('warning', 'running…')}`, 0, 0);
  }

  const summary = compactSummary(toolName, result, theme);
  if (!options.expanded) {
    return new Text(`${summary}\n${dim(keyHint('app.tools.expand', 'to expand'), theme)}`, 0, 0);
  }

  const content = resultText(result);
  const body = content ? `\n\n${content}` : '';
  return new Text(`${summary}\n${dim(keyHint('app.tools.expand', 'to collapse'), theme)}${body}`, 0, 0);
}

export function context7ToolRenderers(toolName: string) {
  return {
    renderCall(args: Record<string, unknown>, theme: Theme) {
      return renderContext7ToolCall(toolName, args, theme);
    },
    renderResult(result: ToolResultLike, options: Context7RenderOptions, theme: Theme) {
      return renderContext7ToolResult(toolName, result, options, theme);
    },
  };
}
