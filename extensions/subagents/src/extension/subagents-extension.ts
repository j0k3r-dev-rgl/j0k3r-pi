import { readSubagentsConfig, subagentSourceWarnings } from '../config.js';
import { SubagentManager } from '../manager.js';
import { renderSubagentCompletionMessage, sendSubagentCompletionMessage, sendSubagentQuestionMessage } from '../render/completion-message.js';
import { registerSubagentTools, triggerClaudeBackgroundHandoff } from '../tools.js';
import { sendSubagentReportMessage, renderSubagentReportMessage } from '../render/report-message.js';
import { ClaudeBackgroundWidget, ClaudeBackgroundWidgetState } from '../ui/background-widget.js';
import { clearSubagentSessionRenderCaches, preloadPiComponentsForSubagentRendering, registerSubagentExternalToolDefinition } from '../thread-view.js';
import { registerSubagentsPanelOpener, showSubagentsPanel } from '../ui/panel-overlay.js';

function currentSessionId(ctx: any): string | undefined {
  const direct = ctx?.sessionManager?.getSessionId?.() ?? ctx?.sessionId;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const file = ctx?.sessionManager?.getSessionFile?.();
  return typeof file === 'string' && file.length > 0 ? file : undefined;
}

function isStaleContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes('extension ctx is stale') || message.includes('stale after session replacement or reload');
}

