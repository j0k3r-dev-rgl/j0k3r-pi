import { describe, expect, it } from 'vitest';
import { SubagentManager } from '../../src/manager.js';
import { registerSubagentTools } from '../../src/tools.js';
import { installSubagentTestEnv } from '../helpers/subagent-test-helpers.js';

const env = installSubagentTestEnv();

describe('subagent_cancel tool', () => {
  it('cancels a delegated task without continuation guidance when continuation is disabled', async () => {
    env.writeAgent('analyst');
    const manager = new SubagentManager(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { result: 'late result', model: 'mock/model', fallback_used: false };
    });
    let runTool: any;
    let cancelTool: any;
    registerSubagentTools({ registerTool: (tool: any) => {
      if (tool.name === 'subagent_run') runTool = tool;
      if (tool.name === 'subagent_cancel') cancelTool = tool;
    } }, manager);

    const launched = await runTool.execute('1', { agent: 'analyst', task: 'cancel me', mode: 'background' }, undefined, undefined, { cwd: env.tmp });
    const taskId = launched.details.task_ids[0];
    const cancelled = await cancelTool.execute('2', { task_id: taskId }, undefined, undefined, { cwd: env.tmp });

    expect(cancelTool.renderShell).toBe('self');
    expect(cancelTool.renderCall({ task_id: taskId }, { fg: (_name: string, text: string) => text }).render(120)).toEqual([]);
    expect(cancelled.content[0].text).toContain('cancelled');
    expect(cancelled.content[0].text).toContain(`task_id: ${taskId}`);
    expect(cancelled.content[0].text).not.toContain('subagent_continue');
    expect(cancelled.content[0].text).not.toContain('Ask the user before resuming');
    expect(cancelled.details.task).toMatchObject({ id: taskId, status: 'stopping', task: 'cancel me' });
    const rendered = env.stripAnsi(cancelTool.renderResult(cancelled, { expanded: false }, { fg: (_name: string, text: string) => text, bold: (text: string) => text }).render(120).join('\n'));
    expect(rendered).toContain('subagent cancel');
    expect(rendered).toContain('subagent: analyst');
    expect(rendered).toContain('status: stopping');
    expect(rendered).toContain('ctrl+o to expand');
    expect(rendered).not.toContain(taskId);
    expect(rendered).not.toContain('task_id:');
  });

  it('cancels a delegated task and returns compact task details', async () => {
    env.writeAgent('analyst');
    await import('node:fs').then((fs) => fs.writeFileSync(`${env.tmp}/.pi/subagents.json`, JSON.stringify({ enable_continue: true })));
    const manager = new SubagentManager(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { result: 'late result', model: 'mock/model', fallback_used: false };
    });
    let runTool: any;
    let cancelTool: any;
    registerSubagentTools({ registerTool: (tool: any) => {
      if (tool.name === 'subagent_run') runTool = tool;
      if (tool.name === 'subagent_cancel') cancelTool = tool;
    } }, manager);

    const launched = await runTool.execute('1', { agent: 'analyst', task: 'cancel me', mode: 'background' }, undefined, undefined, { cwd: env.tmp });
    const taskId = launched.details.task_ids[0];
    const cancelled = await cancelTool.execute('2', { task_id: taskId }, undefined, undefined, { cwd: env.tmp });

    expect(cancelled.content[0].text).toContain('cancelled');
    expect(cancelled.content[0].text).toContain('can be resumed with `subagent_continue`');
    expect(cancelled.content[0].text).toContain('Ask the user before resuming');
    expect(cancelled.content[0].text).toContain('model and effort');
    expect(cancelled.details.task).toMatchObject({ id: taskId, status: 'stopping', task: 'cancel me' });
  });

  it('returns an error result when the task does not exist', async () => {
    const manager = new SubagentManager(env.mockRunner());
    let cancelTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_cancel') cancelTool = tool; } }, manager);

    const result = await cancelTool.execute('1', { task_id: 'missing-task' }, undefined, undefined, { cwd: env.tmp });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('missing-task');
  });
});
