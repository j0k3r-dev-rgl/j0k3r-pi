import { describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWorkspaceGraphScheduler, registerWorkspaceGraphLifecycle } from '../../src/core/graph-scheduler.js';

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

  it('registers lifecycle hooks when the host exposes events', () => {
    const handlers: Record<string, Function> = {};
    const pi = {
      on(event: string, handler: Function) {
        handlers[event] = handler;
      },
    };

    registerWorkspaceGraphLifecycle(pi, { refresh: async () => undefined });
    expect(Object.keys(handlers)).toEqual(expect.arrayContaining(['session_start', 'turn_end']));
  });

  it('awaits a refresh on session start using cwd context when graph is enabled', async () => {
    const handlers: Record<string, Function> = {};
    const refresh = vi.fn(async () => undefined);
    const pi = {
      on(event: string, handler: Function) {
        handlers[event] = handler;
      },
    };

    const rootDir = join(tmpdir(), `pi-graph-scheduler-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(rootDir, '.pi'), { recursive: true });
    await writeFile(join(rootDir, '.pi', 'code-research.json'), '{"graph":{"enable":true}}\n', 'utf8');

    registerWorkspaceGraphLifecycle(pi, { refresh });
    await handlers.session_start?.({ reason: 'startup' }, { cwd: rootDir });

    expect(refresh).toHaveBeenCalledWith(rootDir);
  });

  it('does not refresh on turn end when graph is disabled by default', async () => {
    const handlers: Record<string, Function> = {};
    const refresh = vi.fn(async () => undefined);
    const pi = {
      on(event: string, handler: Function) {
        handlers[event] = handler;
      },
    };

    const rootDir = join(tmpdir(), `pi-graph-scheduler-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(rootDir, { recursive: true });

    registerWorkspaceGraphLifecycle(pi, { refresh });
    await handlers.turn_end?.({ turnIndex: 1 }, { cwd: rootDir });

    expect(refresh).not.toHaveBeenCalled();
  });
});
