import type { Theme } from '@earendil-works/pi-coding-agent';
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';

export interface ToolResultLike {
  content?: Array<{ type?: string; text?: string }>;
  details?: Record<string, any>;
  isError?: boolean;
}

export interface Context7RenderOptions {
  expanded?: boolean;
  isPartial?: boolean;
}

export interface Context7RowState {
  hasResult?: boolean;
  isError?: boolean;
  isPartial?: boolean;
  expanded?: boolean;
}

export const RESET = '\x1b[0m';
export const CYAN = '\x1b[1;38;2;0;229;255m';
export const LIME = '\x1b[1;38;2;102;255;102m';
export const RED = '\x1b[1;38;2;255;77;109m';
export const DIM = '\x1b[2m';

/** Short inline row separator; not a card frame. */
export const ROW_SEPARATOR = ' ─ ';

/** Presentation-only marker: declares compact, unboxed, single-row compliance with 1-col margin. */
export const COMPACT_TOOL_RENDERING = { compactToolRenderingVersion: 1, compactLeftMargin: 1 } as const;

function clip(value: unknown, maxChars = 100): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return truncateToWidth(text, Math.max(0, maxChars), '…');
}

function paint(color: string, text: string): string {
  return `${color}${text}${RESET}`;
}

function dim(text: string): string {
  return paint(DIM, text);
}

/** One compact inline row, clipped to the supplied width. */
export function rowLine(parts: Array<string | undefined | null>, width: number): string[] {
  if (width <= 0) return [];
  const line = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.replace(/[\r\n]+/g, ' '))
    .join(ROW_SEPARATOR);
  return [truncateToWidth(line, width, '')];
}

/** Wrap expanded content losslessly, preserving blank lines. */
export function wrappedLines(text: string, width: number): string[] {
  if (width <= 0) return [];
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw === '') {
      out.push('');
      continue;
    }
    const segments = wrapTextWithAnsi(raw, width);
    if (segments.length === 0) out.push('');
    else out.push(...segments.map((segment) => truncateToWidth(segment, width, '')));
  }
  return out;
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
    const library = args.version
      ? `${clip(args.libraryName, 60)}@${clip(args.version, 30)}`
      : clip(args.libraryName, 60);
    return [library, clip(args.query, 100)].filter(Boolean);
  }
  return [];
}

export function toolActionBadge(toolName: string, args: Record<string, unknown>): string | undefined {
  if (toolName === 'context7_status') return 'status';
  const identity = requestIdentity(toolName, args);
  return identity.length > 0 ? identity.join(' · ') : undefined;
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

/** Specialized per-tool summary preserved from the previous card presentation. */
function summaryParts(toolName: string, details: Record<string, any>): string[] {
  if (toolName === 'context7_status') return statusSummary(details);
  if (toolName === 'context7_search_library') return searchSummary(details);
  if (toolName === 'context7_get_context') return documentationSummary(details);
  if (toolName === 'context7_resolve_and_get_context') return resolveSummary(details);
  return ['result'];
}

function identityParts(toolName: string, details: Record<string, any>): string[] {
  return requestIdentity(toolName, (details.request ?? {}) as Record<string, unknown>);
}

export function renderContext7ToolCall(
  toolName: string,
  args: Record<string, unknown>,
  _theme?: Theme,
  context?: any,
): { compactLeftMargin: number; invalidate(): void; render(width: number): string[] } {
  const state: Context7RowState = context ? (context.state ??= {}) : {};
  const identity = toolActionBadge(toolName, args);
  return {
    compactLeftMargin: 1,
    invalidate() {},
    render(width: number): string[] {
      if (state.hasResult) return [];
      const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      if (safeWidth <= 0) return [];
      if (safeWidth === 1) return [' '];
      return rowLine([paint(CYAN, toolName), identity, dim('running…')], safeWidth - 1).map((line) => ` ${line}`);
    },
  };
}

export function renderContext7ToolResult(
  toolName: string,
  result: ToolResultLike,
  options: Context7RenderOptions = {},
  _theme?: Theme,
  context?: any,
): { compactLeftMargin: number; invalidate(): void; render(width: number): string[] } {
  const state: Context7RowState = context ? (context.state ??= {}) : {};
  const isError = Boolean(
    context?.isError ||
      result.isError ||
      result.details?.error ||
      result.details?.sdkAvailable === false,
  );
  state.hasResult = true;
  state.isError = isError;
  state.isPartial = Boolean(options?.isPartial);
  state.expanded = options?.expanded === true;

  const details = result.details ?? {};

  return {
    compactLeftMargin: 1,
    invalidate() {},
    render(width: number): string[] {
      const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      if (safeWidth <= 0) return [];
      if (safeWidth === 1) return [' '];
      const innerWidth = safeWidth - 1;

      let head: Array<string | undefined>;
      if (state.isPartial) {
        head = [paint(CYAN, toolName), dim('running…')];
      } else if (isError) {
        const message = details.error?.message ?? details.error ?? resultText(result) ?? 'tool failed';
        head = [paint(RED, toolName), paint(RED, `error · ${clip(message, 120)}`)];
      } else {
        const parts = [...identityParts(toolName, details), ...summaryParts(toolName, details)];
        head = [paint(LIME, toolName), ...parts.map((part) => paint(DIM, part))];
      }

      const lines = rowLine(head, innerWidth).map((line) => ` ${line}`);
      if (!state.expanded || state.isPartial) return lines;

      const body = resultText(result);
      if (!body) return lines;
      return [...lines, ...wrappedLines(body, innerWidth).map((line) => ` ${line}`)];
    },
  };
}

export function context7ToolRenderers(toolName: string) {
  return {
    ...COMPACT_TOOL_RENDERING,
    renderShell: 'self' as const,
    renderCall(args: Record<string, unknown>, theme: Theme, context?: any) {
      return renderContext7ToolCall(toolName, args, theme, context);
    },
    renderResult(result: ToolResultLike, options: Context7RenderOptions, theme: Theme, context?: any) {
      return renderContext7ToolResult(toolName, result, options, theme, context);
    },
  };
}

export { visibleWidth };
