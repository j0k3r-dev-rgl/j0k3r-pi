import { safeErrorMetadataDetails } from '../error-metadata.js';
import { appendSubagentResumeGuidance, formatTaskLabel } from './tools/formatting.js';
import { wrapLineToWidth } from './text-width.js';
import { ARCH_ICON, BOX_CHARS, CYAN, LIME, RED, electricBorder, padToWidth, themeAccent, themeBg, themeBold, themeDim, themeError, themeFg, themeStatus, themeSuccess, themeTitle, themeWarning, truncateToWidth, visibleWidth } from '../ui/theme.js';

function formatErrorMetadataLines(task: any): string[] {
  if (!task?.error_metadata) return [];
  const safe = safeErrorMetadataDetails(task.error_metadata as any);
  if (!safe || Object.keys(safe).length === 0) return [];
  const lines: string[] = [];
  lines.push(`- category: ${safe.category ?? 'unknown'}`);
  if (safe.phase) lines.push(`- phase: ${safe.phase}`);
  lines.push(`- retryable: ${safe.retryable ?? false}`);
  if (safe.code && safe.code !== safe.category) lines.push(`- code: ${safe.code}`);
  if (safe.source && typeof safe.source === 'object') {
    const src = safe.source as Record<string, unknown>;
    const srcParts: string[] = [];
    if (typeof src.provider === 'string') srcParts.push(`provider=${src.provider}`);
    if (typeof src.model === 'string') srcParts.push(`model=${src.model}`);
    if (typeof src.tool === 'string') srcParts.push(`tool=${src.tool}`);
    if (typeof src.operation === 'string') srcParts.push(`op=${src.operation}`);
    if (srcParts.length) lines.push(`- source: ${srcParts.join(', ')}`);
  }
  if (safe.partial_result_available) lines.push(`- partial_result_available: true`);
  if (safe.details && Object.keys(safe.details).length > 0) {
    for (const [key, value] of Object.entries(safe.details)) {
      lines.push(`- ${key}: ${value}`);
    }
  }
  return lines;
}

export {
  ARCH_ICON,
  BOX_CHARS,
  CYAN,
  LIME,
  RED,
  electricBorder,
  padToWidth,
  themeAccent,
  themeBg,
  themeBold,
  themeDim,
  themeError,
  themeFg,
  themeStatus,
  themeSuccess,
  themeTitle,
  themeWarning,
  truncateToWidth,
  visibleWidth,
};

export function completionMessage(task: any): string {
  const cwd = task?.cwd ?? process.cwd();
  const label = formatTaskLabel(task);
  const hasResp = typeof task.result === 'string' && task.result.trim().length > 0;
  const content = [
    `Subagent ${label} ${task.status}`,
    `task_id: ${task.id ?? task.task_id ?? 'unknown'}`,
    `Undelivered messages: ${task.undelivered_message_count ?? 0}`,
    '',
    'Read only this final response from the subagent. Do not reread the full execution transcript unless the user explicitly asks for debugging details.',
  ];
  if (hasResp) {
    content.push('', '## response sent to the orchestrator', '', task.result);
  } else if (task.error) {
    content.push('', '## error', '', task.error);
    const errorDetails = formatErrorMetadataLines(task);
    if (errorDetails.length) {
      content.push('', '## error details', ...errorDetails);
    }
  }
  return appendSubagentResumeGuidance(content.join('\n'), [task], cwd);
}

function safeCompletionErrorMetadata(task: any): Record<string, unknown> | undefined {
  if (!task?.error_metadata) return undefined;
  return safeErrorMetadataDetails(task.error_metadata as any);
}

export function sendSubagentCompletionMessage(pi: any, task: any, cwd = task?.cwd): void {
  pi.sendMessage?.({
    customType: 'subagent-completion',
    content: completionMessage({ ...task, cwd }),
    display: true,
    details: {
      full_result: task.result ?? task.error ?? task.output_preview,
      task: {
        id: task.id,
        agent: task.agent,
        status: task.status,
        mode: task.mode,
        effective_mode: task.effective_mode,
        model: task.model,
        effort: task.effort,
        usage: task.usage,
        result: task.result,
        error: task.error,
        undelivered_message_count: task.undelivered_message_count ?? 0,
        error_metadata: safeCompletionErrorMetadata(task),
      },
    },
  }, {
    triggerTurn: true,
    deliverAs: 'followUp',
  });
}

