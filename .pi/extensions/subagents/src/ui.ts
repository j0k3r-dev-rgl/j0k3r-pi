import type { SubagentTask, UsageStats } from './types.js';

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

function formatUsage(usage?: UsageStats): string {
  if (!usage) return '';
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? 's' : ''}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  return parts.join(' ');
}

export class SubagentsHistoryPanel {
  private selected = 0;
  private scroll = 0;
  private followTail = true;

  constructor(
    private tasksProvider: SubagentTask[] | (() => SubagentTask[]),
    private theme: any,
    private done: () => void,
    private matchesKey: (data: string, key: string) => boolean,
    private visibleWidth: (text: string) => number,
    private truncateToWidth: (text: string, width: number) => string,
  ) {}

  invalidate(): void {}

  handleInput(data: string): void {
    const tasks = this.tasks();
    if (this.matchesKey(data, 'escape') || this.matchesKey(data, 'ctrl+c') || this.matchesKey(data, 'q')) {
      this.done();
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
      this.followTail = false;
    }
    if (this.matchesKey(data, 'up')) {
      this.scroll = Math.max(0, this.scroll - 1);
      this.followTail = false;
    }
    if (this.matchesKey(data, 'pageDown')) {
      this.scroll += 12;
      this.followTail = false;
    }
    if (this.matchesKey(data, 'pageUp')) {
      this.scroll = Math.max(0, this.scroll - 12);
      this.followTail = false;
    }
    if (this.matchesKey(data, 'home')) {
      this.scroll = 0;
      this.followTail = false;
    }
    if (this.matchesKey(data, 'end')) this.followTail = true;
  }

  render(width: number): string[] {
    const w = Math.max(40, width);
    const bodyWidth = w;
    // Pi custom components currently receive width but not terminal height. Emit enough
    // lines for the overlay to occupy a full-height terminal; the overlay clips to 100%.
    const maxLines = 120;
    const th = this.theme;
    const accent = (s: string) => th?.fg?.('accent', s) ?? s;
    const dim = (s: string) => th?.fg?.('dim', s) ?? s;
    const warn = (s: string) => th?.fg?.('warning', s) ?? s;
    const ok = (s: string) => th?.fg?.('success', s) ?? s;
    const err = (s: string) => th?.fg?.('error', s) ?? s;
    const title = (s: string) => th?.fg?.('toolTitle', th?.bold?.(s) ?? s) ?? s;
    const line = (s = '') => this.truncateToWidth(s, bodyWidth);
    const divider = dim('─'.repeat(bodyWidth));
    const status = (task: SubagentTask) => task.status === 'completed' ? ok(task.status) : task.status === 'failed' ? err(task.status) : task.status === 'cancelled' ? warn(task.status) : accent(task.status);

    const lines: string[] = [];
    lines.push(line(`${title('subagents')} ${dim('session execution flow')} ${dim('· ←/→ executions · ↑/↓ scroll · pgup/pgdn · esc/q close')}`));
    lines.push(divider);

    const tasks = this.tasks();
    if (this.selected >= tasks.length) this.selected = Math.max(0, tasks.length - 1);

    if (!tasks.length) {
      lines.push(line(dim('No subagent tasks recorded in this session yet.')));
      while (lines.length < maxLines) lines.push('');
      return lines;
    }

    const task = tasks[this.selected]!;
    const usage = formatUsage(task.usage);
    lines.push(line(`${accent(`${this.selected + 1}/${tasks.length}`)}  ${dim('agent:')} ${accent(task.agent)}  ${dim('status:')} ${status(task)}  ${dim('effort:')} ${accent(task.effort ?? 'default/current')}`));
    lines.push(line(`${dim('model:')} ${task.model ?? 'default/current'}  ${dim('id:')} ${task.id}  ${dim('duration:')} ${fmtDuration(task)}`));
    if (usage) lines.push(line(`${dim('usage:')} ${usage}`));
    lines.push(line(`${dim('last:')} ${task.last_activity ?? 'n/a'} ${dim(task.last_activity_at ?? '')}`));
    lines.push(line(`${dim('task:')} ${clip(task.task, bodyWidth - 6)}`));
    lines.push(this.taskStrip(bodyWidth));
    lines.push(divider);

    const transcript = this.executionFlowFor(task);
    const wrapped = this.wrap(transcript, bodyWidth);
    const bodyHeight = Math.max(5, maxLines - lines.length - 2);
    const maxScroll = Math.max(0, wrapped.length - bodyHeight);
    if (this.followTail && (task.status === 'running' || task.status === 'queued')) this.scroll = maxScroll;
    if (this.scroll > maxScroll) this.scroll = maxScroll;
    const visible = wrapped.slice(this.scroll, this.scroll + bodyHeight);
    for (const raw of visible) lines.push(this.renderFlowLine(raw, bodyWidth));

    while (lines.length < maxLines - 1) lines.push('');
    const position = wrapped.length > bodyHeight ? ` ${this.scroll + 1}-${Math.min(wrapped.length, this.scroll + bodyHeight)}/${wrapped.length}` : '';
    lines.push(line(`${dim('─'.repeat(Math.max(0, bodyWidth - position.length)))}${dim(position)}`));
    return lines;
  }

