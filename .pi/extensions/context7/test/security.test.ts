import { describe, expect, it } from 'vitest';
import {
  clampMaxChars,
  formatSafeContext7Error,
  redactSecrets,
  truncateSnippets,
  truncateText,
} from '../src/security.js';

describe('context7 safe output helpers', () => {
  it('redacts the exact current API key value', () => {
    const output = redactSecrets('upstream failed for redaction-sentinel', ['redaction-sentinel']);

    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('redaction-sentinel');
  });

  it('redacts generic token-like values', () => {
    const output = redactSecrets('request failed with token=sensitive-marker and api_key: redaction-sentinel');

    expect(output).toContain('token=[REDACTED]');
    expect(output).toContain('api_key: [REDACTED]');
    expect(output).not.toContain('sensitive-marker');
    expect(output).not.toContain('redaction-sentinel');
  });

  it('clamps max_chars to the supported safety range', () => {
    expect(clampMaxChars(undefined, 12000)).toBe(12000);
    expect(clampMaxChars(10, 12000)).toBe(1000);
    expect(clampMaxChars(999999, 12000)).toBe(50000);
    expect(clampMaxChars(Number.NaN, 12000)).toBe(12000);
  });

  it('truncates text with an explicit notice and original size', () => {
    const truncated = truncateText('a'.repeat(1200), 1000);

    expect(truncated.truncated).toBe(true);
    expect(truncated.originalChars).toBe(1200);
    expect(truncated.text.length).toBeLessThanOrEqual(1100);
    expect(truncated.text).toContain('[truncated: showing');
  });

  it('truncates snippet content and marks metadata', () => {
    const result = truncateSnippets([
      { title: 'Long snippet', content: 'b'.repeat(1400), source: 'docs' },
    ], 1000);

    expect(result.truncated).toBe(true);
    expect(result.snippets[0].truncated).toBe(true);
    expect(result.snippets[0].originalChars).toBe(1400);
    expect(result.snippets[0].content).toContain('[truncated: showing');
  });

  it('formats actionable missing-key, access, rate-limit, and transient errors without secrets', () => {
    expect(formatSafeContext7Error({ code: 'missing_api_key', message: 'no key' })).toContain('CONTEXT7_API_KEY');
    expect(formatSafeContext7Error({ status: 403, message: 'denied redaction-sentinel' }, { apiKey: 'redaction-sentinel' })).not.toContain('redaction-sentinel');
    expect(formatSafeContext7Error({ status: 403, message: 'denied' })).toContain('access was denied');
    expect(formatSafeContext7Error({ status: 429, message: 'slow down', retryAfter: '30s' })).toContain('Retry-After: 30s');
    expect(formatSafeContext7Error({ status: 503, message: 'bad gateway' })).toContain('transient');
  });
});
