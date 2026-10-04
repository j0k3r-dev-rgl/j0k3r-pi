// Dependency-free Management API boundary. Limits include fetch AND streamed body reads.
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export function abortable(promise, signal) {
  if (signal?.aborted) {
    // The operation may have synchronously aborted before returning a rejected promise.
    void Promise.resolve(promise).catch(() => {});
    signal.throwIfAborted();
  }
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function requestJson(url, init, { fetchFn = globalThis.fetch, signal, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  signal?.throwIfAborted();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException('Management request timed out', 'TimeoutError')), timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  let reader;
  try {
    const response = await abortable(fetchFn(url, { ...init, signal: combined }), combined);
    if (!response.ok) throw new Error('Management HTTP error');
    const length = Number(response.headers?.get('content-length'));
    if (length > MAX_RESPONSE_BYTES) throw new Error('Management response too large');
    if (!response.body) throw new Error('Empty Management response');
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await abortable(reader.read(), combined);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Management response too large');
      chunks.push(value);
    }
    combined.throwIfAborted();
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    clearTimeout(timer);
    // Never let cancellation of a broken stream stall task allocation.
    if (reader) void reader.cancel().catch(() => {});
  }
}
