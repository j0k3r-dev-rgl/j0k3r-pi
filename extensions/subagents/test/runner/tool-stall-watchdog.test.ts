import { describe, expect, it, vi } from 'vitest';
import { promptWithInactivity } from '../../src/runner/event-processing.js';

// Fake session whose prompt starts one silent tool call, then waits `holdMs`
// before ending it and producing a final assistant message.
function silentToolSession(holdMs: number) {
  let subscriber: ((event: unknown) => void) | undefined;
  const session: any = {
    messages: [] as any[],
    subscribe: vi.fn((cb: (event: unknown) => void) => { subscriber = cb; return vi.fn(); }),
    abort: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
    prompt: vi.fn(async () => {
      subscriber?.({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash' });
      await new Promise<void>((resolve) => {
        const done = setTimeout(resolve, holdMs);
        session.abort.mockImplementation(async () => { clearTimeout(done); resolve(); });
      });
      if (session.abort.mock.calls.length) return;
      subscriber?.({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'bash' });
      session.messages.push({ role: 'assistant', content: 'tests passed' });
    }),
  };
  return session;
}

const run = (session: any, stallMs: number, toolStallMs?: number) => promptWithInactivity(
  session, 'delegate', stallMs, new AbortController().signal,
  undefined, undefined, undefined, undefined, undefined,
  'delegated_task', 'delegate', 1, undefined, undefined, toolStallMs,
);

describe('tool-aware stall watchdog', () => {
  it('does not abort a silent in-flight tool before the tool stall budget', async () => {
    const session = silentToolSession(1500);
    const result = await run(session, 500, 10_000);
    expect(result.result).toBe('tests passed');
    expect(session.abort).not.toHaveBeenCalled();
  });

  it('still aborts a silent in-flight tool after the tool stall budget', async () => {
    const session = silentToolSession(10_000);
    await expect(run(session, 500, 1000)).rejects.toThrow(/stalled for 1000ms/);
    expect(session.abort).toHaveBeenCalled();
  });

  it('keeps the idle budget for tools when no tool budget is supplied', async () => {
    const session = silentToolSession(10_000);
    await expect(run(session, 500)).rejects.toThrow(/stalled for 500ms/);
  });
});
