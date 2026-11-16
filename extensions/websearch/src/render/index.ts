export type Component = { compactLeftMargin?: number; invalidate(): void; render(width: number): string[] };

export type WebsearchRenderOptions = { expanded?: boolean; isPartial?: boolean };
export type Theme = {
  fg?: (name: string, text: string) => string;
  bold?: (text: string) => string;
  keybinding?: (action: string) => string | undefined;
};
type ToolContent = { type?: string; text?: string };

export const RESET = '\x1b[0m';
export const CYAN = '\x1b[1;38;2;0;229;255m';
export const LIME = '\x1b[1;38;2;102;255;102m';
export const RED = '\x1b[1;38;2;255;77;109m';
export const DIM = '\x1b[2m';

/** Short inline row separator; not a card frame. */
export const ROW_SEPARATOR = ' ─ ';

/** Presentation-only marker: declares compact, unboxed, single-row compliance with 1-col margin. */
export const COMPACT_TOOL_RENDERING = { compactToolRenderingVersion: 1, compactLeftMargin: 1 } as const;

const ANSI_RE = /\u001b\][^\u001b\u0007]*(?:\u001b\\|\u0007)|\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_TOKEN_RE = /(?:\u001b\][^\u001b\u0007]*(?:\u001b\\|\u0007)|\u001b\[[0-?]*[ -/]*[@-~])/g;
const graphemeSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : undefined;

function segmentText(text: string): string[] {
  if (!graphemeSegmenter) return [...text];
  return [...graphemeSegmenter.segment(text)].map((entry) => entry.segment);
}

function appendTextSegments(tokens: string[], text: string): void {
  for (const segment of segmentText(text)) tokens.push(segment);
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(ANSI_TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) appendTextSegments(tokens, text.slice(lastIndex, index));
    tokens.push(match[0]);
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) appendTextSegments(tokens, text.slice(lastIndex));
  return tokens;
}

function isAnsi(token: string): boolean {
  return token.startsWith('\u001b');
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

function isZeroWidthCodePoint(codePoint: number): boolean {
  return codePoint === 0x00ad
    || codePoint === 0x034f
    || codePoint === 0x061c
    || codePoint === 0x180e
    || codePoint === 0x200b
    || codePoint === 0x200c
    || codePoint === 0x200d
    || codePoint === 0x2060
    || codePoint === 0xfeff
    || (codePoint >= 0x0000 && codePoint <= 0x001f)
    || (codePoint >= 0x007f && codePoint <= 0x009f)
    || (codePoint >= 0x0300 && codePoint <= 0x036f)
    || (codePoint >= 0x0483 && codePoint <= 0x0489)
    || (codePoint >= 0x0591 && codePoint <= 0x05bd)
    || codePoint === 0x05bf
    || (codePoint >= 0x05c1 && codePoint <= 0x05c2)
    || (codePoint >= 0x05c4 && codePoint <= 0x05c5)
    || codePoint === 0x05c7
    || (codePoint >= 0x0610 && codePoint <= 0x061a)
    || (codePoint >= 0x064b && codePoint <= 0x065f)
    || codePoint === 0x0670
    || (codePoint >= 0x06d6 && codePoint <= 0x06dc)
    || (codePoint >= 0x06df && codePoint <= 0x06e4)
    || (codePoint >= 0x06e7 && codePoint <= 0x06e8)
    || (codePoint >= 0x06ea && codePoint <= 0x06ed)
    || (codePoint >= 0xfe00 && codePoint <= 0xfe0f);
}

function isFullWidthCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1f300 && codePoint <= 0x1f64f)
    || (codePoint >= 0x1f900 && codePoint <= 0x1f9ff)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function graphemeWidth(segment: string): number {
  if (segment === '\t') return 3;
  let width = 0;
  for (const char of segment) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined || isZeroWidthCodePoint(codePoint)) continue;
    width += isFullWidthCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

function lineWidth(text: string): number {
  return segmentText(stripAnsi(text).replace(/\t/g, '   ')).reduce((width, segment) => width + graphemeWidth(segment), 0);
}

export function visibleWidth(text: string): number {
  return lineWidth(text);
}

