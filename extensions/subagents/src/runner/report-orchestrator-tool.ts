import { Type } from 'typebox';
import { Text } from '@earendil-works/pi-tui';

export const REPORT_ORCHESTRATOR_TOOL = 'report_orchestrator';
export const REPORT_ORCHESTRATOR_GUIDELINE =
  'report_orchestrator: when the parent requests a progress report, send a concise factual summary of current work, completed steps, checks, and next step, then continue the assigned task. '
  + 'This is informational only; do not wait for an answer or finish the task because you reported. '
  + 'No periodic reporting or polling is required. For a blocking fact/decision use ask_orchestrator when available instead. Never include credentials or unrelated private data.';

/** Injected into the owning background child only; no caller-chosen task/session identity. */
export function createReportOrchestratorTool(send: (report: string) => void) {
  return {
    name: REPORT_ORCHESTRATOR_TOOL,
    label: 'Report Orchestrator',
    description: 'Send a requested informational progress report to the parent orchestrator and continue working. Returns a delivery acknowledgement without waiting for a parent response. Not a question, final result, or permission request. Maximum 16 KiB UTF-8.',
    parameters: Type.Object({ report: Type.String({ minLength: 1, maxLength: 16384, description: 'Concise factual progress report. Exclude secrets; continue the assigned task after sending.' }) }, { additionalProperties: false }),
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
    renderCall(_args: any, theme: any) {
      return new Text(theme.fg('toolTitle', 'report_orchestrator'), 0, 0);
    },
    renderResult(result: any, { expanded, isPartial }: any, theme: any, context: any) {
      if (isPartial) return new Text(theme.fg('muted', 'Sending report…'), 0, 0);
      const text = result.content?.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n') || 'No delivery acknowledgement.';
      if (expanded) return new Text(text, 0, 0);
      return new Text(theme.fg(result.details?.sent ? 'success' : 'error', result.details?.sent ? 'Report sent · continuing' : 'Report not delivered') + ` (${context.keyHint('app.tools.expand', 'to expand')})`, 0, 0);
    },
  };
}
