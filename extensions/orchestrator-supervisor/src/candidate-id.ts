/**
 * Canonical candidate-ID validation for the supervisor.
 *
 * A candidate is `<provider>/<modelId>`, where the model id may itself contain slashes
 * (`cliproxyapi/main/gpt-6.1-sol`, `openrouter/meta-llama/llama-3-70b`). Empty segments
 * and whitespace are rejected so a persisted routing slot stays unambiguous.
 *
 */
export function isValidCandidateId(id: unknown): id is string {
  if (typeof id !== 'string' || id.length === 0 || /\s/.test(id)) return false;
  const separator = id.indexOf('/');
  if (separator <= 0) return false;
  const provider = id.slice(0, separator);
  const model = id.slice(separator + 1);
  if (!provider || !model) return false;
  if (provider.includes('/') || model.startsWith('/') || model.endsWith('/') || model.includes('//')) return false;
  return true;
}

export function validateCandidateId(id: unknown): asserts id is string {
  if (!isValidCandidateId(id)) {
    throw new Error(`Invalid candidate ID format: "${String(id)}"`);
  }
}
