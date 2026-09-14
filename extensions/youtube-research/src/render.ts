export type Component = {
  render(width: number): string[];
  invalidate(): void;
};

export type YoutubeRenderOptions = {
  expanded?: boolean;
  isPartial?: boolean;
};

export const RESET = '\x1b[0m';
export const CYAN = '\x1b[1;38;2;0;229;255m';
export const LIME = '\x1b[1;38;2;102;255;102m';
export const RED = '\x1b[1;38;2;255;77;109m';
export const DIM = '\x1b[2m';
export const BOLD = '\x1b[1m';

const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;
const CJK_REGEX = /[\u1100-\u115f\u231a-\u231b\u2329-\u232a\u23e9-\u23ec\u23f0\u23f3\u25fd-\u25fe\u2614-\u2615\u2648-\u2653\u267f\u2693\u26a1\u26aa-\u26ab\u26bd-\u26be\u26c4-\u26c5\u26ce\u26d4\u26ea\u26f2-\u26f3\u26f5\u26fa\u26fd\u2705\u270a-\u270b\u2728\u274c\u274e\u2753-\u2755\u2757\u2795-\u2797\u27b0\u27bf\u2b1b-\u2b1c\u2b50\u2b55\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

export function charWidth(char: string): number {
  return CJK_REGEX.test(char) ? 2 : 1;
}

export function visibleWidth(str: string): number {
  const stripped = stripAnsi(str);
  let width = 0;
  for (const ch of stripped) {
    width += charWidth(ch);
  }
  return width;
}

export function truncateWithAnsi(str: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (visibleWidth(str) <= maxWidth) return str;

  let visible = 0;
  let result = '';
  const ansiTokenRegex = /^\x1b\[[0-9;]*[a-zA-Z]/;
  const chars = [...str];
  let i = 0;

  while (i < chars.length) {
    const slice = chars.slice(i).join('');
    const match = slice.match(ansiTokenRegex);
    if (match) {
      result += match[0];
      i += [...match[0]].length;
      continue;
    }
    const ch = chars[i];
    const w = charWidth(ch);
    if (visible + w > maxWidth) break;
    result += ch;
    visible += w;
    i++;
  }

  result += RESET;
  return result;
}

export function fit(text: string, width: number): string {
  return truncateWithAnsi(text, Math.max(0, width));
}

export function pad(text: string, width: number): string {
  const vis = visibleWidth(text);
  if (vis <= width) {
    return text + ' '.repeat(width - vis);
  }
  const fitted = fit(text, width);
  const visFitted = visibleWidth(fitted);
  return fitted + ' '.repeat(Math.max(0, width - visFitted));
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

export function wrapLineToWidth(text: string, width: number): string[] {
  if (width <= 0) return [''];
  if (!text) return [''];
  if (visibleWidth(text) <= width) return [text];

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (visibleWidth(word) > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      let rem = word;
      while (visibleWidth(rem) > width) {
        const chunk = fit(rem, width);
        lines.push(chunk);
        const chunkStripped = stripAnsi(chunk);
        let remIdx = 0;
        let strippedCount = 0;
        while (remIdx < rem.length && strippedCount < chunkStripped.length) {
          const m = rem.slice(remIdx).match(/^\x1b\[[0-9;]*[a-zA-Z]/);
          if (m) {
            remIdx += m[0].length;
          } else {
            remIdx++;
            strippedCount++;
          }
        }
        const nextRem = rem.slice(remIdx);
        if (nextRem.length === rem.length) {
          rem = rem.slice(1);
        } else {
          rem = nextRem;
        }
      }
      if (rem) {
        current = rem;
      }
      continue;
    }

    if (!current) {
      current = word;
      continue;
    }

    const candidate = `${current} ${word}`;
    if (visibleWidth(candidate) <= width) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

export function extractYoutubeAction(toolName: string, args: any): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  switch (toolName) {
    case 'youtube_search':
      return typeof args.query === 'string' && args.query.trim() ? args.query.trim() : undefined;
    case 'youtube_video_get': {
      const ref = args.video_ref ?? args.url ?? args.id;
      return typeof ref === 'string' && ref.trim() ? ref.trim() : undefined;
    }
    case 'youtube_transcript_get': {
      const ref = typeof (args.video_ref ?? args.url) === 'string' ? (args.video_ref ?? args.url).trim() : '';
      const mode = typeof args.mode === 'string' && args.mode.trim() ? ` [${args.mode.trim()}]` : '';
      const combined = `${ref}${mode}`.trim();
      return combined || undefined;
    }
    case 'youtube_channel_search': {
      const target = args.query ?? args.channel_id ?? args.handle ?? args.url;
      return typeof target === 'string' && target.trim() ? target.trim() : undefined;
    }
    case 'youtube_playlist_get': {
      const ref = args.playlist_ref ?? args.url ?? args.playlist_id;
      return typeof ref === 'string' && ref.trim() ? ref.trim() : undefined;
    }
    default:
      return undefined;
  }
}

function getKeyHint(theme: any, action: 'expand' | 'collapse'): string {
  const key = theme?.keybinding?.('app.tools.expand') ?? 'ctrl+o';
  return `${DIM}${key} ${action}${RESET}`;
}

function clip(text: unknown, limit: number): string {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > limit ? `${normalized.slice(0, Math.max(0, limit - 1))}…` : normalized;
}

function resultText(result: any): string {
  return String(result?.content?.find?.((part: any) => part?.type === 'text')?.text ?? result?.content?.[0]?.text ?? '');
}

function status(result: any): string {
  return result?.details?.status ?? (result?.isError ? 'failure' : 'success');
}

function data(result: any): any {
  return result?.details?.data ?? {};
}

function inferToolLabel(result: any): string {
  const text = resultText(result);
  const match = text.match(/^(youtube_[a-z_]+):/);
  return match?.[1] ?? 'youtube_research';
}

function transcriptStats(text: string): string {
  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return `${words.toLocaleString('en-US')} words · ${chars.toLocaleString('en-US')} chars`;
}

function compactTranscript(result: any, theme: any, toolName = 'youtube_transcript_get'): string[] {
  const d = data(result);
  const transcript = String(d.text ?? '');
  const title = (value: string) => theme?.fg?.('toolTitle', theme?.bold?.(value) ?? value) ?? value;
  const accent = (value: string) => theme?.fg?.('accent', value) ?? value;
  const dim = (value: string) => theme?.fg?.('dim', value) ?? value;
  const header = `${title(toolName)} · ${accent(d.content_source ?? 'transcript')} · ${d.language ?? 'unknown'} · ${transcriptStats(transcript)}`;
  return [
    header,
    dim(`video ${d.video_ref ?? 'unknown'} · full transcript available`),
    `preview: ${clip(transcript, 220)}`,
  ];
}

function compactGeneric(result: any, theme: any, toolName = 'youtube_research'): string[] {
  const label = toolName || inferToolLabel(result);
  const title = (value: string) => theme?.fg?.('toolTitle', theme?.bold?.(value) ?? value) ?? value;
  const first = resultText(result).split('\n').find(Boolean) ?? label;
  return [
    `${title(label)} · ${status(result)}`,
    clip(first, 180),
  ];
}

export function renderYoutubeToolCall(
  toolName: string,
  args: any,
  _theme?: any,
  context?: any,
): Component {
  let cachedBorderWidth: number | undefined;
  let cachedBorderColor: string | undefined;
  let cachedTopBorder: string[] | undefined;

  return {
    invalidate() {
      cachedBorderWidth = undefined;
      cachedBorderColor = undefined;
      cachedTopBorder = undefined;
    },
    render(width: number): string[] {
      if (width <= 0) return [];
      const actionBadge = extractYoutubeAction(toolName, args);
      if (width < 24) {
        return [fit(actionBadge ? `${toolName} [${actionBadge}]` : toolName, width)];
      }

      const innerWidth = Math.max(0, width - 2);
      const state = context?.state;
      const isError = Boolean(context?.isError);
      const borderColor = state?.borderColor ?? (isError ? RED : CYAN);

      if (state?.hasResult) {
        if (
          cachedBorderWidth === innerWidth &&
          cachedBorderColor === borderColor &&
          cachedTopBorder
        ) {
          return cachedTopBorder;
        }
        const topBorder = cardTopBorder(toolName, actionBadge, innerWidth, borderColor, borderColor);
        cachedBorderWidth = innerWidth;
        cachedBorderColor = borderColor;
        cachedTopBorder = [topBorder];
        return cachedTopBorder;
      }

      const topBorder = cardTopBorder(toolName, actionBadge, innerWidth, borderColor, borderColor);
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

  const isError = Boolean(
    context?.isError ||
    result?.isError ||
    status(result) === 'failure' ||
    result?.details?.error,
  );
  const borderColor = isError ? RED : LIME;

  if (context?.state) {
    context.state.hasResult = true;
    context.state.borderColor = borderColor;
  }

  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;

  return {
    invalidate() {
      cachedWidth = undefined;
      cachedLines = undefined;
    },
    render(width: number): string[] {
      if (width <= 0) return [];
      if (!options?.isPartial && cachedWidth === width && cachedLines !== undefined) {
        return cachedLines;
      }

      const isExpanded = Boolean(options?.expanded);
      const keyHintStr = getKeyHint(theme, isExpanded ? 'collapse' : 'expand');
      const bodyLines: string[] = [];

      if (options?.isPartial) {
        bodyLines.push(`${toolName} · running…`);
      } else if (isError) {
        const errorMsg = result?.details?.error?.message ?? resultText(result) ?? 'tool failed';
        bodyLines.push(`${RED}Error: ${stripAnsi(String(errorMsg))}${RESET}`);
        bodyLines.push(keyHintStr);
      } else if (!isExpanded) {
        if (toolName === 'youtube_transcript_get' || result?.details?.data?.content_source) {
          bodyLines.push(...compactTranscript(result, theme, toolName));
        } else {
          bodyLines.push(...compactGeneric(result, theme, toolName));
        }
        bodyLines.push(keyHintStr);
      } else {
        bodyLines.push(`${toolName} · expanded`);
        bodyLines.push(keyHintStr);
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
          wrappedBodyLines.push(...wrapLineToWidth(sub, innerContentWidth));
        }
      }

      const framed = frameContent(wrappedBodyLines, innerWidth, borderColor);
      const bottomBorder = cardBottomBorder(innerWidth, borderColor);
      const finalLines = [...framed, bottomBorder];

      if (!options?.isPartial) {
        cachedWidth = width;
        cachedLines = finalLines;
      }

      return finalLines;
    },
  };
}
