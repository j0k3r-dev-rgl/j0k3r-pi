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

export function wrapLineToWidth(line: string, width: number): string[] {
  const max = Math.max(1, width);
  if (!line) return [''];
  const wrapped = wrapTextWithAnsi(line, max);
  return wrapped.length > 0 ? wrapped : [''];
}
