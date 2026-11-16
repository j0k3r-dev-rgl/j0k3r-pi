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

/** Short inline row separator; not a card frame. */
export const ROW_SEPARATOR = ' ─ ';

/** Presentation-only marker: declares compact, unboxed, single-row compliance with 1-col margin. */
export const COMPACT_TOOL_RENDERING = { compactToolRenderingVersion: 1, compactLeftMargin: 1 } as const;

const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;
const CJK_REGEX = /[\u1100-\u115f\u231a-\u231b\u2329-\u232a\u23e9-\u23ec\u23f0\u23f3\u25fd-\u25fe\u2614-\u2615\u2648-\u2653\u267f\u2693\u26a1\u26aa-\u26ab\u26bd-\u26be\u26c4-\u26c5\u26ce\u26d4\u26ea\u26f2-\u26f3\u26f5\u26fa\u26fd\u2705\u270a-\u270b\u2728\u274c\u274e\u2753-\u2755\u2757\u2795-\u2797\u27b0\u27bf\u2b1b-\u2b1c\u2b50\u2b55\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

export function charWidth(char: string): number {
  return CJK_REGEX.test(char) ? 2 : 1;
}

export function visibleWidth(str: string): number {
  let width = 0;
  for (const ch of stripAnsi(str)) width += charWidth(ch);
  return width;
}

export function fit(text: string, width: number): string {
  if (width <= 0) return '';
  if (visibleWidth(text) <= width) return text;
  const chars = [...text];
  let out = '';
  let visible = 0;
  let i = 0;
  const ansiTokenRegex = /^\x1b\[[0-9;]*[a-zA-Z]/;
  while (i < chars.length) {
    const match = chars.slice(i).join('').match(ansiTokenRegex);
    if (match) {
      out += match[0];
      i += [...match[0]].length;
      continue;
    }
    const w = charWidth(chars[i]);
    if (visible + w > width) break;
    out += chars[i];
    visible += w;
    i++;
  }
  return out;
}

/** One compact inline row, composed of non-empty parts and clipped to width. */
export function rowLine(parts: Array<string | undefined | null>, width: number): string[] {
  if (width <= 0) return [];
  const line = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.replace(/[\r\n]+/g, ' '))
    .join(ROW_SEPARATOR);
  return [fit(line, width)];
}

/**
 * Hard-wrap one over-long token in linear time. Re-measuring the whole remainder
 * per chunk made pathological single-line payloads quadratic.
 */
function hardChunks(text: string, width: number): string[] {
  const out: string[] = [];
  let current = '';
  let currentWidth = 0;
  let index = 0;
  while (index < text.length) {
    if (text[index] === '\x1b') {
      const match = text.slice(index).match(/^\x1b\[[0-9;]*[a-zA-Z]/);
      if (match) {
        current += match[0];
        index += match[0].length;
        continue;
      }
    }
    const char = text[index];
    const w = charWidth(char);
    if (currentWidth > 0 && currentWidth + w > width) {
      out.push(current);
      current = '';
      currentWidth = 0;
    }
    if (w <= width) {
      current += char;
      currentWidth += w;
    }
    index += 1;
  }
  if (current || out.length === 0) out.push(current);
  return out;
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
    if (visibleWidth(raw) <= width) {
      out.push(raw);
      continue;
    }
    const words = raw.split(/\s+/).filter(Boolean);
    let current = '';
    for (const word of words) {
      if (visibleWidth(word) > width) {
        if (current) {
          out.push(current);
          current = '';
        }
        out.push(...hardChunks(word, width));
        continue;
      }
      if (!current) {
        current = word;
        continue;
      }
      const candidate = `${current} ${word}`;
      if (visibleWidth(candidate) <= width) current = candidate;
      else {
        out.push(current);
        current = word;
      }
    }
    if (current) out.push(current);
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

function clip(text: unknown, limit: number): string {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return fit(normalized, limit);
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
    clip(d.video?.url ?? d.video?.id ?? d.channel?.url ?? d.channel?.id ?? d.playlist?.url ?? d.playlist?.id ?? '', 120) ||
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
      ).map((line) => ` ${line}`);
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
        head = [theme?.fg?.('error', toolName) ?? toolName, `error · ${clip(message, 140)}`];
      } else {
        head = summaryFor(result, toolName).map((part, index) => (index === 0 ? title(part as string) : part));
      }

      const lines = rowLine(head, innerWidth).map((line) => ` ${line}`);
      if (!state.expanded || state.isPartial) return lines;

      const body = resultText(result);
      if (!body) return lines;
      return [...lines, ...expandedLines(body, innerWidth).map((line) => ` ${line}`)];
    },
  };
}
