import { homedir } from 'node:os';
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

export const compactToolRenderingVersion = 1 as const;
export const compactLeftMargin = 1 as const;
export const renderShell = 'self' as const;

function fg(theme: any, color: string, text: string): string {
  try {
    return typeof theme?.fg === 'function' ? theme.fg(color, text) : text;
  } catch {
    return text;
  }
}

function inlineText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function abbreviateHome(value: string): string {
  const home = homedir();
  if (!home || !value) return value;
  if (value === home) return '~';
  if (value.startsWith(`${home}/`) || value.startsWith(`${home}\\`)) {
    return `~${value.slice(home.length)}`;
  }
  return value;
}

function fitLine(text: string, width: number): string {
  if (width <= 0) return '';
  return truncateToWidth(text, width, width >= 4 ? '…' : '');
}

function wrapLines(text: string, width: number): string[] {
  if (width <= 0) return [];
  const out: string[] = [];
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const normalized = rawLine.replace(/\t/g, '   ');
    if (normalized.length === 0) {
      out.push('');
      continue;
    }
    const wrapped = wrapTextWithAnsi(normalized, width);
    for (const piece of wrapped) {
      out.push(visibleWidth(piece) > width ? truncateToWidth(piece, width, '') : piece);
    }
  }
  return out;
}

function buildCallLabel(toolName: string | undefined, args: any, theme: any): string {
  const name = toolName ?? (args?.action ? 'workflow_record' : 'workflow_check');
  const target = inlineText(args?.phase ?? args?.action ?? '');
  const dir = typeof args?.change_dir === 'string' && args.change_dir.trim()
    ? inlineText(abbreviateHome(args.change_dir.trim()))
    : '';
  const parts = [fg(theme, 'toolTitle', name)];
  if (target) parts.push(fg(theme, 'muted', `[${target}]`));
  if (dir) parts.push(fg(theme, 'dim', dir));
  return parts.join(' ');
}

export function createWorkflowRenderCall(toolName?: string): NonNullable<ToolDefinition['renderCall']> {
  return (args, theme, context) => ({
    compactLeftMargin: 1 as const,
    invalidate() {},
    render(width: number): string[] {
      const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      try {
        if (safeWidth <= 0) return [];
        if (context?.state?.hasResult) return [];
        if (safeWidth === 1) return [' '];
        const innerWidth = safeWidth - 1;
        const header = `${buildCallLabel(toolName, args, theme)} ${fg(theme, 'dim', '───')} ${fg(theme, 'muted', 'pending…')}`;
        return [` ${fitLine(header, innerWidth)}`];
      } catch {
        if (safeWidth <= 0) return [];
        return safeWidth === 1 ? [' '] : [` ${fitLine(toolName ?? 'workflow_check', safeWidth - 1)}`];
      }
    },
  } as any);
}

export function createWorkflowRenderResult(toolName?: string): NonNullable<ToolDefinition['renderResult']> {
  return (result, { expanded, isPartial } = { expanded: false, isPartial: false }, theme, context) => {
    try {
      if (context?.state) {
        context.state.hasResult = true;
      }
    } catch {
      // Ignore malformed context
    }

    return {
      compactLeftMargin: 1 as const,
      invalidate() {},
      render(width: number): string[] {
        const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
        try {
          if (safeWidth <= 0) return [];
          if (safeWidth === 1) return [' '];
          const innerWidth = safeWidth - 1;
          const args = context?.args ?? {};
          const label = buildCallLabel(toolName, args, theme);
          const sep = fg(theme, 'dim', '───');

          if (isPartial) {
            return [` ${fitLine(`${label} ${sep} ${fg(theme, 'muted', 'Checking workflow…')}`, innerWidth)}`];
          }

          const details = result?.details as { status?: string; phase?: string; action?: string; contract_count?: number; next_offset?: number } | undefined;
          const blocks = Array.isArray(result?.content) ? result.content : [];
          const text = blocks
            .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
            .map((block: any) => block.text as string)
            .join('\n');

          const status = details?.status ?? (context?.isError || (result as any)?.isError ? 'ERROR' : 'EMPTY');
          const op = details?.phase ?? details?.action ?? args?.phase ?? args?.action ?? 'workflow';
          const contracts = details?.contract_count === undefined ? '' : ` · ${details.contract_count} contracts`;
          const more = details?.next_offset === undefined ? '' : ' · more diagnostic available';
          const summaryText = `${status} · ${op}${contracts}${more}`;
          const color = status === 'PASS' || status === 'RECORDED' ? 'success' : 'error';
          const header = ` ${fitLine(`${label} ${sep} ${fg(theme, color, summaryText)}`, innerWidth)}`;

          if (!expanded) {
            return [header];
          }

          return [header, ...wrapLines(text || 'No diagnostic returned.', innerWidth).map((line) => ` ${line}`)];
        } catch {
          if (safeWidth <= 0) return [];
          return safeWidth === 1 ? [' '] : [` ${fitLine(toolName ?? 'workflow_check', safeWidth - 1)}`];
        }
      },
    } as any;
  };
}

export const renderCall: NonNullable<ToolDefinition['renderCall']> = createWorkflowRenderCall();
export const renderResult: NonNullable<ToolDefinition['renderResult']> = createWorkflowRenderResult();

export function createWorkflowToolPresentation(toolName: 'workflow_check' | 'workflow_record') {
  return {
    compactToolRenderingVersion,
    compactLeftMargin,
    renderShell,
    renderCall: createWorkflowRenderCall(toolName),
    renderResult: createWorkflowRenderResult(toolName),
  };
}
