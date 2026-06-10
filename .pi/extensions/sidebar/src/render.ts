import type {
  ChatHeaderModel,
  GitFileRow,
  SectionState,
  SidebarModel,
  SubagentActivity,
} from './model.js';
import { DEFAULT_MAX_GIT_FILES } from './config.js';
import { fitWithRightSuffix, padRightVisible, truncateToWidth } from './text.js';

export type SidebarTheme = {
  fg?: (token: string, text: string) => string;
  bold?: (text: string) => string;
};

const TOP_LEFT = '╭';
const TOP_RIGHT = '╮';
const MID_LEFT = '├';
const MID_RIGHT = '┤';
const BOTTOM_LEFT = '╰';
const BOTTOM_RIGHT = '╯';
const HORIZONTAL = '─';
const VERTICAL = '│';

function style(theme: SidebarTheme | undefined, token: string, text: string): string {
  return theme?.fg?.(token, text) ?? text;
}

function strong(theme: SidebarTheme | undefined, text: string): string {
  return theme?.bold?.(text) ?? text;
}

function line(width: number, text: string): string {
  return padRightVisible(text, width);
}

function borderLine(width: number, left: string, right: string, theme?: SidebarTheme): string {
  if (width <= 1) return truncateToWidth(left, width);
  const innerWidth = Math.max(0, width - 2);
  return style(theme, 'border', `${left}${HORIZONTAL.repeat(innerWidth)}${right}`);
}

function panelLine(width: number, text: string, theme?: SidebarTheme, token = 'dim'): string {
  if (width <= 1) return truncateToWidth(VERTICAL, width);
  const innerWidth = Math.max(0, width - 2);
  const content = padRightVisible(truncateToWidth(` ${text}`, innerWidth), innerWidth);
  return `${style(theme, 'border', VERTICAL)}${style(theme, token, content)}${style(theme, 'border', VERTICAL)}`;
}

function blankLine(width: number, theme?: SidebarTheme): string {
  return panelLine(width, '', theme);
}

function topBorder(width: number, theme?: SidebarTheme): string {
  return borderLine(width, TOP_LEFT, TOP_RIGHT, theme);
}

function separator(width: number, theme?: SidebarTheme): string {
  return borderLine(width, MID_LEFT, MID_RIGHT, theme);
}

function bottomBorder(width: number, theme?: SidebarTheme): string {
  return borderLine(width, BOTTOM_LEFT, BOTTOM_RIGHT, theme);
}

function formatElapsed(seconds?: number): string {
  if (!Number.isFinite(seconds) || seconds === undefined) return '';
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return minutes > 0 ? `${minutes}m${remainder}s` : `${remainder}s`;
}

function renderTitle(chat: ChatHeaderModel, width: number, theme?: SidebarTheme): string[] {
  const title = chat.title.trim() || 'Current Chat';
  return [
    topBorder(width, theme),
    panelLine(width, style(theme, 'accent', strong(theme, 'Pi Sidebar')), theme, 'accent'),
    separator(width, theme),
    panelLine(width, style(theme, 'dim', title), theme),
  ];
}

function renderSectionState<T>(label: string, state: SectionState<T>, width: number, theme?: SidebarTheme): string[] {
  const lines = [blankLine(width, theme), panelLine(width, style(theme, 'accent', label), theme, 'accent')];
  switch (state.kind) {
    case 'ready':
      return lines;
    case 'empty':
    case 'unavailable':
    case 'error':
      lines.push(panelLine(width, state.message, theme));
      return lines;
    case 'loading':
      lines.push(panelLine(width, 'loading', theme));
      return lines;
  }
}

function isActiveSubagent(activity: SubagentActivity): boolean {
  return activity.status === 'running' || activity.status === 'queued';
}

function renderSubagentStatusLine(activities: SubagentActivity[], width: number, theme?: SidebarTheme): string {
  const running = activities.filter(isActiveSubagent).length;
  const completed = activities.filter((activity) => activity.status === 'completed').length;
  const failed = activities.filter((activity) => activity.status === 'failed').length;
  return panelLine(
    width,
    `${style(theme, 'warning', `${running} run`)} · ${style(theme, 'success', `${completed} done`)} · ${style(theme, 'error', `${failed} err`)}`,
    theme,
  );
}

