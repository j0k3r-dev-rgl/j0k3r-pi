import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SubagentStructuredError, classifyFallbackFailure, classifyThrownError, deriveErrorString, normalizeErrorMetadata } from '../../src/error-metadata.js';
import type { SubagentDefinition, SubagentErrorMetadata, SubagentsConfig } from '../../src/types.js';

describe('structured error metadata contract', () => {
  it('normalizes v1 metadata defaults, bounds, retryability, and redaction', () => {
    const secretLikeMessage = [
      'Bearer sk-fake-secret-token',
      'contact fake.user@example.com',
      'open /tmp/fake-private.txt',
      'prompt: summarize file contents SECRET_FILE_BODY',
    ].join(' | ');
    const metadata = normalizeErrorMetadata({
      category: 'provider_rate_limit',
      message: `${secretLikeMessage} ${'x'.repeat(1400)}`,
      source: {
        provider: 'openai',
        model: 'gpt-test',
        tool: `read_${'x'.repeat(400)}`,
        operation: `session.prompt.${'y'.repeat(400)}`,
      },
      details: {
        provider_code: 'rate_limit_429',
        auth_header: 'Authorization: Bearer sk-fake-secret-token',
        prompt: 'SYSTEM: fake prompt text',
        file_path: '/tmp/fake-private.txt',
        email: 'fake.user@example.com',
        body: `SECRET_FILE_BODY_${'z'.repeat(800)}`,
      },
      cause: {
        version: 1,
        category: 'unknown',
        message: 'nested cause',
        retryable: false,
        partial_result_available: false,
        cause: {
          version: 1,
          category: 'unknown',
          message: 'deep cause',
          retryable: false,
          partial_result_available: false,
          cause: {
            version: 1,
            category: 'unknown',
            message: 'too deep',
            retryable: false,
            partial_result_available: false,
          },
        },
      },
      attempts: [
        { version: 1, category: 'provider_api_error', message: 'primary', retryable: true, partial_result_available: false, role: 'primary' },
        { version: 1, category: 'provider_network_error', message: 'fallback', retryable: true, partial_result_available: false, role: 'fallback' },
        { version: 1, category: 'unknown', message: 'ignored', retryable: false, partial_result_available: false },
      ],
    });

    expect(metadata.version).toBe(1);
    expect(metadata.retryable).toBe(true);
    expect(metadata.message.length).toBeLessThanOrEqual(1024);
    expect(metadata.message).not.toContain('sk-fake-secret-token');
    expect(metadata.message).not.toContain('fake.user@example.com');
    expect(metadata.message).not.toContain('/tmp/fake-private.txt');
    expect(metadata.message).not.toContain('SECRET_FILE_BODY');
    expect(metadata.message).toContain('[redacted]');
    expect(metadata.source?.tool?.length ?? 0).toBeLessThanOrEqual(256);
    expect(metadata.source?.operation?.length ?? 0).toBeLessThanOrEqual(256);
    expect(Object.keys(metadata.details ?? {}).length).toBeLessThanOrEqual(16);
    expect(Object.values(metadata.details ?? {})).toEqual(expect.not.arrayContaining([
      expect.stringContaining('sk-fake-secret-token'),
      expect.stringContaining('fake.user@example.com'),
      expect.stringContaining('/tmp/fake-private.txt'),
      expect.stringContaining('SECRET_FILE_BODY'),
    ]));
    expect(metadata.attempts).toHaveLength(2);
    expect(metadata.attempts?.map((attempt) => attempt.role)).toEqual(['primary', 'fallback']);
    expect(metadata.cause?.cause?.cause).toBeUndefined();
  });

  it('preserves exact-string compatibility for legacy-facing derived errors', () => {
    expect(deriveErrorString(normalizeErrorMetadata({
      category: 'total_timeout',
      message: 'ignored',
      retryable: false,
      partial_result_available: false,
      details: { timeout_ms: '123' },
    }))).toBe('timed out after 123ms');

    expect(deriveErrorString(normalizeErrorMetadata({
      category: 'stall_timeout',
      message: 'ignored',
      retryable: false,
      partial_result_available: false,
      details: { stall_timeout_ms: '20' },
    }))).toBe('Subagent stalled for 20ms without final response.');

    expect(deriveErrorString(normalizeErrorMetadata({
      category: 'cancelled',
      message: 'ignored',
      retryable: false,
      partial_result_available: true,
      details: { cancel_reason: 'parent abort' },
    }))).toBe('Subagent cancelled: parent abort');
  });

  it('classifies conservative thrown errors and fallback attempts', () => {
    const auth = classifyThrownError(new Error('401 invalid api key Bearer sk-fake-secret-token'), {
      phase: 'runner_invoke',
      provider: 'openai',
      model: 'gpt-test',
    });
    expect(auth.category).toBe('provider_auth_error');
    expect(auth.retryable).toBe(false);
    expect(auth.message).not.toContain('sk-fake-secret-token');

    const malformed = classifyThrownError({ message: 'ECONNRESET fake.user@example.com' }, {
      phase: 'runner_invoke',
      provider: 'openai',
      model: 'gpt-test',
    });
    expect(malformed.category).toBe('malformed_thrown_value');
    expect(malformed.retryable).toBe(false);

    const fallback = classifyFallbackFailure(
      normalizeErrorMetadata({ category: 'provider_network_error', message: 'primary failure', retryable: true, partial_result_available: false, role: 'primary' }),
      normalizeErrorMetadata({ category: 'provider_rate_limit', message: 'fallback failure', retryable: true, partial_result_available: false, role: 'fallback' }),
    );
    expect(fallback.category).toBe('fallback_failed');
    expect(fallback.retryable).toBe(false);
    expect(fallback.attempts?.map((attempt) => attempt.role)).toEqual(['primary', 'fallback']);
  });

  it('wraps normalized metadata in SubagentStructuredError', () => {
    const metadata: SubagentErrorMetadata = normalizeErrorMetadata({
      category: 'unknown',
      message: 'plain failure',
      partial_result_available: false,
    });
    const error = new SubagentStructuredError(metadata);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(deriveErrorString(metadata));
    expect(error.error_metadata).toEqual(metadata);
  });
});
