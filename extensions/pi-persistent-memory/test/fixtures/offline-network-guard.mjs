// Verification preload: normal tests may use ephemeral loopback mocks, never the real E5.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!loopback || url.port === '8000') {
    throw new Error(`offline_network_boundary: blocked ${url.origin}`);
  }
  return originalFetch(input, init);
};
