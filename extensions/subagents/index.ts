import { SubagentManager } from './src/manager.js';
import { readSubagentsConfig } from './src/config.js';
import { registerSubagentTools, triggerClaudeBackgroundHandoff } from './src/tools.js';
import { runSubagentModelsCommand } from './src/model-profiles-ui.js';
import { SubagentsHistoryPanel } from './src/ui.js';
import type { SubagentTask } from './src/types.js';

type ClaudeBackgroundWidgetEntry = {
  key: string;
  line: string;
};

type ClaudeBackgroundTerminalAction =
  | { type: 'focus-editor' }
  | { type: 'open-task'; taskId: string };

type ClaudeBackgroundTerminalInputResult = {
  consume?: boolean;
  data?: string;
  action?: ClaudeBackgroundTerminalAction;
} | undefined;

function matchesKey(data: string, key: string): boolean {
  const keys: Record<string, string[]> = {
    escape: ['\u001b'],
    'ctrl+c': ['\u0003'],
    'ctrl+o': ['\u000f'],
    q: ['q', 'Q'],
    up: ['\u001b[A'],
    down: ['\u001b[B'],
    right: ['\u001b[C'],
    left: ['\u001b[D'],
    pageUp: ['\u001b[5~'],
    pageDown: ['\u001b[6~'],
    home: ['\u001b[H', '\u001b[1~', '\u001bOH'],
    end: ['\u001b[F', '\u001b[4~', '\u001bOF'],
  };
  return keys[key]?.includes(data) ?? data === key;
}

const PANEL_KEYBINDINGS: Record<string, string[]> = {
  escape: ['app.interrupt', 'tui.select.cancel'],
  'ctrl+c': ['tui.select.cancel'],
  'ctrl+o': ['app.tools.expand'],
  up: ['tui.select.up', 'tui.editor.cursorUp'],
  down: ['tui.select.down', 'tui.editor.cursorDown'],
  right: ['tui.editor.cursorRight'],
  left: ['tui.editor.cursorLeft'],
  pageUp: ['tui.select.pageUp', 'tui.editor.pageUp'],
  pageDown: ['tui.select.pageDown', 'tui.editor.pageDown'],
  home: ['tui.editor.cursorLineStart'],
  end: ['tui.editor.cursorLineEnd'],
};

export function createSubagentsPanelKeyMatcher(keybindings?: { matches?: (data: string, keybinding: string) => boolean }) {
  return (data: string, key: string): boolean => {
    const bindings = PANEL_KEYBINDINGS[key];
    if (bindings?.some((binding) => keybindings?.matches?.(data, binding))) return true;
    return matchesKey(data, key);
  };
}

function visibleWidth(text: string): number {
  return [...text.replace(/\u001b\][^\u001b\u0007]*(?:\u001b\\|\u0007)|\u001b\[[0-?]*[ -/]*[@-~]/g, '')].length;
}

function truncateToWidth(text: string, width: number): string {
  const chars = [...text];
  return chars.length > width ? chars.slice(0, Math.max(0, width - 1)).join('') + '…' : text;
}

function currentSessionId(ctx: any): string | undefined {
  const direct = ctx?.sessionManager?.getSessionId?.() ?? ctx?.sessionId;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const file = ctx?.sessionManager?.getSessionFile?.();
  return typeof file === 'string' && file.length > 0 ? file : undefined;
}

function setMouseTracking(tui: any, enabled: boolean): void {
  const write = tui?.terminal?.write?.bind(tui.terminal);
  if (typeof write !== 'function') return;
  write(enabled ? '\u001b[?1000h\u001b[?1006h' : '\u001b[?1006l\u001b[?1000l');
}

function toolFromRegistry(registry: any, name: string): unknown {
  if (!registry) return undefined;
  if (typeof registry.get === 'function') return registry.get(name);
  if (Array.isArray(registry)) return registry.find((tool) => tool?.name === name);
  if (typeof registry === 'object') return registry[name];
  return undefined;
}