export function renderSubagentCompletionMessage(message: any, options: any, theme: any) {
  const details = message.details ?? {};
  const task = details.task ?? details;
  const status = task.status ?? 'completed';
  const failed = status === 'failed' || status === 'cancelled';
  const expanded = Boolean(options?.expanded);
  const rawResponse = details.full_result ?? task.result;
  const hasResp = typeof rawResponse === 'string' && rawResponse.trim().length > 0;
  const responseText = hasResp ? rawResponse : '';
  const archPrefix = themeFg(theme, 'accent', ARCH_ICON, CYAN);
  const taskLabel = formatTaskLabel(task);
  const titleLabel = themeFg(theme, failed ? 'error' : 'customMessageLabel', `[subagent] ${taskLabel} · ${status}`, failed ? RED : CYAN);
  const title = `${archPrefix} ${titleLabel}`.trim();
  const sections: Array<{ text: string; style?: 'label' | 'status' | 'dim' | 'body' | 'heading' }> = [];
  if (!expanded) {
    sections.push(
      { text: `subagent: ${task.agent ?? 'subagent'} · model: ${task.model ?? 'default/current'} · effort: ${task.effort ?? 'default/current'} · status: ${status}`, style: 'dim' },
      { text: 'ctrl+o to expand', style: 'dim' },
    );
  } else {
    sections.push(
      { text: `subagent: ${task.agent ?? 'subagent'} · model: ${task.model ?? 'default/current'} · effort: ${task.effort ?? 'default/current'} · status: ${status}`, style: 'dim' },
    );
    if (task.attempt) {
      sections.push({ text: `attempt: ${task.attempt}`, style: 'dim' });
    }
    if (hasResp && responseText) {
      sections.push(
        { text: BOX_CHARS.horizontal.repeat(24), style: 'dim' },
        { text: 'response sent to the orchestrator', style: 'heading' },
        ...String(responseText).split('\n').map((line) => ({ text: line, style: 'body' as const })),
      );
    } else if (failed && task.error) {
      sections.push(
        { text: BOX_CHARS.horizontal.repeat(24), style: 'dim' },
        { text: 'error', style: 'heading' },
        ...String(task.error).split('\n').map((line) => ({ text: line, style: 'body' as const })),
      );
      const errorDetails = formatErrorMetadataLines(task);
      if (errorDetails.length) {
        sections.push(
          { text: '', style: 'dim' },
          { text: 'error details', style: 'heading' },
          ...errorDetails.map((line) => ({ text: line, style: 'body' as const })),
        );
      }
    }
  }
  const color = (section: { text: string; style?: 'label' | 'status' | 'dim' | 'body' | 'heading' }, text: string) => {
    if (section.style === 'label') return themeFg(theme, failed ? 'error' : 'customMessageLabel', text, failed ? RED : CYAN);
    if (section.style === 'status') return themeFg(theme, failed ? 'error' : 'success', text, failed ? RED : LIME);
    if (section.style === 'dim') return themeDim(theme, text);
    if (section.style === 'heading') return themeTitle(theme, text);
    if (section.style === 'body') return themeFg(theme, 'customMessageText', text);
    return text;
  };
  return {
    invalidate() {},
    render(width: number) {
      const safeWidth = Math.max(1, Math.floor(width || 1));
      if (safeWidth < 10) {
        return [title, ...sections.flatMap((s) => wrapLineToWidth(s.text, safeWidth))].map((l) => truncateToWidth(l, safeWidth, '…'));
      }
      const innerWidth = safeWidth - 2;
      const contentWidth = Math.max(1, innerWidth - 2);
      const borderFn = (t: string) => themeFg(theme, 'accent', t, CYAN);

      const maxTitleWidth = Math.max(0, innerWidth - 4);
      const clippedTitle = truncateToWidth(title, maxTitleWidth, '…');
      const titleVisWidth = visibleWidth(clippedTitle);
      const filler = Math.max(0, innerWidth - titleVisWidth - 3);
      const top = `${borderFn(BOX_CHARS.topLeft)}${borderFn(BOX_CHARS.horizontal)} ${clippedTitle} ${borderFn(BOX_CHARS.horizontal.repeat(filler))}${borderFn(BOX_CHARS.topRight)}`;
      const middle = sections.flatMap((section) =>
        wrapLineToWidth(section.text, contentWidth).map((line) => {
          const styled = color(section, line);
          const lineVisWidth = visibleWidth(line);
          const rightPadding = ' '.repeat(Math.max(0, contentWidth - lineVisWidth));
          return `${borderFn(BOX_CHARS.vertical)} ${styled}${rightPadding} ${borderFn(BOX_CHARS.vertical)}`;
        }),
      );
      const bottom = `${borderFn(BOX_CHARS.bottomLeft)}${borderFn(BOX_CHARS.horizontal.repeat(innerWidth))}${borderFn(BOX_CHARS.bottomRight)}`;

      return [top, ...middle, bottom];
    },
  };
}
