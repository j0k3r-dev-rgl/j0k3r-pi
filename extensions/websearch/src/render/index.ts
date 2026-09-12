export type Component = { invalidate(): void; render(width: number): string[] };

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
export const BOLD = '\x1b[1m';

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

export function pad(text: string, width: number): string {
  const fitted = fit(text, width);
  const vis = visibleWidth(fitted);
  return fitted + ' '.repeat(Math.max(0, width - vis));
}

export function boxLine(content: string, innerWidth: number, borderColor: string = CYAN): string {
  const innerContentWidth = Math.max(0, innerWidth - 2);
  return `${borderColor}│${RESET} ${pad(content, innerContentWidth)} ${borderColor}│${RESET}`;
}

export function cardTopBorder(
  toolName: string,
  actionOrTarget: string | undefined,
  innerWidth: number,
  borderColor: string = CYAN,
  titleColor: string = borderColor,
): string {
  const cleanAction = actionOrTarget ? actionOrTarget.replace(/[\r\n]+/g, ' ').trim() : undefined;
  let label = cleanAction ? `${toolName} [${cleanAction}]` : toolName;

  const maxTitleWidth = Math.max(4, innerWidth - 4);
  if (visibleWidth(label) + 2 > maxTitleWidth && cleanAction) {
    const maxActionWidth = Math.max(3, maxTitleWidth - visibleWidth(toolName) - 5);
    const truncatedAction = fit(cleanAction, maxActionWidth);
    label = `${toolName} [${truncatedAction}]`;
  }

  let titleText = ` ${label} `;
  if (visibleWidth(titleText) > innerWidth) {
    titleText = ` ${fit(label, Math.max(1, innerWidth - 2))} `;
  }

  const rest = Math.max(0, innerWidth - visibleWidth(titleText));
  const leftDash = Math.min(2, rest);
  const rightDash = Math.max(0, rest - leftDash);
  return `${borderColor}╭${'─'.repeat(leftDash)}${RESET}${titleColor}${titleText}${RESET}${borderColor}${'─'.repeat(rightDash)}╮${RESET}`;
}

export function cardBottomBorder(innerWidth: number, borderColor: string = CYAN): string {
  return `${borderColor}╰${'─'.repeat(Math.max(0, innerWidth))}╯${RESET}`;
}

export function frameContent(
  lines: string[],
  innerWidth: number,
  borderColor: string = CYAN,
): string[] {
  const framed: string[] = [];
  for (const rawLine of lines) {
    const subLines = rawLine.split(/\r?\n/);
    for (const sub of subLines) {
      framed.push(boxLine(sub, innerWidth, borderColor));
    }
  }
  return framed;
}

function clip(text: unknown, limit: number): string {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return truncate(normalized, limit);
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

function getKeyHint(theme: Theme | undefined, action: 'expand' | 'collapse'): string {
  const key = theme?.keybinding?.('app.tools.expand') ?? 'ctrl+o';
  return `${DIM}${key} ${action}${RESET}`;
}

function compactSearchData(toolName: string, value: any, theme: Theme): string[] {
  const title = (text: string) => theme?.fg?.('toolTitle', theme?.bold?.(text) ?? text) ?? text;
  const accent = (text: string) => theme?.fg?.('accent', text) ?? text;
  const dim = (text: string) => theme?.fg?.('dim', text) ?? text;
  const items = Array.isArray(value?.items) ? value.items : [];
  const errors = Array.isArray(value?.source_errors) ? value.source_errors : [];
  const query = value?.query ? ` · ${accent(String(value.query))}` : '';
  const source = value?.selected_source ? ` · ${String(value.selected_source)}` : '';
  const lines = [`${title(toolName)} · ${items.length} result${items.length === 1 ? '' : 's'}${source}${query}`];
  for (const item of items.slice(0, 5)) lines.push(`• ${clip(itemLabel(item), 150)}`);
  if (errors.length) lines.push(dim(`${errors.length} source error${errors.length === 1 ? '' : 's'}`));
  return lines;
}

function compactDetailData(toolName: string, value: any, result: any, theme: Theme): string[] {
  const title = (text: string) => theme?.fg?.('toolTitle', theme?.bold?.(text) ?? text) ?? text;
  const dim = (text: string) => theme?.fg?.('dim', text) ?? text;
  const main = titleForData(value) || resultText(result).split('\n').find(Boolean) || toolName;
  const url = urlForData(value);
  const counts = [
    Array.isArray(value?.comments) ? `${value.comments.length} comments` : undefined,
    Array.isArray(value?.review_comments) ? `${value.review_comments.length} review comments` : undefined,
    Array.isArray(value?.items) ? `${value.items.length} items` : undefined,
  ].filter(Boolean).join(' · ');
  const preview = clip(value?.summary ?? value?.snippet ?? value?.body ?? value?.abstract ?? value?.text ?? resultText(result), 220);
  return [
    `${title(toolName)} · ${status(result)}`,
    clip(main, 180),
    ...(url ? [dim(clip(url, 180))] : []),
    ...(counts ? [dim(counts)] : []),
    ...(preview && preview !== main ? [`preview: ${preview}`] : []),
  ];
}

function compactResult(toolName: string, result: any, theme: Theme): string[] {
  const value = data(result);
  if (Array.isArray(value?.items) || Array.isArray(value?.source_errors)) return compactSearchData(toolName, value, theme);
  return compactDetailData(toolName, value, result, theme);
}

export function toolActionBadge(toolName: string, args: any): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  if (toolName === 'web_search' || toolName === 'github_code_search' || toolName === 'github_search_issues' || toolName === 'academic_search') {
    return typeof args.query === 'string' && args.query.trim() ? args.query.trim() : undefined;
  }
  if (toolName === 'web_fetch') {
    return typeof args.url === 'string' && args.url.trim() ? args.url.trim() : undefined;
  }
  if (toolName === 'web_research') {
    const topic = args.topic ?? args.query;
    return typeof topic === 'string' && topic.trim() ? topic.trim() : undefined;
  }
  if (toolName === 'site_search') {
    const site = typeof args.site === 'string' ? args.site.trim() : '';
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const combined = `${site} ${query}`.trim();
    return combined || undefined;
  }
  if (toolName === 'discussion_search') {
    return typeof args.query === 'string' && args.query.trim() ? args.query.trim() : undefined;
  }
  if (toolName === 'discussion_get') {
    const target = args.issue ?? args.question_id ?? args.item_id ?? args.url ?? args.source;
    return typeof target === 'string' && target.trim() ? target.trim() : undefined;
  }
  if (toolName === 'github_get') {
    const target = args.issue ?? args.pull_request ?? args.release ?? args.url;
    return typeof target === 'string' && target.trim() ? target.trim() : undefined;
  }
  if (toolName === 'academic_paper') {
    const target = args.paper_id ?? args.doi ?? args.title;
    return typeof target === 'string' && target.trim() ? target.trim() : undefined;
  }
  const fallback = args.query ?? args.url ?? args.topic ?? args.title ?? args.symbol;
  return typeof fallback === 'string' && fallback.trim() ? fallback.trim() : undefined;
}

