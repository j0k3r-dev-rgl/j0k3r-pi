import type { Theme } from '@earendil-works/pi-coding-agent';
import { visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';

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
export const MUTED = '\x1b[38;2;122;167;184m';

/** Short inline row separator; not a card frame. */
export const ROW_SEPARATOR = ' ─ ';

/** Presentation-only marker: declares compact, unboxed, wrapped compliance with 1-col margin. */
export const COMPACT_TOOL_RENDERING = { compactToolRenderingVersion: 1, compactLeftMargin: 1 } as const;

const ANSI_TOKEN_RE = /(\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~])/g;
const ANSI_ESCAPE_RE = /\x1b(?:\[|\])/;
const GRAPHEME_SEGMENTER = new Intl.Segmenter('en', { granularity: 'grapheme' });

function normalizeInline(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function paint(color: string, text: string): string {
  return `${color}${text}${RESET}`;
}

function dim(text: string): string {
  return paint(DIM, text);
}

function hasAnsi(text: string): boolean {
  return ANSI_ESCAPE_RE.test(text);
}

function styleMuted(theme: Theme | undefined, text: string): string {
  if (!text) return text;
  const fg = (theme as any)?.fg;
  if (typeof fg === 'function') {
    const styled = fg.call(theme, 'muted', text);
    if (typeof styled === 'string' && styled !== text) return styled;
  }
  return `${MUTED}${text}${RESET}`;
}

function stripAnsiTokens(text: string): string {
  return text.replace(ANSI_TOKEN_RE, '');
}

function firstPrintingGraphemeWidth(plain: string): number {
  for (const { segment } of GRAPHEME_SEGMENTER.segment(plain)) {
    const w = visibleWidth(segment);
    if (w > 0) return w;
  }
  return 0;
}

function needsWidth2MarginOmission(line: string, totalWidth: number): boolean {
  if (totalWidth !== 2) return false;
  const plain = stripAnsiTokens(line);
  if (plain === '') return false;
  return visibleWidth(plain) === 2 && firstPrintingGraphemeWidth(plain) === 2;
}

function formatMarginedLine(line: string, totalWidth: number): string {
  if (totalWidth <= 0) return '';
  if (totalWidth === 1) return ' ';
  if (needsWidth2MarginOmission(line, totalWidth)) return line;
  return ` ${line}`;
}

function wrapAnsiForWidth2(rawLine: string): string[] {
  if (rawLine === '') return [''];
  if (visibleWidth(rawLine) <= 1) return [rawLine];
  const out: string[] = [];
  let current = '';
  let currentWidth = 0;
  let chunkLimit = 1;
  let activeSgr = '';
  let pendingAnsi = '';

  const flush = () => {
    const terminated = activeSgr && !current.endsWith(RESET) ? `${current}${RESET}` : current;
    out.push(terminated);
    current = activeSgr;
    currentWidth = 0;
    chunkLimit = 1;
  };

  const applyPending = () => {
    if (!pendingAnsi) return;
    current += pendingAnsi;
    pendingAnsi = '';
  };

  for (const part of rawLine.split(ANSI_TOKEN_RE)) {
    if (!part) continue;
    if (part.startsWith('\x1b[')) {
      if (part === RESET || part === '\x1b[m') {
        if (pendingAnsi) {
          current += pendingAnsi;
          pendingAnsi = '';
        }
        current += part;
        activeSgr = '';
      } else {
        pendingAnsi += part;
        if (part.endsWith('m')) activeSgr += part;
      }
      continue;
    }
    if (part.startsWith('\x1b]')) {
      pendingAnsi += part;
      continue;
    }
    for (const { segment } of GRAPHEME_SEGMENTER.segment(part)) {
      const expanded = segment === '\t' ? [' ', ' ', ' '] : [segment];
      for (const piece of expanded) {
        const gw = visibleWidth(piece);
        if (gw === 0) {
          applyPending();
          current += piece;
          continue;
        }
        if (gw > 1 && gw <= 2) {
          if (currentWidth > 0) flush();
          applyPending();
          chunkLimit = 2;
          current += piece;
          currentWidth = gw;
          continue;
        }
        if (currentWidth > 0 && currentWidth + gw > chunkLimit) {
          flush();
        }
        applyPending();
        current += piece;
        currentWidth += gw;
      }
    }
  }
  if (pendingAnsi) {
    current += pendingAnsi;
    pendingAnsi = '';
  }
  if (current !== activeSgr || out.length === 0) {
    const terminated = activeSgr && !current.endsWith(RESET) ? `${current}${RESET}` : current;
    out.push(terminated);
  }
  return out;
}

/** Compact inline header wrapped ANSI-aware without ellipsis clipping. */
export function rowLine(parts: Array<string | undefined | null>, width: number, totalWidth?: number): string[] {
  if (width <= 0) return [];
  const line = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.replace(/[\r\n]+/g, ' '))
    .join(ROW_SEPARATOR);
  if (!line) return [];
  return wrappedLines(line, width, totalWidth);
}

