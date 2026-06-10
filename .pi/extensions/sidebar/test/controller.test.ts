import { describe, expect, it, vi } from 'vitest';

import type { ChatHeaderModel, GitStatusModel, SectionState, SidebarAdapterContext, SubagentActivityModel } from '../src/model.js';
import { SidebarController } from '../src/controller.js';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function ready<T>(data: T): SectionState<T> {
  return { kind: 'ready', data, refreshedAt: '2026-06-10T00:00:00.000Z' };
}

function context(): SidebarAdapterContext {
  return { cwd: '/workspace/pi', ctx: {}, pi: {}, now: () => new Date('2026-06-10T00:00:00.000Z') };
}

function gitData(label: string): GitStatusModel {
  return { root: '/workspace/pi', repositoryLabel: label, branchLabel: 'main', files: [] };
}

function subagentData(id: string): SubagentActivityModel {
  return {
    windowMinutes: 20,
    source: 'provider',
    activities: [{ id, agent: 'writer', status: 'running', summary: 'work', lastActivityAt: '2026-06-10T00:00:00.000Z', elapsedSeconds: 10 }],
  };
}

describe('SidebarController', () => {
  it('starts and stops the refresh loop', async () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const chatAdapter = { load: vi.fn(async (): Promise<ChatHeaderModel> => ({ title: 'Chat', source: 'runtime' })) };
    const gitAdapter = { load: vi.fn(async () => ready(gitData('repo'))) };
    const subagentsAdapter = { load: vi.fn(async () => ready(subagentData('a'))) };
    const controller = new SidebarController({ context: context(), chatAdapter, gitAdapter, subagentsAdapter, requestRender });

    controller.start();
    await Promise.resolve();
    expect(gitAdapter.load).toHaveBeenCalledTimes(1);
    expect(subagentsAdapter.load).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4500);
    expect(gitAdapter.load).toHaveBeenCalledTimes(2);
    expect(subagentsAdapter.load).toHaveBeenCalledTimes(4);

    controller.stop();
    await vi.advanceTimersByTimeAsync(6000);
    expect(gitAdapter.load).toHaveBeenCalledTimes(2);
    expect(subagentsAdapter.load).toHaveBeenCalledTimes(4);
    expect(requestRender).toHaveBeenCalled();
  });

  it('prevents overlapping git and subagent refreshes', async () => {
    vi.useFakeTimers();
    const gitPending = deferred<SectionState<GitStatusModel>>();
    const subagentsPending = deferred<SectionState<SubagentActivityModel>>();
    const controller = new SidebarController({
      context: context(),
      chatAdapter: { load: async () => ({ title: 'Chat', source: 'runtime' as const }) },
      gitAdapter: { load: vi.fn(() => gitPending.promise) },
      subagentsAdapter: { load: vi.fn(() => subagentsPending.promise) },
      requestRender: vi.fn(),
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(6000);
    expect(controller['gitAdapter'].load).toHaveBeenCalledTimes(1);
    expect(controller['subagentsAdapter'].load).toHaveBeenCalledTimes(1);

    gitPending.resolve(ready(gitData('repo')));
    subagentsPending.resolve(ready(subagentData('a')));
    await Promise.resolve();
  });

  it('retains stale previous state after adapter failure', async () => {
    vi.useFakeTimers();
    const gitAdapter = {
      load: vi.fn()
        .mockResolvedValueOnce(ready(gitData('repo')))
        .mockRejectedValueOnce(new Error('boom')),
    };
    const controller = new SidebarController({
      context: context(),
      chatAdapter: { load: async () => ({ title: 'Chat', source: 'runtime' as const }) },
      gitAdapter,
      subagentsAdapter: { load: async () => ready(subagentData('a')) },
      requestRender: vi.fn(),
    });

    controller.start();
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(4500);

    const state = controller.getModel().git;
    expect(state.kind).toBe('error');
    expect('previous' in state && state.previous?.repositoryLabel).toBe('repo');
  });

  it('reduces refresh work while hidden and stops when closed', async () => {
    vi.useFakeTimers();
    const gitAdapter = { load: vi.fn(async () => ready(gitData('repo'))) };
    const subagentsAdapter = { load: vi.fn(async () => ready(subagentData('a'))) };
    const controller = new SidebarController({
      context: context(),
      chatAdapter: { load: async () => ({ title: 'Chat', source: 'runtime' as const }) },
      gitAdapter,
      subagentsAdapter,
      requestRender: vi.fn(),
    });

    controller.start();
    await Promise.resolve();
    controller.setHidden(true);
    await vi.advanceTimersByTimeAsync(6000);
    expect(gitAdapter.load).toHaveBeenCalledTimes(1);
    expect(subagentsAdapter.load).toHaveBeenCalledTimes(1);

    controller.setHidden(false);
    await vi.advanceTimersByTimeAsync(4500);
    expect(gitAdapter.load).toHaveBeenCalledTimes(3);

    controller.close();
    await vi.advanceTimersByTimeAsync(6000);
    expect(gitAdapter.load).toHaveBeenCalledTimes(3);
  });
});
