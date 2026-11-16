import { formatMarginedLine, truncateToWidth, visibleWidth, wrapLineToWidth } from '../text-width.js';

export function emptyComponent() {
  return {
    compactLeftMargin: 1,
    invalidate() {},
    render(_width?: number): string[] {
      return [];
    },
  };
}

export interface CompactCallState {
  hasResult?: boolean;
}

export interface InlineComponentOptions {
  /** Single compact header line; clipped to the supplied width. */
  header: string;
  /** Lines emitted only when the row is expanded. */
  body?: string[];
  expanded?: boolean;
  /** Shared Pi `context.state` so the call slot suppresses itself once a result exists. */
  state?: CompactCallState;
  isCallSlot?: boolean;
}

/**
 * Owner-local component for the compact tool row.
 *
 * Native `Text` cannot clip one header line to the viewport width while still wrapping the expanded
 * body, so this component owns exactly that: one clipped header line plus fully wrapped expansion
 * lines, prefixed with exactly 1 leading blank column (`width - 1` content width; `width <= 0` -> `[]`;
 * `width === 1` -> `[' ']`). It emits no frame, background fill, extra blank row or expansion hint,
 * and it deliberately implements neither `handleMouse` nor `handleInput`, so Pi keeps ownership of
 * expansion keys and click routing.
 */
export function inlineComponent(options: InlineComponentOptions) {
  const body = options.expanded === true ? (options.body ?? []) : [];
  return {
    compactLeftMargin: 1,
    invalidate() {},
    render(width: number): string[] {
      const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      if (safeWidth <= 0) return [];
      if (options.isCallSlot && options.state?.hasResult) return [];
      if (safeWidth === 1) return [' '];
      const innerWidth = safeWidth - 1;
      const rawHeader = options.header.split('\n')[0] ?? '';
      const headerClipped = visibleWidth(rawHeader) <= innerWidth
        ? rawHeader
        : truncateToWidth(rawHeader, innerWidth, innerWidth <= 2 ? '' : '…');
      const lines: string[] = [` ${visibleWidth(headerClipped) <= innerWidth ? headerClipped : truncateToWidth(headerClipped, innerWidth, '')}`];
      for (const rawLine of body.flatMap((line) => line.split('\n'))) {
        for (const wrapped of wrapLineToWidth(rawLine, innerWidth, safeWidth)) {
          lines.push(formatMarginedLine(wrapped, safeWidth));
        }
      }
      return lines;
    },
  };
}
