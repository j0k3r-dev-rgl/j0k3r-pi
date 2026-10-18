import { describe, expect, it } from 'vitest';
import { createAskOrchestratorTool } from '../../src/runner/ask-orchestrator-tool.js';

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
});
