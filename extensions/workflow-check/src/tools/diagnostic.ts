// Bound each page without discarding diagnostics. Offsets count UTF-16 units.
export function diagnosticPage(text, offset = 0) {
  if (offset > text.length) throw new Error('Invalid diagnostic_offset: beyond diagnostic length');
  let end = Math.min(text.length, offset + 4000);
  let cursor = offset;
  for (let line = 0; line < 100; line++) {
    const newline = text.indexOf('\n', cursor);
    if (newline < 0 || newline >= end) break;
    cursor = newline + 1;
    if (line === 99) end = cursor;
  }
  return { text: text.slice(offset, end), end, total: text.length, next: end < text.length ? end : undefined };
}
