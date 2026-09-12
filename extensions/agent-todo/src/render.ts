import type { AgentTodo, AgentTodoToolResult } from './types.js';

export const RESET = '\x1b[0m';
export const CYAN = '\x1b[1;38;2;0;229;255m';
export const LIME = '\x1b[1;38;2;102;255;102m';
export const RED = '\x1b[1;38;2;255;77;109m';
export const DIM = '\x1b[2m';
export const BOLD = '\x1b[1m';

const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

export function visibleWidth(str: string): number {
  return stripAnsi(str).length;
}

export function truncateWithAnsi(str: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (visibleWidth(str) <= maxWidth) return str;

  let visible = 0;
  let result = '';
  const ansiTokenRegex = /^\x1b\[[0-9;]*[a-zA-Z]/;
  let i = 0;

  while (i < str.length && visible < maxWidth) {
    const match = str.slice(i).match(ansiTokenRegex);
    if (match) {
      result += match[0];
      i += match[0].length;
    } else {
      result += str[i];
      visible++;
      i++;
    }
  }

  result += RESET;
  return result;
}

export function fit(text: string, width: number): string {
  return truncateWithAnsi(text, Math.max(0, width));
}

export function pad(text: string, width: number): string {
  const fitted = fit(text, width);
  const vis = visibleWidth(fitted);
  return fitted + ' '.repeat(Math.max(0, width - vis));
}

export function boxLine(content: string, innerWidth: number, borderColor: string = CYAN): string {
  const innerContentWidth = Math.max(0, innerWidth - 2);
  return `${borderColor}│${RESET} ${pad(content, innerContentWidth)} ${borderColor}│${RESET}`;
}

export function cardTopBorder(
  toolName: string,
  actionOrTarget: string | undefined,
  innerWidth: number,
  borderColor: string = CYAN,
  titleColor: string = borderColor,
): string {
  const cleanAction = actionOrTarget ? actionOrTarget.replace(/[\r\n]+/g, ' ').trim() : undefined;
  let label = cleanAction ? `${toolName} [${cleanAction}]` : toolName;

  const maxTitleWidth = Math.max(4, innerWidth - 4);
  if (visibleWidth(label) + 2 > maxTitleWidth && cleanAction) {
    const maxActionWidth = Math.max(3, maxTitleWidth - visibleWidth(toolName) - 5);
    const truncatedAction = fit(cleanAction, maxActionWidth);
    label = `${toolName} [${truncatedAction}]`;
  }

  let titleText = ` ${label} `;
  if (visibleWidth(titleText) > innerWidth) {
    titleText = ` ${fit(label, Math.max(1, innerWidth - 2))} `;
  }

  const rest = Math.max(0, innerWidth - visibleWidth(titleText));
  const leftDash = Math.min(2, rest);
  const rightDash = Math.max(0, rest - leftDash);
  return `${borderColor}╭${'─'.repeat(leftDash)}${RESET}${titleColor}${titleText}${RESET}${borderColor}${'─'.repeat(rightDash)}╮${RESET}`;
}

export function cardBottomBorder(innerWidth: number, borderColor: string = CYAN): string {
  return `${borderColor}╰${'─'.repeat(Math.max(0, innerWidth))}╯${RESET}`;
}

export function frameContent(
  lines: string[],
  innerWidth: number,
  borderColor: string = CYAN,
): string[] {
  const framed: string[] = [];
  for (const rawLine of lines) {
    const subLines = rawLine.split(/\r?\n/);
    for (const sub of subLines) {
      framed.push(boxLine(sub, innerWidth, borderColor));
    }
  }
  return framed;
}

function progress(todo: AgentTodo): { label: string; completed: number; total: number; open: number } {
  const completed = todo.steps.filter((step) => step.status === 'completed').length;
  const total = todo.steps.length;
  return { label: `${completed}/${total}`, completed, total, open: total - completed };
}

function compactTodoSummary(todo: AgentTodo): string {
  const stats = progress(todo);
  return `${todo.title} · ${stats.label} complete · ${stats.open} open`;
}

function getKeyHint(theme: any, action: 'expand' | 'collapse'): string {
  const key = theme?.keybinding?.('app.tools.expand') ?? 'ctrl+o';
  return `${DIM}${key} ${action}${RESET}`;
}

function getResultBorderColor(details: any, isError?: boolean): string {
  if (isError || details?.ok === false) {
    return RED;
  }
  if (
    details?.action === 'complete_all' ||
    details?.state?.current_todo?.status === 'completed' ||
    details?.state?.active_todo?.status === 'completed'
  ) {
    return LIME;
  }
  return CYAN;
}

export function renderAgentTodoCall(args: any, theme: any, context?: any) {
  return {
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];
      const action = typeof args?.action === 'string' && args.action.trim() ? args.action.trim() : 'show';
      let actionBadge = action;
      if (typeof args?.step_id === 'string' && args.step_id.trim()) {
        actionBadge += ` ${args.step_id.trim()}`;
      } else if (typeof args?.range === 'string' && args.range.trim()) {
        actionBadge += ` ${args.range.trim()}`;
      }

      if (width < 24) {
        return [fit(`agent_todo [${actionBadge}]`, width)];
      }

      const innerWidth = Math.max(0, width - 2);
      const state = context?.state;
      const isError = Boolean(context?.isError);
      const borderColor = state?.borderColor ?? (isError ? RED : CYAN);
      const topBorder = cardTopBorder('agent_todo', actionBadge, innerWidth, borderColor, borderColor);

      if (state?.hasResult) {
        return [topBorder];
      }

      const pendingDetail = typeof args?.title === 'string' && args.title.trim()
        ? `Pending: ${args.title.trim()}`
        : typeof args?.step_id === 'string' && args.step_id.trim()
          ? `Pending: ${args.step_id.trim()}`
          : 'Pending...';

      const pendingLine = `${CYAN}●${RESET} ${pendingDetail}`;

      return [
        topBorder,
        boxLine(pendingLine, innerWidth, borderColor),
        cardBottomBorder(innerWidth, borderColor),
      ];
    },
  };
}

