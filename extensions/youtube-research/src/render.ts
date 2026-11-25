export type Component = {
  compactLeftMargin?: number;
  render(width: number): string[];
  invalidate(): void;
};

export type YoutubeRenderOptions = {
  expanded?: boolean;
  isPartial?: boolean;
};

export interface YoutubeRowState {
  hasResult?: boolean;
  isError?: boolean;
  isPartial?: boolean;
  expanded?: boolean;
  action?: string;
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

const ANSI_REGEX = /\u001b\][^\u001b\u0007]*(?:\u001b\\|\u0007)|\u001b\[[0-?]*[ -/]*[@-~]/g;
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

export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

function hasAnsi(text: string): boolean {
  return ANSI_ESCAPE_RE.test(text);
}

function styleMuted(theme: any, text: string): string {
  if (!text) return text;
  if (typeof theme?.fg === 'function') {
    const styled = theme.fg('muted', text);
    if (typeof styled === 'string' && styled !== text) return styled;
  }
  return `${MUTED}${text}${RESET}`;
}

export function charWidth(char: string): number {
  if (char === '\t') return 3;
  if (ZERO_WIDTH_CLUSTER_RE.test(char)) return 0;
  if (EMOJI_PRESENTATION_RE.test(char) || char.includes('\uFE0F') || char.includes('\u200D')) return 2;
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) return 0;
  return isFullWidthCodePoint(codePoint) ? 2 : 1;
}

export function visibleWidth(str: string): number {
  if (!str) return 0;
  if (isPrintableAscii(str)) return str.length;
  const clean = stripAnsi(str);
  if (isPrintableAscii(clean)) return clean.length;
  let width = 0;
  for (const segment of segmentText(clean)) width += charWidth(segment);
  return width;
}

function firstPrintingGraphemeWidth(plain: string): number {
  for (const segment of segmentText(plain)) {
    const w = charWidth(segment);
    if (w > 0) return w;
  }
  return 0;
}

function needsWidth2MarginOmission(line: string, totalWidth: number): boolean {
  if (totalWidth !== 2) return false;
  const plain = stripAnsi(line);
  if (plain === '') return false;
  return visibleWidth(plain) === 2 && firstPrintingGraphemeWidth(plain) === 2;
}

function formatMarginedLine(line: string, totalWidth: number): string {
  if (totalWidth <= 0) return '';
  if (totalWidth === 1) return ' ';
  if (needsWidth2MarginOmission(line, totalWidth)) return line;
  return ` ${line}`;
}

export function fit(text: string, width: number): string {
  if (width <= 0) return '';
  if (visibleWidth(text) <= width) return text;
  let out = '';
  let visible = 0;
  let hadAnsi = false;
  for (const part of text.split(ANSI_TOKEN_RE)) {
    if (!part) continue;
    if (part.startsWith('\u001b')) {
      out += part;
      hadAnsi = true;
      continue;
    }
    for (const segment of segmentText(part)) {
      const w = charWidth(segment);
      if (visible + w > width) return hadAnsi ? `${out}${RESET}` : out;
      out += segment;
      visible += w;
    }
  }
  return hadAnsi ? `${out}${RESET}` : out;
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
        const gw = charWidth(piece);
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
        if (currentWidth > 0 && currentWidth + gw > chunkLimit) flush();
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
      if (segment === ' ') pushAtom(true, { text: ' ', width: 1 });
      else if (segment === '\t') pushAtom(true, { text: '   ', width: 3 });
      else pushAtom(false, { text: segment, width: charWidth(segment) });
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
  if (visibleWidth(rawLine) <= width) return [rawLine];
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

export function extractYoutubeAction(toolName: string, args: any): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const trimmed = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined;
  switch (toolName) {
    case 'youtube_search':
      return trimmed(args.query);
    case 'youtube_video_get':
      return trimmed(args.video_ref) ?? trimmed(args.url) ?? trimmed(args.id);
    case 'youtube_transcript_get': {
      const ref = trimmed(args.video_ref) ?? trimmed(args.url) ?? '';
      const mode = trimmed(args.mode);
      const combined = `${ref}${mode ? ` [${mode}]` : ''}`.trim();
      return combined || undefined;
    }
    case 'youtube_channel_search':
      return trimmed(args.query) ?? trimmed(args.channel_id) ?? trimmed(args.handle) ?? trimmed(args.url);
    case 'youtube_playlist_get':
      return trimmed(args.playlist_ref) ?? trimmed(args.url) ?? trimmed(args.playlist_id);
    default:
      return undefined;
  }
}

function normalizeInline(text: unknown): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function resultText(result: any): string {
  const parts = Array.isArray(result?.content) ? result.content : [];
  return parts
    .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
    .map((part: any) => part.text)
    .join('\n');
}

