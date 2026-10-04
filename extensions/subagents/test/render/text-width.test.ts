import { describe, expect, it } from 'vitest';
import { visibleWidth, truncateToWidth, stripAnsi, wrapLineToWidth } from '../../src/render/text-width.js';
import { padToWidth } from '../../src/ui/theme.js';

describe('text-width and East Asian width alignment (Issue #25)', () => {
  it('correctly calculates visible width for emojis (e.g. ✅, ❌) matching pi-tui column width (17 vs 16)', () => {
    // Naive code point counting returns 16, whereas terminal cell width is 17
    expect(visibleWidth('✅ Task completed')).toBe(17);
    expect(visibleWidth('❌ Task failed')).toBe(14);
  });

  it('correctly calculates visible width for East Asian fullwidth characters (CJK)', () => {
    expect(visibleWidth('你好世界')).toBe(8);
    expect(visibleWidth('テスト')).toBe(6);
  });

  it('ignores ANSI styling sequences in visibleWidth calculation', () => {
    expect(visibleWidth('\u001b[32m✅ Task completed\u001b[0m')).toBe(17);
    expect(stripAnsi('\u001b[32m✅ Task completed\u001b[0m')).toBe('✅ Task completed');
  });

  it('truncates to terminal cell width without exceeding target width on wide characters', () => {
    const truncated = truncateToWidth('你好世界', 5, '');
    // '你' (2) + '好' (2) = 4; '世' would make it 6 > 5, so must stop at 4 columns
    expect(stripAnsi(truncated)).toBe('你好');
    expect(visibleWidth(truncated)).toBeLessThanOrEqual(5);

    const emojiTrunc = truncateToWidth('✅ Task completed', 10, '…');
    expect(visibleWidth(emojiTrunc)).toBeLessThanOrEqual(10);
  });

  it('padToWidth produces lines with exact target visibleWidth for wide characters and emojis', () => {
    const paddedExact = padToWidth('✅ Task completed', 17);
    expect(visibleWidth(paddedExact)).toBe(17);

    const paddedShort = padToWidth('✅ Task completed', 20);
    expect(visibleWidth(paddedShort)).toBe(20);

    const paddedClipped = padToWidth('✅ Task completed', 16);
    expect(visibleWidth(paddedClipped)).toBe(16);

    const paddedCjk = padToWidth('你好', 10);
    expect(visibleWidth(paddedCjk)).toBe(10);
  });

  it('wrapLineToWidth wraps lines containing wide characters without exceeding width', () => {
    const lines = wrapLineToWidth('你好世界 测试文本', 6);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(6);
    }
  });
});
