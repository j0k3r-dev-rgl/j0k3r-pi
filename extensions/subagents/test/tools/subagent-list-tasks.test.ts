import { describe, expect, it } from 'vitest';
import { SubagentManager } from '../../src/manager.js';
import { registerSubagentTools } from '../../src/tools.js';
import { installSubagentTestEnv } from '../helpers/subagent-test-helpers.js';

const env = installSubagentTestEnv();

describe('subagent_list_tasks tool', () => {
  it('lists only current-session subagent tasks by default', async () => {
    env.writeAgent('analyst');
    const manager = new SubagentManager(async ({ task }) => ({ result: `handled ${task}`, model: 'mock/model', fallback_used: false }));
    let runTool: any;
    let listTool: any;
    registerSubagentTools({ registerTool: (tool: any) => {
      if (tool.name === 'subagent_run') runTool = tool;
      if (tool.name === 'subagent_list_tasks') listTool = tool;
    } }, manager);

    await runTool.execute('1', { agent: 'analyst', task: 'current session task', mode: 'task' }, undefined, undefined, { cwd: env.tmp, sessionId: 'session-current' });
    await runTool.execute('2', { agent: 'analyst', task: 'other session task', mode: 'task' }, undefined, undefined, { cwd: env.tmp, sessionId: 'session-other' });

    const result = await listTool.execute('3', {}, undefined, undefined, { cwd: env.tmp, sessionId: 'session-current' });
    expect(result.content[0].text).toContain('Listed 1 subagent task');
    expect(result.content[0].text).toContain('current session');
    expect(result.details.tasks.map((task: any) => task.task)).toEqual(['current session task']);
    expect(JSON.stringify(result)).not.toContain('other session task');
  });

  it('lists subagent tasks as a short collapsed summary with expandable details', async () => {
    env.writeAgent('analyst');
    const rawResponse = 'list task raw final response to=functions.memory_get '.repeat(8);
    const manager = new SubagentManager(async () => ({ result: rawResponse, model: 'mock/model', fallback_used: false }));
    let runTool: any;
    let listTool: any;
    registerSubagentTools({ registerTool: (tool: any) => {
      if (tool.name === 'subagent_run') runTool = tool;
      if (tool.name === 'subagent_list_tasks') listTool = tool;
    } }, manager);

    await runTool.execute('1', { agent: 'analyst', task: 'list compactly', mode: 'task' }, undefined, undefined, { cwd: env.tmp });
    const result = await listTool.execute('2', {}, undefined, undefined, { cwd: env.tmp });

    expect(result.content[0].text).toContain('Listed 1 subagent task');
    expect(result.content[0].text).toContain('ctrl+o to expand');
    expect(result.content[0].text).not.toContain('preview:');
    expect(result.content[0].text).not.toContain('to=functions.memory_get');
    expect(result.details.tasks[0].result).toBeUndefined();

    const collapsed = listTool.renderResult(result, { expanded: false }, { fg: (_name: string, text: string) => text }).render(120).join('\n');
    expect(collapsed).toContain('subagent tasks · 1 listed');
    expect(collapsed).toContain('most recent: analyst · list compactly · status: completed');
    expect(collapsed).toContain('ctrl+o to expand');
    expect(collapsed).not.toContain('to=functions.memory_get');
    expect(collapsed).not.toContain('id: subtask_');

    const expanded = listTool.renderResult(result, { expanded: true }, { fg: (_name: string, text: string) => text }).render(160).join('\n');
    expect(expanded).toContain('subagent: analyst');
    expect(expanded).toContain('preview: collapsed');
    expect(expanded).not.toContain('to=functions.memory_get');
  });
});
