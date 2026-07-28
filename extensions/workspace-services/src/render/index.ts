import { keyHint } from '@earendil-works/pi-coding-agent';
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
import type { WorkspaceServiceOutcome } from '../types.js';

type RenderTheme = { fg: (name: string, text: string) => string; bold: (text: string) => string };
type RenderComponent = { render(width: number): string[]; invalidate(): void };

function safeKeyHint(id: string, description: string): string {
  try {
    return keyHint(id as any, description);
  } catch {
    return `ctrl+o ${description}`;
  }
}

function linesForOutcome(outcome: WorkspaceServiceOutcome, expanded: boolean): string[] {
  const service = String((outcome.data as any)?.service ?? 'workspace service');
  const header = `${service} · ${outcome.status}`;
  const hint = expanded ? safeKeyHint('app.tools.expand', 'collapse') : safeKeyHint('app.tools.expand', 'expand');
  const summary = outcome.summary;
  if (!expanded) {
    const detail = outcome.truncation?.hasMore ? ` · more available` : '';
    return [header, `${summary}${detail}`, hint];
  }
  const extras: string[] = [];
  const text = typeof (outcome.data as any)?.text === 'string' ? (outcome.data as any).text : undefined;
  if (text) extras.push(...text.split('\n'));
  if (outcome.nextAction) extras.push(`next: ${outcome.nextAction}`);
  if (outcome.truncation) {
    extras.push(`returned=${outcome.truncation.returned} hasMore=${String(outcome.truncation.hasMore)}`);
    if (outcome.truncation.continuation) extras.push(`continue: ${outcome.truncation.continuation}`);
  }
  return [header, hint, '', summary, ...extras];
}

export function renderWorkspaceServiceResult(
  result: { details?: WorkspaceServiceOutcome | any },
  options: { expanded?: boolean; isPartial?: boolean },
  theme: RenderTheme,
): RenderComponent {
  return {
    invalidate() {},
    render(width: number): string[] {
      if (options.isPartial) return [truncateToWidth(theme.fg('warning', 'workspace service · running...'), width)];
      const outcome = result.details as WorkspaceServiceOutcome | undefined;
      if (!outcome) return [truncateToWidth(theme.fg('error', 'workspace service · missing details'), width)];
      const color = outcome.ok ? 'success' : outcome.status === 'trust_required' ? 'warning' : 'error';
      return linesForOutcome(outcome, Boolean(options.expanded)).flatMap((line, index) => {
        const styled = index === 0 ? theme.fg('toolTitle', theme.bold(line)) : index === 1 ? theme.fg(color, line) : theme.fg('toolOutput', line);
        return wrapTextWithAnsi(styled, width).map((wrapped) => visibleWidth(wrapped) > width ? truncateToWidth(wrapped, width) : wrapped);
      });
    },
  };
}
