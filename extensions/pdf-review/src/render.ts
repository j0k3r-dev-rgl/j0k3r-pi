export type Component = {
  render(width: number): string[];
  invalidate(): void;
};

export interface PdfRenderOptions {
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

export function extractPdfBadge(args: any): string {
  if (!args || typeof args !== 'object') return 'pdf_extract';
  if (typeof args.path === 'string' && args.path.trim()) {
    const filename = args.path.trim().split(/[/\\]/).pop() || args.path.trim();
    return `pdf_extract [${filename}]`;
  }
  return 'pdf_extract';
}

export function renderPdfExtractCall(args: any, _theme?: any, context?: any): Component {
  return {
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];
      const badge = extractPdfBadge(args);

      if (width < 24) {
        return [fit(`${badge}`, width)];
      }

      const innerWidth = Math.max(0, width - 2);
      const state = context?.state;
      const isError = Boolean(context?.isError);
      const borderColor = state?.borderColor ?? (isError ? RED : CYAN);
      const topBorder = cardTopBorder('pdf_extract', badge, innerWidth, borderColor, borderColor);

      if (state?.hasResult) {
        return [topBorder];
      }

      const pendingLine = `${CYAN}●${RESET} Pending: Extracting PDF...`;

      return [
        topBorder,
        boxLine(pendingLine, innerWidth, borderColor),
        cardBottomBorder(innerWidth, borderColor),
      ];
    },
  };
}

function buildPdfSummary(data: any): string {
  const filePath = data?.file?.path ?? '';
  const filename = filePath.split(/[/\\]/).pop() || 'document.pdf';
  const pages =
    data?.pageCount !== null && data?.pageCount !== undefined
      ? `${data.pageCount} pages`
      : 'unknown pages';
  const chars = typeof data?.textCharCount === 'number' ? `${data.textCharCount} chars` : '0 chars';
  const source = data?.textSource ?? 'empty';

  return `✓ ${filename} · ${pages} · ${chars} [${source}]`;
}

function buildPdfExpandedLines(data: any): string[] {
  const lines: string[] = [];

  if (data?.file?.path) lines.push(`file: ${data.file.path}`);
  if (data?.file?.sha256) lines.push(`sha256: ${data.file.sha256}`);
  if (data?.file?.sizeBytes) lines.push(`file size: ${formatBytes(data.file.sizeBytes)}`);
  if (data?.pageCount !== null && data?.pageCount !== undefined) lines.push(`page count: ${data.pageCount}`);
  if (data?.textSource) lines.push(`text source: ${data.textSource}`);
  if (typeof data?.textCharCount === 'number') {
    const trunc = data?.truncated?.text ? ' (truncated)' : '';
    lines.push(`extracted chars: ${data.textCharCount}${trunc}`);
  }

  if (data?.ocr) {
    lines.push(`ocr: provider=${data.ocr.provider} language=${data.ocr.language} (${data.ocr.charCount} chars)`);
  }

  if (Array.isArray(data?.renderedPages) && data.renderedPages.length > 0) {
    const truncPages = data?.truncated?.pages ? ' (truncated)' : '';
    lines.push(`rendered pages: ${data.renderedPages.length}${truncPages}`);
  }

  const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
  if (warnings.length > 0) {
    lines.push('', 'warnings:');
    for (const w of warnings) {
      const code = typeof w === 'string' ? w : (w?.code ?? JSON.stringify(w));
      const msg = typeof w === 'object' && w?.message ? `: ${w.message}` : '';
      lines.push(`- ${code}${msg}`);
    }
  }

  if (typeof data?.text === 'string' && data.text.trim()) {
    lines.push('', 'text preview:');
    const preview = data.text.slice(0, 500).trim();
    lines.push(...preview.split('\n'));
    if (data.text.length > 500) {
      lines.push('…');
    }
  }

  return lines;
}

export function renderPdfExtractResult(
  result: any,
  options: PdfRenderOptions = {},
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
        bodyLines.push('Extracting PDF…');
      } else if (isError) {
        const errorMsg =
          result?.details?.error?.message ??
          result?.details?.error ??
          result?.content?.[0]?.text ??
          'pdf extraction failed';
        bodyLines.push(`${RED}Error: ${stripAnsi(String(errorMsg))}${RESET}`);
        bodyLines.push(hint);
      } else {
        const data = result?.details?.data ?? result?.details;
        const summary = buildPdfSummary(data);
        bodyLines.push(summary);
        bodyLines.push(hint);

        if (isExpanded) {
          const detailLines = buildPdfExpandedLines(data);
          if (detailLines.length > 0) {
            bodyLines.push('');
            bodyLines.push(...detailLines);
          }
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