export function renderAgentTodoResult(
  result: AgentTodoToolResult,
  options: { expanded?: boolean; isPartial?: boolean } = {},
  theme: any,
  context?: any,
) {
  const details = result?.details?.agent_todo;
  const isError = Boolean(context?.isError || details?.ok === false);
  const borderColor = getResultBorderColor(details, isError);

  if (context?.state) {
    context.state.hasResult = true;
    context.state.borderColor = borderColor;
  }

  return {
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];
      const isExpanded = options?.expanded === true;
      const keyHint = getKeyHint(theme, isExpanded ? 'collapse' : 'expand');
      const bodyLines: string[] = [];

      if (!details) {
        bodyLines.push(result?.content?.[0]?.text ?? 'agent todo');
      } else if (details.ok === false) {
        const errorMsg = `Error: ${details.error?.message ?? 'agent todo failed'}`;
        bodyLines.push(`${RED}${errorMsg}${RESET}`);
        const active = details.state?.active_todo;
        if (active) {
          bodyLines.push(compactTodoSummary(active));
        }
      } else {
        const active = details.state?.active_todo;
        const current = details.state?.current_todo;

        if (active) {
          if (!isExpanded) {
            bodyLines.push(compactTodoSummary(active));
            bodyLines.push(keyHint);
          } else {
            bodyLines.push(`${BOLD}${active.title}${RESET} ${DIM}[${active.status}]${RESET}`);
            for (const step of active.steps) {
              if (step.status === 'completed') {
                bodyLines.push(`  ${LIME}✓${RESET} ${step.text}`);
              } else {
                bodyLines.push(`  ${CYAN}○${RESET} ${step.text}`);
              }
            }
            bodyLines.push(keyHint);
          }
        } else if (current?.status === 'completed') {
          const stats = progress(current);
          if (!isExpanded) {
            bodyLines.push(`${LIME}completed${RESET} · ${current.title} · ${stats.label} complete`);
            bodyLines.push(keyHint);
          } else {
            bodyLines.push(`${BOLD}${current.title}${RESET} ${DIM}[completed]${RESET}`);
            for (const step of current.steps) {
              bodyLines.push(`  ${LIME}✓${RESET} ${step.text}`);
            }
            bodyLines.push(keyHint);
          }
        } else if (current?.status === 'cleared') {
          bodyLines.push(`${DIM}cleared${RESET} · ${current.title}`);
        } else {
          bodyLines.push(result?.content?.[0]?.text ?? 'No active agent todo.');
        }
      }

      if (width < 24) {
        return bodyLines.map((line) => fit(stripAnsi(line), width));
      }

      const innerWidth = Math.max(0, width - 2);
      const framed = frameContent(bodyLines, innerWidth, borderColor);
      const bottomBorder = cardBottomBorder(innerWidth, borderColor);
      return [...framed, bottomBorder];
    },
  };
}
