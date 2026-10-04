import { describe, expect, it } from 'vitest';
import { SubagentStructuredError, normalizeErrorMetadata } from '../../src/error-metadata.js';
import { SubagentManager } from '../../src/manager.js';
import { registerSubagentTools } from '../../src/tools.js';
import { installSubagentTestEnv } from '../helpers/subagent-test-helpers.js';

const env = installSubagentTestEnv();

describe('subagent_result tool', () => {
  it('returns subagent_result with full content for the orchestrator and collapsed/expanded user render', async () => {
    env.writeAgent('analyst');
    const rawResponse = 'very long subagent final response with tool-looking text to=functions.memory_get '.repeat(8);
    const manager = new SubagentManager(async () => ({ result: rawResponse, model: 'mock/model', fallback_used: false }));
    let runTool: any;
    let resultTool: any;
    registerSubagentTools({ registerTool: (tool: any) => {
      if (tool.name === 'subagent_run') runTool = tool;
      if (tool.name === 'subagent_result') resultTool = tool;
    } }, manager);

    const runResult = await runTool.execute('1', { agent: 'analyst', task: 'compact result', mode: 'task' }, undefined, undefined, { cwd: env.tmp });
    const taskId = runResult.details.task_ids?.[0] ?? runResult.details.results?.[0]?.id ?? manager.listTasks(env.tmp)[0]?.id;
    const result = await resultTool.execute('2', { task_id: taskId }, undefined, undefined, { cwd: env.tmp });

    expect(resultTool.renderShell).toBe('self');
    expect(result.content[0].text).toBe(rawResponse);
    expect(result.details.task.result).toBe(rawResponse);

    const collapsed = resultTool.renderResult(result, { expanded: false, isPartial: false }, { fg: (_name: string, text: string) => text }).render(80).join('\n');
    expect(collapsed).toContain('subagent: analyst');
    expect(collapsed).toContain('ctrl+o to expand');
    expect(collapsed).not.toContain('to=functions.memory_get');
    expect(collapsed).not.toContain('id: subtask_');

    const expanded = resultTool.renderResult(result, { expanded: true, isPartial: false }, { fg: (_name: string, text: string) => text }).render(120).join('\n');
    expect(expanded).toContain('Subagent response');
    expect(expanded).toContain('to=functions.memory_get');
  });

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
    let resultTool: any;
    registerSubagentTools({ registerTool: (tool: any) => {
      if (tool.name === 'subagent_run') runTool = tool;
      if (tool.name === 'subagent_result') resultTool = tool;
    } }, manager);

    const runResult = await runTool.execute('1', { agent: 'analyst', task: 'structured failure', mode: 'task' }, undefined, undefined, { cwd: env.tmp });
    const taskId = runResult.details.results[0].id;
    const result = await resultTool.execute('2', { task_id: taskId }, undefined, undefined, { cwd: env.tmp });

    expect(result.content[0].text).toBe('provider api error');
    expect(result.details.task.error).toBe('provider api error');
    expect(result.details.task.error_metadata).toMatchObject({
      version: 1,
      category: 'provider_api_error',
      retryable: true,
      code: 'provider_api_error',
      partial_result_available: false,
      details: { provider_code: '429' },
    });
    const serialized = JSON.stringify(result.details.task.error_metadata);
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
    let resultTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_result') resultTool = tool; } }, manager);

    const result = await resultTool.execute('1', { task_id: task.id }, undefined, undefined, { cwd: env.tmp });

    expect(() => JSON.stringify(result)).not.toThrow();
    expect(result.details.task.error).toBe('provider api error');
    expect(result.details.task.error_metadata).toMatchObject({ category: 'serialization_failure', version: 1 });
  });
});