function renderSubagentActiveHeader(activeCount: number, width: number, theme?: SidebarTheme): string {
  return panelLine(width, style(theme, 'accent', `[·] ${activeCount} running`), theme, 'accent');
}

function renderSubagentActiveItem(activity: SubagentActivity, width: number, theme?: SidebarTheme): string {
  const elapsed = formatElapsed(activity.elapsedSeconds);
  const elapsedText = elapsed ? ` · ◷ ${elapsed}` : '';
  return panelLine(width, style(theme, 'dim', `  • ${activity.agent}${elapsedText}`), theme);
}

function renderSubagentTerminalItem(activity: SubagentActivity, width: number, theme?: SidebarTheme): string {
  const elapsed = formatElapsed(activity.elapsedSeconds);
  const elapsedText = elapsed ? ` · ◷ ${elapsed}` : '';
  const marker = activity.status === 'failed' ? '✗' : activity.status === 'cancelled' ? '–' : '✓';
  const token = activity.status === 'failed' ? 'error' : activity.status === 'cancelled' ? 'warning' : 'dim';
  return panelLine(width, style(theme, token, `${marker} ${activity.agent}${elapsedText}`), theme, token);
}

function subagentRank(activity: SubagentActivity): number {
  return isActiveSubagent(activity) ? 0 : 1;
}

function renderGitRow(file: GitFileRow, width: number, theme?: SidebarTheme): string {
  const countParts: string[] = [];
  if (file.added !== undefined) countParts.push(`+${file.added}`);
  if (file.deleted !== undefined) countParts.push(`-${file.deleted}`);
  const counts = countParts.join(' ');
  const contentWidth = Math.max(1, width - 3);
  const text = counts && width >= 16 ? fitWithRightSuffix(file.basename, counts, contentWidth) : file.basename;
  const token = file.state === 'created' ? 'success' : file.state === 'deleted' ? 'error' : 'accent';
  return panelLine(width, text, theme, token);
}

export function renderSidebar(model: SidebarModel, width: number, theme?: SidebarTheme): string[] {
  const safeWidth = Math.max(1, width);
  const lines: string[] = [...renderTitle(model.chat, safeWidth, theme)];

  const subagentSection = renderSectionState('Subagents', model.subagents, safeWidth, theme);
  lines.push(...subagentSection);
  if (model.subagents.kind === 'ready') {
    const sorted = [...model.subagents.data.activities].sort((a, b) => {
      const rankDiff = subagentRank(a) - subagentRank(b);
      if (rankDiff !== 0) return rankDiff;
      return Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);
    });
    lines.push(renderSubagentStatusLine(sorted, safeWidth, theme));
    const active = sorted.filter(isActiveSubagent);
    if (active.length > 0) {
      lines.push(renderSubagentActiveHeader(active.length, safeWidth, theme));
      for (const activity of active.slice(0, 5)) lines.push(renderSubagentActiveItem(activity, safeWidth, theme));
      if (active.length > 5) lines.push(panelLine(safeWidth, style(theme, 'dim', `  +${active.length - 5} more`), theme));
    } else if (sorted.length > 0) {
      for (const activity of sorted.slice(0, 5)) lines.push(renderSubagentTerminalItem(activity, safeWidth, theme));
      if (sorted.length > 5) lines.push(panelLine(safeWidth, style(theme, 'dim', `  +${sorted.length - 5} more`), theme));
    } else {
      lines.push(panelLine(safeWidth, 'subagents idle', theme));
    }
  }

  const gitSection = renderSectionState('Git', model.git, safeWidth, theme);
  lines.push(...gitSection);
  if (model.git.kind === 'ready') {
    lines.push(panelLine(safeWidth, `${model.git.data.repositoryLabel} · ${model.git.data.branchLabel}`, theme));
    const files = model.git.data.files;
    for (const file of files.slice(0, DEFAULT_MAX_GIT_FILES)) lines.push(renderGitRow(file, safeWidth, theme));
    if (files.length > DEFAULT_MAX_GIT_FILES) {
      lines.push(panelLine(safeWidth, style(theme, 'dim', `+${files.length - DEFAULT_MAX_GIT_FILES} more files`), theme));
    }
    if (!files.length) lines.push(panelLine(safeWidth, 'No changes', theme));
  }

  lines.push(bottomBorder(safeWidth, theme));

  return lines.map((entry) => line(safeWidth, entry));
}
