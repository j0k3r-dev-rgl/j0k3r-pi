type Component = { invalidate(): void; render(width: number): string[] };

type WebsearchRenderOptions = { expanded?: boolean; isPartial?: boolean };
type Theme = { fg?: (name: string, text: string) => string; bold?: (text: string) => string };
type ToolContent = { type?: string; text?: string };

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

function stripAnsi(text: string): string {
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

function wrapLines(lines: string[], width: number): string[] {
  return lines.flatMap((line) => wrapLine(line, width));
}

function textComponent(linesForWidth: (width: number) => string[]): Component {
  return {
    invalidate() {},
    render(width: number) {
      const w = Math.max(40, width);
      return linesForWidth(w).map((line) => truncate(line, w));
    },
  };
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
  if (errors.length) lines.push(dim(`${errors.length} source error${errors.length === 1 ? '' : 's'} · ctrl+o expand`));
  else lines.push(dim('ctrl+o expand'));
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
    dim('ctrl+o expand'),
  ];
}

function compactResult(toolName: string, result: any, theme: Theme): string[] {
  if (status(result) === 'failure' || result?.isError) {
    const title = (text: string) => theme?.fg?.('toolTitle', theme?.bold?.(text) ?? text) ?? text;
    const error = result?.details?.error;
    return [`${title(toolName)} · error`, clip(error?.message ?? resultText(result), 240), 'ctrl+o expand'];
  }
  const value = data(result);
  if (Array.isArray(value?.items) || Array.isArray(value?.source_errors)) return compactSearchData(toolName, value, theme);
  return compactDetailData(toolName, value, result, theme);
}

export function renderWebsearchToolResult(toolName: string, result: any, options: WebsearchRenderOptions = {}, theme: Theme = {}): Component {
  return textComponent((width) => {
    if (options.isPartial) return [`${toolName} · running…`];
    if (!options.expanded) return compactResult(toolName, result, theme);
    const title = (text: string) => theme?.fg?.('toolTitle', theme?.bold?.(text) ?? text) ?? text;
    const dim = (text: string) => theme?.fg?.('dim', text) ?? text;
    return wrapLines([
      `${title(toolName)} · expanded`,
      dim('ctrl+o collapse'),
      '',
      ...resultText(result).split('\n'),
    ], width);
  });
}
