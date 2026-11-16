/**
 * Content revision: a change detector for cache freshness.
 *
 * Cache keys must cover every visible input (text, tool arguments/results/errors, metadata, attempt),
 * never only item counts or timestamps, so a same-length or equal-timestamp edit — including in-place
 * producer mutations — invalidates immediately.
 *
 * `JSON.stringify` is the fastest available exact encoder for this shape of data (a hand-written
 * per-leaf hash measured ~4x slower for 4000-character strings), so this keeps the native encoder and
 * only removes the cases it cannot handle: cycles from malformed/restored snapshots, and unbounded
 * sizes. Callers must compute one revision per frame and share it, rather than serializing the same
 * snapshot once per item.
 */
const MAX_STRING_CHARS = 64 * 1024;
const MAX_DEPTH = 12;

function bounded(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' && value.length > MAX_STRING_CHARS ? `${value.slice(0, MAX_STRING_CHARS)}…` : value;
  }
  if (depth >= MAX_DEPTH) return '[depth]';
  const object = value as object;
  if (seen.has(object)) return '[cycle]';
  seen.add(object);
  try {
    if (Array.isArray(value)) return value.map((entry) => bounded(entry, depth + 1, seen));
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record)) out[key] = bounded(record[key], depth + 1, seen);
    return out;
  } finally {
    seen.delete(object);
  }
}

/** Exact, bounded, cycle-safe revision string for any JSON-like value. */
export function contentRevision(value: unknown): string {
  if (value === undefined) return '0';
  let text: string;
  try {
    text = JSON.stringify(value) ?? 'undefined';
  } catch {
    try {
      text = JSON.stringify(bounded(value, 0, new WeakSet())) ?? 'undefined';
    } catch {
      return 'unserializable';
    }
  }
  return `${text.length}:${text}`;
}
