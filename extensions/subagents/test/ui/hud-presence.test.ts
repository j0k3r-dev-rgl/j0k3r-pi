import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import extension from '../../index.js';

const WIDGET = 'subagents-claude-background';

let tmp: string;
let oldAgentDir: string | undefined;
let oldHistoryDbPath: string | undefined;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagents-hud-'));
  oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  oldHistoryDbPath = process.env.PI_SUBAGENTS_HISTORY_DB_PATH;
  process.env.PI_CODING_AGENT_DIR = path.join(tmp, 'isolated-agent');
  process.env.PI_SUBAGENTS_HISTORY_DB_PATH = path.join(tmp, 'global-agent', 'subagents-history.sqlite');
  fs.mkdirSync(path.join(tmp, '.pi', 'subagents'), { recursive: true });
});
afterEach(() => {
  if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  if (oldHistoryDbPath === undefined) delete process.env.PI_SUBAGENTS_HISTORY_DB_PATH;
  else process.env.PI_SUBAGENTS_HISTORY_DB_PATH = oldHistoryDbPath;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function createEvents() {
  const listeners = new Map<string, Function[]>();
  const remove = (name: string, handler: Function) => {
    listeners.set(name, (listeners.get(name) ?? []).filter((entry) => entry !== handler));
  };
  return {
    on(name: string, handler: Function) {
      listeners.set(name, [...(listeners.get(name) ?? []), handler]);
      return () => remove(name, handler);
    },
    off: remove,
    emit(name: string, payload?: unknown) {
      for (const handler of [...(listeners.get(name) ?? [])]) handler(payload);
    },
    count(name: string) {
      return (listeners.get(name) ?? []).length;
    },
  };
}

function setup(options: { hudVisible?: boolean } = {}) {
  const handlers: Record<string, any> = {};
  const events = createEvents();
  events.on('pihud:presence:read:v1', (query: any) => {
    if (typeof options.hudVisible === 'boolean') query.respond?.(options.hudVisible);
  });
  const setWidget = vi.fn();
  const offInput = vi.fn();
  const pi = {
    events,
    on: (name: string, handler: any) => { handlers[name] = handler; },
    registerTool: () => undefined,
    registerCommand: () => undefined,
    registerShortcut: () => undefined,
    registerMessageRenderer: () => undefined,
  } as any;
  extension(pi);
  const ctx = {
    cwd: tmp,
    sessionId: 'session-1',
    ui: { setWidget, onTerminalInput: vi.fn(() => offInput), notify: vi.fn() },
  } as any;
  const widget = () => setWidget.mock.calls.filter((call: any[]) => call[0] === WIDGET);
  const installed = () => widget().filter((call: any[]) => typeof call[1] === 'function');
  const removed = () => widget().filter((call: any[]) => call[1] === undefined);
  const start = () => handlers.session_start?.({}, ctx);
  return { handlers, events, ctx, setWidget, offInput, widget, installed, removed, start };
}

describe('HUD presence hides the background widget', () => {
  it('does not install the widget when the HUD is already open', async () => {
    const h = setup({ hudVisible: true });
    await h.start();
    expect(h.installed()).toHaveLength(0);
    expect(h.offInput).not.toHaveBeenCalled();
  });

  it('installs the widget after the HUD closes if it started open', async () => {
    const h = setup({ hudVisible: true });
    await h.start();
    h.events.emit('pihud:presence:v1', { cwd: tmp, sessionId: 'session-1', visible: false });
    expect(h.installed()).toHaveLength(1);
  });

  it('hides an installed widget when the HUD opens and restores it when it closes', async () => {
    const h = setup();
    await h.start();
    expect(h.installed()).toHaveLength(1);
    expect(h.removed()).toHaveLength(0);

    h.events.emit('pihud:presence:v1', { cwd: tmp, sessionId: 'session-1', visible: true });
    expect(h.removed()).toHaveLength(1);
    expect(h.offInput).toHaveBeenCalledTimes(1);

    h.events.emit('pihud:presence:v1', { cwd: tmp, sessionId: 'session-1', visible: false });
    expect(h.installed()).toHaveLength(2);
    expect(h.removed()).toHaveLength(1);
  });

  it('ignores presence events owned by another cwd or session', async () => {
    const h = setup();
    await h.start();
    h.events.emit('pihud:presence:v1', { cwd: '/elsewhere', sessionId: 'session-1', visible: true });
    h.events.emit('pihud:presence:v1', { cwd: tmp, sessionId: 'session-2', visible: true });
    h.events.emit('pihud:presence:v1', { cwd: tmp, sessionId: 'session-1' });
    expect(h.removed()).toHaveLength(0);
    expect(h.installed()).toHaveLength(1);
  });

  it('stops listening for presence after shutdown', async () => {
    const h = setup();
    await h.start();
    expect(h.events.count('pihud:presence:v1')).toBe(1);
    await h.handlers.session_shutdown?.({ reason: 'reload' }, h.ctx);
    expect(h.events.count('pihud:presence:v1')).toBe(0);
    const before = h.widget().length;
    h.events.emit('pihud:presence:v1', { cwd: tmp, sessionId: 'session-1', visible: false });
    expect(h.widget()).toHaveLength(before);
  });
});