/** Wrap content losslessly, preserving blank lines and width-2 wide graphemes. */
export function wrappedLines(text: string, width: number, totalWidth?: number): string[] {
  if (width <= 0) return [];
  const allowWidth2Wide = totalWidth === 2;
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw === '') {
      out.push('');
      continue;
    }
    if (visibleWidth(raw) <= width) {
      out.push(raw);
      continue;
    }
    if (allowWidth2Wide && width === 1) {
      out.push(...wrapAnsiForWidth2(raw));
      continue;
    }
    const segments = wrapTextWithAnsi(raw, width);
    if (segments.length === 0) out.push('');
    else out.push(...segments);
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
    return [normalizeInline(args.libraryName), normalizeInline(args.query)].filter(Boolean);
  }
  if (toolName === 'context7_get_context') {
    return [normalizeInline(args.libraryId), normalizeInline(args.query)].filter(Boolean);
  }
  if (toolName === 'context7_resolve_and_get_context') {
    const library = args.version
      ? `${normalizeInline(args.libraryName)}@${normalizeInline(args.version)}`
      : normalizeInline(args.libraryName);
    return [library, normalizeInline(args.query)].filter(Boolean);
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
    firstId ? `top ${normalizeInline(firstId)}` : undefined,
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
    normalizeInline(documentation.libraryId ?? details.request?.libraryId ?? '<unknown library>'),
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
    selectedId ? normalizeInline(selectedId) : undefined,
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
      return rowLine([paint(CYAN, toolName), identity, dim('running…')], safeWidth - 1, safeWidth).map((line) =>
        formatMarginedLine(line, safeWidth),
      );
    },
  };
}

export function renderContext7ToolResult(
  toolName: string,
  result: ToolResultLike,
  options: Context7RenderOptions = {},
  theme?: Theme,
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
        head = [paint(RED, toolName), paint(RED, `error · ${normalizeInline(message)}`)];
      } else {
        const parts = [...identityParts(toolName, details), ...summaryParts(toolName, details)];
        head = [paint(LIME, toolName), ...parts.map((part) => paint(DIM, part))];
      }

      const lines = rowLine(head, innerWidth, safeWidth).map((line) => formatMarginedLine(line, safeWidth));
      if (!state.expanded || state.isPartial) return lines;

      const body = resultText(result);
      if (!body) return lines;
      const bodyLines: string[] = [];
      for (const raw of body.split(/\r?\n/)) {
        if (raw === '') {
          bodyLines.push(' ');
          continue;
        }
        const preStyled = hasAnsi(raw);
        for (const wrapped of wrappedLines(raw, innerWidth, safeWidth)) {
          const styled = preStyled || wrapped === '' ? wrapped : styleMuted(theme, wrapped);
          bodyLines.push(formatMarginedLine(styled, safeWidth));
        }
      }
      return [...lines, ...bodyLines];
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