export function renderWebsearchToolCall(
  toolName: string,
  args: any,
  _theme?: Theme,
  context?: any,
): Component {
  return {
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];
      const actionBadge = toolActionBadge(toolName, args);

      if (width < 24) {
        return [fit(actionBadge ? `${toolName} [${actionBadge}]` : toolName, width)];
      }

      const innerWidth = Math.max(0, width - 2);
      const state = context?.state;
      const isError = Boolean(context?.isError);
      const borderColor = state?.borderColor ?? (isError ? RED : CYAN);
      const topBorder = cardTopBorder(toolName, actionBadge, innerWidth, borderColor, borderColor);

      if (state?.hasResult) {
        return [topBorder];
      }

      const pendingDetail = actionBadge ? `Pending: ${actionBadge}` : 'Pending...';
      const pendingLine = `${CYAN}●${RESET} ${pendingDetail}`;

      return [
        topBorder,
        boxLine(pendingLine, innerWidth, borderColor),
        cardBottomBorder(innerWidth, borderColor),
      ];
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
  const isError = Boolean(
    context?.isError ||
    result?.isError ||
    status(result) === 'failure' ||
    result?.details?.status === 'failure' ||
    result?.details?.error,
  );
  const borderColor = isError ? RED : LIME;

  if (context?.state) {
    context.state.hasResult = true;
    context.state.borderColor = borderColor;
  }

  return {
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];
      const isExpanded = options?.expanded === true;
      const keyHint = getKeyHint(theme, isExpanded ? 'collapse' : 'expand');
      const bodyLines: string[] = [];
      const title = (text: string) => theme?.fg?.('toolTitle', theme?.bold?.(text) ?? text) ?? text;

      if (options?.isPartial) {
        bodyLines.push(`${title(toolName)} · running…`);
      } else if (isError) {
        const errorMsg = (result?.details?.error?.message ?? result?.details?.error ?? resultText(result)) || 'tool failed';
        bodyLines.push(`${title(toolName)} · error`);
        bodyLines.push(`${RED}Error: ${stripAnsi(String(errorMsg))}${RESET}`);
        bodyLines.push(keyHint);
      } else if (!isExpanded) {
        bodyLines.push(...compactResult(toolName, result, theme));
        bodyLines.push(keyHint);
      } else {
        bodyLines.push(`${title(toolName)} · expanded`);
        bodyLines.push(keyHint);
        bodyLines.push('');
        bodyLines.push(...resultText(result).split('\n'));
      }

      if (width < 24) {
        return bodyLines.map((line) => fit(stripAnsi(line), width));
      }

      const innerWidth = Math.max(0, width - 2);
      const innerContentWidth = Math.max(0, innerWidth - 2);
      const wrappedBodyLines: string[] = [];
      for (const rawLine of bodyLines) {
        for (const sub of rawLine.split(/\r?\n/)) {
          wrappedBodyLines.push(...wrapLine(sub, innerContentWidth));
        }
      }

      const framed = frameContent(wrappedBodyLines, innerWidth, borderColor);
      const bottomBorder = cardBottomBorder(innerWidth, borderColor);
      return [...framed, bottomBorder];
    },
  };
}
