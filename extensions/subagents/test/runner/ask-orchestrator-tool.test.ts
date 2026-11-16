import { describe, expect, it } from 'vitest';
import { createAskOrchestratorTool } from '../../src/runner/ask-orchestrator-tool.js';

const plain = (lines: string[]) => lines.join('\n');

describe('ask_orchestrator tool', () => {
  it('returns the orchestrator answer as tool output', async () => {
    const tool = createAskOrchestratorTool(async (question) => `answer to ${question}`);
    const result: any = await tool.execute('call-1', { question: 'port?' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('Orchestrator answer:\nanswer to port?');
  });

  it('reports a failed wait as a tool error instead of throwing', async () => {
    const tool = createAskOrchestratorTool(async () => { throw new Error('task cancelled'); });
    const result: any = await tool.execute('call-1', { question: 'port?' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('task cancelled');
  });

  it('declares the compact presentation contract and renders one unboxed inline row', async () => {
    const tool: any = createAskOrchestratorTool(async (question) => `answer to ${question}`);
    expect(tool.renderShell).toBe('self');
    expect(tool.compactToolRenderingVersion).toBe(1);

    const theme = { fg: (_name: string, text: string) => text };
    const result: any = await tool.execute('call-1', { question: 'Which port should the service bind?' });

    const call = plain(tool.renderCall({ question: 'Which port should the service bind?' }, theme).render(80));
    expect(call).toContain('ask_orchestrator');
    expect(call).toContain('Which port');
    expect(call).not.toMatch(/[╭╮╰╯│┌┐└┘]/);

    const collapsed = tool.renderResult(result, { expanded: false }, theme).render(80);
    expect(plain(collapsed)).toContain('answered');
    expect(plain(collapsed)).not.toContain('answer to Which port');
    expect(plain(collapsed)).not.toMatch(/to expand|app\.tools\.expand|ctrl\+o/i);

    const expanded = plain(tool.renderResult(result, { expanded: true }, theme).render(80));
    expect(expanded).toContain('answer to Which port should the service bind?');

    const waiting = plain(tool.renderResult({}, { isPartial: true }, theme).render(80));
    expect(waiting).toContain('waiting');
  });

  it('keeps a failed wait compact and free of expansion guidance', async () => {
    const tool: any = createAskOrchestratorTool(async () => { throw new Error('task cancelled'); });
    const theme = { fg: (_name: string, text: string) => text };
    const result: any = await tool.execute('call-1', { question: 'port?' });
    const collapsed = plain(tool.renderResult(result, { expanded: false }, theme).render(80));
    expect(collapsed).toContain('no answer');
    expect(collapsed).not.toContain('task cancelled');
    expect(collapsed).not.toMatch(/to expand|ctrl\+o/i);
    expect(plain(tool.renderResult(result, { expanded: true }, theme).render(80))).toContain('task cancelled');
  });
});