  private taskStrip(width: number): string {
    const tasks = this.tasks();
    const max = Math.max(1, Math.min(tasks.length, 8));
    const start = Math.min(Math.max(0, this.selected - Math.floor(max / 2)), Math.max(0, tasks.length - max));
    const chips: string[] = [];
    for (let i = start; i < Math.min(tasks.length, start + max); i++) {
      const task = tasks[i]!;
      const label = `${i === this.selected ? '●' : '○'} ${task.agent}:${task.status}${task.effort ? ` effort:${task.effort}` : ''}`;
      chips.push(i === this.selected ? (this.theme?.fg?.('accent', label) ?? label) : (this.theme?.fg?.('dim', label) ?? label));
    }
    return this.truncateToWidth(chips.join('  '), width);
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
      const padded = this.padToWidth(raw, width);
      return th?.bg?.('toolPendingBg', th?.fg?.('toolTitle', padded) ?? padded) ?? padded;
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
      const clipped = this.truncateToWidth(raw, width);
      const text = th?.bold?.(clipped) ?? clipped;
      return th?.fg?.('mdHeading', text) ?? text;
    }
    if (raw.startsWith('  ')) {
      const clipped = this.truncateToWidth(raw, width);
      return th?.fg?.('dim', clipped) ?? clipped;
    }
    return this.truncateToWidth(raw, width);
  }

  private executionFlowFor(task: SubagentTask): string {
    const usage = formatUsage(task.usage);
    const parts = [
      `agent: ${task.agent} · status: ${task.status} · effort: ${task.effort ?? 'default/current'}`,
      `model: ${task.model ?? 'default/current'}${usage ? ` · usage: ${usage}` : ''}`,
      '',
      `Preparing for response`,
      '',
      task.prompt ? ['# delegated task', this.extractPromptTail(task.prompt)].join('\n') : ['# delegated task', task.task].join('\n'),
      task.context ? ['', '# context', task.context].join('\n') : undefined,
      usage ? ['', '# usage', usage].join('\n') : undefined,
      task.transcript ? ['', '# execution', this.cleanTranscript(task.transcript)].join('\n') : undefined,
      task.error ? ['', '# error', task.error].join('\n') : undefined,
      task.result ? ['', '# response sent to orchestrator', task.result].join('\n') : undefined,
      !task.transcript && !task.result && !task.error ? ['', '# activity', `${task.last_activity ?? 'queued'}${task.output_preview ? `\n${task.output_preview}` : ''}`].join('\n') : undefined,
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
    const clipped = this.truncateToWidth(text, width);
    return `${clipped}${' '.repeat(Math.max(0, width - this.visibleWidth(clipped)))}`;
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
