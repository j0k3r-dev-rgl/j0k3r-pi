import { describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWorkspaceGraphScheduler, registerWorkspaceGraphLifecycle, startWorkspaceGraphSourceWatcher } from '../../src/core/graph-scheduler.js';

describe('workspace graph scheduler', () => {
  it('single-flights immediate refresh requests', async () => {
    const refresh = vi.fn(async () => undefined);
    const scheduler = createWorkspaceGraphScheduler({ refresh, debounceMs: 5 });
    await Promise.all([scheduler.refresh('/tmp/project'), scheduler.refresh('/tmp/project')]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('still supports debounced background refresh requests', async () => {
    const refresh = vi.fn(async () => undefined);
    const scheduler = createWorkspaceGraphScheduler({ refresh, debounceMs: 5 });
    scheduler.schedule('/tmp/project');
    scheduler.schedule('/tmp/project');
    await scheduler.flush();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('registers only explicit lifecycle hooks when the host exposes events', () => {
    const handlers: Record<string, Function> = {};
    const pi = {
      on(event: string, handler: Function) {
        handlers[event] = handler;
      },
    };

    registerWorkspaceGraphLifecycle(pi, { schedule: () => undefined });
    expect(Object.keys(handlers).sort()).toEqual(['session_shutdown', 'session_start']);
  });

  it('schedules refresh on startup, reload, and new sessions without awaiting refresh', async () => {
    const handlers: Record<string, Function> = {};
    const schedule = vi.fn();
    const close = vi.fn();
    const startWatcher = vi.fn(async (root: string) => ({ root, close }));
    const pi = {
      on(event: string, handler: Function) {
        handlers[event] = handler;
      },
    };

    const rootDir = join(tmpdir(), `pi-graph-scheduler-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(rootDir, '.pi'), { recursive: true });
    await writeFile(join(rootDir, '.pi', 'code-research.json'), '{"graph":{"enable":true}}\n', 'utf8');

    const result = registerWorkspaceGraphLifecycle(pi, { schedule }, startWatcher);
    expect(result).toBe(true);

    handlers.session_start?.({ reason: 'startup' }, { cwd: rootDir });
    handlers.session_start?.({ reason: 'reload' }, { cwd: rootDir });
    handlers.session_start?.({ reason: 'new' }, { cwd: rootDir });

    await vi.waitFor(() => expect(schedule).toHaveBeenCalledTimes(3));
    expect(schedule).toHaveBeenNthCalledWith(1, rootDir);
    expect(schedule).toHaveBeenNthCalledWith(2, rootDir);
    expect(schedule).toHaveBeenNthCalledWith(3, rootDir);
    expect(startWatcher).toHaveBeenCalledTimes(3);
  });

  it('does not schedule for turn_end, resume, fork, or disabled graph config', async () => {
    const handlers: Record<string, Function> = {};
    const schedule = vi.fn();
    const startWatcher = vi.fn(async (root: string) => ({ root, close: vi.fn() }));
    const pi = {
      on(event: string, handler: Function) {
        handlers[event] = handler;
      },
    };

    const enabledRoot = join(tmpdir(), `pi-graph-scheduler-enabled-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(enabledRoot, '.pi'), { recursive: true });
    await writeFile(join(enabledRoot, '.pi', 'code-research.json'), '{"graph":{"enable":true}}\n', 'utf8');

    const disabledRoot = join(tmpdir(), `pi-graph-scheduler-disabled-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(disabledRoot, { recursive: true });

    registerWorkspaceGraphLifecycle(pi, { schedule }, startWatcher);
    handlers.session_start?.({ reason: 'resume' }, { cwd: enabledRoot });
    handlers.session_start?.({ reason: 'fork' }, { cwd: enabledRoot });
    handlers.turn_end?.({ turnIndex: 1 }, { cwd: enabledRoot });
    handlers.session_start?.({ reason: 'startup' }, { cwd: disabledRoot });

    await vi.waitFor(() => expect(startWatcher).toHaveBeenCalledTimes(2));
    expect(schedule).not.toHaveBeenCalled();
  });

  it('closes the source watcher on session shutdown', async () => {
    const handlers: Record<string, Function> = {};
    const schedule = vi.fn();
    const close = vi.fn();
    const startWatcher = vi.fn(async (root: string) => ({ root, close }));
    const pi = {
      on(event: string, handler: Function) {
        handlers[event] = handler;
      },
    };

    const rootDir = join(tmpdir(), `pi-graph-scheduler-close-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(rootDir, '.pi'), { recursive: true });
    await writeFile(join(rootDir, '.pi', 'code-research.json'), '{"graph":{"enable":true}}\n', 'utf8');

    registerWorkspaceGraphLifecycle(pi, { schedule }, startWatcher);
    handlers.session_start?.({ reason: 'startup' }, { cwd: rootDir });
    await vi.waitFor(() => expect(startWatcher).toHaveBeenCalledTimes(1));

    handlers.session_shutdown?.({ reason: 'quit' }, { cwd: rootDir });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('schedules refresh when a supported source file changes and ignores non-code files', async () => {
    const rootDir = join(tmpdir(), `pi-graph-source-watch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(rootDir, 'src'), { recursive: true });
    await writeFile(join(rootDir, 'README.md'), '# docs\n', 'utf8');
    await writeFile(join(rootDir, 'src', 'app.ts'), 'export const value = 1;\n', 'utf8');

    const schedule = vi.fn();
    const watcher = await startWorkspaceGraphSourceWatcher(rootDir, { schedule });
    try {
      await writeFile(join(rootDir, 'README.md'), '# docs changed\n', 'utf8');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(schedule).not.toHaveBeenCalled();

      await writeFile(join(rootDir, 'src', 'app.ts'), 'export const value = 2;\n', 'utf8');
      await vi.waitFor(() => expect(schedule).toHaveBeenCalledWith(rootDir));
    } finally {
      watcher.close();
    }
  });
});
