import { formatMarginedLine, wrapLineToWidth } from '../text-width.js';
import { hasAnsiEscape, MUTED, themeFg } from '../completion-message.js';

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

export type InlineBodyLine = string | { text: string; muted?: boolean };

export interface InlineComponentOptions {
  /** Compact header line; wraps automatically on terminal-width overflow without ellipsis clipping. */
  header: string;
  /** Lines emitted only when the row is expanded. */
  body?: InlineBodyLine[];
  expanded?: boolean;
  /** Active theme for styling plain-text muted body lines (falls back to #7aa7b8 ANSI muted). */
  theme?: any;
  /** Shared Pi `context.state` so the call slot suppresses itself once a result exists. */
  state?: CompactCallState;
  isCallSlot?: boolean;
}

/**
 * Owner-local component for the compact tool row.
 *
 * Wraps both header and expanded body automatically ANSI-aware without ellipsis clipping, prefixed
 * with exactly 1 leading blank column (`width - 1` content width; `width <= 0` -> `[]`;
 * `width === 1` -> `[' ']`; omitting the margin at width 2 solely where needed for an intact
 * wide grapheme). It emits no frame, background fill, extra blank row or expansion hint, and it
 * deliberately implements neither `handleMouse` nor `handleInput`, so Pi keeps ownership of
 * expansion keys and click routing.
 */
export function inlineComponent(options: InlineComponentOptions) {
  const body = options.expanded === true ? (options.body ?? []) : [];
  const theme = options.theme;
  return {
    compactLeftMargin: 1,
    invalidate() {},
    render(width: number): string[] {
      const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      if (safeWidth <= 0) return [];
      if (options.isCallSlot && options.state?.hasResult) return [];
      if (safeWidth === 1) return [' '];
      const innerWidth = safeWidth - 1;
      const lines: string[] = [];
      for (const rawHeaderLine of options.header.split('\n')) {
        for (const wrapped of wrapLineToWidth(rawHeaderLine, innerWidth, safeWidth)) {
          lines.push(formatMarginedLine(wrapped, safeWidth));
        }
      }
      for (const item of body) {
        const rawText = typeof item === 'string' ? item : item.text;
        const shouldMute = typeof item !== 'string' && Boolean(item.muted);
        for (const rawLine of rawText.split('\n')) {
          const alreadyAnsi = hasAnsiEscape(rawLine);
          for (const wrapped of wrapLineToWidth(rawLine, innerWidth, safeWidth)) {
            const styled = shouldMute && !alreadyAnsi && wrapped.length > 0
              ? themeFg(theme, 'muted', wrapped, MUTED)
              : wrapped;
            lines.push(formatMarginedLine(styled, safeWidth));
          }
        }
      }
      return lines;
    },
  };
}
