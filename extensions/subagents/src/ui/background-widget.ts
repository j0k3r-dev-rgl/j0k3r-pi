import { wrapLineToWidth } from '../render/text-width.js';
import type { SubagentTask } from '../types.js';
import { ARCH_ICON, getArchNeonWorkingIcon, themeBold, themeWarning } from './theme.js';

type ClaudeBackgroundWidgetEntry = {
  key: string;
  line: string;
  status?: string;
};

export type ClaudeBackgroundTerminalAction =
  | { type: 'focus-editor' }
  | { type: 'open-task'; taskId: string };

export type ClaudeBackgroundTerminalInputResult = {
  consume?: boolean;
  data?: string;
  action?: ClaudeBackgroundTerminalAction;
} | undefined;

function matchesKey(data: string, key: string): boolean {
  const keys: Record<string, string[]> = {
    escape: ['\u001b'],
    q: ['q', 'Q'],
    up: ['\u001b[A'],
    down: ['\u001b[B'],
    right: ['\u001b[C'],
    left: ['\u001b[D'],
  };
  return keys[key]?.includes(data) ?? data === key;
}

function isMouseClickInput(data: string): { isClick: boolean; row?: number } {
  // SGR mouse tracking: \u001b[<button;col;rowM
  const sgr = data.match(/^\u001b\[<(\d+);(\d+);(\d+)M$/);
  if (sgr) {
    const button = Number(sgr[1]);
    const row = Number(sgr[3]) - 1; // 1-based row in terminal to 0-based
    if (button === 0) return { isClick: true, row };
  }
  return { isClick: false };
}

function normalize(text: string | undefined): string {
  return text ? text.replace(/\s+/g, ' ').trim() : '';
}

function isActiveBackgroundTask(task: SubagentTask): boolean {
  return task.mode === 'background' && (task.status === 'queued' || task.status === 'running');
}

function buildClaudeBackgroundWidgetEntries(tasks: SubagentTask[]): ClaudeBackgroundWidgetEntry[] {
  const active = tasks.filter(isActiveBackgroundTask);
  if (!active.length) return [];
  return [
    { key: 'main', line: 'main', status: 'idle' },
    ...active.map((task) => {
      const line = task.display_name?.trim() || `${task.agent} ${normalize(task.live_activity?.current?.label ?? task.last_activity ?? task.task ?? '')}`.trim();
      return {
        key: task.id,
        line: line || task.agent,
        status: task.status,
      };
    }),
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

export function renderClaudeBackgroundWidgetLines(
  tasks: SubagentTask[],
  selectedKey?: string,
  options: { archIndicator?: boolean; neonRunning?: boolean; frame?: number } = {},
): string[] | undefined {
  const entries = buildClaudeBackgroundWidgetEntries(tasks);
  if (!entries.length) return undefined;
  const current = selectedKey === undefined ? undefined : coerceClaudeBackgroundSelection(entries, selectedKey);
  const useNeon = Boolean(options.archIndicator || options.neonRunning);

  return entries.map((entry) => {
    const isSelected = entry.key === current;
    const isRunning = entry.status === 'running';

    let bullet: string;
    if (useNeon && isRunning) {
      bullet = getArchNeonWorkingIcon(options.frame);
    } else if (useNeon && isSelected) {
      bullet = ARCH_ICON;
    } else {
      bullet = isSelected ? (options.archIndicator ? ARCH_ICON : '●') : '○';
    }

    return `${bullet} ${entry.line}`;
  });
}

export class ClaudeBackgroundWidgetState {
  private selectedKey = 'main';
  private navigationActive = false;

  constructor(
    private getTasks: () => SubagentTask[],
    private onChange?: () => void,
    private onAction?: (action: ClaudeBackgroundTerminalAction) => void,
    private options: { archIndicator?: boolean; neonRunning?: boolean; frame?: number } = {},
  ) {}

  getSelectedKey(): string {
    this.selectedKey = coerceClaudeBackgroundSelection(buildClaudeBackgroundWidgetEntries(this.getTasks()), this.selectedKey);
    return this.selectedKey;
  }

  renderLines(options?: { archIndicator?: boolean; neonRunning?: boolean; frame?: number }): string[] {
    return renderClaudeBackgroundWidgetLines(
      this.getTasks(),
      this.navigationActive ? this.getSelectedKey() : undefined,
      options ?? this.options,
    ) ?? [];
  }

  handleWidgetInput(data: string): void {
    this.handleTerminalInput(data);
  }

  handleMouseClick(event: { type?: string; button?: string; row?: number; y?: number; x?: number; col?: number }): ClaudeBackgroundTerminalInputResult {
    const tasks = this.getTasks().filter(isActiveBackgroundTask);
    if (!tasks.length) return undefined;

    const entries = buildClaudeBackgroundWidgetEntries(this.getTasks());
    const row = event.row ?? event.y;

    let targetKey: string | undefined;
    if (typeof row === 'number' && Number.isFinite(row) && row >= 0 && row < entries.length) {
      targetKey = entries[row]?.key;
    } else if (tasks.length === 1) {
      targetKey = tasks[0]?.id;
    } else {
      const running = tasks.find((t) => t.status === 'running');
      targetKey = running?.id ?? tasks[0]?.id;
    }

    if (!targetKey) return undefined;

    this.navigationActive = false;
    this.selectedKey = targetKey;
    this.onChange?.();

    const action: ClaudeBackgroundTerminalAction = targetKey === 'main'
      ? { type: 'focus-editor' }
      : { type: 'open-task', taskId: targetKey };

    this.onAction?.(action);
    return { consume: true, action };
  }

  handleTerminalInput(data: string, options: { allowActivate?: boolean } = {}): ClaudeBackgroundTerminalInputResult {
    const mouse = isMouseClickInput(data);
    if (mouse.isClick) {
      return this.handleMouseClick({ type: 'click', row: mouse.row });
    }

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
      if (!this.navigationActive && options.allowActivate === false) return undefined;
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
      const action: ClaudeBackgroundTerminalAction = selectedKey === 'main'
        ? { type: 'focus-editor' }
        : { type: 'open-task', taskId: selectedKey };
      this.onAction?.(action);
      return { consume: true, action };
    }

    if (this.navigationActive && (matchesKey(data, 'left') || matchesKey(data, 'right') || matchesKey(data, 'escape'))) {
      this.navigationActive = false;
      this.onChange?.();
      const action: ClaudeBackgroundTerminalAction = { type: 'focus-editor' };
      this.onAction?.(action);
      return { consume: true, action };
    }

    if (this.navigationActive) return { consume: true };
    return undefined;
  }
}

export class ClaudeBackgroundWidget {
  constructor(
    private state: ClaudeBackgroundWidgetState,
    private theme: any,
    private options: { archIndicator?: boolean; neonRunning?: boolean; frame?: number } = {},
    private onAction?: (action: ClaudeBackgroundTerminalAction) => void,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const isNeon = Boolean(
      this.options.archIndicator ||
      this.options.neonRunning ||
      (typeof this.theme?.bg === 'function'),
    );

    const renderOptions = isNeon
      ? { archIndicator: true, neonRunning: true, ...this.options }
      : this.options;

    const lines = isNeon
      ? this.state.renderLines(renderOptions)
      : this.state.renderLines();

    return lines.flatMap((line) => wrapLineToWidth(this.decorate(line), width));
  }

  handleInput(data: string): void {
    this.state.handleWidgetInput(data);
  }

  handleMouse(event: { type?: string; button?: string; row?: number; y?: number; x?: number; col?: number }): { handled: true; render?: boolean } | undefined {
    if (event.type === 'press' || event.type === 'click' || (!event.type && (event.button === 'left' || event.button === undefined))) {
      const result = this.state.handleMouseClick(event);
      if (result?.action && this.onAction) {
        this.onAction(result.action);
      }
      if (result) {
        return { handled: true, render: true };
      }
    }
    return undefined;
  }

  private decorate(line: string): string {
    const isSelected = line.startsWith('● ') || line.startsWith(`${ARCH_ICON} `);
    if (!isSelected) return line;
    return themeWarning(this.theme, themeBold(this.theme, line));
  }
}
