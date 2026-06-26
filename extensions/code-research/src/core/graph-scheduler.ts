import { loadCodeResearchConfig } from '../config.js';

export function createWorkspaceGraphScheduler(options: { refresh: (projectRoot: string) => Promise<void>; debounceMs?: number }) {
  const pending = new Map<string, Promise<void>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const debounceMs = options.debounceMs ?? 50;

  const run = (projectRoot: string) => {
    if (pending.has(projectRoot)) return pending.get(projectRoot)!;
    const promise = Promise.resolve().then(() => options.refresh(projectRoot)).finally(() => pending.delete(projectRoot));
    pending.set(projectRoot, promise);
    return promise;
  };

  return {
    schedule(projectRoot: string) {
      const existing = timers.get(projectRoot);
      if (existing) clearTimeout(existing);
      timers.set(projectRoot, setTimeout(() => {
        timers.delete(projectRoot);
        void run(projectRoot);
      }, debounceMs));
    },
    async flush() {
      await new Promise((resolve) => setTimeout(resolve, debounceMs + 5));
      await Promise.all([...pending.values()]);
    },
  };
}

export function registerWorkspaceGraphLifecycle(pi: any, scheduler: { schedule: (projectRoot: string) => void }) {
  if (typeof pi?.on !== 'function') return false;

  const scheduleFromContext = async (_payload: any, ctx: any) => {
    const cwd = ctx?.cwd ?? ctx?.projectRoot ?? process.cwd();
    const config = await loadCodeResearchConfig(cwd);
    if (!config.graph.enable) return;
    scheduler.schedule(cwd);
  };

  pi.on('session_start', scheduleFromContext);
  pi.on('turn_end', scheduleFromContext);
  return true;
}