function truncate(text: string, width: number): string {
  if (width <= 0) return '';
  if (lineWidth(text) <= width) return text;
  if (width === 1) return '…';

  const targetWidth = width - lineWidth('…');
  let visible = 0;
  let output = '';

  for (const token of tokenize(text)) {
    if (isAnsi(token)) {
      output += token;
      continue;
    }
    const tokenWidth = graphemeWidth(token);
    if (visible + tokenWidth > targetWidth) break;
    output += token;
    visible += tokenWidth;
  }

  return `${output}…`;
}

export function fit(text: string, width: number): string {
  return truncate(text, Math.max(0, width));
}

function hardWrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;

  for (const token of tokenize(text)) {
    if (isAnsi(token)) {
      current += token;
      continue;
    }
    const tokenWidth = graphemeWidth(token);
    if (currentWidth > 0 && currentWidth + tokenWidth > width) {
      lines.push(current);
      current = '';
      currentWidth = 0;
    }
    if (tokenWidth <= width) {
      current += token;
      currentWidth += tokenWidth;
    }
  }

  if (current || lines.length === 0) lines.push(current);
  return lines;
}

function wrapLine(text: string, width: number): string[] {
  if (!text) return [''];
  if (width <= 0) return [''];
  if (lineWidth(text) <= width) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (lineWidth(word) > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(...hardWrap(word, width));
      continue;
    }
    if (!current) {
      current = word;
      continue;
    }
    const candidate = `${current} ${word}`;
    if (lineWidth(candidate) <= width) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** One compact inline row, composed of non-empty parts and clipped to width. */
export function rowLine(parts: Array<string | undefined | null>, width: number): string[] {
  if (width <= 0) return [];
  const line = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.replace(/[\r\n]+/g, ' '))
    .join(ROW_SEPARATOR);
  return [truncate(line, width)];
}

/** Wrap expanded content losslessly, preserving blank-line meaning. */
export function expandedLines(text: string, width: number): string[] {
  if (width <= 0) return [];
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw === '') {
      out.push('');
      continue;
    }
    out.push(...wrapLine(raw, width).map((line) => truncate(line, width)));
  }
  return out;
}

function clip(text: unknown, limit: number): string {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return truncate(normalized, limit);
}

function resultText(result: any): string {
  const content = Array.isArray(result?.content) ? result.content as ToolContent[] : [];
  return content.filter((part) => part?.type === 'text').map((part) => part.text ?? '').join('\n');
}

function status(result: any): string {
  return result?.details?.status ?? (result?.isError ? 'failure' : 'success');
}

function data(result: any): any {
  return result?.details?.data ?? {};
}

function titleForData(value: any): string {
  return String(value?.title ?? value?.name ?? value?.tag ?? value?.id ?? value?.entity_id ?? value?.follow_up_ref ?? '').trim();
}

function urlForData(value: any): string {
  return String(value?.url ?? value?.html_url ?? value?.doi ?? value?.pdf_url ?? '').trim();
}

function itemLabel(item: any): string {
  const source = item?.source ? `[${item.source}${item.kind ? `/${item.kind}` : ''}] ` : '';
  const title = titleForData(item) || item?.followup_ref || item?.follow_up_ref || item?.id || 'result';
  const ref = item?.followup_tool && item?.followup_ref !== undefined ? ` → ${item.followup_tool}(${item.followup_ref})` : '';
  return `${source}${title}${ref}`;
}

function paint(theme: Theme | undefined, token: string, text: string): string {
  return theme?.fg?.(token, text) ?? text;
}

function boldTitle(theme: Theme | undefined, text: string): string {
  return paint(theme, 'toolTitle', theme?.bold?.(text) ?? text);
}

/**
 * Specialized collapsed summary for search-style payloads: counts, source and the
 * top hit stay inline. The single row is clipped from the tail, so the useful
 * identity is placed last and the returned text remains available on expansion.
 */
function compactSearchData(toolName: string, value: any, theme: Theme): Array<string | undefined> {
  const items = Array.isArray(value?.items) ? value.items : [];
  const errors = Array.isArray(value?.source_errors) ? value.source_errors : [];
  const source = value?.selected_source ? String(value.selected_source) : undefined;
  const top = items.length > 0 ? clip(itemLabel(items[0]), 200) : undefined;
  return [
    boldTitle(theme, toolName),
    `${items.length} result${items.length === 1 ? '' : 's'}`,
    source,
    errors.length ? `${errors.length} source error${errors.length === 1 ? '' : 's'}` : undefined,
    top,
  ];
}