export function resolveRegisteredToolDefinition(ctx: any, pi: any, name: string): unknown {
  return ctx?.pi?.getToolDefinition?.(name)
    ?? pi?.getToolDefinition?.(name)
    ?? ctx?.getToolDefinition?.(name)
    ?? toolFromRegistry(ctx?.pi?.tools, name)
    ?? toolFromRegistry(pi?.tools, name)
    ?? toolFromRegistry(ctx?.tools, name);
}

function clip(text: string | undefined, limit = 120): string {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, Math.max(0, limit - 1))}…` : normalized;
}

function isActiveBackgroundTask(task: SubagentTask): boolean {
  return task.mode === 'background' && (task.status === 'queued' || task.status === 'running');
}

function buildClaudeBackgroundWidgetEntries(tasks: SubagentTask[]): ClaudeBackgroundWidgetEntry[] {
  const active = tasks.filter(isActiveBackgroundTask);
  if (!active.length) return [];
  return [
    { key: 'main', line: 'main' },
    ...active.map((task) => ({ key: task.id, line: `${task.agent} ${clip(task.last_activity ?? task.task ?? task.id)}` })),
  ];
}

function coerceClaudeBackgroundSelection(entries: ClaudeBackgroundWidgetEntry[], selectedKey: string | undefined): string {
  if (!entries.length) return 'main';
  return entries.some((entry) => entry.key === selectedKey) ? selectedKey! : entries[0]!.key;
}

export function moveClaudeBackgroundWidgetSelection(tasks: SubagentTask[], selectedKey: string | undefined, direction: 'up' | 'down'): string {
  const entries = buildClaudeBackgroundWidgetEntries(tasks);
  if (!entries.length) return 'main';
  const current = coerceClaudeBackgroundSelection(entries, selectedKey);
  const index = entries.findIndex((entry) => entry.key === current);
  const nextIndex = direction === 'down'
    ? Math.min(index + 1, entries.length - 1)
    : Math.max(index - 1, 0);
  return entries[nextIndex]?.key ?? current;
}

export function renderClaudeBackgroundWidgetLines(tasks: SubagentTask[], selectedKey?: string): string[] | undefined {
  const entries = buildClaudeBackgroundWidgetEntries(tasks);
  if (!entries.length) return undefined;
  const current = selectedKey === undefined ? undefined : coerceClaudeBackgroundSelection(entries, selectedKey);
  return entries.map((entry) => `${entry.key === current ? '●' : '○'} ${entry.line}`);
}

export class ClaudeBackgroundWidgetState {
  private selectedKey = 'main';
  private navigationActive = false;

  constructor(
    private getTasks: () => SubagentTask[],
    private onChange?: () => void,
  ) {}

  getSelectedKey(): string {
    this.selectedKey = coerceClaudeBackgroundSelection(buildClaudeBackgroundWidgetEntries(this.getTasks()), this.selectedKey);
    return this.selectedKey;
  }

  renderLines(): string[] {
    return renderClaudeBackgroundWidgetLines(this.getTasks(), this.navigationActive ? this.getSelectedKey() : undefined) ?? [];
  }

  handleWidgetInput(data: string): void {
    this.handleTerminalInput(data);
  }

  handleTerminalInput(data: string): ClaudeBackgroundTerminalInputResult {
    const tasks = this.getTasks();
    if (!tasks.some(isActiveBackgroundTask)) {
      if (this.navigationActive || this.selectedKey !== 'main') {
        this.selectedKey = 'main';
        this.navigationActive = false;
        this.onChange?.();
      }
      return undefined;
    }

    if (matchesKey(data, 'down')) {
      this.navigationActive = true;
      const next = moveClaudeBackgroundWidgetSelection(tasks, this.getSelectedKey(), 'down');
      if (next !== this.selectedKey) {
        this.selectedKey = next;
        this.onChange?.();
      }
      return { consume: true };
    }

    if (matchesKey(data, 'up')) {
      if (!this.navigationActive) return undefined;
      if (this.getSelectedKey() === 'main') {
        this.navigationActive = false;
        this.onChange?.();
        return { consume: true };
      }
      const next = moveClaudeBackgroundWidgetSelection(tasks, this.selectedKey, 'up');
      if (next !== this.selectedKey) {
        this.selectedKey = next;
        this.onChange?.();
      }
      return { consume: true };
    }

    if (this.navigationActive && (data === '\r' || data === '\n')) {
      const selectedKey = this.getSelectedKey();
      this.navigationActive = false;
      this.onChange?.();
      if (selectedKey === 'main') return { consume: true, action: { type: 'focus-editor' } };
      return { consume: true, action: { type: 'open-task', taskId: selectedKey } };
    }

    if (this.navigationActive && (matchesKey(data, 'left') || matchesKey(data, 'right') || matchesKey(data, 'escape'))) {
      this.navigationActive = false;
      this.onChange?.();
      return { consume: true, action: { type: 'focus-editor' } };
    }

    if (this.navigationActive) return { consume: true };
    return undefined;
  }
}

export class ClaudeBackgroundWidget {
  constructor(
    private state: ClaudeBackgroundWidgetState,
    private theme: any,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    return this.state.renderLines().map((line) => truncateToWidth(this.decorate(line), width));
  }

  handleInput(data: string): void {
    this.state.handleWidgetInput(data);
  }

  private decorate(line: string): string {
    if (!line.startsWith('● ')) return line;
    return this.theme?.fg?.('warning', this.theme?.bold?.(line) ?? line) ?? line;
  }
}

function completionMessage(task: any): string {
  const result = task.result ?? task.error ?? task.output_preview ?? '(no result captured)';
  return [
    `Subagent ${task.agent} ${task.status}: ${task.id}`,
    '',
    'Read only this final response from the subagent. Do not reread the full execution transcript unless the user explicitly asks for debugging details.',
    '',
    '## response sent to the orchestrator',
    '',
    result,
  ].join('\n');
}

export default function subagentsExtension(pi: any): void {
  const manager = new SubagentManager(undefined, undefined, (task) => {
    pi.sendMessage?.({
      customType: 'subagent-completion',
      content: completionMessage(task),
      display: true,
      details: {
        task_id: task.id,
        agent: task.agent,
        status: task.status,
        result: task.result,
        error: task.error,
      },
    }, {
      triggerTurn: true,
      deliverAs: 'followUp',
    });
  });
  registerSubagentTools(pi, manager);

  let widgetTimer: NodeJS.Timeout | undefined;
  let widgetCtx: any;
  let widgetRequestRender: (() => void) | undefined;
  let removeTerminalInputListener: (() => void) | undefined;
  let widgetState: ClaudeBackgroundWidgetState | undefined;
  let widgetInputSuspended = false;

  const installClaudeBackgroundWidget = (ctx: any): boolean => {
    if (typeof ctx?.ui?.setWidget !== 'function') return false;
    const cwd = ctx?.cwd ?? process.cwd();
    const config = readSubagentsConfig(cwd);
    if (config.mode !== 'claude') {
      ctx.ui.setWidget('subagents-claude-background', undefined);
      return false;
    }
    const sessionId = currentSessionId(ctx);
    widgetState = new ClaudeBackgroundWidgetState(
      () => manager.listSessionTasks(cwd, sessionId).slice(0, 100),
      () => widgetRequestRender?.(),
    );
    if (typeof ctx?.ui?.onTerminalInput === 'function') {
      removeTerminalInputListener = ctx.ui.onTerminalInput((data: string) => {
        if (widgetInputSuspended) return undefined;
        const result = widgetState?.handleTerminalInput(data);
        if (result?.action?.type === 'open-task' && widgetCtx) void showSubagentsPanel(widgetCtx, result.action.taskId);
        return result;
      });
    }
    ctx.ui.setWidget('subagents-claude-background', (tui: any, theme: any) => {
      widgetRequestRender = () => tui?.requestRender?.();
      return new ClaudeBackgroundWidget(widgetState!, theme);
    }, { placement: 'belowEditor' });
    return true;
  };

  const clearClaudeBackgroundWidget = () => {
    if (widgetTimer) clearInterval(widgetTimer);
    widgetTimer = undefined;
    widgetRequestRender = undefined;
    removeTerminalInputListener?.();
    removeTerminalInputListener = undefined;
    widgetState = undefined;
    widgetInputSuspended = false;
    widgetCtx?.ui?.setWidget?.('subagents-claude-background', undefined);
    widgetCtx = undefined;
  };

  pi.on?.('session_start', (_event: unknown, ctx: any) => {
    clearClaudeBackgroundWidget();
    if (typeof ctx?.ui?.setWidget !== 'function') return;
    widgetCtx = ctx;
    if (!installClaudeBackgroundWidget(ctx)) return;
    widgetTimer = setInterval(() => widgetRequestRender?.(), 250);
    widgetTimer.unref?.();
  });

  pi.on?.('session_shutdown', () => {
    clearClaudeBackgroundWidget();
  });

  async function showSubagentsPanel(ctx: any, selectedTaskId?: string) {
    const cwd = ctx?.cwd ?? process.cwd();
    const sessionId = currentSessionId(ctx);
    let refresh: NodeJS.Timeout | undefined;
    widgetInputSuspended = true;
    try {
      await ctx.ui.custom(
      (tui: any, theme: any, _keybindings: any, done: () => void) => {
        setMouseTracking(tui, true);
        const close = () => {
          if (refresh) clearInterval(refresh);
          setMouseTracking(tui, false);
          done();
        };
        const panel = new SubagentsHistoryPanel(
          () => manager.listSessionTasks(cwd, sessionId).slice(0, 100),
          theme,
          close,
          createSubagentsPanelKeyMatcher(_keybindings),
          visibleWidth,
          truncateToWidth,
          {
            theme,
            tui,
            cwd,
            visibleWidth,
            truncateToWidth,
            getToolDefinition: (name: string) => resolveRegisteredToolDefinition(ctx, pi, name),
            getMessageRenderer: (customType: string) => ctx?.pi?.getMessageRenderer?.(customType) ?? ctx?.pi?.customMessageRenderers?.get?.(customType) ?? ctx?.customMessageRenderers?.get?.(customType),
            showImages: ctx?.showImages,
            imageWidthCells: ctx?.imageWidthCells,
          },
          () => Math.max(12, process.stdout.rows || 42),
          (id: string) => manager.getTask(id, cwd),
          selectedTaskId,
        );
        refresh = setInterval(() => tui.requestRender?.(), 1000);
        return {
          render: (width: number) => panel.render(width),
          invalidate: () => panel.invalidate(),
          handleInput: (data: string) => { panel.handleInput(data); tui.requestRender?.(); },
        };
      },
      undefined,
    );
    } finally {
      widgetInputSuspended = false;
    }
  }

  pi.registerShortcut?.('ctrl+,', {
    description: 'Show subagent history panel',
    handler: async (ctx: any) => {
      const cwd = ctx?.cwd ?? process.cwd();
      if (readSubagentsConfig(cwd).mode === 'claude') return;
      await showSubagentsPanel(ctx);
    },
  });

  const backgroundHandoffShortcut = readSubagentsConfig(process.cwd()).background_handoff_shortcut ?? 'ctrl+h';
  pi.registerShortcut?.(backgroundHandoffShortcut, {
    description: 'Send running claude subagent task to background',
    handler: async (ctx: any) => {
      const cwd = ctx?.cwd ?? process.cwd();
      if (readSubagentsConfig(cwd).mode !== 'claude') return;
      triggerClaudeBackgroundHandoff();
    },
  });

  pi.registerCommand?.('subagents', {
    description: 'Show subagent history panel',
    handler: async (_args: string, ctx: any) => showSubagentsPanel({ ...ctx, pi }),
  });

  pi.registerCommand?.('subagent-models', {
    description: 'Configure subagent and SDD phase model profiles',
    handler: async (_args: string, ctx: any) => runSubagentModelsCommand({ ...ctx, pi }),
  });

}
