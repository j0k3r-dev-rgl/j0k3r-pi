import { describe, expect, it } from 'vitest';

import { fitWithRightSuffix, padRightVisible, truncateToWidth, visibleWidth } from '../src/text.js';

describe('text utilities', () => {
  it('measures visible width for plain and ansi text', () => {
    expect(visibleWidth('plain')).toBe(5);
    expect(visibleWidth('\u001b[31mred\u001b[0m')).toBe(3);
  });

  it('truncates to width with ellipsis and preserves ansi reset', () => {
    expect(truncateToWidth('alphabet', 5)).toBe('alph…');
    expect(truncateToWidth('\u001b[31mstatus\u001b[0m', 4)).toBe('\u001b[31msta…\u001b[0m');
  });

  it('handles narrow widths deterministically', () => {
    expect(truncateToWidth('abc', 0)).toBe('');
    expect(truncateToWidth('abc', 1)).toBe('…');
    expect(padRightVisible('abcdef', 3)).toBe('ab…');
  });

  it('supports multibyte-safe clipping where visible glyphs are counted', () => {
    expect(visibleWidth('é🙂')).toBe(2);
    expect(truncateToWidth('é🙂z', 2)).toBe('é🙂');
  });

  it('pads plain and ansi text to visible width', () => {
    expect(padRightVisible('abc', 5)).toBe('abc  ');
    expect(padRightVisible('\u001b[32mok\u001b[0m', 4)).toBe('\u001b[32mok\u001b[0m  ');
  });

  it('preserves a right suffix when space is tight', () => {
    expect(fitWithRightSuffix('filename.ts', '+12 -3', 16)).toBe('filename… +12 -3');
    expect(fitWithRightSuffix('name', '+1 -0', 6)).toBe('+1 -0');
  });
});