function status(result: any): string {
  return result?.details?.status ?? (result?.isError ? 'failure' : 'success');
}

function data(result: any): any {
  return result?.details?.data ?? {};
}

function inferToolLabel(result: any): string {
  const match = resultText(result).match(/^(youtube_[a-z_]+):/);
  return match?.[1] ?? 'youtube_research';
}

function transcriptStats(text: string): string {
  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return `${words.toLocaleString('en-US')} words · ${chars.toLocaleString('en-US')} chars`;
}

/** Mode for media identity: transcript rows keep source/language/media stats. */
function transcriptSummary(result: any, toolName: string): Array<string | undefined> {
  const d = data(result);
  return [
    toolName,
    d.content_source ?? 'transcript',
    d.language ?? 'unknown',
    transcriptStats(String(d.text ?? '')),
    `video ${d.video_ref ?? 'unknown'}`,
  ];
}

/** Generic identity summary: media identity and result status. */
function genericSummary(result: any, toolName: string): Array<string | undefined> {
  const d = data(result);
  const media =
    normalizeInline(d.video?.url ?? d.video?.id ?? d.channel?.url ?? d.channel?.id ?? d.playlist?.url ?? d.playlist?.id ?? '') ||
    undefined;
  const counts = [
    Array.isArray(d.videos) ? `${d.videos.length} videos` : undefined,
    Array.isArray(d.entries) ? `${d.entries.length} entries` : undefined,
    Array.isArray(d.results) ? `${d.results.length} results` : undefined,
    Array.isArray(d.comments) ? `${d.comments.length} comments` : undefined,
  ].filter(Boolean) as string[];
  const continued =
    typeof d.entriesTotal === 'number' && typeof d.entriesOffset === 'number'
      ? `entries ${d.entriesOffset}+ of ${d.entriesTotal}`
      : undefined;
  return [
    toolName,
    status(result) === 'failure' ? 'failure' : 'complete',
    media,
    counts.length ? counts.join(' · ') : undefined,
    continued,
  ];
}

function isTranscript(result: any, toolName: string): boolean {
  return toolName === 'youtube_transcript_get' || Boolean(result?.details?.data?.content_source);
}

function summaryFor(result: any, toolName: string): Array<string | undefined> {
  return isTranscript(result, toolName) ? transcriptSummary(result, toolName) : genericSummary(result, toolName);
}

export function renderYoutubeToolCall(
  toolName: string,
  args: any,
  theme?: any,
  context?: any,
): Component {
  const state: YoutubeRowState = context ? (context.state ??= {}) : {};
  const action = extractYoutubeAction(toolName, args);
  if (context?.state) context.state.action = action;
  return {
    compactLeftMargin: 1,
    invalidate() {},
    render(width: number): string[] {
      if (state.hasResult) return [];
      const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      if (safeWidth <= 0) return [];
      if (safeWidth === 1) return [' '];
      return rowLine(
        [theme?.fg?.('toolTitle', toolName) ?? toolName, action, `${DIM}running…${RESET}`],
        safeWidth - 1,
        safeWidth,
      ).map((line) => formatMarginedLine(line, safeWidth));
    },
  };
}

export function renderYoutubeToolResult(
  first: any,
  second?: any,
  third?: any,
  fourth?: any,
  fifth?: any,
): Component {
  let toolName: string;
  let result: any;
  let options: YoutubeRenderOptions;
  let theme: any;
  let context: any;

  if (typeof first === 'string') {
    toolName = first;
    result = second ?? {};
    options = third ?? {};
    theme = fourth ?? {};
    context = fifth;
  } else {
    result = first ?? {};
    options = second ?? {};
    theme = third ?? {};
    context = fourth;
    toolName = inferToolLabel(result);
  }

  const state: YoutubeRowState = context ? (context.state ??= {}) : {};
  const isError = Boolean(
    context?.isError || result?.isError || status(result) === 'failure' || result?.details?.error,
  );
  state.hasResult = true;
  state.isError = isError;
  state.isPartial = Boolean(options?.isPartial);
  state.expanded = Boolean(options?.expanded);

  const title = (text: string) => theme?.fg?.('toolTitle', text) ?? text;

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
        head = [title(toolName), state.action, `${DIM}running…${RESET}`];
      } else if (isError) {
        const message = result?.details?.error?.message ?? resultText(result) ?? 'tool failed';
        head = [theme?.fg?.('error', toolName) ?? toolName, `error · ${normalizeInline(message)}`];
      } else {
        head = summaryFor(result, toolName).map((part, index) => (index === 0 ? title(part as string) : part));
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
