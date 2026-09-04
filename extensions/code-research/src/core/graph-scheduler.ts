import { watch, type FSWatcher } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadCodeResearchConfig } from '../config.js';
import { ensureWorkspaceGraphFreshness } from './workspace-graph.js';
import { isExcludedPath, isSupportedGraphSourceFile } from './source-policy.js';

export interface WorkspaceGraphScheduler {
  refresh(projectRoot: string): Promise<void>;
  schedule(projectRoot: string): void;
  flush(): Promise<void>;
}

export interface WorkspaceGraphSourceWatcher {
  close(): void;
  readonly root: string;
}

const DEFAULT_GRAPH_REFRESH_DEBOUNCE_MS = 2500;

export function createWorkspaceGraphScheduler(options: { refresh: (projectRoot: string) => Promise<void>; debounceMs?: number }): WorkspaceGraphScheduler {
  const pending = new Map<string, Promise<void>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const dirty = new Set<string>();
  const debounceMs = options.debounceMs ?? DEFAULT_GRAPH_REFRESH_DEBOUNCE_MS;

  const scheduleTimer = (projectRoot: string) => {
    const existing = timers.get(projectRoot);
    if (existing) clearTimeout(existing);
    timers.set(projectRoot, setTimeout(() => {
      timers.delete(projectRoot);
      void run(projectRoot).catch(() => undefined);
    }, debounceMs));
  };

  const run = (projectRoot: string) => {
    const inFlight = pending.get(projectRoot);
    if (inFlight) return inFlight;

    const timer = timers.get(projectRoot);
    if (timer) {
      clearTimeout(timer);
      timers.delete(projectRoot);
    }

    const promise = Promise.resolve()
      .then(() => options.refresh(projectRoot))
      .finally(() => {
        pending.delete(projectRoot);
        if (dirty.delete(projectRoot)) scheduleTimer(projectRoot);
      });
    pending.set(projectRoot, promise);
    return promise;
  };

  return {
    async refresh(projectRoot: string) {
      return run(projectRoot);
    },
    schedule(projectRoot: string) {
      if (pending.has(projectRoot)) {
        dirty.add(projectRoot);
        return;
      }
      scheduleTimer(projectRoot);
    },
    async flush() {
      while (timers.size > 0 || pending.size > 0 || dirty.size > 0) {
        if (timers.size > 0) await new Promise((resolve) => setTimeout(resolve, debounceMs + 5));
        if (pending.size > 0) await Promise.all([...pending.values()]);
      }
    },
  };
}

export const workspaceGraphScheduler = createWorkspaceGraphScheduler({
  refresh: async (projectRoot) => {
    await ensureWorkspaceGraphFreshness(projectRoot);
  },
});

export function scheduleWorkspaceGraphRefresh(projectRoot: string): void {
  workspaceGraphScheduler.schedule(projectRoot);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function startWorkspaceGraphSourceWatcher(
  projectRoot: string,
  scheduler: Pick<WorkspaceGraphScheduler, 'schedule'> = workspaceGraphScheduler
): Promise<WorkspaceGraphSourceWatcher> {
  const root = resolve(projectRoot);
  const watchers = new Map<string, FSWatcher>();
  let closed = false;

  const watchDirectory = async (dir: string): Promise<void> => {
    if (closed || watchers.has(dir) || isExcludedPath(root, dir)) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    try {
      const watcher = watch(dir, { persistent: false }, (eventType, fileName) => {
        if (closed || !fileName) return;
        const candidate = resolve(dir, fileName.toString());
        if (isExcludedPath(root, candidate)) return;

        if (isSupportedGraphSourceFile(candidate)) {
          scheduler.schedule(root);
          return;
        }

        if (eventType === 'rename') {
          void isDirectory(candidate).then((directory) => {
            if (directory) void watchDirectory(candidate);
          }).catch(() => undefined);
        }
      });
      watcher.on('error', () => {
        watcher.close();
        watchers.delete(dir);
      });
      watchers.set(dir, watcher);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = join(dir, entry.name);
      if (isExcludedPath(root, child)) continue;
      await watchDirectory(child);
    }
  };

  await watchDirectory(root);

  return {
    root,
    close() {
      closed = true;
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}

export function registerWorkspaceGraphLifecycle(
  pi: any,
  scheduler: Pick<WorkspaceGraphScheduler, 'schedule'> = workspaceGraphScheduler,
  startWatcher: (projectRoot: string, scheduler: Pick<WorkspaceGraphScheduler, 'schedule'>) => Promise<WorkspaceGraphSourceWatcher> = startWorkspaceGraphSourceWatcher
) {
  if (typeof pi?.on !== 'function') return false;

  let watcher: WorkspaceGraphSourceWatcher | undefined;

  const scheduleFromContext = (_payload: any, ctx: any) => {
    const cwd = ctx?.cwd ?? ctx?.projectRoot ?? process.cwd();
    void loadCodeResearchConfig(cwd).then(async (config) => {
      if (!config.graph.enable) return;
      const reason = _payload?.reason ?? 'startup';
      if (reason === 'startup' || reason === 'reload' || reason === 'new') scheduler.schedule(cwd);
      watcher?.close();
      watcher = await startWatcher(cwd, scheduler);
    }).catch(() => undefined);
  };

  pi.on('session_start', scheduleFromContext);
  pi.on('session_shutdown', () => {
    watcher?.close();
    watcher = undefined;
  });
  return true;
}
