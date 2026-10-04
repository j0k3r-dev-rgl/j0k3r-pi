import { isValidThreadSnapshot, renderThreadBody } from '../thread-view.js';
import type { SubagentTask, SubagentThreadRenderContext, SubagentThreadSnapshot, UsageStats } from '../types.js';
import { formatTaskLabel } from '../render/tools/formatting.js';
import { visibleWidth as terminalVisibleWidth } from '../render/text-width.js';
import {
  ARCH_ICON,
  BOX_CHARS,
  CYAN,
  CYBER_SEPARATOR,
  LIME,
  RED,
  VIOLET,
  AMBER,
  electricBorder,
  themeAccent,
  themeBold,
  themeDim,
  themeError,
  themeFg,
  themeStatus,
  themeSuccess,
  themeTitle,
  themeWarning,
} from './theme.js';

export const ROUNDED_BOX_CHARS = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  tDown: '┬',
  tUp: '┴',
  tRight: '├',
  tLeft: '┤',
  cross: '┼',
} as const;

function clip(text: string | undefined, limit: number): string {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, Math.max(0, limit - 1))}…` : normalized;
}

function fmtDuration(task: SubagentTask): string {
  const start = task.started_at ? Date.parse(task.started_at) : Date.parse(task.created_at);
  const end = task.ended_at ? Date.parse(task.ended_at) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '';
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  return `${seconds}s`;
}

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

function formatTimeout(milliseconds: number | undefined): string | undefined {
  if (!Number.isFinite(milliseconds) || milliseconds === undefined || milliseconds <= 0) return undefined;
  let seconds = Math.max(1, Math.round(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', seconds ? `${seconds}s` : ''].filter(Boolean).join('');
}

function formatUsage(usage?: UsageStats, contextWindow?: number): string {
  if (!usage) return '';
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? 's' : ''}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens) {
    let context = `ctx:${formatTokens(usage.contextTokens)}`;
    if (Number.isFinite(contextWindow) && contextWindow !== undefined && contextWindow > 0) {
      const percentage = (usage.contextTokens / contextWindow) * 100;
      const formatted = Number.isInteger(percentage) ? percentage.toFixed(0) : percentage.toFixed(1);
      context += ` (${formatted}%)`;
    }
    parts.push(context);
  }
  return parts.join(' ');
}

type SubagentsHistoryPanelDisplayOptions = {
  timeoutMs?: number;
  stallTimeoutMs?: number;
  contextWindowForTask?: (task: SubagentTask) => number | undefined;
};

function fitsWidth(text: string, width: number, visibleWidth: (text: string) => number): boolean {
  try {
    if (visibleWidth(text) <= width) return true;
  } catch {}
  return terminalVisibleWidth(text) <= width;
}

function mouseWheelDelta(data: string): -1 | 1 | undefined {
  const sgr = data.match(/^\u001b\[<(\d+);\d+;\d+M$/);
  const urxvt = data.match(/^\u001b\[(\d+);\d+;\d+M$/);
  const button = sgr || urxvt ? Number((sgr ?? urxvt)![1]) : data.startsWith('\u001b[M') && data.length >= 6 ? data.charCodeAt(3) - 32 : undefined;
  if (button === undefined || !Number.isFinite(button) || (button & 64) === 0) return undefined;
  return (button & 1) === 0 ? -1 : 1;
}

function isMouseClickInput(data: string): { isClick: boolean; row?: number; col?: number } {
  const sgr = data.match(/^\u001b\[<(\d+);(\d+);(\d+)M$/);
  if (sgr) {
    const button = Number(sgr[1]);
    const col = Number(sgr[2]) - 1;
    const row = Number(sgr[3]) - 1;
    if (button === 0) return { isClick: true, row, col };
  }
  const urxvt = data.match(/^\u001b\[(\d+);\d+;\d+M$/);
  if (urxvt) {
    const button = Number(urxvt[1]);
    const col = Number(urxvt[2]) - 1;
    const row = Number(urxvt[3]) - 1;
    if (button === 0) return { isClick: true, row, col };
  }
  if (data.startsWith('\u001b[M') && data.length >= 6) {
    const button = data.charCodeAt(3) - 32;
    const col = data.charCodeAt(4) - 32 - 1;
    const row = data.charCodeAt(5) - 32 - 1;
    if ((button & 64) === 0 && (button & 3) === 0) return { isClick: true, row, col };
  }
  return { isClick: false };
}

function normalizeTerminalErrorText(text: string | undefined): string {
  return text?.replace(/\s+/g, ' ').trim().toLowerCase() ?? '';
}

function hasEquivalentSnapshotError(snapshot: SubagentThreadSnapshot, errorText: string): boolean {
  const normalized = normalizeTerminalErrorText(errorText);
  if (!normalized) return false;
  return snapshot.items.some((item) => {
    if (item.type === 'error') return normalizeTerminalErrorText(item.text) === normalized;
    if (item.type === 'assistant') return normalizeTerminalErrorText(item.message.errorMessage) === normalized;
    return false;
  });
}

function snapshotHasActiveTools(snapshot: SubagentThreadSnapshot | undefined): boolean {
  if (!snapshot?.items?.length) return false;
  return snapshot.items.some((item) => (item.type === 'tool' && ['pending', 'running', 'partial'].includes(item.status))
    || (item.type === 'bash' && (item.status === undefined || item.status === 'running')));
}

export class SubagentsHistoryPanel {
  private selected = 0;
  private scroll = 0;
  private sidebarScroll = 0;
  private followTail = true;
  private lastMaxScroll = 0;
  private toolOutputExpanded = false;
  private hideThinkingBlock = false;
  private hydratedTasks = new Map<string, { signature: string; task: SubagentTask }>();
  private bodyCache = new Map<string, Array<{ text: string; taskId?: string }>>();
  private rowTaskMap = new Map<number, string>();
  private sidebarRowTaskMap = new Map<number, string>();
  private detailRowTaskMap = new Map<number, string>();
  private lastSidebarWidth = 26;
  private lastRenderWidth = 100;
  private lastIsSplit = true;
  private lastListStartRow = -1;
  private lastListEndRow = -1;
  private lastSelectedTaskIdx = -1;
  private lastRenderDebugState?: {
    configuredMaxLines: number;
    renderWidth: number;
    renderedLineCount: number;
    bodyHeight: number;
    maxVisibleWidth: number;
    widthViolationCount: number;
    clickableRowCount?: number;
  };

  constructor(
    private tasksProvider: SubagentTask[] | (() => SubagentTask[]),
    private theme: any,
    private done: () => void,
    private matchesKey: (data: string, key: string) => boolean,
    private visibleWidth: (text: string) => number,
    private truncateToWidth: (text: string, width: number) => string,
    private renderContext: Partial<SubagentThreadRenderContext> = {},
    private maxLinesProvider: number | (() => number) = 42,
    private taskResolver?: (id: string) => SubagentTask | undefined,
    private initialSelectedTaskId?: string,
    private cancelSelectedTask?: (id: string) => void,
    private detailCancelShortcut = 'x',
    private displayOptions: SubagentsHistoryPanelDisplayOptions = {},
  ) {}

  invalidate(): void {
    this.bodyCache.clear();
    this.hydratedTasks.clear();
    this.rowTaskMap.clear();
  }

  handleMouse(event: {
    type?: string;
    button?: string;
    row?: number;
    y?: number;
    x?: number;
    col?: number;
    wheelDelta?: number;
  }): { handled: true; focus?: boolean; render?: boolean } | undefined {
    const hasCol = event.col !== undefined || event.x !== undefined;
    const col = event.col ?? event.x ?? 0;
    const row = event.row ?? event.y ?? 0;

    if (event.type === 'wheel') {
      const delta = Number(event.wheelDelta ?? 0);
      if (!Number.isFinite(delta) || delta === 0) return undefined;
      if (this.lastIsSplit) {
        if (hasCol && col <= this.lastSidebarWidth + 2) {
          this.sidebarScrollBy(delta);
        } else {
          this.scrollBy(delta);
        }
      } else {
        if (this.lastListStartRow >= 0 && row >= this.lastListStartRow && row <= this.lastListEndRow) {
          this.sidebarScrollBy(delta);
        } else {
          this.scrollBy(delta);
        }
      }
      return { handled: true, render: true };
    }

    const isLeft = event.button === 'left' || event.button === undefined;
    if (event.type === 'press') {
      if (isLeft) {
        return { handled: true, focus: true };
      }
      return undefined;
    }

    if (event.type === 'release') {
      if (isLeft) {
        return { handled: true };
      }
      return undefined;
    }

    const isLeftClick = event.type === 'click' || (!event.type && isLeft);
    if (!isLeftClick) return undefined;

    // Header or footer close click [✕ Cerrar]
    const lastRowIndex = (this.lastRenderDebugState?.renderedLineCount ?? 0) - 1;
    const isTopHeaderRow = row === 0;
    const isBottomFooterRow = lastRowIndex > 0 && row === lastRowIndex;
    const isCloseCol = col >= Math.max(0, this.lastRenderWidth - 16);

    if ((isTopHeaderRow || isBottomFooterRow) && isCloseCol) {
      this.done();
      return { handled: true, render: true };
    }

    let targetTaskId: string | undefined;
    if (this.lastIsSplit && hasCol) {
      if (col <= this.lastSidebarWidth + 2) {
        targetTaskId = this.sidebarRowTaskMap.get(row);
      } else {
        targetTaskId = this.detailRowTaskMap.get(row);
      }
    } else {
      targetTaskId = this.detailRowTaskMap.get(row) ?? this.sidebarRowTaskMap.get(row) ?? this.rowTaskMap.get(row);
    }

    if (targetTaskId) {
      const tasks = this.tasks();
      const targetIndex = tasks.findIndex((t) => t.id === targetTaskId);
      if (targetIndex >= 0) {
        const changed = this.selected !== targetIndex;
        this.selected = targetIndex;
        this.scroll = 0;
        this.followTail = true;
        return { handled: true, focus: true, render: changed };
      }
    }

    return { handled: true, focus: true };
  }

  handleInput(data: string): void {
    const tasks = this.tasks();
    if (this.matchesKey(data, 'escape') || this.matchesKey(data, 'ctrl+c') || this.matchesKey(data, 'q')) {
      this.done();
      return;
    }
    if (this.matchesKey(data, 'ctrl+o') || data === '\u000f') {
      this.toolOutputExpanded = !this.toolOutputExpanded;
      return;
    }
    if (this.matchesKey(data, 'ctrl+t') || data === '\u0014') {
      this.hideThinkingBlock = !this.hideThinkingBlock;
      return;
    }
    if (this.matchesKey(data, 'detailCancel')) {
      this.cancelSelectedActiveTask();
      return;
    }
    const wheel = mouseWheelDelta(data);
    if (wheel === -1) {
      this.scrollBy(-1);
      return;
    }
    if (wheel === 1) {
      this.scrollBy(1);
      return;
    }
    const mouseClick = isMouseClickInput(data);
    if (mouseClick.isClick && typeof mouseClick.row === 'number') {
      this.handleMouse({ type: 'click', row: mouseClick.row, col: mouseClick.col });
      return;
    }
    if (this.matchesKey(data, 'right')) {
      this.selected = Math.min(tasks.length - 1, this.selected + 1);
      this.scroll = 0;
      this.followTail = true;
    }
    if (this.matchesKey(data, 'left')) {
      this.selected = Math.max(0, this.selected - 1);
      this.scroll = 0;
      this.followTail = true;
    }
    if (this.matchesKey(data, 'down')) {
      this.scroll += 1;
      this.followTail = this.scroll >= this.lastMaxScroll;
    }
    if (this.matchesKey(data, 'up')) {
      this.scroll = Math.max(0, this.scroll - 1);
      this.followTail = false;
    }
    if (this.matchesKey(data, 'pageDown')) {
      this.scroll += 12;
      this.followTail = this.scroll >= this.lastMaxScroll;
    }
    if (this.matchesKey(data, 'pageUp')) {
      this.scroll = Math.max(0, this.scroll - 12);
      this.followTail = false;
    }
    if (this.matchesKey(data, 'home')) {
      this.scroll = 0;
      this.followTail = false;
    }
    if (this.matchesKey(data, 'end')) {
      this.scroll = Number.MAX_SAFE_INTEGER;
      this.followTail = true;
    }
  }

  private scrollBy(delta: number): void {
    if (delta < 0) {
      this.scroll = Math.max(0, this.scroll + delta);
      this.followTail = false;
      return;
    }
    if (delta > 0) {
      this.scroll += delta;
      this.followTail = this.scroll >= this.lastMaxScroll;
    }
  }

  private sidebarScrollBy(delta: number): void {
    const tasks = this.tasks();
    if (!tasks.length) return;
    this.sidebarScroll = Math.max(0, Math.min(tasks.length - 1, this.sidebarScroll + delta));
  }

  getRenderDebugState(): {
    taskCount: number;
    selectedIndex: number;
    selectedStatus?: string;
    scrollOffset: number;
    followTail: boolean;
    hasUsage: boolean;
    configuredMaxLines?: number;
    renderWidth?: number;
    renderedLineCount?: number;
    bodyHeight?: number;
    maxVisibleWidth?: number;
    widthViolationCount?: number;
    clickableRowCount?: number;
  } {
    const tasks = this.tasks();
    const task = tasks[this.selected];
    return {
      taskCount: tasks.length,
      selectedIndex: task ? this.selected : -1,
      selectedStatus: task?.status,
      scrollOffset: this.scroll,
      followTail: this.followTail,
      hasUsage: Boolean(task?.usage),
      configuredMaxLines: this.lastRenderDebugState?.configuredMaxLines,
      renderWidth: this.lastRenderDebugState?.renderWidth,
      renderedLineCount: this.lastRenderDebugState?.renderedLineCount,
      bodyHeight: this.lastRenderDebugState?.bodyHeight,
      maxVisibleWidth: this.lastRenderDebugState?.maxVisibleWidth,
      widthViolationCount: this.lastRenderDebugState?.widthViolationCount,
      clickableRowCount: this.rowTaskMap.size,
    };
  }

  render(width: number): string[] {
    const w = Math.max(40, width);
    this.lastRenderWidth = w;
    const configuredMaxLines = typeof this.maxLinesProvider === 'function' ? this.maxLinesProvider() : this.maxLinesProvider;
    const maxLines = Math.max(12, Math.floor(Number.isFinite(configuredMaxLines) ? configuredMaxLines : 42));
    const th = this.theme;
    const accent = (s: string) => themeAccent(th, s);
    const dim = (s: string) => themeDim(th, s);
    const title = (s: string) => themeTitle(th, s);
    const border = (text: string) => themeFg(th, 'accent', text, CYAN);
    const status = (task: SubagentTask) => themeStatus(th, task.status);

    const isSplit = w >= 90;
    this.lastIsSplit = isSplit;
    const sidebarWidth = isSplit ? Math.max(18, Math.min(30, Math.floor(w * 0.25))) : 0;
    this.lastSidebarWidth = sidebarWidth;
    const rightWidth = isSplit ? Math.max(16, w - sidebarWidth - 7) : Math.max(16, w - 4);

    const tasks = this.tasks();
    if (this.initialSelectedTaskId) {
      const initialIndex = tasks.findIndex((entry) => entry.id === this.initialSelectedTaskId);
      if (initialIndex >= 0) this.selected = initialIndex;
      this.initialSelectedTaskId = undefined;
    }
    if (this.selected >= tasks.length) this.selected = Math.max(0, tasks.length - 1);

    const rawLines: string[] = [];
    const archPrefix = themeFg(th, 'accent', ARCH_ICON, CYAN);
    const closeBtnText = '[✕ Cerrar]';
    const closeBtn = themeFg(th, 'error', closeBtnText, RED);
    const closeVis = this.visibleWidth(closeBtn);

    if (!tasks.length) {
      // Empty state
      const topTitle = `${archPrefix} ${title('subagents')}`;
      const topTitleVis = this.visibleWidth(topTitle);
      const topFill = Math.max(0, w - topTitleVis - closeVis - 8);
      const top = `${border(ROUNDED_BOX_CHARS.topLeft + ROUNDED_BOX_CHARS.horizontal)} ${topTitle} ${border(ROUNDED_BOX_CHARS.horizontal.repeat(topFill))} ${closeBtn} ${border(ROUNDED_BOX_CHARS.horizontal + ROUNDED_BOX_CHARS.topRight)}`;
      rawLines.push(top);
      rawLines.push(`${border(ROUNDED_BOX_CHARS.vertical)} ${this.padToWidth(dim('No subagent tasks recorded in this session yet.'), w - 4)} ${border(ROUNDED_BOX_CHARS.vertical)}`);
      while (rawLines.length < maxLines - 1) rawLines.push(`${border(ROUNDED_BOX_CHARS.vertical)}${' '.repeat(w - 2)}${border(ROUNDED_BOX_CHARS.vertical)}`);
      const bottomFill = Math.max(0, w - closeVis - 5);
      const bottom = `${border(ROUNDED_BOX_CHARS.bottomLeft + ROUNDED_BOX_CHARS.horizontal.repeat(bottomFill))} ${closeBtn} ${border(ROUNDED_BOX_CHARS.horizontal + ROUNDED_BOX_CHARS.bottomRight)}`;
      rawLines.push(bottom);
      const lines = rawLines.map((l) => fitsWidth(l, w, this.visibleWidth) ? l : this.truncateToWidth(l, w));
      this.updateDebugState(maxLines, w, lines, Math.max(0, maxLines - 2));
      return lines;
    }

    const currentTask = this.resolveTaskForBody(tasks[this.selected]!);
    let contextWindow: number | undefined;
    try { contextWindow = this.displayOptions.contextWindowForTask?.(currentTask); } catch {}
    const usage = formatUsage(currentTask.usage, contextWindow);
    const duration = fmtDuration(currentTask);
    const timeout = formatTimeout(this.displayOptions.timeoutMs);
    const timeoutHint = timeout ? ` (timeout ${timeout})` : '';
    const stall = formatTimeout(this.displayOptions.stallTimeoutMs);
    const stallHint = stall ? ` (stall ${stall})` : '';
    const cancelDetailHint = (currentTask.status === 'queued' || currentTask.status === 'running') && this.detailCancelShortcut
      ? `(${this.detailCancelShortcut} cancel)`
      : '';
    const cancelActiveHint = (currentTask.status === 'queued' || currentTask.status === 'running') && this.detailCancelShortcut
      ? `${this.detailCancelShortcut} cancel active`
      : '';
    const lastActivity = currentTask.last_activity ? `${currentTask.last_activity}${stallHint}` : undefined;

    // Row 0: Top Frame with Rounded Corners, Title, Keybindings & Column Divider Connector
    const leftTitle = `${archPrefix} ${title('subagents')}`;
    const leftTitleVis = this.visibleWidth(leftTitle);

    if (isSplit) {
      // Left Top Segment: ╭─ leftTitle ─...─┬
      const fillLeft = Math.max(0, sidebarWidth + 2 - leftTitleVis - 3);
      const leftTopSegment = `${border(ROUNDED_BOX_CHARS.topLeft + ROUNDED_BOX_CHARS.horizontal)} ${leftTitle} ${border(ROUNDED_BOX_CHARS.horizontal.repeat(fillLeft))}${border(ROUNDED_BOX_CHARS.tDown)}`;

      // Right Top Segment: ─ badge ─...─ closeBtn ─╮
      const badge = `${accent(`${this.selected + 1}/${tasks.length}`)} ${accent(currentTask.agent)} · ${status(currentTask)}${duration ? ` · ${dim(duration)}` : ''}`;
      const cancelActionText = cancelActiveHint ? `${cancelActiveHint} · ` : '';
      const shortcutsText = dim(`${cancelActionText}ctrl+o expand · ctrl+t thinking · `);
      const rightHeaderItems = `${shortcutsText}${closeBtn}`;

      const rightHeaderVis = this.visibleWidth(rightHeaderItems);
      const badgeVis = this.visibleWidth(badge);
      let clippedBadge = badge;
      const maxBadgeVis = Math.max(10, rightWidth - rightHeaderVis - 4);
      if (badgeVis + rightHeaderVis + 4 > rightWidth) {
        clippedBadge = this.truncateToWidth(badge, maxBadgeVis);
      }
      const midFill = Math.max(0, rightWidth - 4 - this.visibleWidth(clippedBadge) - rightHeaderVis);
      const rightTopSegment = `${border(ROUNDED_BOX_CHARS.horizontal)} ${clippedBadge} ${border(ROUNDED_BOX_CHARS.horizontal.repeat(midFill))} ${rightHeaderItems} ${border(ROUNDED_BOX_CHARS.horizontal + ROUNDED_BOX_CHARS.topRight)}`;
      rawLines.push(`${leftTopSegment}${rightTopSegment}`);
    } else {
      let displayTitle = leftTitle;
      const maxTitleVis = Math.max(4, w - closeVis - 8);
      if (leftTitleVis > maxTitleVis) {
        displayTitle = this.truncateToWidth(leftTitle, maxTitleVis);
      }
      let titleVis = this.visibleWidth(displayTitle);
      if (titleVis > maxTitleVis) {
        displayTitle = this.truncateToWidth(displayTitle, maxTitleVis);
        titleVis = this.visibleWidth(displayTitle);
      }
      const midFill = Math.max(0, w - titleVis - closeVis - 8);
      rawLines.push(`${border(ROUNDED_BOX_CHARS.topLeft + ROUNDED_BOX_CHARS.horizontal)} ${displayTitle} ${border(ROUNDED_BOX_CHARS.horizontal.repeat(midFill))} ${closeBtn} ${border(ROUNDED_BOX_CHARS.horizontal + ROUNDED_BOX_CHARS.topRight)}`);
    }

    if (isSplit) {
      // Row 1: Subheader Row 1 (Agent, Status, Effort, Model, Duration)
      const leftSubHeader1 = `${accent(`executions 1-${tasks.length}/${tasks.length}`)} `;
      const rightSubHeader1 = [
        `agent: ${accent(currentTask.agent)}`,
        `status: ${status(currentTask)}`,
        currentTask.effort ? `effort: ${accent(currentTask.effort)}${cancelDetailHint ? ` ${dim(cancelDetailHint)}` : ''}` : undefined,
        currentTask.model ? `model: ${currentTask.model}` : undefined,
        duration ? `duration: ${duration}${timeoutHint}` : undefined,
        usage ? `usage: ${usage}` : undefined,
      ].filter(Boolean).join(` ${themeFg(th, 'accent', CYBER_SEPARATOR, VIOLET)} `);

      const subheaderLine1 = `${border(ROUNDED_BOX_CHARS.vertical)} ${this.padToWidth(leftSubHeader1, sidebarWidth)} ${border(ROUNDED_BOX_CHARS.vertical)} ${this.padToWidth(rightSubHeader1, rightWidth)} ${border(ROUNDED_BOX_CHARS.vertical)}`;
      rawLines.push(subheaderLine1);

      // Row 2: Subheader Row 2 (Usage, Last activity, Display Name, Task)
      const displayName = currentTask.display_name?.trim();
      const leftSubHeader2 = '';
      const rightSubHeader2 = [
        usage ? `usage: ${usage}` : undefined,
        lastActivity ? `last: ${lastActivity}` : undefined,
        displayName ? `name: ${accent(displayName)}` : undefined,
        currentTask.task ? `task: ${clip(currentTask.task, Math.max(20, rightWidth - 30))}` : undefined,
      ].filter(Boolean).join(` ${themeFg(th, 'accent', CYBER_SEPARATOR, VIOLET)} `);

      const subheaderLine2 = `${border(ROUNDED_BOX_CHARS.vertical)} ${this.padToWidth(leftSubHeader2, sidebarWidth)} ${border(ROUNDED_BOX_CHARS.vertical)} ${this.padToWidth(rightSubHeader2, rightWidth)} ${border(ROUNDED_BOX_CHARS.vertical)}`;
      rawLines.push(subheaderLine2);

      // Row 3: Header Divider Row
      const headerDivider = `${border(ROUNDED_BOX_CHARS.tRight + ROUNDED_BOX_CHARS.horizontal.repeat(sidebarWidth + 2) + ROUNDED_BOX_CHARS.cross + ROUNDED_BOX_CHARS.horizontal.repeat(rightWidth + 2) + ROUNDED_BOX_CHARS.tLeft)}`;
      rawLines.push(headerDivider);

      // Body Setup
      this.lastListStartRow = -1;
      this.lastListEndRow = -1;
      const headerCount = rawLines.length; // 4 rows
      const bodyHeight = Math.max(5, maxLines - headerCount - 1);

      // Keep sidebar scroll focused on selected task
      if (this.selected !== this.lastSelectedTaskIdx) {
        if (this.selected < this.sidebarScroll) this.sidebarScroll = this.selected;
        if (this.selected >= this.sidebarScroll + bodyHeight) this.sidebarScroll = this.selected - bodyHeight + 1;
        this.lastSelectedTaskIdx = this.selected;
      }
      this.sidebarScroll = Math.max(0, Math.min(Math.max(0, tasks.length - bodyHeight), this.sidebarScroll));

      // Prepare main view content
      const structuredBody = isValidThreadSnapshot(currentTask.thread_snapshot);
      const bodyEntries = this.bodyEntriesFor(currentTask, rightWidth);
      const wrappedEntries = structuredBody ? bodyEntries : this.wrapWithTaskIds(bodyEntries, rightWidth);
      const maxScroll = Math.max(0, wrappedEntries.length - bodyHeight);
      if (this.followTail) this.scroll = maxScroll;
      if (this.scroll > maxScroll) this.scroll = maxScroll;
      this.lastMaxScroll = maxScroll;
      const visibleEntries = wrappedEntries.slice(this.scroll, this.scroll + bodyHeight);

      this.rowTaskMap.clear();
      this.sidebarRowTaskMap.clear();
      this.detailRowTaskMap.clear();

      // Render Split-View Rows
      for (let i = 0; i < bodyHeight; i++) {
        const terminalRow = headerCount + i;

        // Sidebar Column Cell
        const sidebarTaskIdx = this.sidebarScroll + i;
        let leftCellText = '';
        if (sidebarTaskIdx < tasks.length) {
          const t = tasks[sidebarTaskIdx]!;
          const isSelected = sidebarTaskIdx === this.selected;
          this.sidebarRowTaskMap.set(terminalRow, t.id);
          this.rowTaskMap.set(terminalRow, t.id);

          const icon = isSelected ? '●' : '○';
          const statusText = t.status;
          const name = t.display_name?.trim() || t.agent;
          const effortTag = t.effort ? ` effort:${t.effort}` : '';
          const itemLabel = `${icon} ${name}:${statusText}${effortTag}`;
          const clippedItem = this.truncateToWidth(itemLabel, sidebarWidth);
          leftCellText = isSelected ? themeFg(th, 'warning', clippedItem, AMBER) : dim(clippedItem);
        }
        const leftCell = this.padToWidth(leftCellText, sidebarWidth);

        // Main View Column Cell
        let rightCellText = '';
        if (i < visibleEntries.length) {
          const entry = visibleEntries[i]!;
          if (entry.taskId) {
            this.detailRowTaskMap.set(terminalRow, entry.taskId);
          }
          rightCellText = structuredBody ? entry.text : this.renderFlowLine(entry.text, rightWidth);
        }
        const rightCell = this.padToWidth(rightCellText, rightWidth);

        const rowLine = `${border(ROUNDED_BOX_CHARS.vertical)} ${leftCell} ${border(ROUNDED_BOX_CHARS.vertical)} ${rightCell} ${border(ROUNDED_BOX_CHARS.vertical)}`;
        rawLines.push(rowLine);
      }

      // Bottom Border with Rounded Corners, Scroll position & Shortcuts & close button
      const scrollPos = wrappedEntries.length > bodyHeight
        ? `[${this.scroll + 1}-${Math.min(wrappedEntries.length, this.scroll + bodyHeight)}/${wrappedEntries.length}]`
        : '';
      const shortcuts = dim('←/→ exec · ↑/↓ scroll · ctrl+o expand · ctrl+t thinking');
      const scrollBadge = scrollPos ? dim(`${scrollPos} `) : '';
      const bottomItems = `${scrollBadge}${shortcuts}`;
      const bottomVis = this.visibleWidth(bottomItems);
      let rightBottomSegment: string;
      const maxShortcutsVis = Math.max(4, rightWidth - closeVis - 4);
      let clippedItems = bottomItems;
      if (bottomVis + closeVis + 4 > rightWidth) {
        clippedItems = this.truncateToWidth(bottomItems, maxShortcutsVis);
      }
      const fillBottom = Math.max(0, rightWidth - 4 - this.visibleWidth(clippedItems) - closeVis);
      rightBottomSegment = `${border(ROUNDED_BOX_CHARS.horizontal.repeat(fillBottom))} ${clippedItems} ${border(ROUNDED_BOX_CHARS.horizontal)} ${closeBtn} ${border(ROUNDED_BOX_CHARS.horizontal + ROUNDED_BOX_CHARS.bottomRight)}`;
      const bottomLine = `${border(ROUNDED_BOX_CHARS.bottomLeft + ROUNDED_BOX_CHARS.horizontal.repeat(sidebarWidth + 2) + ROUNDED_BOX_CHARS.tUp)}${rightBottomSegment}`;
      rawLines.push(bottomLine);

      const lines = rawLines.map((l) => fitsWidth(l, w, this.visibleWidth) ? l : this.truncateToWidth(l, w));
      this.updateDebugState(maxLines, w, lines, bodyHeight);
      return lines;
    } else {
      // Narrow Mode (Stacked View)
      // Row 1: Selected task summary
      const subItems = [
        `${accent(`${this.selected + 1}/${tasks.length}`)}`,
        `agent: ${accent(currentTask.agent)}`,
        `status: ${status(currentTask)}`,
        duration ? `duration: ${duration}` : undefined,
        currentTask.effort ? `effort: ${accent(currentTask.effort)}` : undefined,
      ].filter(Boolean).join(` ${themeFg(th, 'accent', CYBER_SEPARATOR, VIOLET)} `);
      const clippedSub1 = this.truncateToWidth(subItems, rightWidth);
      rawLines.push(`${border(ROUNDED_BOX_CHARS.vertical)} ${this.padToWidth(clippedSub1, rightWidth)} ${border(ROUNDED_BOX_CHARS.vertical)}`);

      // Row 2: Task or details
      const displayName = currentTask.display_name?.trim();
      let taskText = (currentTask.task || '').trim().replace(/\s+/g, ' ');
      if (displayName && taskText.toLowerCase().startsWith(displayName.toLowerCase())) {
        taskText = taskText.slice(displayName.length).replace(/^[:\s\-–—]+/, '').trim();
      }

      const titlePart = displayName
        ? `task: ${accent(displayName)}${taskText ? ` · ${dim(taskText)}` : ''}`
        : (taskText ? `task: ${accent(taskText)}` : undefined);

      const sub2Parts = [
        titlePart,
        currentTask.model ? `model: ${dim(currentTask.model)}` : undefined,
      ].filter(Boolean).join(` ${themeFg(th, 'accent', CYBER_SEPARATOR, VIOLET)} `);
      if (sub2Parts) {
        const clippedSub2 = this.truncateToWidth(sub2Parts, rightWidth);
        rawLines.push(`${border(ROUNDED_BOX_CHARS.vertical)} ${this.padToWidth(clippedSub2, rightWidth)} ${border(ROUNDED_BOX_CHARS.vertical)}`);
      }

      // Row 3: Header Divider
      const headerDivider = `${border(ROUNDED_BOX_CHARS.tRight + ROUNDED_BOX_CHARS.horizontal.repeat(rightWidth + 2) + ROUNDED_BOX_CHARS.tLeft)}`;
      rawLines.push(headerDivider);

      const headerCount = rawLines.length;
      const nonBodyRows = headerCount + 1 + 1; // headerCount + listDivider (1) + bottomFrame (1)
      const availableSpace = Math.max(4, maxLines - nonBodyRows);
      const listHeight = Math.min(tasks.length, Math.max(1, Math.min(4, Math.floor(availableSpace * 0.35))));
      const detailsHeight = Math.max(2, availableSpace - listHeight);

      // Keep sidebar scroll focused on selected task within listHeight
      if (this.selected !== this.lastSelectedTaskIdx) {
        if (this.selected < this.sidebarScroll) this.sidebarScroll = this.selected;
        if (this.selected >= this.sidebarScroll + listHeight) this.sidebarScroll = this.selected - listHeight + 1;
        this.lastSelectedTaskIdx = this.selected;
      }
      this.sidebarScroll = Math.max(0, Math.min(Math.max(0, tasks.length - listHeight), this.sidebarScroll));

      // Prepare main view content
      const structuredBody = isValidThreadSnapshot(currentTask.thread_snapshot);
      const bodyEntries = this.bodyEntriesFor(currentTask, rightWidth);
      const wrappedEntries = structuredBody ? bodyEntries : this.wrapWithTaskIds(bodyEntries, rightWidth);
      const maxScroll = Math.max(0, wrappedEntries.length - detailsHeight);
      if (this.followTail) this.scroll = maxScroll;
      if (this.scroll > maxScroll) this.scroll = maxScroll;
      this.lastMaxScroll = maxScroll;
      const visibleEntries = wrappedEntries.slice(this.scroll, this.scroll + detailsHeight);

      this.rowTaskMap.clear();
      this.sidebarRowTaskMap.clear();
      this.detailRowTaskMap.clear();

      // Render details rows
      for (let i = 0; i < detailsHeight; i++) {
        const terminalRow = headerCount + i;
        let cellText = '';
        if (i < visibleEntries.length) {
          const entry = visibleEntries[i]!;
          if (entry.taskId) {
            this.detailRowTaskMap.set(terminalRow, entry.taskId);
            this.rowTaskMap.set(terminalRow, entry.taskId);
          }
          cellText = structuredBody ? entry.text : this.renderFlowLine(entry.text, rightWidth);
        }
        const padded = this.padToWidth(cellText, rightWidth);
        rawLines.push(`${border(ROUNDED_BOX_CHARS.vertical)} ${padded} ${border(ROUNDED_BOX_CHARS.vertical)}`);
      }

      // Divider before subagents list at the bottom
      const listScrollPos = `[${this.sidebarScroll + 1}-${Math.min(tasks.length, this.sidebarScroll + listHeight)}/${tasks.length}] `;
      const scrollArrow = tasks.length > listHeight ? '▲/▼ ' : '';
      const listLabel = `executions ${listScrollPos}${scrollArrow}`;
      const listLabelVis = this.visibleWidth(listLabel);
      const listDivFill = Math.max(0, w - listLabelVis - 5);
      rawLines.push(`${border(ROUNDED_BOX_CHARS.tRight + ROUNDED_BOX_CHARS.horizontal)} ${dim(listLabel)} ${border(ROUNDED_BOX_CHARS.horizontal.repeat(listDivFill) + ROUNDED_BOX_CHARS.tLeft)}`);

      // Render subagents list rows
      this.lastListStartRow = rawLines.length;
      for (let i = 0; i < listHeight; i++) {
        const terminalRow = rawLines.length;
        const taskIdx = this.sidebarScroll + i;
        let lineContent = '';
        if (taskIdx < tasks.length) {
          const t = tasks[taskIdx]!;
          const isSelected = taskIdx === this.selected;
          this.sidebarRowTaskMap.set(terminalRow, t.id);
          this.rowTaskMap.set(terminalRow, t.id);

          const icon = isSelected ? '●' : '○';
          const name = t.display_name?.trim() || t.agent;
          const dur = fmtDuration(t);
          const durPart = dur ? ` · ${dur}` : '';
          const itemText = `${icon} ${taskIdx + 1}. ${name} · ${t.status}${durPart}`;
          const clipped = this.truncateToWidth(itemText, rightWidth);
          lineContent = isSelected ? themeFg(th, 'warning', clipped, AMBER) : dim(clipped);
        }
        const padded = this.padToWidth(lineContent, rightWidth);
        rawLines.push(`${border(ROUNDED_BOX_CHARS.vertical)} ${padded} ${border(ROUNDED_BOX_CHARS.vertical)}`);
      }
      this.lastListEndRow = rawLines.length - 1;

      // Bottom frame (footer) with shortcuts on the left and close button on the right
      const maxShortcutsVis = Math.max(4, w - closeVis - 8);
      let shortcuts = w >= 55 ? '←/→ select · ↑/↓ scroll' : '←/→ select';
      if (this.visibleWidth(shortcuts) > maxShortcutsVis) {
        shortcuts = this.truncateToWidth(shortcuts, maxShortcutsVis);
      }
      const shortcutsStyled = dim(shortcuts);
      let shortcutsVis = this.visibleWidth(shortcutsStyled);
      if (shortcutsVis > maxShortcutsVis) {
        shortcuts = this.truncateToWidth(shortcuts, maxShortcutsVis);
        shortcutsVis = this.visibleWidth(dim(shortcuts));
      }
      const bottomFill = Math.max(0, w - shortcutsVis - closeVis - 8);
      const bottomLine = `${border(ROUNDED_BOX_CHARS.bottomLeft + ROUNDED_BOX_CHARS.horizontal)} ${dim(shortcuts)} ${border(ROUNDED_BOX_CHARS.horizontal.repeat(bottomFill))} ${closeBtn} ${border(ROUNDED_BOX_CHARS.horizontal + ROUNDED_BOX_CHARS.bottomRight)}`;
      rawLines.push(bottomLine);

      const lines = rawLines.map((l) => fitsWidth(l, w, this.visibleWidth) ? l : this.truncateToWidth(l, w));
      this.updateDebugState(maxLines, w, lines, detailsHeight);
      return lines;
    }
  }

  private updateDebugState(maxLines: number, width: number, lines: string[], bodyHeight: number): void {
    const lineWidths = lines.map((entry) => {
      try {
        return this.visibleWidth(entry);
      } catch {
        return terminalVisibleWidth(entry);
      }
    });
    this.lastRenderDebugState = {
      configuredMaxLines: maxLines,
      renderWidth: width,
      renderedLineCount: lines.length,
      bodyHeight,
      maxVisibleWidth: lineWidths.reduce((max, value) => Math.max(max, value), 0),
      widthViolationCount: lineWidths.filter((value) => value > width).length,
    };
  }

  cancelSelectedActiveTask(): void {
    const task = this.tasks()[this.selected];
    if (task && (task.status === 'queued' || task.status === 'running')) this.cancelSelectedTask?.(task.id);
  }

  private tasks(): SubagentTask[] {
    return typeof this.tasksProvider === 'function' ? this.tasksProvider() : this.tasksProvider;
  }

  private renderFlowLine(raw: string, width: number): string {
    const th = this.theme;
    if (raw.startsWith('Preparing for response') || /^\*\*.+\*\*$/.test(raw)) {
      const clipped = this.truncateToWidth(raw, width);
      const text = th?.bold?.(clipped) ?? clipped;
      return th?.fg?.('dim', text) ?? text;
    }
    if (this.isToolLikeLine(raw)) {
      const border = (t: string) => themeFg(th, 'accent', t, CYAN);
      const prefix = border(`${BOX_CHARS.vertical} `);
      const maxTextWidth = Math.max(0, width - 2);
      const clipped = this.truncateToWidth(raw, maxTextWidth);
      const text = th?.fg?.('toolTitle', clipped) ?? clipped;
      return `${prefix}${text}`;
    }
    if (raw.startsWith('done') || raw.startsWith('completed')) {
      const clipped = this.truncateToWidth(raw, width);
      return th?.fg?.('success', clipped) ?? clipped;
    }
    if (raw.startsWith('failed') || raw.startsWith('error')) {
      const clipped = this.truncateToWidth(raw, width);
      return th?.fg?.('error', clipped) ?? clipped;
    }
    if (raw.startsWith('# ') || raw.startsWith('## ') || raw.startsWith('### ')) {
      const border = (t: string) => themeFg(th, 'accent', t, CYAN);
      const titleText = raw.replace(/^#+\s*/, '');
      const maxTitle = Math.max(4, width - 8);
      const clippedTitle = this.truncateToWidth(titleText, maxTitle);
      const heading = th?.bold?.(th?.fg?.('mdHeading', clippedTitle) ?? clippedTitle) ?? clippedTitle;
      const leftFrame = `${border(BOX_CHARS.topLeft + BOX_CHARS.horizontal + ' ')}${heading} `;
      const leftVisWidth = this.visibleWidth(leftFrame);
      const rightCorner = border(BOX_CHARS.topRight);
      const rightVisWidth = this.visibleWidth(rightCorner);
      const filler = Math.max(0, width - leftVisWidth - rightVisWidth);
      const framed = `${leftFrame}${border(BOX_CHARS.horizontal.repeat(filler))}${rightCorner}`;
      return framed;
    }
    if (raw.startsWith('  ')) {
      const clipped = this.truncateToWidth(raw, width);
      return th?.fg?.('dim', clipped) ?? clipped;
    }
    return this.truncateToWidth(raw, width);
  }

  private taskSignature(task: SubagentTask): string {
    const snapshot = task.thread_snapshot;
    return [task.id, task.status, task.last_activity_at ?? '', task.ended_at ?? '', snapshot?.updated_at ?? '', snapshot?.items?.length ?? 0].join('|');
  }

  private resolveTaskForBody(task: SubagentTask): SubagentTask {
    if (task.thread_snapshot || !this.taskResolver) return task;
    const signature = this.taskSignature(task);
    const cached = this.hydratedTasks.get(task.id);
    if (cached?.signature === signature) return cached.task;
    const hydrated = this.taskResolver(task.id) ?? task;
    this.hydratedTasks.set(task.id, { signature, task: hydrated });
    return hydrated;
  }

  private bodyCacheKey(task: SubagentTask, width: number): string {
    return [this.taskSignature(task), width, this.toolOutputExpanded ? 'expanded' : 'collapsed', this.hideThinkingBlock ? 'thinking-hidden' : 'thinking-visible'].join('|');
  }

  private resolveTaskIdFromSnapshotItem(item: any, tasks: SubagentTask[]): string | undefined {
    if (!item) return undefined;
    const directId = item.taskId ?? item.task_id ?? item.subagentTaskId ?? item.subtaskId;
    if (typeof directId === 'string' && directId.trim()) return directId.trim();

    const details = item.result?.details;
    if (details) {
      if (typeof details.task?.id === 'string' && details.task.id.trim()) return details.task.id.trim();
      if (typeof details.task_id === 'string' && details.task_id.trim()) return details.task_id.trim();
      if (typeof details.taskId === 'string' && details.taskId.trim()) return details.taskId.trim();
      if (Array.isArray(details.tasks) && details.tasks[0]?.id) return String(details.tasks[0].id).trim();
      if (Array.isArray(details.task_ids) && details.task_ids[0]) return String(details.task_ids[0]).trim();
    }

    const resultTaskId = item.result?.task_id ?? item.result?.taskId ?? item.result?.task?.id;
    if (typeof resultTaskId === 'string' && resultTaskId.trim()) return resultTaskId.trim();

    const argsTaskId = item.arguments?.task_id ?? item.arguments?.taskId ?? item.arguments?.task?.id;
    if (typeof argsTaskId === 'string' && argsTaskId.trim()) return argsTaskId.trim();

    const toolName = typeof item.name === 'string' ? item.name : '';
    const isSubagentTool = toolName === 'subagent_run' || toolName === 'subagent_continue' || toolName === 'subagent' || toolName.startsWith('subagent');

    if (isSubagentTool || item.type === 'subagent') {
      const agentCandidate = item.arguments?.agent ?? item.arguments?.name;
      if (typeof agentCandidate === 'string' && agentCandidate.trim()) {
        const found = tasks.find((t) => t.id === agentCandidate || t.agent === agentCandidate || t.display_name === agentCandidate);
        if (found) return found.id;
      }
      const taskCandidate = item.arguments?.task;
      if (typeof taskCandidate === 'string' && taskCandidate.trim()) {
        const found = tasks.find((t) => t.task === taskCandidate || t.display_name === taskCandidate);
        if (found) return found.id;
      }
    }

    return undefined;
  }

  private resolveTaskIdFromFlowLine(line: string, tasks: SubagentTask[]): { cleanLine: string; taskId?: string } {
    const trimmed = line.trim();
    if (!trimmed) return { cleanLine: line };

    if (
      trimmed.startsWith('subagent:') ||
      trimmed.startsWith('model:') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('Preparing for response') ||
      trimmed.startsWith('done') ||
      trimmed.startsWith('completed') ||
      trimmed.startsWith('failed') ||
      trimmed.startsWith('error')
    ) {
      return { cleanLine: line };
    }

    let cleanLine = line;
    let taskId: string | undefined;

    const rawIdMatch = line.match(/\b(subtask_[a-zA-Z0-9_-]+)\b/);
    if (rawIdMatch) {
      taskId = rawIdMatch[1];
      cleanLine = cleanLine
        .replace(/\s*[\(\[]?subtask_[a-zA-Z0-9_-]+[\)\]]?/g, '')
        .replace(/\s{2,}/g, ' ')
        .trimEnd();
    }

    if (!taskId) {
      if (trimmed === 'main') {
        const found = tasks.find((t) => t.id === 'main' || t.agent === 'main');
        if (found) taskId = found.id;
      }

      const subagentMatch = trimmed.match(/^subagent\s+([^\s:]+)/);
      if (subagentMatch) {
        const agentName = subagentMatch[1]!;
        const found = tasks.find((t) => t.id === agentName || t.agent === agentName || t.display_name === agentName);
        if (found) taskId = found.id;
      }

      const bulletMatch = trimmed.match(/^(?:󰣇|●|○)\s+([^\s:]+)/);
      if (bulletMatch) {
        const agentName = bulletMatch[1]!;
        const found = tasks.find((t) => t.id === agentName || t.agent === agentName || t.display_name === agentName);
        if (found) taskId = found.id;
      }

      if (!taskId) {
        for (const t of tasks) {
          if (t.agent && (trimmed.startsWith(`${t.agent} `) || trimmed.startsWith(`${t.agent}:`) || trimmed === t.agent)) {
            taskId = t.id;
            break;
          }
          if (t.display_name && (trimmed.startsWith(`${t.display_name} `) || trimmed.startsWith(`${t.display_name}:`) || trimmed === t.display_name)) {
            taskId = t.id;
            break;
          }
        }
      }
    }

    return { cleanLine, taskId };
  }

  private wrapWithTaskIds(
    entries: Array<{ text: string; taskId?: string }>,
    width: number,
  ): Array<{ text: string; taskId?: string }> {
    const out: Array<{ text: string; taskId?: string }> = [];
    for (const entry of entries) {
      const wrappedTexts = this.wrap(entry.text, width);
      for (const text of wrappedTexts) {
        out.push({ text, taskId: entry.taskId });
      }
    }
    return out;
  }

  private executionFlowEntriesFor(task: SubagentTask): Array<{ text: string; taskId?: string }> {
    const rawFlow = this.executionFlowFor(task);
    const rawLines = rawFlow.split('\n');
    const tasks = this.tasks();
    return rawLines.map((line) => {
      const { cleanLine, taskId } = this.resolveTaskIdFromFlowLine(line, tasks);
      return { text: cleanLine, taskId };
    });
  }

  private bodyEntriesFor(task: SubagentTask, width: number): Array<{ text: string; taskId?: string }> {
    const activeSnapshot = isValidThreadSnapshot(task.thread_snapshot) ? task.thread_snapshot : undefined;
    const allowCache = !snapshotHasActiveTools(activeSnapshot);
    const cacheKey = this.bodyCacheKey(task, width);
    if (allowCache) {
      const cached = this.bodyCache.get(cacheKey);
      if (cached) return cached;
    }
    let entries: Array<{ text: string; taskId?: string }>;
    if (activeSnapshot) {
      const context = {
        ...this.renderContext,
        theme: this.renderContext.theme ?? this.theme,
        cwd: this.renderContext.cwd ?? process.cwd(),
        taskId: task.id,
        visibleWidth: this.renderContext.visibleWidth ?? this.visibleWidth,
        truncateToWidth: this.renderContext.truncateToWidth ?? this.truncateToWidth,
        renderWidth: width,
        toolOutputExpanded: this.toolOutputExpanded,
        hideThinkingBlock: this.hideThinkingBlock,
      };
      const rendered = renderThreadBody(activeSnapshot, context);
      const rawLines = rendered.length ? rendered : [''];
      const knownTasks = this.tasks();

      if (activeSnapshot.items.length <= 1) {
        const taskId = activeSnapshot.items[0]
          ? this.resolveTaskIdFromSnapshotItem(activeSnapshot.items[0], knownTasks)
          : undefined;
        entries = rawLines.map((text) => {
          const resolved = taskId ? { cleanLine: text, taskId } : this.resolveTaskIdFromFlowLine(text, knownTasks);
          return { text: resolved.cleanLine, taskId: resolved.taskId };
        });
      } else {
        const itemSlices: Array<{ lines: string[]; taskId?: string }> = [];
        for (const item of activeSnapshot.items) {
          const itemLines = renderThreadBody({ ...activeSnapshot, items: [item] }, context);
          const taskId = this.resolveTaskIdFromSnapshotItem(item, knownTasks);
          itemSlices.push({ lines: itemLines, taskId });
        }
        const flatLines = itemSlices.flatMap((s) => s.lines);
        if (flatLines.length === rawLines.length && flatLines.join('\n') === rawLines.join('\n')) {
          entries = itemSlices.flatMap((s) => s.lines.map((text) => {
            const resolved = s.taskId ? { cleanLine: text, taskId: s.taskId } : this.resolveTaskIdFromFlowLine(text, knownTasks);
            return { text: resolved.cleanLine, taskId: resolved.taskId };
          }));
        } else {
          entries = rawLines.map((lineText) => {
            const resolved = this.resolveTaskIdFromFlowLine(lineText, knownTasks);
            return { text: resolved.cleanLine, taskId: resolved.taskId };
          });
        }
      }

      if ((task.status === 'failed' || task.status === 'cancelled') && task.error && !hasEquivalentSnapshotError(activeSnapshot, task.error)) {
        entries.push({ text: '' }, { text: '# error' }, { text: task.error });
      }
    } else {
      entries = this.executionFlowEntriesFor(task);
    }
    if (!allowCache) return entries;
    this.bodyCache.set(cacheKey, entries);
    if (this.bodyCache.size > 50) {
      const oldest = this.bodyCache.keys().next().value;
      if (oldest !== undefined) this.bodyCache.delete(oldest);
    }
    return entries;
  }

  private bodyLinesFor(task: SubagentTask, width: number): string[] {
    return this.bodyEntriesFor(task, width).map((entry) => entry.text);
  }

  private executionFlowFor(task: SubagentTask): string {
    const usage = formatUsage(task.usage);
    const hasResp = typeof task.result === 'string' && task.result.trim().length > 0;
    const parts = [
      `subagent: ${task.agent} · status: ${task.status} · attempt: ${task.attempt ?? 1} · effort: ${task.effort ?? 'default/current'}`,
      `model: ${task.model ?? 'default/current'}${usage ? ` · usage: ${usage}` : ''}`,
      '',
      hasResp ? 'Preparing for response' : undefined,
      hasResp ? '' : undefined,
      task.prompt ? ['# delegated task', this.extractPromptTail(task.prompt)].join('\n') : ['# delegated task', task.task].join('\n'),
      task.context ? ['', '# context', task.context].join('\n') : undefined,
      task.continuation_prompt ? ['', '# continuation prompt', task.continuation_prompt].join('\n') : undefined,
      usage ? ['', '# usage', usage].join('\n') : undefined,
      task.transcript ? ['', '# execution', this.cleanTranscript(task.transcript)].join('\n') : undefined,
      task.error ? ['', '# error', task.error].join('\n') : undefined,
      hasResp ? ['', '# response sent to orchestrator', task.result].join('\n') : undefined,
      !task.transcript && !hasResp && !task.error ? ['', '# activity', `${task.last_activity ?? 'queued'}${task.output_preview ? `\n${task.output_preview}` : ''}`].join('\n') : undefined,
    ].filter(Boolean);
    return parts.join('\n').trim();
  }

  private cleanTranscript(transcript: string): string {
    return transcript
      .replace(/^# orchestrator prompt[\s\S]*?## delegated task\n/m, '')
      .replace(/\n# final assistant text[\s\S]*$/m, '')
      .replace(/\n# response sent to orchestrator[\s\S]*$/m, '')
      .split('\n')
      .filter((line) => !this.isNoiseLine(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private isToolLikeLine(raw: string): boolean {
    return raw.startsWith('subagent ') || raw.startsWith('memory_') || raw.startsWith('read ') || raw.startsWith('bash ') || raw.startsWith('edit ') || raw.startsWith('write ') || raw.startsWith('tool ');
  }

  private isNoiseLine(raw: string): boolean {
    const line = raw.trim();
    if (!line) return false;
    if (['agent_start', 'message_start', 'message_update', 'message_end', 'turn_start', 'turn_end'].includes(line)) return true;
    if (/^\{.*\}$/.test(line)) return true;
    return false;
  }

  private padToWidth(text: string, width: number): string {
    const vis = this.visibleWidth(text);
    if (vis <= width) {
      return `${text}${' '.repeat(width - vis)}`;
    }
    const clipped = this.truncateToWidth(text, width);
    const clippedVis = this.visibleWidth(clipped);
    return `${clipped}${' '.repeat(Math.max(0, width - clippedVis))}`;
  }

  private extractPromptTail(prompt: string): string {
    const marker = '## delegated task';
    const index = prompt.lastIndexOf(marker);
    if (index >= 0) return prompt.slice(index + marker.length).trim();
    return prompt.trim();
  }

  private wrap(text: string, width: number): string[] {
    const out: string[] = [];
    for (const raw of text.replace(/\t/g, '  ').split('\n')) {
      if (!raw) {
        out.push('');
        continue;
      }
      const indent = raw.match(/^\s*/)?.[0] ?? '';
      const words = raw.trimEnd().split(/\s+/);
      let line = indent && words.length ? indent + words.shift() : (words.shift() ?? '');
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (this.visibleWidth(next) <= width) {
          line = next;
          continue;
        }
        if (line) out.push(line);
        if (this.visibleWidth(word) > width) {
          let rest = word;
          while (this.visibleWidth(rest) > width) {
            let cut = Math.max(1, width);
            while (cut > 1 && this.visibleWidth(rest.slice(0, cut)) > width) cut--;
            out.push(rest.slice(0, cut));
            rest = rest.slice(cut);
          }
          line = rest;
        } else {
          line = indent + word;
        }
      }
      if (line) out.push(line);
    }
    return out;
  }
}
