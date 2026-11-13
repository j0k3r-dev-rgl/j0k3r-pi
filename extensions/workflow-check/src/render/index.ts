import { Text } from '@earendil-works/pi-tui';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

export const renderCall: NonNullable<ToolDefinition['renderCall']> = (args, theme) =>
  new Text(theme.fg('toolTitle', args.action ? 'workflow_record' : 'workflow_check') + ` · ${args.phase ?? args.action ?? '…'} · ${args.change_dir ?? '…'}`, 0, 0);

export const renderResult: NonNullable<ToolDefinition['renderResult']> = (result, { expanded, isPartial }, theme, context) => {
  if (isPartial) return new Text(theme.fg('muted', 'Checking workflow…'), 0, 0);
  const details = result.details as { status?: string; phase?: string; action?: string; contract_count?: number; next_offset?: number } | undefined;
  const text = result.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
  if (expanded) return new Text(text || 'No diagnostic returned.', 0, 0);
  const status = details?.status ?? (context.isError ? 'ERROR' : 'EMPTY');
  const summary = `${status} · ${details?.phase ?? details?.action ?? context.args.phase ?? context.args.action ?? 'workflow'}${details?.contract_count === undefined ? '' : ` · ${details.contract_count} contracts`}${details?.next_offset === undefined ? '' : ' · more diagnostic available'}`;
  return new Text(theme.fg(status === 'PASS' ? 'success' : 'error', summary) + ` (${context.keyHint('app.tools.expand', 'to expand')})`, 0, 0);
};
