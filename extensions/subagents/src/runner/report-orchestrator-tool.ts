import { Type } from 'typebox';
import { emptyComponent, inlineComponent } from '../render/tools/components.js';

export const REPORT_ORCHESTRATOR_TOOL = 'report_orchestrator';
export const REPORT_ORCHESTRATOR_GUIDELINE =
  'report_orchestrator: when the parent requests a progress report, send a concise factual summary of current work, completed steps, checks, and next step, then continue the assigned task. '
  + 'This is informational only; do not wait for an answer or finish the task because you reported. '
  + 'No periodic reporting or polling is required. For a blocking fact/decision use ask_orchestrator when available instead. Never include credentials or unrelated private data.';

const SEPARATOR = ' ─ ';

function themeFg(theme: any, key: string, text: string): string {
  try {
    return typeof theme?.fg === 'function' ? theme.fg(key, text) : text;
  } catch {
    return text;
  }
}

function reportSummary(args: any): string {
  const report = typeof args?.report === 'string' ? args.report.replace(/\s+/g, ' ').trim() : '';
  return report.length > 80 ? `${report.slice(0, 79)}…` : report;
}

/** Compact inline row for the injected child tool; no frame, background or expansion instruction. */
function renderReportCall(args: any, theme: any, context?: any) {
  try {
    if (context?.state?.hasResult) return emptyComponent();
    const summary = reportSummary(args);
    const header = [
      themeFg(theme, 'toolTitle', REPORT_ORCHESTRATOR_TOOL),
      themeFg(theme, 'muted', 'reporting'),
      summary ? themeFg(theme, 'muted', summary) : undefined,
    ].filter(Boolean).join(SEPARATOR);
    return inlineComponent({ header, body: [], expanded: false, state: context?.state, isCallSlot: true });
  } catch {
    return inlineComponent({ header: `${REPORT_ORCHESTRATOR_TOOL}${SEPARATOR}reporting`, body: [], expanded: false, state: context?.state, isCallSlot: true });
  }
}

function renderReportResult(result: any, options: any, theme: any, context?: any) {
  if (context?.state && typeof context.state === 'object') context.state.hasResult = true;
  try {
    const expanded = options?.expanded === true;
    const isPartial = Boolean(options?.isPartial);
    const delivered = Boolean(result?.details?.sent) && !result?.isError;
    const state = isPartial ? 'sending' : delivered ? 'sent' : 'not delivered';
    const header = [
      themeFg(theme, 'toolTitle', REPORT_ORCHESTRATOR_TOOL),
      themeFg(theme, isPartial ? 'muted' : delivered ? 'success' : 'error', state),
    ].filter(Boolean).join(SEPARATOR);
    const text = (result?.content ?? []).filter((part: any) => part?.type === 'text').map((part: any) => part.text).join('\n');
    return inlineComponent({ header, body: text ? text.split('\n') : [], expanded });
  } catch {
    const text = (result?.content ?? []).filter((part: any) => part?.type === 'text').map((part: any) => part.text).join('\n');
    return inlineComponent({
      header: `${REPORT_ORCHESTRATOR_TOOL}${SEPARATOR}${result?.details?.sent ? 'sent' : 'not delivered'}`,
      body: text ? text.split('\n') : [],
      expanded: options?.expanded === true,
    });
  }
}

/** Injected into the owning background child only; no caller-chosen task/session identity. */
export function createReportOrchestratorTool(send: (report: string) => void) {
  return {
    name: REPORT_ORCHESTRATOR_TOOL,
    label: 'Report Orchestrator',
    description: 'Send a requested informational progress report to the parent orchestrator and continue working. Returns a delivery acknowledgement without waiting for a parent response. Not a question, final result, or permission request. Maximum 16 KiB UTF-8.',
    parameters: Type.Object({ report: Type.String({ minLength: 1, maxLength: 16384, description: 'Concise factual progress report. Exclude secrets; continue the assigned task after sending.' }) }, { additionalProperties: false }),
    renderShell: 'self',
    compactToolRenderingVersion: 1,
    compactLeftMargin: 1,
    async execute(_id: string, params: { report?: unknown }, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const report = typeof params?.report === 'string' ? params.report.trim() : '';
      if (!report || Buffer.byteLength(report, 'utf8') > 16 * 1024) throw new Error('Report must contain 1–16384 UTF-8 bytes.');
      try {
        send(report);
        return { content: [{ type: 'text', text: 'Report sent to the parent session. Continue the assigned work without waiting for a reply; this is not the final result.' }], details: { sent: true } };
      } catch {
        signal?.throwIfAborted();
        return { content: [{ type: 'text', text: 'Report could not be delivered to the owning parent session. No answer is pending; continue only within existing task authority.' }], details: { sent: false }, isError: true };
      }
    },
    renderCall: renderReportCall,
    renderResult: renderReportResult,
  };
}
