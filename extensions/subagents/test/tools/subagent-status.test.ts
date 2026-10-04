import { describe, expect, it } from 'vitest';
import { SubagentStructuredError, normalizeErrorMetadata } from '../../src/error-metadata.js';
import { SubagentManager } from '../../src/manager.js';
import { registerSubagentTools } from '../../src/tools.js';
import { installSubagentTestEnv } from '../helpers/subagent-test-helpers.js';

const env = installSubagentTestEnv();

describe('subagent_status tool', () => {
  it('exposes only safe structured error summaries while preserving legacy error text', async () => {
    env.writeAgent('analyst');
    const manager = new SubagentManager(async () => {
      throw new SubagentStructuredError(normalizeErrorMetadata({
        category: 'provider_api_error',
        message: 'Authorization: Bearer sk-fake-secret-token fake.user@example.com /tmp/fake-private.txt',
        partial_result_available: false,
        details: {
          provider_code: '429',
          auth_header: 'Authorization: Bearer sk-fake-secret-token',
          prompt: 'SYSTEM: hidden prompt body',
          file_path: '/tmp/fake-private.txt',
          nested_payload: JSON.stringify({ transcript: 'SECRET_FILE_BODY_DO_NOT_SHOW' }),
        },
        last_activity: 'USER: hidden prompt body /tmp/fake-private.txt',
      }));
    });
    let runTool: any;
    let statusTool: any;
    registerSubagentTools({ registerTool: (tool: any) => {
      if (tool.name === 'subagent_run') runTool = tool;
      if (tool.name === 'subagent_status') statusTool = tool;
    } }, manager);

    const runResult = await runTool.execute('1', { agent: 'analyst', task: 'structured failure', mode: 'task' }, undefined, undefined, { cwd: env.tmp });
    const taskId = runResult.details.results[0].id;
    const statusResult = await statusTool.execute('2', { task_id: taskId }, undefined, undefined, { cwd: env.tmp });

    expect(runResult.isError).toBe(true);
    expect(statusResult.details.task.error).toBe('provider api error');
    expect(statusResult.details.task.error_metadata).toMatchObject({
      version: 1,
      category: 'provider_api_error',
      retryable: true,
      code: 'provider_api_error',
      partial_result_available: false,
      details: { provider_code: '429' },
    });
    expect(statusResult.details.task.error_metadata.message).toBeUndefined();
    expect(statusResult.details.task.error_metadata.last_activity).toBeUndefined();
    expect(statusResult.details.task.error_metadata.usage_at_failure).toBeUndefined();
    expect(statusResult.details.task.error_metadata.task_id).toBeUndefined();
    expect(statusResult.details.task.error_metadata.parent_session_id).toBeUndefined();
    expect(statusResult.details.task.error_metadata.attempts).toBeUndefined();
    expect(statusResult.details.task.error_metadata.cause).toBeUndefined();
    const serialized = JSON.stringify(statusResult.details.task.error_metadata);
    expect(serialized).not.toContain('sk-fake-secret-token');
    expect(serialized).not.toContain('fake.user@example.com');
    expect(serialized).not.toContain('/tmp/fake-private.txt');
    expect(serialized).not.toContain('hidden prompt body');
    expect(serialized).not.toContain('SECRET_FILE_BODY_DO_NOT_SHOW');
  });

  it('fails closed when compact tool details encounter malformed error metadata payloads', async () => {
    const circular: any = { category: 'provider_api_error', message: 'unsafe raw payload' };
    circular.details = { circular };
    const task: any = {
      id: 'subtask_malformed_tool_error_metadata',
      agent: 'analyst',
      mode: 'task',
      status: 'failed',
      task: 'broken metadata',
      created_at: new Date().toISOString(),
      error: 'provider api error',
      error_metadata: circular,
    };
    const manager: any = { getTask: () => task };
    let statusTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_status') statusTool = tool; } }, manager);

    const statusResult = await statusTool.execute('1', { task_id: task.id }, undefined, undefined, { cwd: env.tmp });

    expect(() => JSON.stringify(statusResult)).not.toThrow();
    expect(statusResult.details.task.error).toBe('provider api error');
    expect(statusResult.details.task.error_metadata).toMatchObject({ category: 'serialization_failure', version: 1 });
  });

  it('renders subagent_status with boxed layout in collapsed and expanded states', async () => {
    const task: any = {
      id: 'subtask_status_render',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      attempt: 1,
      model: 'openai/gpt-5.4',
      effort: 'high',
      task: 'analyze report',
      result: 'analysis completed cleanly',
      usage: { turns: 2, input: 1200, output: 300, cost: 0.05 },
    };
    const manager: any = { getTask: () => task };
    let statusTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_status') statusTool = tool; } }, manager);

    expect(statusTool.renderShell).toBe('self');
    expect(statusTool.renderCall({}, {}).render(80)).toHaveLength(0);

    const result = await statusTool.execute('1', { task_id: task.id }, undefined, undefined, { cwd: env.tmp });
    const theme = { fg: (_n: string, t: string) => t, bold: (t: string) => t };

    const collapsed = statusTool.renderResult(result, { expanded: false }, theme).render(80);
    expect(collapsed[0]).toContain('┌─');
    expect(collapsed[0]).toContain('󰣇');
    expect(collapsed[0]).toContain('subagent status · analyst · analyze report · completed');
    expect(collapsed.join('\n')).toContain('subagent: analyst');
    expect(collapsed.join('\n')).toContain('ctrl+o to expand');
    expect(collapsed.join('\n')).not.toContain('analysis completed cleanly');

    const expanded = statusTool.renderResult(result, { expanded: true }, theme).render(80);
    expect(expanded[0]).toContain('┌─');
    expect(expanded[0]).toContain('󰣇');
    expect(expanded.join('\n')).toContain('Subagent response');
    expect(expanded.join('\n')).toContain('analysis completed cleanly');
    expect(expanded.join('\n')).toContain('usage:');
  });
});