export default function subagentsExtension(pi: any): void {
  const originalRegisterTool = typeof pi.registerTool === 'function' ? pi.registerTool.bind(pi) : undefined;
  if (originalRegisterTool) {
    pi.registerTool = (tool: any) => {
      registerSubagentExternalToolDefinition(tool?.name, tool);
      return originalRegisterTool(tool);
    };
  }
  pi.registerMessageRenderer?.('subagent-completion', renderSubagentCompletionMessage);
  pi.registerMessageRenderer?.('subagent-report', renderSubagentReportMessage);
  const widgetInputSuspensions = new Set<string>();
  let activeSessionId: string | undefined;
  const setWidgetInputSuspended = (reason: string, active: boolean): void => {
    if (active) widgetInputSuspensions.add(reason);
    else widgetInputSuspensions.delete(reason);
  };
  const manager = new SubagentManager(
    undefined,
    undefined,
    (task, cwd) => {
      const taskSessionId = typeof task?.session_id === 'string' && task.session_id.length > 0 ? task.session_id : undefined;
      if (taskSessionId && taskSessionId !== activeSessionId) return;
      try {
        sendSubagentCompletionMessage(pi, task, cwd);
      } catch (error) {
        if (!isStaleContextError(error)) throw error;
      }
    },
    (active) => { setWidgetInputSuspended('interaction', active); },
    pi.events,
    (task, question) => {
      const taskSessionId = typeof task?.session_id === 'string' && task.session_id.length > 0 ? task.session_id : undefined;
      if (taskSessionId && taskSessionId !== activeSessionId) throw new Error('The parent orchestrator session is no longer active.');
      sendSubagentQuestionMessage(pi, task, question);
    },
    (task, report) => {
      if (!task.session_id || task.session_id !== activeSessionId) throw new Error('The owning parent session is no longer active.');
      sendSubagentReportMessage(pi, task, report);
    },
  );
  registerSubagentTools(pi, manager, process.cwd());

  let widgetCtx: any;
  let widgetRequestRender: (() => void) | undefined;
  let removeTerminalInputListener: (() => void) | undefined;
  let removeTaskUpdateListener: (() => void) | undefined;
  let widgetState: ClaudeBackgroundWidgetState | undefined;
  let widgetInstalled = false;
  let hudVisible = false;
  let removeHudPresenceListener: (() => void) | undefined;
  let activePanelCancelSelected: (() => void) | undefined;
  let activePanelRequestRender: (() => void) | undefined;

  const presenceSessionId = (ctx: any): string => currentSessionId(ctx) ?? '';

  const installClaudeBackgroundWidget = (ctx: any): boolean => {
    if (typeof ctx?.ui?.setWidget !== 'function') return false;
    const cwd = ctx?.cwd ?? process.cwd();
    const sessionId = currentSessionId(ctx);
    removeTaskUpdateListener?.();
    removeTaskUpdateListener = undefined;
    removeTerminalInputListener?.();
    removeTerminalInputListener = undefined;
    widgetState = new ClaudeBackgroundWidgetState(
      () => manager.listActiveSessionTasks(cwd, sessionId),
      () => widgetRequestRender?.(),
    );
    removeTaskUpdateListener = manager.onTaskUpdate(() => widgetRequestRender?.());
    if (typeof ctx?.ui?.onTerminalInput === 'function') {
      removeTerminalInputListener = ctx.ui.onTerminalInput((data: string) => {
        if (widgetInputSuspensions.size > 0) return undefined;
        const editorText = typeof ctx.ui.getEditorText === 'function' ? String(ctx.ui.getEditorText() ?? '') : '';
        const result = widgetState?.handleTerminalInput(data, { allowActivate: !editorText.trim() });
        if (result?.action?.type === 'open-task' && widgetCtx) {
          const selectedTaskId = result.action.taskId;
          void (async () => {
            await preloadPiComponentsForSubagentRendering();
            await showSubagentsPanel({
              ctx: widgetCtx,
              pi,
              manager,
              selectedTaskId,
              setWidgetInputSuspended: (value) => { setWidgetInputSuspended('panel', value); },
              setActivePanelCancelSelected: (fn) => { activePanelCancelSelected = fn; },
              setActivePanelRequestRender: (fn) => { activePanelRequestRender = fn; },
            });
          })();
        }
        return result;
      });
    }
    ctx.ui.setWidget('subagents-claude-background', (tui: any, theme: any) => {
      widgetRequestRender = () => tui?.requestRender?.();
      return new ClaudeBackgroundWidget(widgetState!, theme);
    }, { placement: 'belowEditor' });
    widgetInstalled = true;
    return true;
  };

  // The HUD mirrors active subagents, so the Pi widget only owns that space while it is closed.
  const hideClaudeBackgroundWidget = () => {
    widgetRequestRender = undefined;
    removeTerminalInputListener?.();
    removeTerminalInputListener = undefined;
    widgetInstalled = false;
    widgetCtx?.ui?.setWidget?.('subagents-claude-background', undefined);
  };

  const clearClaudeBackgroundWidget = () => {
    widgetRequestRender = undefined;
    removeTaskUpdateListener?.();
    removeTaskUpdateListener = undefined;
    removeTerminalInputListener?.();
    removeTerminalInputListener = undefined;
    widgetState = undefined;
    widgetInstalled = false;
    widgetInputSuspensions.clear();
    widgetCtx?.ui?.setWidget?.('subagents-claude-background', undefined);
    widgetCtx = undefined;
  };

  const ownsHudPresence = (event: any): boolean => {
    if (!widgetCtx || !event) return false;
    if (typeof event.visible !== 'boolean') return false;
    if (event.cwd !== (widgetCtx.cwd ?? process.cwd())) return false;
    return typeof event.sessionId === 'string' && event.sessionId === presenceSessionId(widgetCtx);
  };

  const applyHudPresence = (visible: boolean, ctx?: any): void => {
    const target = ctx ?? widgetCtx;
    if (!target) return;
    hudVisible = visible;
    if (visible) {
      if (widgetInstalled) hideClaudeBackgroundWidget();
      return;
    }
    if (!widgetInstalled) installClaudeBackgroundWidget(target);
  };

  // Presence queries are synchronous; ignore callbacks retained past this emission.
  const readHudPresence = (ctx: any): boolean => {
    if (typeof pi.events?.emit !== 'function') return false;
    let visible = false;
    let reading = true;
    try {
      pi.events.emit('pihud:presence:read:v1', {
        cwd: ctx?.cwd ?? process.cwd(),
        sessionId: presenceSessionId(ctx),
        respond(value: unknown) {
          if (reading && typeof value === 'boolean') visible = value;
        },
      });
    } catch { /* Missing or broken optional HUD leaves the normal widget intact. */ }
    finally { reading = false; }
    return visible;
  };

  const bindHudPresence = (): void => {
    removeHudPresenceListener?.();
    removeHudPresenceListener = undefined;
    if (typeof pi.events?.on !== 'function') return;
    const handler = (event: any) => {
      if (!ownsHudPresence(event)) return;
      applyHudPresence(event.visible);
    };
    const off = pi.events.on('pihud:presence:v1', handler);
    removeHudPresenceListener = typeof off === 'function'
      ? off
      : () => { pi.events?.off?.('pihud:presence:v1', handler); };
  };

  pi.on?.('session_start', async (_event: unknown, ctx: any) => {
    void preloadPiComponentsForSubagentRendering();
    clearClaudeBackgroundWidget();
    activeSessionId = currentSessionId(ctx);
    const cwd = ctx?.cwd ?? process.cwd();
    await manager.reconcileOrphanedTasks(cwd);
    for (const warning of subagentSourceWarnings(cwd)) ctx?.ui?.notify?.(warning, 'warning');
    widgetCtx = ctx;
    bindHudPresence();
    hudVisible = readHudPresence(ctx);
    registerSubagentsPanelOpener(async (taskId?: string) => {
      const currentCtx = widgetCtx ?? ctx;
      if (!currentCtx) return;
      await preloadPiComponentsForSubagentRendering();
      await showSubagentsPanel({
        ctx: currentCtx,
        pi,
        manager,
        selectedTaskId: taskId,
        setWidgetInputSuspended: (value) => { setWidgetInputSuspended('panel', value); },
        setActivePanelCancelSelected: (fn) => { activePanelCancelSelected = fn; },
        setActivePanelRequestRender: (fn) => { activePanelRequestRender = fn; },
      });
    });
    if (typeof ctx?.ui?.setWidget !== 'function') return;
    if (hudVisible) {
      widgetCtx?.ui?.setWidget?.('subagents-claude-background', undefined);
      return;
    }
    if (!installClaudeBackgroundWidget(ctx)) return;
  });

  pi.on?.('session_shutdown', async (event: any, ctx: any) => {
    const reason = event?.reason;
    const isInstanceShutdown = reason === 'quit' || reason === 'reload';
    const shutdownReason = isInstanceShutdown ? `Pi ${reason}` : 'Pi session shutdown';
    const closingSessionId = currentSessionId(ctx) ?? activeSessionId;
    activeSessionId = undefined;
    registerSubagentsPanelOpener(undefined);
    if (isInstanceShutdown) {
      await manager.drainAllTasks(shutdownReason);
    } else {
      await manager.drainOwnerSession(closingSessionId, shutdownReason);
    }
    clearClaudeBackgroundWidget();
    removeHudPresenceListener?.();
    removeHudPresenceListener = undefined;
    hudVisible = false;
    clearSubagentSessionRenderCaches();
  });

  const historyPanelShortcut = readSubagentsConfig(process.cwd()).history_panel_shortcut ?? 'ctrl+,';
  pi.registerShortcut?.(historyPanelShortcut, {
    description: 'Show subagent history panel',
    handler: async (ctx: any) => {
      await preloadPiComponentsForSubagentRendering();
      await showSubagentsPanel({
        ctx,
        pi,
        manager,
        setWidgetInputSuspended: (value) => { setWidgetInputSuspended('panel', value); },
        setActivePanelCancelSelected: (fn) => { activePanelCancelSelected = fn; },
        setActivePanelRequestRender: (fn) => { activePanelRequestRender = fn; },
      });
    },
  });

  const detailCancelShortcut = readSubagentsConfig(process.cwd()).detail_cancel_shortcut ?? 'x';
  if (detailCancelShortcut.startsWith('ctrl+')) {
    pi.registerShortcut?.(detailCancelShortcut, {
      description: 'Cancel selected running subagent from the active subagents detail panel',
      handler: async () => {
        activePanelCancelSelected?.();
        activePanelRequestRender?.();
      },
    });
  }

  const backgroundHandoffShortcut = readSubagentsConfig(process.cwd()).background_handoff_shortcut ?? 'ctrl+h';
  pi.registerShortcut?.(backgroundHandoffShortcut, {
    description: 'Send running subagent task to background',
    handler: async () => {
      triggerClaudeBackgroundHandoff();
    },
  });

  pi.registerCommand?.('subagents', {
    description: 'Show subagent history panel',
    handler: async (_args: string, ctx: any) => {
      await preloadPiComponentsForSubagentRendering();
      return showSubagentsPanel({
        ctx: { ...ctx, pi },
        pi,
        manager,
        setWidgetInputSuspended: (value) => { setWidgetInputSuspended('panel', value); },
        setActivePanelCancelSelected: (fn) => { activePanelCancelSelected = fn; },
        setActivePanelRequestRender: (fn) => { activePanelRequestRender = fn; },
      });
    },
  });
}
