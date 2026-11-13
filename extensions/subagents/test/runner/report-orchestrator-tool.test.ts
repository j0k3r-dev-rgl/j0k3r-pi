import { describe, expect, it, vi } from 'vitest';
import { createReportOrchestratorTool } from '../../src/runner/report-orchestrator-tool.js';

describe('report_orchestrator tool', () => {
  it('acknowledges transport without waiting for any parent answer', async () => {
    const send = vi.fn();
    const tool = createReportOrchestratorTool(send);
    const result = await tool.execute('report', { report: '  Tests in progress.  ' });
    expect(send).toHaveBeenCalledWith('Tests in progress.');
    expect(result.details).toEqual({ sent: true });
    expect(result.content[0].text).toContain('Continue');
    expect(result).not.toHaveProperty('terminate');
  });

  it('bounds UTF-8 reports, preserves cancellation, and reports delivery failures honestly', async () => {
    const send = vi.fn();
    const tool = createReportOrchestratorTool(send);
    for (const report of ['', ' ', '🙂'.repeat(5000)]) {
      await expect(tool.execute('report', { report })).rejects.toThrow(/UTF-8 bytes/);
    }
    const controller = new AbortController();
    controller.abort();
    await expect(tool.execute('report', { report: 'cancelled' }, controller.signal)).rejects.toHaveProperty('name', 'AbortError');
    expect(send).not.toHaveBeenCalled();
    const failed = await createReportOrchestratorTool(() => { throw new Error('internal transport detail'); }).execute('report', { report: 'progress' });
    expect(failed.isError).toBe(true);
    expect(failed.details).toEqual({ sent: false });
    expect(failed.content[0].text).not.toContain('internal transport detail');
  });

  it('supports native collapsed/expanded, partial and failed tool results', async () => {
    const tool = createReportOrchestratorTool(() => {});
    const result = await tool.execute('report', { report: 'progress' });
    const theme = { fg: (_name: string, text: string) => text };
    const keyHint = vi.fn(() => 'configured key to expand');
    expect(tool.renderResult(result, { expanded: false }, theme, { keyHint }).render(80).join('\n')).toContain('Report sent');
    expect(keyHint).toHaveBeenCalledWith('app.tools.expand', 'to expand');
    expect(tool.renderResult(result, { expanded: true }, theme, { keyHint }).render(80).join('\n')).toContain('Continue');
    expect(tool.renderResult({}, { isPartial: true }, theme, { keyHint }).render(80).join('\n')).toContain('Sending');
    expect(tool.renderResult({ details: { sent: false } }, {}, theme, { keyHint }).render(80).join('\n')).toContain('not delivered');
  });
});
