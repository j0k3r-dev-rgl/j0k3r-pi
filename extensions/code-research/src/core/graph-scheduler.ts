import { loadCodeResearchConfig } from '../config.js';
import { ensureWorkspaceGraphFreshness } from './workspace-graph.js';

export interface WorkspaceGraphScheduler {
  refresh(projectRoot: string): Promise<void>;
  schedule(projectRoot: string): void;
  flush(): Promise<void>;
}

export function createWorkspaceGraphScheduler(options: { refresh: (projectRoot: string) => Promise<void>; debounceMs?: number }): WorkspaceGraphScheduler {
  const pending = new Map<string, Promise<void>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const debounceMs = options.debounceMs ?? 50;

  const run = (projectRoot: string) => {
    const inFlight = pending.get(projectRoot);
    if (inFlight) return inFlight;
    const promise = Promise.resolve().then(() => options.refresh(projectRoot)).finally(() => pending.delete(projectRoot));
    pending.set(projectRoot, promise);
    return promise;
  };

  return {
    async refresh(projectRoot: string) {
      return run(projectRoot);
    },
    schedule(projectRoot: string) {
      if (pending.has(projectRoot)) return;
      const existing = timers.get(projectRoot);
      if (existing) clearTimeout(existing);
      timers.set(projectRoot, setTimeout(() => {
        timers.delete(projectRoot);
        void run(projectRoot).catch(() => undefined);
      }, debounceMs));
    },
    async flush() {
      await new Promise((resolve) => setTimeout(resolve, debounceMs + 5));
      await Promise.all([...pending.values()]);
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

export function registerWorkspaceGraphLifecycle(pi: any, scheduler: Pick<WorkspaceGraphScheduler, 'schedule'> = workspaceGraphScheduler) {
  if (typeof pi?.on !== 'function') return false;

  const scheduleFromContext = (_payload: any, ctx: any) => {
    const cwd = ctx?.cwd ?? ctx?.projectRoot ?? process.cwd();
    void loadCodeResearchConfig(cwd).then((config) => {
      if (config.graph.enable) scheduler.schedule(cwd);
    }).catch(() => undefined);
  };

  pi.on('session_start', scheduleFromContext);
  pi.on('turn_end', scheduleFromContext);
  return true;
}
