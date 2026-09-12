export type Component = {
  render(width: number): string[];
  invalidate(): void;
};

export interface UtilsRenderOptions {
  expanded?: boolean;
  isPartial?: boolean;
}

export const RESET = '\x1b[0m';
export const CYAN = '\x1b[1;38;2;0;229;255m';
export const LIME = '\x1b[1;38;2;102;255;102m';
export const RED = '\x1b[1;38;2;255;77;109m';
export const DIM = '\x1b[2m';
export const BOLD = '\x1b[1m';

const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;
const CJK_REGEX =
  /[\u1100-\u115f\u231a-\u231b\u2329-\u232a\u23e9-\u23ec\u23f0\u23f3\u25fd-\u25fe\u2614-\u2615\u2648-\u2653\u267f\u2693\u26a1\u26aa-\u26ab\u26bd-\u26be\u26c4-\u26c5\u26ce\u26d4\u26ea\u26f2-\u26f3\u26f5\u26fa\u26fd\u2705\u270a-\u270b\u2728\u274c\u274e\u2753-\u2755\u2757\u2795-\u2797\u27b0\u27bf\u2b1b-\u2b1c\u2b50\u2b55\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u;

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

export function getKeyHint(theme: any, action: 'expand' | 'collapse'): string {
  const key = theme?.keybinding?.('app.tools.expand') ?? 'ctrl+o';
  return `${DIM}${key} ${action}${RESET}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

// ---------------- Screenshot Renderer ----------------

export function extractScreenshotBadge(args: any): string {
  if (!args || typeof args !== 'object') return 'capture';
  if (args.action === 'list-windows') return 'list-windows';
  const target = args.target ?? 'screen';
  return `capture [${target}]`;
}

export function renderScreenshotCall(args: any, _theme?: any, context?: any): Component {
  return {
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];
      const badge = extractScreenshotBadge(args);

      if (width < 24) {
        return [fit(`screenshot [${badge}]`, width)];
      }

      const innerWidth = Math.max(0, width - 2);
      const state = context?.state;
      const isError = Boolean(context?.isError);
      const borderColor = state?.borderColor ?? (isError ? RED : CYAN);
      const topBorder = cardTopBorder('screenshot', badge, innerWidth, borderColor, borderColor);

      if (state?.hasResult) {
        return [topBorder];
      }

      const isList = args?.action === 'list-windows';
      const pendingDetail = isList ? 'Listing windows...' : 'Capturing screenshot...';
      const pendingLine = `${CYAN}●${RESET} Pending: ${pendingDetail}`;

      return [
        topBorder,
        boxLine(pendingLine, innerWidth, borderColor),
        cardBottomBorder(innerWidth, borderColor),
      ];
    },
  };
}

function buildScreenshotSummary(data: any): string {
  if (data?.action === 'list-windows') {
    const count = Array.isArray(data.windows) ? data.windows.length : 0;
    return `✓ ${count} windows listed`;
  }

  const target = data?.target ?? 'screen';
  const bounds = data?.window?.bounds;
  const dimensions = bounds ? `${bounds.width}x${bounds.height}` : '';
  const size = typeof data?.outputSizeBytes === 'number' ? formatBytes(data.outputSizeBytes) : '';
  const outPath = data?.outputPath ?? '';

  const dimPart = dimensions ? `${dimensions} ` : '';
  const sizePart = size ? `(${size}) ` : '';
  return `✓ captured ${target} ${dimPart}${sizePart}-> ${outPath}`.trim();
}

function buildScreenshotExpandedLines(data: any): string[] {
  const lines: string[] = [];

  if (data?.action === 'list-windows') {
    const windows = Array.isArray(data.windows) ? data.windows : [];
    lines.push(`backend: ${data.backend ?? 'unknown'} · server: ${data.displayServer ?? 'unknown'}`);
    if (data.command) lines.push(`command: ${data.command}`);
    lines.push(`total windows: ${windows.length}`);

    for (const w of windows) {
      const title = w.title ? `"${w.title}"` : '(untitled)';
      const app = w.app ? ` [${w.app}]` : '';
      const focus = w.focused ? ' (focused)' : '';
      const bounds = w.bounds ? ` (${w.bounds.width}x${w.bounds.height})` : '';
      lines.push(`- [${w.id}] ${title}${app}${focus}${bounds}`);
    }
  } else {
    lines.push(`target: ${data?.target ?? 'screen'}`);
    if (data?.outputPath) lines.push(`output: ${data.outputPath}`);
    if (data?.outputSizeBytes) lines.push(`file size: ${formatBytes(data.outputSizeBytes)}`);
    if (data?.displayServer) lines.push(`display server: ${data.displayServer}`);
    if (data?.screenshotProgram) lines.push(`program: ${data.screenshotProgram}`);
    if (data?.command) lines.push(`command: ${data.command}`);
    if (data?.window) {
      const w = data.window;
      lines.push(`window: id=${w.id} title="${w.title ?? ''}"${w.app ? ` app=${w.app}` : ''}`);
      if (w.bounds) {
        lines.push(`dimensions: ${w.bounds.width}x${w.bounds.height} at (${w.bounds.x}, ${w.bounds.y})`);
      }
    }
  }

  const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
  if (warnings.length > 0) {
    lines.push('', 'warnings:');
    for (const warn of warnings) {
      lines.push(`- ${warn}`);
    }
  }

  return lines;
}

export function renderScreenshotResult(
  result: any,
  options: UtilsRenderOptions = {},
  theme?: any,
  context?: any,
): Component {
  const isError = Boolean(
    context?.isError ||
      result?.isError ||
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
      const isExpanded = Boolean(options?.expanded);
      const hint = getKeyHint(theme, isExpanded ? 'collapse' : 'expand');
      const bodyLines: string[] = [];

      if (options?.isPartial) {
        bodyLines.push('Capturing screenshot…');
      } else if (isError) {
        const errorMsg =
          result?.details?.error?.message ??
          result?.details?.error ??
          result?.content?.[0]?.text ??
          'screenshot failed';
        bodyLines.push(`${RED}Error: ${stripAnsi(String(errorMsg))}${RESET}`);
        bodyLines.push(hint);
      } else if (!isExpanded) {
        const data = result?.details?.data ?? result?.details;
        const summary = buildScreenshotSummary(data);
        bodyLines.push(summary);
        bodyLines.push(hint);
      } else {
        const data = result?.details?.data ?? result?.details;
        const summary = buildScreenshotSummary(data);
        bodyLines.push(summary);
        bodyLines.push(hint);
        const detailLines = buildScreenshotExpandedLines(data);
        if (detailLines.length > 0) {
          bodyLines.push('');
          bodyLines.push(...detailLines);
        }
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
      return [...framed, bottomBorder];
    },
  };
}

// ---------------- Markdown To Audio Renderer ----------------

export function extractMarkdownToAudioBadge(args: any): string {
  if (!args || typeof args !== 'object') return 'tts';
  if (typeof args.path === 'string' && args.path.trim()) {
    const filename = args.path.trim().split(/[/\\]/).pop() || args.path.trim();
    return `tts [${filename}]`;
  }
  return 'tts';
}

export function renderMarkdownToAudioCall(args: any, _theme?: any, context?: any): Component {
  return {
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];
      const badge = extractMarkdownToAudioBadge(args);

      if (width < 24) {
        return [fit(`markdown_to_audio [${badge}]`, width)];
      }

      const innerWidth = Math.max(0, width - 2);
      const state = context?.state;
      const isError = Boolean(context?.isError);
      const borderColor = state?.borderColor ?? (isError ? RED : CYAN);
      const topBorder = cardTopBorder(
        'markdown_to_audio',
        badge,
        innerWidth,
        borderColor,
        borderColor,
      );

      if (state?.hasResult) {
        return [topBorder];
      }

      const pendingLine = `${CYAN}●${RESET} Pending: Converting markdown to audio...`;

      return [
        topBorder,
        boxLine(pendingLine, innerWidth, borderColor),
        cardBottomBorder(innerWidth, borderColor),
      ];
    },
  };
}

function buildMarkdownToAudioSummary(data: any): string {
  const chars = typeof data?.textCharCount === 'number' ? `${data.textCharCount} chars` : '';
  const size = typeof data?.outputSizeBytes === 'number' ? formatBytes(data.outputSizeBytes) : '';
  const engine = data?.engine ?? 'auto';

  const parts = [chars, size ? `(${size})` : ''].filter(Boolean).join(' ');
  return `✓ audio generated: ${parts} [${engine}]`.trim();
}

function buildMarkdownToAudioExpandedLines(data: any): string[] {
  const lines: string[] = [];

  if (data?.inputPath) lines.push(`input: ${data.inputPath}`);
  if (data?.outputPath) lines.push(`output: ${data.outputPath}`);
  if (data?.engine) lines.push(`engine: ${data.engine} (${data.engineRole ?? 'primary'})`);
  if (data?.ttsProgram) lines.push(`program: ${data.ttsProgram}`);
  if (data?.voiceModel) lines.push(`voice model: ${data.voiceModel}`);
  if (data?.language) lines.push(`language: ${data.language} · format: ${data.format ?? 'wav'}`);
  if (typeof data?.textCharCount === 'number') lines.push(`text characters: ${data.textCharCount}`);
  if (typeof data?.outputSizeBytes === 'number') lines.push(`audio size: ${formatBytes(data.outputSizeBytes)}`);

  const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
  if (warnings.length > 0) {
    lines.push('', 'warnings:');
    for (const warn of warnings) {
      lines.push(`- ${warn}`);
    }
  }

  return lines;
}

export function renderMarkdownToAudioResult(
  result: any,
  options: UtilsRenderOptions = {},
  theme?: any,
  context?: any,
): Component {
  const isError = Boolean(
    context?.isError ||
      result?.isError ||
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
      const isExpanded = Boolean(options?.expanded);
      const hint = getKeyHint(theme, isExpanded ? 'collapse' : 'expand');
      const bodyLines: string[] = [];

      if (options?.isPartial) {
        bodyLines.push('Converting markdown to audio…');
      } else if (isError) {
        const errorMsg =
          result?.details?.error?.message ??
          result?.details?.error ??
          result?.content?.[0]?.text ??
          'markdown_to_audio failed';
        bodyLines.push(`${RED}Error: ${stripAnsi(String(errorMsg))}${RESET}`);
        bodyLines.push(hint);
      } else if (!isExpanded) {
        const data = result?.details?.data ?? result?.details;
        const summary = buildMarkdownToAudioSummary(data);
        bodyLines.push(summary);
        bodyLines.push(hint);
      } else {
        const data = result?.details?.data ?? result?.details;
        const summary = buildMarkdownToAudioSummary(data);
        bodyLines.push(summary);
        bodyLines.push(hint);
        const detailLines = buildMarkdownToAudioExpandedLines(data);
        if (detailLines.length > 0) {
          bodyLines.push('');
          bodyLines.push(...detailLines);
        }
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
      return [...framed, bottomBorder];
    },
  };
}
