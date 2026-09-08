import type { AgentTodo, AgentTodoProjection, AgentTodoStep } from './types.js';

export type AgentTodoWidgetOptions = {
  collapsed?: boolean;
  shortcut?: string;
};

const RESET = '\u001b[0m';
const DIM = '\u001b[2m';
const STRIKE = '\u001b[9m';
const FG_CYAN = '\u001b[36m';
const FG_GREEN = '\u001b[32m';
const FG_YELLOW = '\u001b[33m';
const FG_MUTED = '\u001b[90m';
const FG_TEXT = '\u001b[37m';

const TASKS_PER_COLUMN = 5;
const COLUMN_GAP = '   ';

function color(code: string, text: string): string {
  return `${code}${text}${RESET}`;
}

function dim(text: string): string {
  return `${DIM}${text}\u001b[22m`;
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

function padVisible(text: string, width: number): string {
  return `${text}${' '.repeat(Math.max(0, width - visibleLength(text)))}`;
}

function progress(todo: AgentTodo): { completed: number; total: number; open: number } {
  const completed = todo.steps.filter((step) => step.status === 'completed').length;
  const total = todo.steps.length;
  return { completed, total, open: total - completed };
}

function titleLine(todo: AgentTodo): string {
  return color(FG_CYAN, `----- agent-todo ${todo.title} -----`);
}

export function renderAgentTodoStepLine(step: AgentTodoStep, index: number): string {
  const done = step.status === 'completed';
  const marker = done ? color(FG_GREEN, '✓') : color(FG_YELLOW, '○');
  const number = color(done ? FG_GREEN : FG_CYAN, `${index + 1}.`);
  const text = done ? `${FG_MUTED}${STRIKE}${step.text}${RESET}` : color(FG_TEXT, step.text);
  return `${marker} ${number} ${text}`;
}

function chunkSteps(steps: AgentTodoStep[]): AgentTodoStep[][] {
  const chunks: AgentTodoStep[][] = [];
  for (let index = 0; index < steps.length; index += TASKS_PER_COLUMN) {
    chunks.push(steps.slice(index, index + TASKS_PER_COLUMN));
  }
  return chunks;
}

function renderStepColumns(todo: AgentTodo): string[] {
  const columns = chunkSteps(todo.steps).map((steps, columnIndex) => {
    const offset = columnIndex * TASKS_PER_COLUMN;
    const lines = steps.map((step, stepIndex) => renderAgentTodoStepLine(step, offset + stepIndex));
    const width = Math.max(...lines.map(visibleLength), 0);
    return { lines, width };
  });

  const rows = Math.max(...columns.map((column) => column.lines.length), 0);
  const output: string[] = [];
  for (let row = 0; row < rows; row++) {
    output.push(columns.map((column) => padVisible(column.lines[row] ?? '', column.width)).join(COLUMN_GAP).trimEnd());
  }
  return output;
}

export function renderAgentTodoWidgetLines(todo: AgentTodo, options: AgentTodoWidgetOptions = {}): string[] {
  const { completed, total, open } = progress(todo);
  const shortcut = options.shortcut?.trim();

  if (options.collapsed) {
    return [
      `${titleLine(todo)} ${color(FG_GREEN, `${completed}/${total}`)} complete ${color(open === 0 ? FG_GREEN : FG_YELLOW, `${open} open`)}`,
      shortcut ? dim(`${shortcut} to expand`) : dim('expand to show steps'),
    ];
  }

  const lines = [
    titleLine(todo),
    `${color(FG_GREEN, `${completed}/${total}`)} complete ${color(open === 0 ? FG_GREEN : FG_YELLOW, `${open} open`)}`,
    ...renderStepColumns(todo),
  ];
  if (shortcut) lines.push(dim(`${shortcut} to collapse`));
  return lines;
}

export function syncAgentTodoWidget(ctx: any, projection: AgentTodoProjection, options: AgentTodoWidgetOptions = {}): void {
  if (typeof ctx?.ui?.setWidget !== 'function') return;
  if (!projection.active_todo) {
    ctx.ui.setWidget('agent-todo', undefined);
    return;
  }
  ctx.ui.setWidget('agent-todo', renderAgentTodoWidgetLines(projection.active_todo, options));
}
