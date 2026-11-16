import {
  stripTerminalSequences,
  truncateToWidth as piTruncateToWidth,
  visibleWidth as piVisibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';

export function stripAnsi(text: string): string {
  return stripTerminalSequences(text);
}

export function visibleWidth(text: string): number {
  return piVisibleWidth(text);
}

export function truncateToWidth(text: string, width: number, ellipsis = '…'): string {
  if (width <= 0) return '';
  return piTruncateToWidth(text, width, ellipsis);
}

export function wrapLineToWidth(line: string, width: number, totalWidth?: number): string[] {
  const max = Math.max(1, width);
  if (!line) return [''];
  if (totalWidth === 2 && piVisibleWidth(line) > max) {
    return wrapAnsiForWidth2(line);
  }
  const wrapped = wrapTextWithAnsi(line, max);
  return wrapped.length > 0 ? wrapped : [''];
}

const ANSI_TOKEN_RE = /(\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~])/g;
const GRAPHEME_SEGMENTER = new Intl.Segmenter('en', { granularity: 'grapheme' });

function firstPrintingGraphemeWidth(plain: string, widthFn: (text: string) => number = piVisibleWidth): number {
  for (const { segment } of GRAPHEME_SEGMENTER.segment(plain)) {
    const w = widthFn(segment);
    if (w > 0) return w;
  }
  return 0;
}

export function needsWidth2MarginOmission(
  line: string,
  totalWidth: number,
  widthFn: (text: string) => number = piVisibleWidth,
): boolean {
  if (totalWidth !== 2) return false;
  const plain = stripTerminalSequences(line);
  if (plain === '') return false;
  return widthFn(plain) === 2 && firstPrintingGraphemeWidth(plain, widthFn) === 2;
}

export function formatMarginedLine(
  line: string,
  totalWidth: number,
  widthFn: (text: string) => number = piVisibleWidth,
  truncateFn: (text: string, width: number, ellipsis?: string) => string = piTruncateToWidth,
): string {
  if (totalWidth <= 0) return '';
  if (totalWidth === 1) return ' ';
  if (needsWidth2MarginOmission(line, totalWidth, widthFn)) return line;
  const innerWidth = totalWidth - 1;
  return ` ${widthFn(line) <= innerWidth ? line : truncateFn(line, innerWidth, '')}`;
}

export function wrapAnsiForWidth2(rawLine: string, widthFn: (text: string) => number = piVisibleWidth): string[] {
  if (rawLine === '') return [''];
  if (widthFn(rawLine) <= 1) return [rawLine];
  const out: string[] = [];
  let current = '';
  let currentWidth = 0;
  let chunkLimit = 1;
  let activeSgr = '';

  const flush = () => {
    const terminated = activeSgr && !current.endsWith('\x1b[0m') ? `${current}\x1b[0m` : current;
    out.push(terminated);
    current = activeSgr;
    currentWidth = 0;
    chunkLimit = 1;
  };

  for (const part of rawLine.split(ANSI_TOKEN_RE)) {
    if (!part) continue;
    if (part.startsWith('\x1b[')) {
      current += part;
      activeSgr = part === '\x1b[0m' ? '' : `${activeSgr}${part}`;
      continue;
    }
    if (part.startsWith('\x1b]')) {
      current += part;
      continue;
    }
    for (const { segment } of GRAPHEME_SEGMENTER.segment(part)) {
      const gw = widthFn(segment);
      if (gw === 0) {
        current += segment;
        continue;
      }
      if (gw > 1 && gw <= 2) {
        if (currentWidth > 0) flush();
        chunkLimit = 2;
        current += segment;
        currentWidth = gw;
        continue;
      }
      if (currentWidth + gw > chunkLimit && currentWidth > 0) {
        flush();
      }
      current += segment;
      currentWidth += gw;
    }
  }
  if (current !== activeSgr || out.length === 0) {
    const terminated = activeSgr && !current.endsWith('\x1b[0m') ? `${current}\x1b[0m` : current;
    out.push(terminated);
  }
  return out;
}