/** Specialized collapsed summary for single-document detail payloads. */
function compactDetailData(toolName: string, value: any, result: any, theme: Theme): Array<string | undefined> {
  const main = titleForData(value) || resultText(result).split('\n').find(Boolean) || toolName;
  const url = urlForData(value);
  const counts = [
    Array.isArray(value?.comments) ? `${value.comments.length} comments` : undefined,
    Array.isArray(value?.review_comments) ? `${value.review_comments.length} review comments` : undefined,
    Array.isArray(value?.items) ? `${value.items.length} items` : undefined,
  ].filter(Boolean) as string[];
  const preview = clip(value?.summary ?? value?.snippet ?? value?.body ?? value?.abstract ?? value?.text ?? resultText(result), 220);
  return [
    boldTitle(theme, toolName),
    status(result),
    clip(main, 180),
    url ? clip(url, 180) : undefined,
    counts.length ? counts.join(' · ') : undefined,
    preview && preview !== main ? `preview: ${preview}` : undefined,
  ];
}

function compactResult(toolName: string, result: any, theme: Theme): Array<string | undefined> {
  const value = data(result);
  if (Array.isArray(value?.items) || Array.isArray(value?.source_errors)) return compactSearchData(toolName, value, theme);
  return compactDetailData(toolName, value, result, theme);
}

export function toolActionBadge(toolName: string, args: any): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = args[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  };
  switch (toolName) {
    case 'web_search':
    case 'github_code_search':
    case 'github_search_issues':
    case 'academic_search':
    case 'discussion_search':
      return pick('query');
    case 'web_fetch':
      return pick('url');
    case 'web_research':
      return pick('topic', 'query');
    case 'site_search': {
      const combined = `${pick('site') ?? ''} ${pick('query') ?? ''}`.trim();
      return combined || undefined;
    }
    case 'discussion_get':
      return pick('issue', 'question_id', 'item_id', 'url', 'source');
    case 'github_get':
      return pick('issue', 'pull_request', 'release', 'url');
    case 'academic_paper':
      return pick('paper_id', 'doi', 'title');
    default:
      return pick('query', 'url', 'topic', 'title', 'symbol');
  }
}

export function renderWebsearchToolCall(
  toolName: string,
  args: any,
  theme?: Theme,
  context?: any,
): Component {
  const state = context ? (context.state ??= {}) : {};
  const badge = toolActionBadge(toolName, args);
  if (context?.state) context.state.badge = badge;
  return {
    compactLeftMargin: 1,
    invalidate() {},
    render(width: number): string[] {
      if (state.hasResult) return [];
      const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      if (safeWidth <= 0) return [];
      if (safeWidth === 1) return [' '];
      return rowLine([paint(theme, 'toolTitle', toolName), badge, `${DIM}running…${RESET}`], safeWidth - 1).map((line) => ` ${line}`);
    },
  };
}

export function renderWebsearchToolResult(
  toolName: string,
  result: any,
  options: WebsearchRenderOptions = {},
  theme: Theme = {},
  context?: any,
): Component {
  const state = context ? (context.state ??= {}) : {};
  const isError = Boolean(
    context?.isError ||
    result?.isError ||
    status(result) === 'failure' ||
    result?.details?.status === 'failure' ||
    result?.details?.error,
  );
  state.hasResult = true;
  state.isError = isError;
  state.isPartial = Boolean(options?.isPartial);
  state.expanded = options?.expanded === true;

  // Prefer the call-phase badge; fall back to result data for restored rows.
  const badge: string | undefined = state.badge ?? toolActionBadge(toolName, data(result));

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
        head = [boldTitle(theme, toolName), badge, `${DIM}running…${RESET}`];
      } else if (isError) {
        const errorMsg = result?.details?.error?.message ?? result?.details?.error ?? resultText(result) ?? 'tool failed';
        head = [paint(theme, 'error', toolName), paint(theme, 'error', `error · ${clip(stripAnsi(String(errorMsg)), 140)}`)];
      } else {
        head = compactResult(toolName, result, theme);
      }

      const lines = rowLine(head, innerWidth).map((line) => ` ${line}`);
      if (!state.expanded || state.isPartial) return lines;

      const body = resultText(result);
      if (!body) return lines;
      return [...lines, ...expandedLines(body, innerWidth).map((line) => ` ${line}`)];
    },
  };
}
