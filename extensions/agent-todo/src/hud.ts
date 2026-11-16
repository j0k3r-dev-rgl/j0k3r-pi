import type { AgentTodoProjection } from './types.js';

/** Optional, synchronous, UI-only bridge; never exposes the todo body or tool output. */
export function createAgentTodoHud(pi: any, projection: () => AgentTodoProjection, refresh: (ctx: any) => void) {
  let context: any;
  let cwd: string | undefined;
  let sessionId: string | undefined;
  let visible = false;
  const trusted = () => context?.mode === 'tui' && context?.isProjectTrusted?.() === true
    && typeof sessionId === 'string' && sessionId !== '' && context.cwd === cwd
    && context.sessionManager?.getSessionId?.() === sessionId;
  const owns = (query: any) => trusted() && query?.cwd === cwd && query.sessionId === sessionId;
  const offRead = pi.events?.on('pihud:todo:read:v1', (query: any) => {
    if (!owns(query) || typeof query.respond !== 'function') return;
    const todo = projection().active_todo;
    query.respond(todo ? { lines: [], todo: { title: todo.title, steps: todo.steps.map(({ text, status }) => ({ text, status })) } } : { lines: [] });
  });
  const offPresence = pi.events?.on('pihud:presence:v1', (event: any) => {
    if (!owns(event) || typeof event.visible !== 'boolean') return;
    visible = event.visible;
    refresh(context);
  });
  return {
    isVisible: () => trusted() && visible,
    bind(ctx: any, reset = false) {
      const nextId = ctx?.sessionManager?.getSessionId?.();
      if (!reset && context && cwd === ctx?.cwd && sessionId === nextId) { context = ctx; return; }
      context = ctx;
      cwd = ctx?.cwd;
      sessionId = nextId;
      visible = false;
      if (!trusted()) return;
      // Presence queries are synchronous; ignore callbacks retained past this emission.
      let reading = true;
      try {
        pi.events?.emit('pihud:presence:read:v1', { cwd, sessionId, respond(value: unknown) {
          if (reading && trusted() && typeof value === 'boolean') visible = value;
        } });
      } catch { /* Missing or broken optional HUD leaves the normal widget intact. */ }
      finally { reading = false; }
    },
    dispose() {
      offRead?.();
      offPresence?.();
      context = undefined;
      visible = false;
    },
  };
}
