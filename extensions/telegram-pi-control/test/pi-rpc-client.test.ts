import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { PiRpcClient } from '../src/pi-rpc-client.js';

interface FakePiRpcProcess {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: (...args: unknown[]) => void;
  on: EventEmitter['on'];
}

function makeFakeProcess() {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const kill = vi.fn();

  const child: FakePiRpcProcess = Object.assign(emitter, {
    stdin,
    stdout,
    stderr,
    kill,
  });

  const written: string[] = [];
  stdin.on('data', (chunk: Buffer | string) => {
    written.push(String(chunk));
  });

  return {
    child,
    written,
    emitStdout: (payload: string) => stdout.emit('data', payload),
    emitExit: (code: number | null, signal?: string) => emitter.emit('exit', code, signal),
    kill: kill as (...args: unknown[]) => void,
  };
}

describe('PiRpcClient JSONL transport', () => {
  it('writes JSONL requests with LF framing and preserves stable request ids', async () => {
    const { child, written, emitStdout } = makeFakeProcess();
    const client = new PiRpcClient({
      workspaceRoot: '/tmp/ws',
      processFactory: () => child,
    });

    await client.start();

    const prompt = client.prompt('run this command');
    const line = written.pop() ?? '';
    expect(line.endsWith('\n')).toBe(true);

    const frame = JSON.parse(line.trim());
    expect(frame).toMatchObject({
      type: 'prompt',
      message: 'run this command',
      id: expect.anything(),
    });
    expect(frame.command).toBeUndefined();

    emitStdout(JSON.stringify({ id: frame.id, type: 'response', command: 'prompt', success: true }) + '\n');
    await prompt;
  });

  it('routes responses by request id even when responses arrive out of order', async () => {
    const { child, written, emitStdout } = makeFakeProcess();
    const client = new PiRpcClient({
      workspaceRoot: '/tmp/ws',
      processFactory: () => child,
    });

    await client.start();

    const first = client.prompt('first');
    const second = client.steer('second');

    const [firstFrame, secondFrame] = written.slice(-2).map((line) => JSON.parse(line));
    expect(firstFrame.id).not.toBe(secondFrame.id);
    expect(firstFrame.type).toBe('prompt');
    expect(secondFrame.type).toBe('steer');

    emitStdout(JSON.stringify({ id: secondFrame.id, type: 'response', command: 'steer', success: true }) + '\n');
    emitStdout(JSON.stringify({ id: firstFrame.id, type: 'response', command: 'prompt', success: true }) + '\n');

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });

  it('uses documented RPC command field names for session commands', async () => {
    const { child, written, emitStdout } = makeFakeProcess();
    const client = new PiRpcClient({
      workspaceRoot: '/tmp/ws',
      processFactory: () => child,
    });

    await client.start();

    const create = client.newSession('/tmp/parent.jsonl');
    const createFrame = JSON.parse(written.pop() ?? '{}');
    expect(createFrame).toMatchObject({
      type: 'new_session',
      parentSession: '/tmp/parent.jsonl',
    });
    emitStdout(JSON.stringify({ id: createFrame.id, type: 'response', command: 'new_session', success: true, data: { cancelled: false } }) + '\n');
    await expect(create).resolves.toEqual({ cancelled: false });

    const switchSession = client.switchSession('/tmp/session.jsonl');
    const switchFrame = JSON.parse(written.pop() ?? '{}');
    expect(switchFrame).toMatchObject({
      type: 'switch_session',
      sessionPath: '/tmp/session.jsonl',
    });
    emitStdout(JSON.stringify({ id: switchFrame.id, type: 'response', command: 'switch_session', success: true, data: { cancelled: false } }) + '\n');
    await expect(switchSession).resolves.toEqual({ cancelled: false });
  });

  it('parses documented get_state data responses', async () => {
    const { child, written, emitStdout } = makeFakeProcess();
    const client = new PiRpcClient({ workspaceRoot: '/tmp/ws', processFactory: () => child });
    await client.start();

    const state = client.getState();
    const frame = JSON.parse(written.pop() ?? '{}');
    expect(frame.type).toBe('get_state');
    emitStdout(JSON.stringify({
      id: frame.id,
      type: 'response',
      command: 'get_state',
      success: true,
      data: { sessionFile: '/tmp/session.jsonl', sessionId: 'abc', sessionName: 'Smoke', isStreaming: false },
    }) + '\n');

    await expect(state).resolves.toMatchObject({
      workspaceRoot: '/tmp/ws',
      sessionFile: '/tmp/session.jsonl',
      sessionId: 'abc',
      sessionName: 'Smoke',
      running: false,
    });
  });

  it('converts Pi RPC assistant text deltas into output events and agent_end into completion', async () => {
    const { child, emitStdout } = makeFakeProcess();
    const client = new PiRpcClient({ workspaceRoot: '/tmp/ws', processFactory: () => child });
    await client.start();

    const observed: Array<{ type: string; text?: string; status?: string }> = [];
    client.onEvent((event) => {
      if (event.type === 'output') observed.push({ type: event.type, text: String(event.text) });
      if (event.type === 'status') observed.push({ type: event.type, status: String(event.status) });
    });

    emitStdout(JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'smoke' } }) + '\n');
    emitStdout(JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: ' ok' } }) + '\n');
    emitStdout(JSON.stringify({ type: 'agent_end', messages: [] }) + '\n');

    expect(observed).toEqual([
      { type: 'output', text: 'smoke' },
      { type: 'output', text: ' ok' },
      { type: 'status', status: 'completed' },
    ]);
  });

  it('converts Pi RPC error deltas into failed status events', async () => {
    const { child, emitStdout } = makeFakeProcess();
    const client = new PiRpcClient({ workspaceRoot: '/tmp/ws', processFactory: () => child });
    await client.start();

    const observed: string[] = [];
    client.onEvent((event) => {
      if (event.type === 'status') observed.push(String(event.status));
      if (event.type === 'error') observed.push('error');
    });

    emitStdout(JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'error', reason: 'error' } }) + '\n');

    expect(observed).toEqual(['failed']);
  });

  it('streams output events in arrival order', async () => {
    const { child, emitStdout } = makeFakeProcess();
    const client = new PiRpcClient({
      workspaceRoot: '/tmp/ws',
      processFactory: () => child,
    });

    await client.start();

    const observed: string[] = [];
    client.onEvent((event) => {
      if (event.type === 'output' && typeof event.text === 'string') {
        observed.push(event.text);
      }
    });

    emitStdout(JSON.stringify({ type: 'output', text: 'first' }) + '\n');
    emitStdout(JSON.stringify({ type: 'output', text: ' second' }) + '\n');
    emitStdout(JSON.stringify({ type: 'output', text: ' third' }) + '\n');

    expect(observed).toEqual(['first', ' second', ' third']);
  });

  it('fails pending requests when process exits (stale/cancelled state)', async () => {
    const { child, emitExit } = makeFakeProcess();
    const client = new PiRpcClient({
      workspaceRoot: '/tmp/ws',
      processFactory: () => child,
    });

    await client.start();

    const request = client.prompt('will never return');

    emitExit(1, 'SIGTERM');
    await expect(request).rejects.toThrow(/cancelled|stale|exit|terminated/i);

    const newRequest = client.newSession();
    await expect(newRequest).rejects.toThrow(/not running|terminated|cancelled/i);
  });
});
