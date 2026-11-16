/** Optional HUD presence and read bridge. The footer remains the sole state owner. */
export function registerHudBridge(pi: any, read: () => any, visibility: (visible: boolean) => void) {
  let context: any;
  pi.on('session_start', (_event: any, ctx: any) => {
    context = ctx;
    pi.events.emit('pihud:presence:read:v1', { cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId(), respond: visibility });
  });
  const offPresence = pi.events.on('pihud:presence:v1', (event: any) => {
    if (context && event?.cwd === context.cwd && event.sessionId === context.sessionManager.getSessionId()) visibility(event.visible === true);
  });
  const offRead = pi.events.on('pihud:main:read:v1', (event: any) => {
    if (context?.mode !== 'tui' || !context.isProjectTrusted?.() || event?.cwd !== context.cwd ||
        event.sessionId !== context.sessionManager.getSessionId() || typeof event.respond !== 'function') return;
    event.respond({ lines: [], ...read() });
  });
  pi.on('session_shutdown', () => { context = undefined; visibility(false); offPresence(); offRead(); });
}
