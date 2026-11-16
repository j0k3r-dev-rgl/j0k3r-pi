import { safeErrorMetadataDetails } from '../error-metadata.js';
import { appendSubagentResumeGuidance, formatTaskLabel, formatUsage } from './tools/formatting.js';
import { needsWidth2MarginOmission, wrapLineToWidth } from './text-width.js';
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
    `attempt: ${task.attempt ?? 1}`,
    `model: ${task.model ?? 'unresolved'} · effort: ${task.effort ?? 'unresolved'}`,
    ...(task.nested_session_path ? [`executor: ${task.nested_session_path}`] : []),
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
        display_name: task.display_name,
        attempt: task.attempt,
        cwd,
        status: task.status,
        mode: task.mode,
        effective_mode: task.effective_mode,
        model: task.model,
        effort: task.effort,
        nested_session_path: task.nested_session_path,
        usage: task.usage,
        result: task.result,
        error: task.error,
        undelivered_message_count: task.undelivered_message_count ?? 0,
        error_metadata: safeCompletionErrorMetadata(task),
      },
    },
  }, {
    // steer: delivered after the parent's current tool batch instead of waiting
    // for the whole run to settle; when idle, triggerTurn starts a turn directly.
    triggerTurn: true,
    deliverAs: 'steer',
  });
}

export function sendSubagentQuestionMessage(pi: any, task: any, question: string): void {
  const label = formatTaskLabel(task);
  pi.sendMessage?.({
    customType: 'subagent-question',
    content: [
      `Subagent ${label} is waiting on ask_orchestrator`,
      `task_id: ${task.id}`,
      '',
      '## question',
      '',
      question,
      '',
      'Answer with subagent_run action=message, this task_id, and the answer in task. The subagent resumes in the same session.',
      'Answer facts, context, and already-approved decisions yourself. If it needs a product, scope, architecture, or design decision the user has not made, ask the user first and then relay the answer.',
    ].join('\n'),
    display: true,
    details: { task_id: task.id, agent: task.agent, question },
  }, {
    triggerTurn: true,
    deliverAs: 'steer',
  });
}

function fallbackMessageContent(message: any): string {
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.content)) {
    return message.content
      .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join('\n');
  }
  return '';
}

function fitToWidth(text: string, width: number, ellipsis = '…'): string {
  if (width <= 0) return '';
  if (visibleWidth(text) <= width) return text;
  const clipped = truncateToWidth(text, width, width <= 2 ? '' : ellipsis);
  return visibleWidth(clipped) <= width ? clipped : truncateToWidth(clipped, width, '');
}

export function renderSubagentCompletionMessage(message: any, options: any, theme: any) {
  const details = (message?.details && typeof message.details === 'object') ? message.details : {};
  const hasExplicitTask = Boolean(
    (details.task && typeof details.task === 'object')
    || typeof details.full_result === 'string'
    || typeof details.result === 'string'
    || typeof details.error === 'string',
  );
  const task = (details.task && typeof details.task === 'object') ? details.task : details;
  const status = typeof task.status === 'string' && task.status.trim() ? task.status : 'completed';
  const failed = status === 'failed' || status === 'cancelled' || status === 'interrupted';
  const expanded = Boolean(options?.expanded);
  const rawResponse = task.result ?? (task.error ? undefined : details.full_result);
  const hasResp = typeof rawResponse === 'string' && rawResponse.trim().length > 0;
  const responseText = hasResp ? rawResponse : '';
  const fallbackText = !hasExplicitTask ? fallbackMessageContent(message).trim() : '';

  const archPrefix = themeFg(theme, 'accent', ARCH_ICON, CYAN);
  const taskLabel = formatTaskLabel(task);
  const titleLabel = themeFg(theme, failed ? 'error' : 'customMessageLabel', `[subagent] ${taskLabel} · ${status}`, failed ? RED : CYAN);
  const metaParts = [
    ...(task.model ? [`model: ${task.model}`] : []),
    ...(task.effort ? [`effort: ${task.effort}`] : []),
    ...(task.attempt && task.attempt > 1 ? [`attempt: ${task.attempt}`] : []),
  ];
  const metaSuffix = metaParts.length ? ` ${themeDim(theme, `─ ${metaParts.join(' · ')}`)}` : '';
  const header = `${archPrefix} ${titleLabel}${metaSuffix}`.trim();

  const bodyEntries: Array<{ text: string; style: 'dim' | 'body' | 'heading' }> = [];
  if (expanded) {
    if (task.agent && task.display_name && String(task.display_name).trim() !== String(task.agent).trim()) {
      bodyEntries.push({ text: `agent: ${task.agent}`, style: 'dim' });
    }
    const usage = task.usage ? formatUsage(task) : '';
    if (usage) {
      bodyEntries.push({ text: `usage: ${usage}`, style: 'dim' });
    }
    if (hasResp && responseText) {
      bodyEntries.push(
        { text: '__DIVIDER__', style: 'dim' },
        { text: 'response sent to the orchestrator', style: 'heading' },
        ...String(responseText).replace(/\r/g, '').split('\n').map((line) => ({ text: line, style: 'body' as const })),
      );
    } else if (failed && task.error) {
      bodyEntries.push(
        { text: '__DIVIDER__', style: 'dim' },
        { text: 'error', style: 'heading' },
        ...String(task.error).replace(/\r/g, '').split('\n').map((line) => ({ text: line, style: 'body' as const })),
      );
      const errorDetails = formatErrorMetadataLines(task);
      if (errorDetails.length) {
        bodyEntries.push(
          { text: '', style: 'dim' },
          { text: 'error details', style: 'heading' },
          ...errorDetails.map((line) => ({ text: line, style: 'body' as const })),
        );
      }
    } else if (fallbackText) {
      bodyEntries.push(
        { text: '__DIVIDER__', style: 'dim' },
        ...fallbackText.replace(/\r/g, '').split('\n').map((line) => ({ text: line, style: 'body' as const })),
      );
    }
  }

  const styleLine = (style: 'dim' | 'body' | 'heading', text: string) => {
    if (text === '') return '';
    if (style === 'dim') return themeDim(theme, text);
    if (style === 'heading') return themeTitle(theme, text);
    if (style === 'body') return themeFg(theme, 'customMessageText', text);
    return text;
  };

  return {
    invalidate() {},
    render(width: number): string[] {
      const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      if (safeWidth <= 0) return [];
      if (safeWidth === 1) return [' '];

      const innerWidth = safeWidth - 1;
      const headerLine = ` ${fitToWidth(header, innerWidth)}`;
      if (!expanded) return [headerLine];

      const lines = [headerLine];
      for (const entry of bodyEntries) {
        if (entry.text === '__DIVIDER__') {
          lines.push(` ${styleLine('dim', BOX_CHARS.horizontal.repeat(Math.min(24, innerWidth)))}`);
          continue;
        }
        if (entry.text === '') {
          lines.push(' ');
          continue;
        }
        for (const wrapped of wrapLineToWidth(entry.text, innerWidth, safeWidth)) {
          if (needsWidth2MarginOmission(wrapped, safeWidth)) {
            lines.push(styleLine(entry.style, wrapped));
            continue;
          }
          const fitted = visibleWidth(wrapped) <= innerWidth ? wrapped : truncateToWidth(wrapped, innerWidth, '');
          lines.push(` ${styleLine(entry.style, fitted)}`);
        }
      }
      return lines;
    },
  };
}
