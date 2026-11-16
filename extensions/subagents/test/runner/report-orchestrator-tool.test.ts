import { describe, expect, it, vi } from 'vitest';
import { createReportOrchestratorTool } from '../../src/runner/report-orchestrator-tool.js';
import { visibleWidth } from '../../src/render/text-width.js';

const plain = (lines: string[]) => lines.join('\n');

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

  it('declares the compact presentation contract and renders one unboxed inline row', async () => {
    const tool: any = createReportOrchestratorTool(() => {});
    expect(tool.renderShell).toBe('self');
    expect(tool.compactToolRenderingVersion).toBe(1);

    const theme = { fg: (_name: string, text: string) => text };
    const result = await tool.execute('report', { report: 'progress' });

    const collapsed = plain(tool.renderResult(result, { expanded: false }, theme).render(80));
    expect(collapsed).toContain('report_orchestrator');
    expect(collapsed).toContain('sent');
    expect(collapsed).not.toContain('Continue working');
    expect(collapsed).not.toMatch(/[╭╮╰╯│┌┐└┘]/);
    expect(collapsed).not.toMatch(/to expand|app\.tools\.expand|ctrl\+o/i);

    const expanded = plain(tool.renderResult(result, { expanded: true }, theme).render(80));
    expect(expanded).toContain('Continue');

    const partial = plain(tool.renderResult({}, { isPartial: true }, theme).render(80));
    expect(partial).toContain('sending');

    const failed = plain(tool.renderResult({ details: { sent: false } }, {}, theme).render(80));
    expect(failed).toContain('not delivered');

    const call = plain(tool.renderCall({ report: 'progress summary' }, theme).render(80));
    expect(call).toContain('report_orchestrator');
    expect(call).toContain('progress summary');
    expect(call).not.toMatch(/[╭╮╰╯│┌┐└┘]/);
  });

  it('never emits expansion guidance in either state and stays width safe', async () => {
    const tool: any = createReportOrchestratorTool(() => {});
    const theme = { fg: (_name: string, text: string) => text };
    const result = await tool.execute('report', { report: 'progress' });
    for (const expanded of [false, true]) {
      for (const width of [0, 1, 2, 10, 23, 24, 80]) {
        const lines = tool.renderResult(result, { expanded }, theme).render(width);
        const joined = plain(lines);
        expect(joined).not.toMatch(/to expand|ctrl\+o/i);
        if (width <= 0) expect(lines).toEqual([]);
        for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(Math.max(0, width));
      }
    }
  });
});
