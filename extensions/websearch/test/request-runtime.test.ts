import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools } from '../src/tools.js';
import { createMockPi, execute, response } from './helpers.js';

describe('websearch request runtime config', () => {
  it('applies timeout signal and retries fetch-backed requests', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(response({ items: [] }));
    const pi = createMockPi();
    registerWebsearchTools(pi, {
      env: {},
      fetch: fetchMock,
      config: { github: { provider: 'api' }, request: { timeoutMs: 5_000, maxRetries: 1 } },
    });

    const tool = pi.tools.find((entry) => entry.name === 'search_stack_overflow');
    const result = (await execute(tool!, { query: 'retry fetch' })) as { details: { status: string } };

    expect(result.details.status).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(firstInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it('applies timeout signal and retries gh command runner requests', async () => {
    const commandRunner = vi.fn()
      .mockRejectedValueOnce(new Error('temporary gh failure'))
      .mockResolvedValueOnce({ stdout: JSON.stringify({ items: [] }), stderr: '' });
    const pi = createMockPi();
    registerWebsearchTools(pi, {
      env: {},
      fetch: vi.fn<typeof fetch>(),
      commandRunner,
      config: { github: { provider: 'gh' }, request: { timeoutMs: 5_000, maxRetries: 1 } },
    });

    const tool = pi.tools.find((entry) => entry.name === 'search_github_pull_requests');
    const result = (await execute(tool!, { query: 'retry gh', limit: 1 })) as { details: { status: string } };

    expect(result.details.status).toBe('success');
    expect(commandRunner).toHaveBeenCalledTimes(2);
    expect(commandRunner.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
  });
});
