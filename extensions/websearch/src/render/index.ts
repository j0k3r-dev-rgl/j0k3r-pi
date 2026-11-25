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
export const MUTED = '\x1b[38;2;122;167;184m';

/** Short inline row separator; not a card frame. */
export const ROW_SEPARATOR = ' ─ ';

/** Presentation-only marker: declares compact, unboxed, wrapped compliance with 1-col margin. */
export const COMPACT_TOOL_RENDERING = { compactToolRenderingVersion: 1, compactLeftMargin: 1 } as const;

const ANSI_RE = /\u001b\][^\u001b\u0007]*(?:\u001b\\|\u0007)|\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_TOKEN_RE = /(\u001b\][^\u001b\u0007]*(?:\u001b\\|\u0007)|\u001b\[[0-?]*[ -/]*[@-~])/g;
const ANSI_ESCAPE_RE = /\u001b(?:\[|\])/;
const ZERO_WIDTH_CLUSTER_RE = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark})+$/u;
const EMOJI_PRESENTATION_RE = /^\p{Emoji_Presentation}/u;
const graphemeSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : undefined;

function segmentText(text: string): string[] {
  if (!graphemeSegmenter) return [...text];
  return [...graphemeSegmenter.segment(text)].map((entry) => entry.segment);
}

function isPrintableAscii(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

function hasAnsi(text: string): boolean {
  return ANSI_ESCAPE_RE.test(text);
}

function styleMuted(theme: Theme | undefined, text: string): string {
  if (!text) return text;
  if (typeof theme?.fg === 'function') {
    const styled = theme.fg('muted', text);
    if (typeof styled === 'string' && styled !== text) return styled;
  }
  return `${MUTED}${text}${RESET}`;
}

function isFullWidthCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x231a || codePoint === 0x231b
    || codePoint === 0x2329 || codePoint === 0x232a
    || (codePoint >= 0x23e9 && codePoint <= 0x23ec)
    || codePoint === 0x23f0 || codePoint === 0x23f3
    || (codePoint >= 0x25fd && codePoint <= 0x25fe)
    || (codePoint >= 0x2614 && codePoint <= 0x2615)
    || (codePoint >= 0x2648 && codePoint <= 0x2653)
    || codePoint === 0x267f || codePoint === 0x2693 || codePoint === 0x26a1
    || (codePoint >= 0x26aa && codePoint <= 0x26ab)
    || (codePoint >= 0x26bd && codePoint <= 0x26be)
    || (codePoint >= 0x26c4 && codePoint <= 0x26c5)
    || codePoint === 0x26ce || codePoint === 0x26d4 || codePoint === 0x26ea
    || (codePoint >= 0x26f2 && codePoint <= 0x26f3)
    || codePoint === 0x26f5 || codePoint === 0x26fa || codePoint === 0x26fd
    || codePoint === 0x2705 || (codePoint >= 0x270a && codePoint <= 0x270b)
    || codePoint === 0x2728 || codePoint === 0x274c || codePoint === 0x274e
    || (codePoint >= 0x2753 && codePoint <= 0x2755) || codePoint === 0x2757
    || (codePoint >= 0x2795 && codePoint <= 0x2797) || codePoint === 0x27b0 || codePoint === 0x27bf
    || (codePoint >= 0x2b1b && codePoint <= 0x2b1c) || codePoint === 0x2b50 || codePoint === 0x2b55
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || codePoint === 0x1f004 || codePoint === 0x1f0cf
    || (codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff)
    || (codePoint >= 0x1f300 && codePoint <= 0x1fbff)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function graphemeWidth(segment: string): number {
  if (segment === '\t') return 3;
  if (ZERO_WIDTH_CLUSTER_RE.test(segment)) return 0;
  if (EMOJI_PRESENTATION_RE.test(segment) || segment.includes('\uFE0F') || segment.includes('\u200D')) return 2;
  const codePoint = segment.codePointAt(0);
  if (codePoint === undefined) return 0;
  return isFullWidthCodePoint(codePoint) ? 2 : 1;
}

function lineWidth(text: string): number {
  if (!text) return 0;
  if (isPrintableAscii(text)) return text.length;
  const clean = stripAnsi(text);
  if (isPrintableAscii(clean)) return clean.length;
  let width = 0;
  for (const segment of segmentText(clean)) width += graphemeWidth(segment);
  return width;
}

export function visibleWidth(text: string): number {
  return lineWidth(text);
}

function firstPrintingGraphemeWidth(plain: string): number {
  for (const segment of segmentText(plain)) {
    const w = graphemeWidth(segment);
    if (w > 0) return w;
  }
  return 0;
}

function needsWidth2MarginOmission(line: string, totalWidth: number): boolean {
  if (totalWidth !== 2) return false;
  const plain = stripAnsi(line);
  if (plain === '') return false;
  return lineWidth(plain) === 2 && firstPrintingGraphemeWidth(plain) === 2;
}

function formatMarginedLine(line: string, totalWidth: number): string {
  if (totalWidth <= 0) return '';
  if (totalWidth === 1) return ' ';
  if (needsWidth2MarginOmission(line, totalWidth)) return line;
  return ` ${line}`;
}

function sliceToWidth(text: string, width: number): string {
  if (width <= 0) return '';
  if (lineWidth(text) <= width) return text;
  let visible = 0;
  let output = '';
  let hadAnsi = false;

  for (const part of text.split(ANSI_TOKEN_RE)) {
    if (!part) continue;
    if (part.startsWith('\u001b')) {
      output += part;
      hadAnsi = true;
      continue;
    }
    for (const segment of segmentText(part)) {
      const tokenWidth = graphemeWidth(segment);
      if (visible + tokenWidth > width) {
        return hadAnsi ? `${output}${RESET}` : output;
      }
      output += segment;
      visible += tokenWidth;
    }
  }
  return hadAnsi ? `${output}${RESET}` : output;
}

export function fit(text: string, width: number): string {
  return sliceToWidth(text, Math.max(0, width));
}

function wrapAnsiForWidth2(rawLine: string): string[] {
  if (rawLine === '') return [''];
  if (lineWidth(rawLine) <= 1) return [rawLine];
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
    if (part.startsWith('\u001b[')) {
      if (part === RESET || part === '\u001b[m') {
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
    if (part.startsWith('\u001b]')) {
      pendingAnsi += part;
      continue;
    }
    for (const segment of segmentText(part)) {
      const expanded = segment === '\t' ? [' ', ' ', ' '] : [segment];
      for (const piece of expanded) {
        const gw = graphemeWidth(piece);
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

type WrapAtom = { ansi?: string; text?: string; width: number };
type WrapUnit = { isSpace: boolean; parts: WrapAtom[]; width: number };

function tokenizeWrapUnits(rawLine: string): WrapUnit[] {
  const units: WrapUnit[] = [];
  let current: WrapUnit | undefined;
  let pendingAnsi: WrapAtom[] = [];

  const pushAtom = (isSpace: boolean, atom: WrapAtom) => {
    if (!current || current.isSpace !== isSpace) {
      current = { isSpace, parts: [], width: 0 };
      units.push(current);
    }
    if (pendingAnsi.length > 0) {
      current.parts.push(...pendingAnsi);
      pendingAnsi = [];
    }
    current.parts.push(atom);
    current.width += atom.width;
  };

  for (const part of rawLine.split(ANSI_TOKEN_RE)) {
    if (!part) continue;
    if (part.startsWith('\u001b')) {
      if ((part === RESET || part === '\u001b[m') && current) {
        current.parts.push({ ansi: part, width: 0 });
      } else {
        pendingAnsi.push({ ansi: part, width: 0 });
      }
      continue;
    }
    for (const segment of segmentText(part)) {
      if (segment === ' ') {
        pushAtom(true, { text: ' ', width: 1 });
      } else if (segment === '\t') {
        pushAtom(true, { text: '   ', width: 3 });
      } else {
        pushAtom(false, { text: segment, width: graphemeWidth(segment) });
      }
    }
  }

  if (pendingAnsi.length > 0) {
    if (current) current.parts.push(...pendingAnsi);
    else units.push({ isSpace: false, parts: pendingAnsi, width: 0 });
  }
  return units;
}

function wrapSingleLine(rawLine: string, width: number, allowWidth2Wide = false): string[] {
  if (width <= 0) return [];
  if (rawLine === '') return [''];
  if (lineWidth(rawLine) <= width) return [rawLine];
  if (isPrintableAscii(rawLine) && !rawLine.includes(' ')) {
    const chunks: string[] = [];
    for (let i = 0; i < rawLine.length; i += width) chunks.push(rawLine.slice(i, i + width));
    return chunks;
  }
  if (allowWidth2Wide && width === 1) return wrapAnsiForWidth2(rawLine);

  const units = tokenizeWrapUnits(rawLine);
  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;
  let activeSgr = '';
  let lineHasContent = false;
  let pendingSpace: WrapUnit | undefined;

  const updateSgr = (code: string) => {
    if (code === RESET || code === '\u001b[m') activeSgr = '';
    else if (code.startsWith('\u001b[') && code.endsWith('m')) activeSgr += code;
  };

  const applyParts = (parts: WrapAtom[]) => {
    for (const part of parts) {
      if (part.ansi !== undefined) {
        updateSgr(part.ansi);
        current += part.ansi;
      } else if (part.text !== undefined) {
        current += part.text;
        currentWidth += part.width;
        lineHasContent = true;
      }
    }
  };

  const applyAnsiOnly = (parts: WrapAtom[]) => {
    for (const part of parts) {
      if (part.ansi !== undefined) updateSgr(part.ansi);
    }
  };

  const flush = () => {
    const terminated = activeSgr && !current.endsWith(RESET) ? `${current}${RESET}` : current;
    lines.push(terminated);
    current = activeSgr;
    currentWidth = 0;
    lineHasContent = false;
  };

  for (const unit of units) {
    if (unit.isSpace) {
      if (currentWidth === 0 && lines.length === 0) {
        if (unit.width <= width) applyParts(unit.parts);
        else applyAnsiOnly(unit.parts);
      } else if (currentWidth > 0) {
        pendingSpace = unit;
      } else {
        applyAnsiOnly(unit.parts);
        current = activeSgr;
      }
      continue;
    }

    const spaceWidth = pendingSpace ? pendingSpace.width : 0;
    if (currentWidth + spaceWidth + unit.width <= width) {
      if (pendingSpace) {
        applyParts(pendingSpace.parts);
        pendingSpace = undefined;
      }
      applyParts(unit.parts);
      continue;
    }

    if (currentWidth > 0) flush();
    if (pendingSpace) {
      applyAnsiOnly(pendingSpace.parts);
      current = activeSgr;
      pendingSpace = undefined;
    }

    if (unit.width <= width) {
      applyParts(unit.parts);
      continue;
    }

    for (const part of unit.parts) {
      if (part.ansi !== undefined) {
        if (part.ansi === RESET || part.ansi === '\u001b[m') {
          current += part.ansi;
          activeSgr = '';
        } else {
          updateSgr(part.ansi);
          current += part.ansi;
        }
      } else if (part.text !== undefined) {
        if (currentWidth > 0 && currentWidth + part.width > width) flush();
        current += part.text;
        currentWidth += part.width;
        lineHasContent = true;
      }
    }
  }

  if (lineHasContent || lines.length === 0) {
    const terminated = activeSgr && !current.endsWith(RESET) ? `${current}${RESET}` : current;
    lines.push(terminated);
  }
  return lines;
}

/** Compact inline header wrapped ANSI-aware without ellipsis clipping. */
export function rowLine(parts: Array<string | undefined | null>, width: number, totalWidth?: number): string[] {
  if (width <= 0) return [];
  const line = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.replace(/[\r\n]+/g, ' '))
    .join(ROW_SEPARATOR);
  if (!line) return [];
  return wrapSingleLine(line, width, totalWidth === 2);
}

/** Wrap expanded content losslessly, preserving blank-line meaning. */
export function expandedLines(text: string, width: number, totalWidth?: number): string[] {
  if (width <= 0) return [];
  const allowWidth2Wide = totalWidth === 2;
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw === '') {
      out.push('');
      continue;
    }
    out.push(...wrapSingleLine(raw, width, allowWidth2Wide));
  }
  return out;
}

function normalizeInline(text: unknown): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function boundPreview(text: unknown, limit: number): string {
  const normalized = normalizeInline(text);
  if (!normalized) return '';
  return sliceToWidth(normalized, limit).trimEnd();
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
  const top = items.length > 0 ? normalizeInline(itemLabel(items[0])) : undefined;
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
  const main = normalizeInline(titleForData(value) || resultText(result).split('\n').find(Boolean) || toolName);
  const url = normalizeInline(urlForData(value));
  const counts = [
    Array.isArray(value?.comments) ? `${value.comments.length} comments` : undefined,
    Array.isArray(value?.review_comments) ? `${value.review_comments.length} review comments` : undefined,
    Array.isArray(value?.items) ? `${value.items.length} items` : undefined,
  ].filter(Boolean) as string[];
  const preview = boundPreview(value?.summary ?? value?.snippet ?? value?.body ?? value?.abstract ?? value?.text ?? resultText(result), 220);
  return [
    boldTitle(theme, toolName),
    status(result),
    main,
    url || undefined,
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
      return rowLine([paint(theme, 'toolTitle', toolName), badge, `${DIM}running…${RESET}`], safeWidth - 1, safeWidth).map((line) =>
        formatMarginedLine(line, safeWidth),
      );
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
        head = [paint(theme, 'error', toolName), paint(theme, 'error', `error · ${normalizeInline(stripAnsi(String(errorMsg)))}`)];
      } else {
        head = compactResult(toolName, result, theme);
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
        for (const wrapped of wrapSingleLine(raw, innerWidth, safeWidth === 2)) {
          const styled = preStyled || wrapped === '' ? wrapped : styleMuted(theme, wrapped);
          bodyLines.push(formatMarginedLine(styled, safeWidth));
        }
      }
      return [...lines, ...bodyLines];
    },
  };
}
