import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import extension, { ClaudeBackgroundWidget, ClaudeBackgroundWidgetState, completionMessage, createSubagentsPanelKeyMatcher, moveClaudeBackgroundWidgetSelection, renderClaudeBackgroundWidgetLines, resolveRegisteredToolDefinition, sendSubagentCompletionMessage } from '../index.js';
import { loadSubagents, parseFrontmatter, readSubagentsConfig, subagentSourceWarnings } from '../src/config.js';
import { resolveEffectiveSubagentProfile } from '../src/profile-resolver.js';
import { buildPrompt, ThreadSnapshotBuilder } from '../src/runner.js';
import { SubagentStructuredError, deriveErrorString, normalizeErrorMetadata, parseErrorMetadata, safeErrorMetadataDetails, serializeErrorMetadata } from '../src/error-metadata.js';
import { resolveSubagentHistoryDbPath, resolveSubagentsHistoryHome, SubagentHistoryStore } from '../src/history.js';
import { isSubagentsDebugEnabled, writeSubagentsDebugLog } from '../src/debug.js';
import { createSubagentsRenderLogger, DEFAULT_RENDER_DEBUG_LOG_PATH } from '../src/render-debug.js';
import { SubagentManager } from '../src/manager.js';
import { registerSubagentTools } from '../src/tools.js';
import { SubagentsHistoryPanel } from '../src/ui.js';
import { boundThreadSnapshot, isValidThreadSnapshot, registerSubagentRuntimeToolDefinition, renderThreadBody, resetPiComponentCacheForTests } from '../src/thread-view.js';
import type { EffectiveSubagentProfile, SubagentErrorMetadata, SubagentModelProfiles, SubagentRunner, SubagentTask, SubagentTaskAllocationEvent } from '../src/types.js';

const require = createRequire(import.meta.url);

let tmp: string;
let oldAgentDir: string | undefined;
let oldHistoryDbPath: string | undefined;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagents-test-'));
  oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  oldHistoryDbPath = process.env.PI_SUBAGENTS_HISTORY_DB_PATH;
  process.env.PI_CODING_AGENT_DIR = path.join(tmp, 'isolated-agent');
  process.env.PI_SUBAGENTS_HISTORY_DB_PATH = path.join(tmp, 'global-agent', 'subagents-history.sqlite');
  fs.mkdirSync(path.join(tmp, '.pi', 'subagents'), { recursive: true });
});
afterEach(() => {
  if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  if (oldHistoryDbPath === undefined) delete process.env.PI_SUBAGENTS_HISTORY_DB_PATH;
  else process.env.PI_SUBAGENTS_HISTORY_DB_PATH = oldHistoryDbPath;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeAgent(name: string, body = '# Agent\nhello') {
  fs.writeFileSync(path.join(tmp, '.pi', 'subagents', `${name}.md`), `---\nname: ${name}\ndescription: ${name} agent\ntools:\n  - read\n  - memory_search\n---\n${body}`);
}

function mockRunner(delay = 0): SubagentRunner {
  return async ({ definition, task }) => {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    return { result: `${definition.name} handled ${task}`, model: 'mock/model', fallback_used: false };
  };
}

function statusSnapshot(text: string) {
  return { version: 1 as const, source: 'events' as const, items: [{ type: 'status' as const, text }] };
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '').replace(/\u001b\][^\u001b]*(?:\u001b\\|\u0007)/g, '');
}

function renderText(snapshot: unknown, overrides: Partial<Parameters<typeof renderThreadBody>[1]> = {}): string {
  const context = {
    cwd: tmp,
    visibleWidth: (text: string) => stripAnsi(text).length,
    truncateToWidth: (text: string, width: number) => text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text,
    ...overrides,
  };
  return stripAnsi(renderThreadBody(snapshot, context).join('\n')).replace(/\s+/g, ' ').trim();
}

function withAgentDir<T>(agentDir: string, run: () => T): T {
  const old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    return run();
  } finally {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = old;
  }
}

function readJsonl(file: string): any[] {
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

describe('manager and history integration', () => {
  it('runs one subagent as task and exposes the active effort', async () => {
    writeAgent('analyst');
    const manager = new SubagentManager(mockRunner());
    const result = await manager.run({ agent: 'analyst', task: 'check scope', mode: 'task' }, { cwd: tmp, pi: { getThinkingLevel: () => 'high' } });
    expect(result.results?.[0].status).toBe('completed');
    expect(result.results?.[0].result).toContain('analyst handled check scope');
    expect(result.results?.[0].effort).toBe('high');
  });

  it('resolves task metadata before running and passes the same effective profile to the runner', async () => {
    writeAgent('analyst');
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({
      model_profiles: { analyst: { model: 'profile/model', effort: 'xhigh' } },
    }));
    const seenUpdates: SubagentTask[][] = [];
    let runnerProfile: EffectiveSubagentProfile | undefined;
    const runner: SubagentRunner = async ({ effectiveProfile }) => {
      runnerProfile = effectiveProfile;
      return { result: 'profiled result', model: effectiveProfile?.model.label.replace(/^(?:profile|orchestrator): /, ''), effort: effectiveProfile?.effort.value, fallback_used: false };
    };
    const manager = new SubagentManager(runner);

    const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    let result!: Awaited<ReturnType<SubagentManager['run']>>;
    try {
      result = await manager.run(
        { agent: 'analyst', task: 'profiled work', mode: 'task' },
        { cwd: tmp, model: { provider: 'orchestrator', id: 'model' }, thinkingLevel: 'low' },
        undefined,
        (tasks) => seenUpdates.push(tasks.map((task) => ({ ...task }))),
      );
    } finally {
      if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
    }

    const queued = seenUpdates.flat().find((task) => task.status === 'queued');
    expect(queued).toMatchObject({ model: undefined, effort: 'low', model_source: 'unresolved', effort_source: 'orchestrator' });
    expect(runnerProfile).toMatchObject({
      agent: 'analyst',
      model: { value: { provider: 'orchestrator', id: 'model' }, source: 'orchestrator', label: 'orchestrator: orchestrator/model' },
      effort: { value: 'low', source: 'orchestrator', label: 'orchestrator: low' },
    });
    expect(result.results?.[0]).toMatchObject({ model: 'orchestrator/model', effort: 'low', model_source: 'orchestrator', effort_source: 'orchestrator' });
  });

  it('runs multiple subagents in one task call', async () => {
    writeAgent('analyst');
    writeAgent('reviewer');
    const manager = new SubagentManager(mockRunner());
    const result = await manager.run({ agents: ['analyst', 'reviewer'], task: 'review plan', mode: 'task' }, { cwd: tmp });
    expect(result.task_ids.length).toBe(2);
    expect(result.results?.map((r) => r.agent).sort()).toEqual(['analyst', 'reviewer']);
  });

  it('resolves explicit, definition, config, and built-in mode defaults and waits only effective task members', async () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ default_mode: 'background' }));
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'analyst.md'), `---\nname: analyst\ndescription: analyst agent\nsubagent_mode: task\ntools:\n  - read\n---\n# Agent`);
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'reviewer.md'), `---\nname: reviewer\ndescription: reviewer agent\ntools:\n  - read\n---\n# Agent`);

    const releaseReviewer = vi.fn<() => void>();
    const runner: SubagentRunner = async ({ definition }) => {
      if (definition.name === 'reviewer') {
        return await new Promise((resolve) => {
          releaseReviewer.mockImplementationOnce(() => resolve({ result: 'reviewer handled review plan', model: 'mock/model', fallback_used: false }));
        });
      }
      return { result: 'analyst handled review plan', model: 'mock/model', fallback_used: false };
    };
    const manager = new SubagentManager(runner);

    const result = await manager.run({ agents: ['analyst', 'reviewer'], task: 'review plan' }, { cwd: tmp });

    expect(result.mode).toBe('mixed');
    expect(result.waited_task_ids).toEqual([result.results?.find((task) => task.agent === 'analyst')?.id]);
    expect(result.background_task_ids).toEqual([result.results?.find((task) => task.agent === 'reviewer')?.id]);
    expect(result.results?.map((task) => ({ agent: task.agent, mode: task.mode, effective_mode: task.effective_mode, status: task.status }))).toEqual([
      { agent: 'analyst', mode: 'task', effective_mode: 'task', status: 'completed' },
      { agent: 'reviewer', mode: 'background', effective_mode: 'background', status: 'running' },
    ]);
    expect(manager.getTask(result.background_task_ids[0]!)?.status).toBe('running');

    releaseReviewer();
    await vi.waitFor(() => expect(manager.getTask(result.background_task_ids[0]!)?.status).toBe('completed'));
  });

  it('loads subagent markdown definitions only once per multi-agent run', async () => {
    writeAgent('a');
    writeAgent('b');
    writeAgent('c');
    const readSpy = vi.spyOn(fs, 'readFileSync');
    const manager = new SubagentManager(mockRunner());

    await manager.run({ agents: ['a', 'b', 'c'], task: 'single discovery pass', mode: 'task' }, { cwd: tmp });

    const markdownReads = readSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((file) => file.startsWith(path.join(tmp, '.pi', 'subagents')) && file.endsWith('.md'));
    expect(markdownReads).toHaveLength(3);
    readSpy.mockRestore();
  });

  it('enforces configured max concurrency within one run and across concurrent runs', async () => {
    writeAgent('a');
    writeAgent('b');
    writeAgent('c');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ max_concurrency: 1 }));
    let running = 0;
    let maxRunning = 0;
    const runner: SubagentRunner = async ({ definition }) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
      return { result: `${definition.name} done`, model: 'mock/model', fallback_used: false };
    };
    const manager = new SubagentManager(runner);
    await Promise.all([
      manager.run({ agents: ['a', 'b'], task: 'limited one', mode: 'task' }, { cwd: tmp }),
      manager.run({ agent: 'c', task: 'limited two', mode: 'task' }, { cwd: tmp }),
    ]);
    expect(maxRunning).toBe(1);
  });

  it('derives manager error text compatibly and enriches structured failure metadata eagerly', async () => {
    writeAgent('analyst');
    const runner: SubagentRunner = async ({ onActivity }) => {
      onActivity?.({
        message: 'streaming response',
        output: 'partial answer before failure',
        usage: { input: 10, output: 4, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 14, turns: 1 },
      });
      throw new SubagentStructuredError(normalizeErrorMetadata({
        category: 'provider_rate_limit',
        message: 'provider said rate limit exceeded',
        retryable: true,
        phase: 'runner_invoke',
        partial_result_available: false,
      }));
    };
    const manager = new SubagentManager(runner);

    const result = await manager.run({ agent: 'analyst', task: 'structured failure', mode: 'task' }, { cwd: tmp, sessionId: 'parent-session-123' });

    expect(result.results?.[0].status).toBe('failed');
    expect(result.results?.[0].error).toBe('provider rate limit');
    expect(result.results?.[0].error_metadata).toMatchObject({
      version: 1,
      category: 'provider_rate_limit',
      retryable: true,
      usage_at_failure: { input: 10, output: 4, contextTokens: 14, turns: 1 },
      last_activity: 'streaming response',
      partial_result_available: true,
      parent_session_id: 'parent-session-123',
    });
    expect(result.results?.[0].error_metadata?.task_id).toBe(result.results?.[0].id);
    expect(result.results?.[0].error_metadata?.message).toBe('provider said rate limit exceeded');
  });

  it('classifies manager total timeout ownership compatibly and preserves structured metadata', async () => {
    writeAgent('analyst');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ timeout_ms: 20 }));
    const runner: SubagentRunner = async ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('cleanup complete after timeout')), { once: true });
    });
    const manager = new SubagentManager(runner);
    const result = await manager.run({ agent: 'analyst', task: 'timeout', mode: 'task' }, { cwd: tmp, sessionId: 'timeout-parent' });

    expect(result.results?.[0].status).toBe('failed');
    expect(result.results?.[0].error).toBe('timed out after 20ms');
    expect(result.results?.[0].error_metadata).toMatchObject({
      version: 1,
      category: 'total_timeout',
      phase: 'manager',
      retryable: false,
      partial_result_available: false,
      parent_session_id: 'timeout-parent',
      details: { timeout_ms: '20' },
    });
  });

  it('waits for timed-out runner cleanup before continuing the same task id', async () => {
    writeAgent('analyst');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ enable_continue: true, timeout_ms: 20 }));
    const nestedSessionPath = path.join(tmp, 'timeout-session.jsonl');
    fs.writeFileSync(nestedSessionPath, '{"type":"session"}\n');
    let allowCleanup = false;
    let cleanupFinished = false;
    let reopenedBeforeCleanup = false;
    const runner = vi.fn<SubagentRunner>(async ({ continuation, signal, onActivity }) => {
      if (continuation) {
        reopenedBeforeCleanup = !cleanupFinished;
        return {
          result: 'continued after timeout cleanup',
          model: 'mock/model',
          fallback_used: false,
          nested_session_path: nestedSessionPath,
        } as any;
      }
      onActivity?.({ message: 'nested session ready', nested_session_path: nestedSessionPath } as any);
      return await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const waitForCleanup = () => {
            if (!allowCleanup) return setTimeout(waitForCleanup, 5);
            cleanupFinished = true;
            reject(new Error('Subagent was aborted'));
          };
          waitForCleanup();
        }, { once: true });
      });
    });
    const manager = new SubagentManager(runner);

    const initial = await manager.run({ agent: 'analyst', task: 'timeout continuation', mode: 'background' }, { cwd: tmp });
    const taskId = initial.task_ids[0]!;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(manager.getTask(taskId)?.status).toBe('stopping');

    const continuePromise = manager.continueTask({ task_id: taskId, prompt: 'Resume after timeout.' }, { cwd: tmp });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runner).toHaveBeenCalledTimes(1);
    allowCleanup = true;

    await continuePromise;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(reopenedBeforeCleanup).toBe(false);
    expect(manager.getTask(taskId)).toMatchObject({
      id: taskId,
      status: 'completed',
      attempt: 2,
      result: 'continued after timeout cleanup',
    });
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('rejects disabled direct continuation attempts with a generic non-resume error', async () => {
    writeAgent('analyst');
    const nestedSessionPath = path.join(tmp, 'disabled-continue-session.jsonl');
    fs.writeFileSync(nestedSessionPath, '{"type":"session"}\n');
    const manager = new SubagentManager(async ({ continuation, nested_session_path, onActivity }) => {
      onActivity?.({ message: 'nested session ready', nested_session_path: nestedSessionPath } as any);
      return {
        result: continuation ? `continued: ${continuation.prompt}` : 'initial result',
        model: 'mock/model',
        fallback_used: false,
        nested_session_path: nested_session_path ?? nestedSessionPath,
      } as any;
    });

    const first = await manager.run({ agent: 'analyst', task: 'initial task', mode: 'task' }, { cwd: tmp });
    const error = await manager.continueTask({ task_id: first.task_ids[0]!, prompt: 'Resume anyway.' }, { cwd: tmp }).then(
      () => undefined,
      (value) => value,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Subagent task is not available.');
    expect(error.message.toLowerCase()).not.toContain('resume');
    expect(error.message).not.toContain('subagent_continue');
    expect(manager.getTask(first.task_ids[0]!, tmp)).toMatchObject({ attempt: 1, status: 'completed', result: 'initial result' });
  });

  it('resolves continuation mode from explicit override, previous effective mode, and config fallback', async () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ enable_continue: true, default_mode: 'background' }));
    writeAgent('analyst');
    const nestedSessionPath = path.join(tmp, 'continue-effective-mode-session.jsonl');
    fs.writeFileSync(nestedSessionPath, '{"type":"session"}\n');
    let releaseBackgroundContinuation: (() => void) | undefined;
    const manager = new SubagentManager(async ({ continuation, nested_session_path, onActivity }) => {
      onActivity?.({ message: 'nested session ready', nested_session_path: nestedSessionPath } as any);
      if (!continuation) return { result: 'initial result', model: 'mock/model', fallback_used: false, nested_session_path: nested_session_path ?? nestedSessionPath } as any;
      if (continuation.prompt === 'resume in background') {
        return await new Promise((resolve) => {
          releaseBackgroundContinuation = () => resolve({ result: 'continued in background', model: 'mock/model', fallback_used: false, nested_session_path: nested_session_path ?? nestedSessionPath } as any);
        });
      }
      return { result: `continued: ${continuation.prompt}`, model: 'mock/model', fallback_used: false, nested_session_path: nested_session_path ?? nestedSessionPath } as any;
    });

    const backgroundTask = await manager.run({ agent: 'analyst', task: 'initial background task', mode: 'background' }, { cwd: tmp });
    const backgroundTaskId = backgroundTask.task_ids[0]!;
    await vi.waitFor(() => expect(manager.getTask(backgroundTaskId)?.status).toBe('completed'));

    const explicitTask = await manager.continueTask({ task_id: backgroundTaskId, prompt: 'force task mode', mode: 'task' }, { cwd: tmp });
    expect(explicitTask).toMatchObject({ mode: 'task', task_ids: [backgroundTaskId] });
    expect(explicitTask.results?.[0]).toMatchObject({ attempt: 2, mode: 'task', effective_mode: 'task', status: 'completed' });

    const taskTask = await manager.run({ agent: 'analyst', task: 'initial task task', mode: 'task' }, { cwd: tmp });
    const taskTaskId = taskTask.task_ids[0]!;
    const explicitBackground = await manager.continueTask({ task_id: taskTaskId, prompt: 'resume in background', mode: 'background' }, { cwd: tmp });
    expect(explicitBackground).toMatchObject({ mode: 'background', task_ids: [taskTaskId] });
    expect(manager.getTask(taskTaskId)).toMatchObject({ attempt: 2, mode: 'background', effective_mode: 'background', status: 'running' });
    releaseBackgroundContinuation?.();
    await vi.waitFor(() => expect(manager.getTask(taskTaskId)?.status).toBe('completed'));

    const legacyTaskId = 'subtask_legacy_continue_mode';
    const legacyHistory = new SubagentHistoryStore();
    legacyHistory.upsertTask(tmp, {
      id: legacyTaskId,
      agent: 'analyst',
      mode: 'legacy',
      status: 'completed',
      task: 'legacy continuation',
      created_at: new Date().toISOString(),
      nested_session_path: nestedSessionPath,
      result: 'legacy result',
      attempt: 1,
    } as any);
    const legacyManager = new SubagentManager(async ({ continuation, nested_session_path, onActivity }) => {
      onActivity?.({ message: 'nested session ready', nested_session_path: nestedSessionPath } as any);
      return { result: `legacy continued: ${continuation?.prompt}`, model: 'mock/model', fallback_used: false, nested_session_path: nested_session_path ?? nestedSessionPath } as any;
    }, legacyHistory);

    const legacy = await legacyManager.continueTask({ task_id: legacyTaskId, prompt: 'fallback to config default' }, { cwd: tmp });
    expect(legacy).toMatchObject({ mode: 'background', task_ids: [legacyTaskId] });
    expect(legacyManager.getTask(legacyTaskId)).toMatchObject({ attempt: 2, mode: 'background', effective_mode: 'background', status: 'running' });
    await vi.waitFor(() => expect(legacyManager.getTask(legacyTaskId)?.status).toBe('completed'));
  });

  it('keeps exact-string compatibility for plain and malformed legacy manager failures while attaching metadata', async () => {
    writeAgent('analyst');
    const plainManager = new SubagentManager(async () => { throw new Error('legacy plain failure'); });
    const malformedManager = new SubagentManager(async () => { throw { reason: 'legacy malformed failure' }; });

    const plain = await plainManager.run({ agent: 'analyst', task: 'plain fail', mode: 'task' }, { cwd: tmp });
    const malformed = await malformedManager.run({ agent: 'analyst', task: 'malformed fail', mode: 'task' }, { cwd: tmp });

    expect(plain.results?.[0].error).toBe('legacy plain failure');
    expect(plain.results?.[0].error_metadata).toMatchObject({ category: 'provider_api_error', message: 'legacy plain failure' });
    expect(malformed.results?.[0].error).toBe('[object Object]');
    expect(malformed.results?.[0].error_metadata).toMatchObject({ category: 'malformed_thrown_value', message: '[object Object]' });
  });

  it('marks tasks failed when a runner returns no final response text', async () => {
    writeAgent('analyst');
    const runner: SubagentRunner = async ({ onActivity }) => {
      onActivity?.({ message: 'collected final response', output: '{"path":"not-a-final-answer.md"}' });
      return { result: '', model: 'mock/model', fallback_used: false };
    };
    const manager = new SubagentManager(runner);

    const result = await manager.run({ agent: 'analyst', task: 'empty final response', mode: 'task' }, { cwd: tmp });

    expect(result.results?.[0].status).toBe('failed');
    expect(result.results?.[0].error).toMatch(/final response/i);
    expect(result.results?.[0].result).toBeUndefined();
    expect(result.results?.[0].output_preview).toContain('not-a-final-answer');
  });

  it('starts background tasks and keeps notification compact while completion message carries full response', async () => {
    writeAgent('analyst');
    const notifications: string[] = [];
    const manager = new SubagentManager(mockRunner(20));
    const result = await manager.run({ agent: 'analyst', task: 'background work', mode: 'background' }, { cwd: tmp, ui: { notify: (msg: string) => notifications.push(msg) } });
    expect(result.results).toBeUndefined();
    const id = result.task_ids[0];
    expect(manager.getTask(id)?.status).toMatch(/queued|running/);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const completed = manager.getTask(id);
    expect(completed?.status).toBe('completed');
    expect(notifications.some((n) => n.includes('completed'))).toBe(true);
    const message = completionMessage(completed);
    expect(message).toContain('Read only this final response');
    expect(message).toContain('analyst handled background work');
  });

  it('emits exactly one terminal background completion callback per settled task', async () => {
    writeAgent('analyst');
    const terminalCallbacks: Array<{ id: string; status: string }> = [];
    const manager = new SubagentManager(mockRunner(20), undefined, (task) => {
      terminalCallbacks.push({ id: task.id, status: task.status });
    });

    const started = await manager.run({ agent: 'analyst', task: 'background callback', mode: 'background' }, { cwd: tmp });
    const taskId = started.task_ids[0]!;
    await vi.waitFor(() => expect(manager.getTask(taskId)?.status).toBe('completed'));

    expect(terminalCallbacks).toEqual([{ id: taskId, status: 'completed' }]);
  });

  it('can move a running task-mode subagent to background and notify on completion', async () => {
    writeAgent('analyst');
    const notifications: string[] = [];
    const manager = new SubagentManager(mockRunner(20));
    const runPromise = manager.run({ agent: 'analyst', task: 'task work', mode: 'task' }, { cwd: tmp, ui: { notify: (msg: string) => notifications.push(msg) } });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const running = manager.listTasks(tmp).find((task) => task.task === 'task work');
    expect(running?.mode).toBe('task');

    const backgrounded = manager.sendToBackground([running!.id]);
    expect(backgrounded.map((task) => task.id)).toEqual([running!.id]);
    expect(manager.getTask(running!.id)?.mode).toBe('background');

    const result = await runPromise;
    expect(result.results?.[0]?.status).toBe('completed');
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(notifications.some((n) => n.includes('completed'))).toBe(true);
  });

  it('records manager cancel metadata and avoids double terminal records for explicit user cancellation', async () => {
    writeAgent('analyst');
    const persisted: Array<{ status: string; error?: string }> = [];
    const history = {
      upsertTask(_cwd: string, task: SubagentTask) { persisted.push({ status: task.status, error: task.error }); },
      addEvent() {},
      listTasks() { return []; },
      listSessionTasks() { return []; },
      getTask() { return undefined; },
    };
    const runner: SubagentRunner = async ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Subagent was aborted')), { once: true });
    });
    const manager = new SubagentManager(runner, history as any);
    const result = await manager.run({ agent: 'analyst', task: 'slow work', mode: 'background' }, { cwd: tmp, sessionId: 'cancel-parent' });
    const task = manager.cancel(result.task_ids[0], 'user request');

    expect(task.status).toBe('stopping');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const settled = manager.getTask(result.task_ids[0])!;
    expect(settled.status).toBe('cancelled');
    expect(settled.error).toBe('Subagent cancelled: user request');
    expect(settled.error_metadata).toMatchObject({
      version: 1,
      category: 'cancelled',
      phase: 'user',
      partial_result_available: false,
      parent_session_id: 'cancel-parent',
      details: { cancel_reason: 'user request' },
    });
    expect(persisted.filter((entry) => entry.status === 'cancelled')).toHaveLength(1);
    expect(persisted.filter((entry) => entry.status === 'failed')).toHaveLength(0);
  });

  it('queues same-parent pre-ready messages, flushes them exactly once on bridge readiness, and preserves fail-closed checks', async () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'backgrounder.md'), `---\nname: backgrounder\ndescription: background agent\nsubagent_mode: background\ntools:\n  - read\n---\n# Agent`);

    let registerLiveBridge: ((bridge: any) => void) | undefined;
    let release: () => void = () => undefined;
    const steer = vi.fn();
    const manager = new SubagentManager(async ({ registerLiveBridge: register }) => {
      registerLiveBridge = register;
      return await new Promise((resolve) => {
        release = () => resolve({ result: 'backgrounder done', model: 'mock/model', fallback_used: false });
      });
    });

    const sessionCtx = { cwd: tmp, sessionManager: { getSessionId: () => 'parent-a' } };
    const background = await manager.run({ agent: 'backgrounder', task: 'background work', mode: 'background' }, sessionCtx);
    const backgroundTaskId = background.task_ids[0]!;
    await new Promise((resolve) => setTimeout(resolve, 20));

    const queued = (manager as any).sendMessage({ task_id: backgroundTaskId, message: 'Need one more constraint.', session_id: 'parent-a' });
    expect(queued).toMatchObject({ status: 'queued', task_id: backgroundTaskId, pending_message_count: 1 });
    expect(steer).not.toHaveBeenCalled();
    expect(manager.getTask(backgroundTaskId)?.pending_message_count).toBe(1);

    const crossSession = (manager as any).sendMessage({ task_id: backgroundTaskId, message: 'Cross-session attempt.', session_id: 'parent-b' });
    expect(crossSession).toMatchObject({ status: 'rejected', reason: 'not_owner' });
    expect(manager.getTask(backgroundTaskId)?.pending_message_count).toBe(1);

    const missingCaller = (manager as any).sendMessage({ task_id: backgroundTaskId, message: 'Missing caller identity.' });
    expect(missingCaller).toMatchObject({ status: 'rejected', reason: 'caller_identity_unavailable' });
    expect(manager.getTask(backgroundTaskId)?.pending_message_count).toBe(1);

    registerLiveBridge?.({ supported: true, detected_pi_version: '0.82.1', steer });
    expect(steer).toHaveBeenCalledTimes(1);
    expect(steer).toHaveBeenCalledWith('Need one more constraint.');

    registerLiveBridge?.({ supported: true, detected_pi_version: '0.82.1', steer });
    expect(steer).toHaveBeenCalledTimes(1);

    release();
    await vi.waitFor(() => expect(manager.getTask(backgroundTaskId)?.status).toBe('completed'));
  });

  it('accepts only same-parent running background tasks and rejects cross-session or foreground targets without mutation', async () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'backgrounder.md'), `---\nname: backgrounder\ndescription: background agent\nsubagent_mode: background\ntools:\n  - read\n---\n# Agent`);
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'tasker.md'), `---\nname: tasker\ndescription: task agent\nsubagent_mode: task\ntools:\n  - read\n---\n# Agent`);

    const releases = new Map<string, () => void>();
    const runner: SubagentRunner = async ({ definition }) => await new Promise((resolve) => {
      releases.set(definition.name, () => resolve({ result: `${definition.name} done`, model: 'mock/model', fallback_used: false }));
    });
    const manager = new SubagentManager(runner);

    const background = await manager.run({ agent: 'backgrounder', task: 'background work', mode: 'background' }, { cwd: tmp, sessionId: 'parent-a' });
    const foregroundPromise = manager.run({ agent: 'tasker', task: 'task work', mode: 'task' }, { cwd: tmp, sessionId: 'parent-a' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const backgroundTaskId = background.task_ids[0]!;
    const foregroundTaskId = manager.listTasks(tmp).find((task) => task.agent === 'tasker')!.id;
    const steer = vi.fn();
    (manager as any).registerLiveBridge(backgroundTaskId, {
      supported: true,
      detected_pi_version: '0.82.1',
      steer,
    }, 'parent-a', 1);

    const queued = (manager as any).sendMessage({ task_id: backgroundTaskId, message: 'Need one more constraint.', session_id: 'parent-a' });
    expect(queued).toMatchObject({ status: 'queued', task_id: backgroundTaskId, pending_message_count: 1 });
    expect(steer).toHaveBeenCalledWith('Need one more constraint.');
    expect(manager.getTask(backgroundTaskId)?.pending_message_count).toBe(1);

    const crossSession = (manager as any).sendMessage({ task_id: backgroundTaskId, message: 'Cross-session attempt.', session_id: 'parent-b' });
    expect(crossSession).toMatchObject({ status: 'rejected', reason: 'not_owner' });
    expect(manager.getTask(backgroundTaskId)?.pending_message_count).toBe(1);

    const foreground = (manager as any).sendMessage({ task_id: foregroundTaskId, message: 'Foreground attempt.', session_id: 'parent-a' });
    expect(foreground).toMatchObject({ status: 'rejected', reason: 'not_background' });

    releases.get('tasker')?.();
    await foregroundPromise;
    releases.get('backgrounder')?.();
    await vi.waitFor(() => expect(manager.getTask(backgroundTaskId)?.status).toBe('completed'));
  });

  it('converts post-enqueue settlement, cancellation, and restart races into undelivered counts without replay', async () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'backgrounder.md'), `---\nname: backgrounder\ndescription: background agent\nsubagent_mode: background\ntools:\n  - read\n---\n# Agent`);
    const releases = new Map<string, () => void>();
    const manager = new SubagentManager(async ({ definition }) => await new Promise((resolve) => {
      releases.set(definition.name, () => resolve({ result: `${definition.name} done`, model: 'mock/model', fallback_used: false }));
    }));

    const started = await manager.run({ agent: 'backgrounder', task: 'background work', mode: 'background' }, { cwd: tmp, sessionId: 'parent-a' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const taskId = started.task_ids[0]!;
    (manager as any).registerLiveBridge(taskId, { supported: true, detected_pi_version: '0.82.1', steer: vi.fn() }, 'parent-a', 1);
    expect((manager as any).sendMessage({ task_id: taskId, message: 'delivered message', session_id: 'parent-a' })).toMatchObject({ status: 'queued', pending_message_count: 1 });
    (manager as any).consumeQueuedMessage(taskId);
    expect((manager as any).sendMessage({ task_id: taskId, message: 'undelivered message', session_id: 'parent-a' })).toMatchObject({ status: 'queued', pending_message_count: 1 });

    releases.get('backgrounder')?.();
    await vi.waitFor(() => expect(manager.getTask(taskId, tmp)?.status).toBe('completed'));
    expect(manager.getTask(taskId, tmp)).toMatchObject({ pending_message_count: 0, undelivered_message_count: 1 });
    expect(manager.listTasks(tmp).find((task) => task.id === taskId)).toMatchObject({ undelivered_message_count: 1 });

    const history = new SubagentHistoryStore();
    history.upsertTask(tmp, {
      id: 'subtask_orphaned_pending',
      agent: 'backgrounder',
      mode: 'background',
      status: 'running',
      task: 'stale pending queue',
      created_at: new Date().toISOString(),
      attempt: 1,
      pending_message_count: 2,
      undelivered_message_count: 0,
    } as any);
    const restarted = new SubagentManager(mockRunner(), history);
    const reconciled = await restarted.reconcileOrphanedTasks(tmp);
    expect(reconciled).toHaveLength(1);
    expect(restarted.getTask('subtask_orphaned_pending', tmp)).toMatchObject({
      status: 'interrupted',
      pending_message_count: 0,
      undelivered_message_count: 2,
    });
  }, 5000);

  it('consumes only forwarded queued messages when an earlier flush failure remains pending', async () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'backgrounder.md'), `---\nname: backgrounder\ndescription: background agent\nsubagent_mode: background\ntools:\n  - read\n---\n# Agent`);
    const releases = new Map<string, () => void>();
    const failedMessage = 'first flush failure';
    const forwardedMessage = 'later forwarded message';
    const steer = vi.fn((message: string) => {
      if (message === failedMessage) throw new Error('steer failed');
    });
    const manager = new SubagentManager(async ({ definition }) => await new Promise((resolve) => {
      releases.set(definition.name, () => resolve({ result: `${definition.name} done`, model: 'mock/model', fallback_used: false }));
    }));

    const started = await manager.run({ agent: 'backgrounder', task: 'background work', mode: 'background' }, { cwd: tmp, sessionId: 'parent-a' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const taskId = started.task_ids[0]!;

    expect((manager as any).sendMessage({ task_id: taskId, message: failedMessage, session_id: 'parent-a' })).toMatchObject({ status: 'queued', pending_message_count: 1 });
    (manager as any).registerLiveBridge(taskId, { supported: true, detected_pi_version: '0.82.1', steer }, 'parent-a', 1);
    expect(steer).toHaveBeenCalledWith(failedMessage);

    expect((manager as any).sendMessage({ task_id: taskId, message: forwardedMessage, session_id: 'parent-a' })).toMatchObject({ status: 'queued', pending_message_count: 2 });
    expect(steer).toHaveBeenCalledWith(forwardedMessage);

    (manager as any).consumeQueuedMessage(taskId);
    expect(manager.getTask(taskId, tmp)?.pending_message_count).toBe(1);
    expect((manager as any).liveStates.get(taskId)?.pendingMessages).toEqual([
      expect.objectContaining({ message: failedMessage, forwarded: false }),
    ]);

    releases.get('backgrounder')?.();
    await vi.waitFor(() => expect(manager.getTask(taskId, tmp)?.status).toBe('completed'));
    expect(manager.getTask(taskId, tmp)).toMatchObject({ pending_message_count: 0, undelivered_message_count: 1 });
  });

  it('waits for cancelled runner cleanup before continuing the same nested session', async () => {
    writeAgent('analyst');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ enable_continue: true }));
    const nestedSessionPath = path.join(tmp, 'cancel-session.jsonl');
    fs.writeFileSync(nestedSessionPath, '{"type":"session"}\n');
    let allowCleanup = false;
    let cleanupFinished = false;
    let reopenedBeforeCleanup = false;
    const runner = vi.fn<SubagentRunner>(async ({ continuation, signal, onActivity }) => {
      if (continuation) {
        reopenedBeforeCleanup = !cleanupFinished;
        return {
          result: 'continued after cancel cleanup',
          model: 'mock/model',
          fallback_used: false,
          nested_session_path: nestedSessionPath,
        } as any;
      }
      onActivity?.({ message: 'nested session ready', nested_session_path: nestedSessionPath } as any);
      return await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const waitForCleanup = () => {
            if (!allowCleanup) return setTimeout(waitForCleanup, 5);
            cleanupFinished = true;
            reject(new Error('Subagent was aborted'));
          };
          waitForCleanup();
        }, { once: true });
      });
    });
    const manager = new SubagentManager(runner);

    const initial = await manager.run({ agent: 'analyst', task: 'cancel continuation', mode: 'background' }, { cwd: tmp });
    const taskId = initial.task_ids[0]!;
    manager.cancel(taskId, 'user request');
    const continuePromise = manager.continueTask({ task_id: taskId, prompt: 'Resume after cancellation.' }, { cwd: tmp });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runner).toHaveBeenCalledTimes(1);
    allowCleanup = true;

    await continuePromise;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(reopenedBeforeCleanup).toBe(false);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(manager.getTask(taskId)?.attempt).toBe(2);
  });

  it('keeps timed-out tasks in stopping until runner settlement and ignores late activity after stop begins', async () => {
    writeAgent('analyst');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ timeout_ms: 20 }));
    const persisted: Array<{ status: string; activity: string }> = [];
    const history = {
      upsertTask(_cwd: string, task: SubagentTask) { persisted.push({ status: task.status, activity: task.last_activity ?? '' }); },
      addEvent() {},
      listTasks() { return []; },
      listSessionTasks() { return []; },
      getTask() { return undefined; },
    };
    let allowCleanup = false;
    const runner: SubagentRunner = async ({ signal, onActivity }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        onActivity?.({ message: 'late tool activity after abort', output: 'should be dropped' });
        const finish = () => {
          if (!allowCleanup) return setTimeout(finish, 5);
          reject(new Error('cleanup complete after timeout'));
        };
        finish();
      }, { once: true });
    });
    const manager = new SubagentManager(runner, history as any);

    const started = await manager.run({ agent: 'analyst', task: 'slow timeout', mode: 'background' }, { cwd: tmp });
    const id = started.task_ids[0]!;
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(manager.getTask(id)).toMatchObject({ status: 'stopping', last_activity: 'timed out after 20ms' });
    expect(persisted.some((entry) => entry.status === 'failed')).toBe(false);
    expect(manager.getTask(id)?.output_preview).toBeUndefined();

    allowCleanup = true;
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(manager.getTask(id)).toMatchObject({ status: 'failed', error: 'timed out after 20ms' });
    expect(persisted.some((entry) => entry.status === 'failed')).toBe(true);
  });

  it('keeps cancelled tasks in stopping until runner settlement and ignores late activity after cancellation', async () => {
    writeAgent('analyst');
    let allowCleanup = false;
    const runner: SubagentRunner = async ({ signal, onActivity }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        onActivity?.({ message: 'late activity after cancel', output: 'should not persist' });
        const finish = () => {
          if (!allowCleanup) return setTimeout(finish, 5);
          reject(new Error('Subagent was aborted'));
        };
        finish();
      }, { once: true });
    });
    const manager = new SubagentManager(runner);

    const started = await manager.run({ agent: 'analyst', task: 'cancel me', mode: 'background' }, { cwd: tmp, sessionId: 'cancel-parent' });
    const id = started.task_ids[0]!;
    const stopping = manager.cancel(id, 'user request');

    expect(stopping).toMatchObject({ status: 'stopping', last_activity: 'user request' });
    expect(manager.getTask(id)?.error).toBeUndefined();
    expect(manager.getTask(id)?.output_preview).toBeUndefined();

    allowCleanup = true;
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(manager.getTask(id)).toMatchObject({ status: 'cancelled', error: 'Subagent cancelled: user request' });
    expect(manager.getTask(id)?.error_metadata).toMatchObject({ category: 'cancelled', phase: 'user' });
  });

  it('does not terminalize a stopping timeout solely because the grace window elapsed', async () => {
    writeAgent('analyst');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ timeout_ms: 20 }));
    let allowCleanup = false;
    const runner: SubagentRunner = async ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const finish = () => {
          if (!allowCleanup) return setTimeout(finish, 5);
          reject(new Error('cleanup complete after timeout'));
        };
        finish();
      }, { once: true });
    });
    const manager = new SubagentManager(runner);

    const started = await manager.run({ agent: 'analyst', task: 'stuck cleanup', mode: 'background' }, { cwd: tmp });
    const id = started.task_ids[0]!;

    await new Promise((resolve) => setTimeout(resolve, 160));
    expect(manager.getTask(id)).toMatchObject({ status: 'stopping', last_activity: 'timed out after 20ms' });
    expect(manager.getTask(id)?.ended_at).toBeUndefined();
    expect(manager.getTask(id)?.error).toBeUndefined();

    allowCleanup = true;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(manager.getTask(id)).toMatchObject({ status: 'failed', error: 'timed out after 20ms' });
  });

  it('reconciles orphaned queued and running persisted tasks as interrupted without touching terminal rows', async () => {
    const history = new SubagentHistoryStore();
    const createdAt = new Date().toISOString();
    history.upsertTask(tmp, {
      id: 'orphan-queued',
      agent: 'analyst',
      mode: 'task',
      status: 'queued',
      task: 'queued orphan',
      created_at: createdAt,
    } as any);
    history.upsertTask(tmp, {
      id: 'orphan-running',
      agent: 'analyst',
      mode: 'task',
      status: 'running',
      task: 'running orphan',
      created_at: createdAt,
      started_at: createdAt,
    } as any);
    history.upsertTask(tmp, {
      id: 'finished-task',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      task: 'done already',
      created_at: createdAt,
      result: 'done',
    } as any);

    const manager = new SubagentManager(mockRunner(), history);
    const reconciled = await manager.reconcileOrphanedTasks(tmp);

    expect(reconciled.map((task) => ({ id: task.id, status: task.status }))).toEqual([
      { id: 'orphan-running', status: 'interrupted' },
      { id: 'orphan-queued', status: 'interrupted' },
    ]);
    expect(history.getTask(tmp, 'orphan-queued')).toMatchObject({
      status: 'interrupted',
      error: 'Subagent interrupted: orphaned active state at startup',
      error_metadata: expect.objectContaining({ category: 'interrupted' }),
    });
    expect(history.getTask(tmp, 'orphan-running')).toMatchObject({ status: 'interrupted' });
    expect(history.getTask(tmp, 'finished-task')).toMatchObject({ status: 'completed', result: 'done' });
  });

  it('records manager cancel metadata for parent abort with compatible wording', async () => {
    writeAgent('analyst');
    const runner: SubagentRunner = async ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Subagent was aborted')), { once: true });
    });
    const manager = new SubagentManager(runner);
    const controller = new AbortController();
    const runPromise = manager.run({ agent: 'analyst', task: 'slow work', mode: 'background' }, { cwd: tmp, sessionId: 'parent-session-456' }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    const result = await runPromise;
    const task = manager.getTask(result.task_ids[0]);

    expect(task?.status).toBe('stopping');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const settled = manager.getTask(result.task_ids[0]);
    expect(settled?.status).toBe('cancelled');
    expect(settled?.error).toBe('Subagent cancelled: parent abort');
    expect(settled?.error_metadata).toMatchObject({
      version: 1,
      category: 'cancelled',
      phase: 'manager',
      parent_session_id: 'parent-session-456',
      details: { cancel_reason: 'parent abort' },
    });
  });

  it('cleans up queued cancellations and lets later tasks run', async () => {
    writeAgent('a');
    writeAgent('b');
    writeAgent('c');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ max_concurrency: 1 }));
    const manager = new SubagentManager(mockRunner(30));
    const result = await manager.run({ agents: ['a', 'b', 'c'], task: 'queue', mode: 'background' }, { cwd: tmp });
    const cancelled = manager.cancel(result.task_ids[1]);
    expect(cancelled.status).toBe('cancelled');
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(manager.getTask(result.task_ids[0])?.status).toBe('completed');
    expect(manager.getTask(result.task_ids[2])?.status).toBe('completed');
  });

  it('throttles noisy activity persistence and update notifications while always flushing terminal state', async () => {
    vi.useFakeTimers();
    writeAgent('analyst');
    const persisted: Array<{ task: SubagentTask; activity: string }> = [];
    const events: Array<{ task: SubagentTask; activity: string }> = [];
    const history = {
      upsertTask(_cwd: string, task: SubagentTask) { persisted.push({ task: { ...task }, activity: task.last_activity ?? '' }); },
      addEvent(_cwd: string, task: SubagentTask, activity: string) { events.push({ task: { ...task }, activity }); },
      listTasks() { return []; },
      listSessionTasks() { return []; },
      getTask() { return undefined; },
    };
    const runner: SubagentRunner = async ({ onActivity }) => {
      for (let index = 0; index < 20; index += 1) onActivity?.({ message: 'streaming response', output: `chunk ${index}` });
      return { result: 'final review', model: 'mock/model', fallback_used: false };
    };
    const updates: SubagentTask[][] = [];
    const manager = new SubagentManager(runner, history as any);

    const resultPromise = manager.run({ agent: 'analyst', task: 'inspect', mode: 'task' }, { cwd: tmp }, undefined, (tasks) => updates.push(tasks.map((task) => ({ ...task }))));
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    vi.useRealTimers();

    expect(result.results?.[0].status).toBe('completed');
    expect(events.map((entry) => entry.activity)).toContain('queued');
    expect(events.map((entry) => entry.activity)).toContain('started');
    expect(events.map((entry) => entry.activity)).toContain('completed');
    expect(events.length).toBeLessThan(10);
    expect(updates.length).toBeLessThan(10);
    expect(persisted.at(-1)?.task).toMatchObject({ status: 'completed', result: 'final review', output_preview: 'final review' });
  });

  it('tracks latest activity and partial output while running', async () => {
    writeAgent('analyst');
    const runner: SubagentRunner = async ({ onActivity }) => {
      onActivity?.({ message: 'reading docs' });
      onActivity?.({ message: 'streaming response', output: 'found current architecture notes' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { result: 'final review', model: 'mock/model', fallback_used: false };
    };
    const manager = new SubagentManager(runner);
    const result = await manager.run({ agent: 'analyst', task: 'inspect', mode: 'background' }, { cwd: tmp });
    const running = manager.getTask(result.task_ids[0]);
    expect(running?.last_activity).toBe('streaming response');
    expect(running?.output_preview).toContain('architecture notes');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const completed = manager.getTask(result.task_ids[0]);
    expect(completed?.last_activity).toBe('completed');
    expect(completed?.output_preview).toBe('final review');
  });

  it('persists subagent system prompts separately from delegated user prompts', () => {
    const history = new SubagentHistoryStore();
    const task: SubagentTask = {
      id: 'subtask_system_prompt_history',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      task: 'ping',
      prompt: '## delegated task\nping',
      system_prompt: '# Analyst\nSYSTEM_ONLY',
      created_at: new Date().toISOString(),
      result: 'pong',
    } as any;

    history.upsertTask(tmp, task);
    const persisted = history.getTask(tmp, task.id);

    expect(persisted?.prompt).toBe('## delegated task\nping');
    expect(persisted?.system_prompt).toBe('# Analyst\nSYSTEM_ONLY');
    expect(persisted?.prompt).not.toContain('SYSTEM_ONLY');
  });

  it('persists nullable structured error metadata and category across history reopen', () => {
    const history = new SubagentHistoryStore();
    const task: SubagentTask = {
      id: 'subtask_error_metadata_history',
      agent: 'analyst',
      mode: 'task',
      status: 'failed',
      task: 'persist structured failure',
      created_at: new Date().toISOString(),
      error: 'Subagent cancelled: user request',
      error_metadata: normalizeErrorMetadata({
        category: 'cancelled',
        message: 'Subagent cancelled: user request',
        partial_result_available: false,
        details: { cancel_reason: 'user request', raw_payload: 'Authorization: Bearer sk-fake-secret-token' },
      }),
    } as any;

    history.upsertTask(tmp, task);

    const { DatabaseSync } = require('node:sqlite') as any;
    const db = new DatabaseSync(resolveSubagentHistoryDbPath());
    const columns = db.prepare('PRAGMA table_info(subagent_tasks)').all() as Array<{ name: string; notnull: number }>;
    expect(columns.find((column) => column.name === 'error_metadata_json')?.notnull).toBe(0);
    expect(columns.find((column) => column.name === 'error_category')?.notnull).toBe(0);

    const row = db.prepare('SELECT error, error_metadata_json, error_category FROM subagent_tasks WHERE id = ?').all(task.id)[0] as any;
    expect(row.error).toBe('Subagent cancelled: user request');
    expect(row.error_category).toBe('cancelled');
    expect(row.error_metadata_json).toContain('cancelled');
    expect(row.error_metadata_json).not.toContain('sk-fake-secret-token');

    const reopened = new SubagentHistoryStore().getTask(tmp, task.id);
    expect(reopened?.error).toBe('Subagent cancelled: user request');
    expect(reopened?.error_metadata?.category).toBe('cancelled');
    expect(reopened?.error_metadata?.details?.raw_payload).toContain('[redacted]');
  });

  it('adds nullable error columns idempotently without backfilling legacy rows and preserves exact legacy error strings', () => {
    const { DatabaseSync } = require('node:sqlite') as any;
    fs.mkdirSync(path.dirname(resolveSubagentHistoryDbPath()), { recursive: true });
    const db = new DatabaseSync(resolveSubagentHistoryDbPath());
    db.exec(`
      CREATE TABLE IF NOT EXISTS subagent_tasks (
        id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL,
        agent TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        task TEXT NOT NULL,
        context TEXT,
        created_at TEXT NOT NULL,
        session_id TEXT,
        started_at TEXT,
        ended_at TEXT,
        last_activity_at TEXT,
        last_activity TEXT,
        output_preview TEXT,
        prompt TEXT,
        system_prompt TEXT,
        transcript TEXT,
        usage_input INTEGER,
        usage_output INTEGER,
        usage_cache_read INTEGER,
        usage_cache_write INTEGER,
        usage_cost REAL,
        usage_context_tokens INTEGER,
        usage_turns INTEGER,
        model TEXT,
        effort TEXT,
        model_source TEXT,
        effort_source TEXT,
        fallback_used INTEGER,
        error TEXT,
        result TEXT,
        thread_snapshot_json TEXT
      );
    `);
    db.prepare(`
      INSERT INTO subagent_tasks (
        id, cwd, agent, mode, status, task, created_at, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'subtask_legacy_error_only',
      tmp,
      'analyst',
      'task',
      'failed',
      'legacy history row',
      new Date().toISOString(),
      'legacy plain error  with  exact   spacing',
    );

    const reopenedStore = new SubagentHistoryStore();
    const legacy = reopenedStore.getTask(tmp, 'subtask_legacy_error_only');
    expect(legacy?.error).toBe('legacy plain error  with  exact   spacing');
    expect(legacy?.error_metadata).toBeUndefined();

    const migratedColumns = db.prepare('PRAGMA table_info(subagent_tasks)').all() as Array<{ name: string; notnull: number }>;
    expect(migratedColumns.find((column) => column.name === 'error_metadata_json')?.notnull).toBe(0);
    expect(migratedColumns.find((column) => column.name === 'error_category')?.notnull).toBe(0);

    const row = db.prepare('SELECT error_metadata_json, error_category FROM subagent_tasks WHERE id = ?').all('subtask_legacy_error_only')[0] as any;
    expect(row.error_metadata_json).toBeNull();
    expect(row.error_category).toBeNull();

    reopenedStore.upsertTask(tmp, {
      id: 'subtask_no_error_metadata',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      task: 'no metadata needed',
      created_at: new Date().toISOString(),
      result: 'ok',
    } as any);
    const currentRow = db.prepare('SELECT error_metadata_json, error_category FROM subagent_tasks WHERE id = ?').all('subtask_no_error_metadata')[0] as any;
    expect(currentRow.error_metadata_json).toBeNull();
    expect(currentRow.error_category).toBeNull();
  });

  it('migrates legacy subagent_task_attempts tables additively and preserves existing rows across reopen', () => {
    const { DatabaseSync } = require('node:sqlite') as any;
    fs.mkdirSync(path.dirname(resolveSubagentHistoryDbPath()), { recursive: true });
    const db = new DatabaseSync(resolveSubagentHistoryDbPath());
    db.exec(`
      CREATE TABLE IF NOT EXISTS subagent_tasks (
        id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL,
        agent TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        task TEXT NOT NULL,
        context TEXT,
        created_at TEXT NOT NULL,
        session_id TEXT,
        started_at TEXT,
        ended_at TEXT,
        last_activity_at TEXT,
        last_activity TEXT,
        output_preview TEXT,
        prompt TEXT,
        system_prompt TEXT,
        transcript TEXT,
        usage_input INTEGER,
        usage_output INTEGER,
        usage_cache_read INTEGER,
        usage_cache_write INTEGER,
        usage_cost REAL,
        usage_context_tokens INTEGER,
        usage_turns INTEGER,
        model TEXT,
        effort TEXT,
        model_source TEXT,
        effort_source TEXT,
        fallback_used INTEGER,
        error TEXT,
        result TEXT,
        thread_snapshot_json TEXT,
        continued_from TEXT,
        root_task_id TEXT
      );
      CREATE TABLE IF NOT EXISTS subagent_task_attempts (
        task_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        cwd TEXT,
        status TEXT,
        result TEXT,
        PRIMARY KEY (task_id, attempt)
      );
    `);
    const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO subagent_tasks (id, cwd, agent, mode, status, task, created_at, result, continued_from, root_task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'legacy-attempt-task', tmp, 'analyst', 'task', 'completed', 'legacy work', createdAt, 'legacy projection', null, 'legacy-attempt-task',
    );
    db.prepare('INSERT INTO subagent_task_attempts (task_id, attempt, cwd, status, result) VALUES (?, ?, ?, ?, ?)').run(
      'legacy-attempt-task', 1, tmp, 'completed', 'legacy attempt result',
    );

    const store = new SubagentHistoryStore();
    expect(store.listTaskAttempts(tmp, 'legacy-attempt-task').map((attempt) => ({ attempt: attempt.attempt, result: attempt.result }))).toEqual([
      { attempt: 1, result: 'legacy attempt result' },
    ]);

    store.upsertTask(tmp, {
      id: 'legacy-attempt-task',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      task: 'legacy work',
      created_at: createdAt,
      attempt: 2,
      result: 'continued attempt result',
    } as any);

    const columns = db.prepare('PRAGMA table_info(subagent_task_attempts)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'agent',
      'mode',
      'task',
      'created_at',
      'nested_session_path',
      'continuation_prompt',
      'system_prompt',
      'error_metadata_json',
      'error_category',
      'thread_snapshot_json',
    ]));

    const reopened = new SubagentHistoryStore();
    expect(reopened.listTaskAttempts(tmp, 'legacy-attempt-task').map((attempt) => ({ attempt: attempt.attempt, result: attempt.result }))).toEqual([
      { attempt: 1, result: 'legacy attempt result' },
      { attempt: 2, result: 'continued attempt result' },
    ]);
    expect(reopened.getTask(tmp, 'legacy-attempt-task')).toMatchObject({ attempt: 2, result: 'continued attempt result' });
  });

  it('ignores malformed persisted error metadata json safely while preserving legacy error text', () => {
    const history = new SubagentHistoryStore();
    const task: SubagentTask = {
      id: 'subtask_malformed_error_metadata',
      agent: 'analyst',
      mode: 'task',
      status: 'failed',
      task: 'malformed metadata row',
      created_at: new Date().toISOString(),
      error: 'legacy malformed metadata error',
    } as any;
    history.upsertTask(tmp, task);

    const { DatabaseSync } = require('node:sqlite') as any;
    const db = new DatabaseSync(resolveSubagentHistoryDbPath());
    db.prepare('UPDATE subagent_tasks SET error_metadata_json = ?, error_category = ? WHERE id = ?').run('{bad json', 'provider_api_error', task.id);

    const loaded = history.getTask(tmp, task.id);
    expect(loaded?.error).toBe('legacy malformed metadata error');
    expect(loaded?.error_metadata).toBeUndefined();
  });

  it('never lets error metadata serialization failure escape history upsertTask', () => {
    const history = new SubagentHistoryStore();
    const task: SubagentTask = {
      id: 'subtask_unserializable_error_metadata',
      agent: 'analyst',
      mode: 'task',
      status: 'failed',
      task: 'unserializable metadata',
      created_at: new Date().toISOString(),
      error: 'legacy serialization-safe error',
      error_metadata: {
        category: 'provider_api_error',
        message: 'should fail closed',
        partial_result_available: false,
        details: { broken: 1n as any },
      } as any,
    } as any;

    expect(() => history.upsertTask(tmp, task)).not.toThrow();
    const persisted = history.getTask(tmp, task.id);
    expect(persisted?.error).toBe('legacy serialization-safe error');
    expect(persisted?.error_metadata?.category).toBe('serialization_failure');
    expect(deriveErrorString(persisted?.error_metadata!)).toBe('Subagent error metadata could not be serialized safely.');
  });

  it('keeps current-session listing available when sqlite history is temporarily busy', () => {
    const busy = Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR', errcode: 5, errstr: 'database is locked' });
    const history = {
      listSessionTasks: vi.fn()
        .mockReturnValueOnce([{ id: 'persisted_cached', agent: 'analyst', mode: 'task', status: 'completed', task: 'cached', created_at: '2026-01-01T00:00:00.000Z', session_id: 'session-current' }])
        .mockImplementationOnce(() => { throw busy; }),
      listTasks() { return []; },
      getTask() { return undefined; },
      upsertTask() {},
      addEvent() {},
    };
    const manager = new SubagentManager(mockRunner(), history as any);

    vi.useFakeTimers();
    try {
      expect(manager.listSessionTasks(tmp, 'session-current').map((task) => task.id)).toEqual(['persisted_cached']);
      vi.advanceTimersByTime(1600);
      let lockedResult: SubagentTask[] = [];
      expect(() => { lockedResult = manager.listSessionTasks(tmp, 'session-current'); }).not.toThrow();
      expect(lockedResult.map((task) => task.id)).toEqual(['persisted_cached']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers active session task state from memory without querying persisted history', () => {
    const history = {
      listSessionTasks: vi.fn(() => { throw new Error('heavy history should not be read'); }),
      listSessionTaskMetadata: vi.fn(() => { throw new Error('metadata history should not be read'); }),
      listTasks() { return []; },
      getTask() { return undefined; },
      upsertTask() {},
      addEvent() {},
    };
    const manager = new SubagentManager(mockRunner(), history as any);
    const task = {
      id: 'subtask_active_only',
      agent: 'analyst',
      mode: 'background',
      status: 'running',
      task: 'active only',
      created_at: '2026-01-01T00:00:00.000Z',
      session_id: 'session-current',
    } as SubagentTask;
    (manager as any).tasks.set(task.id, task);
    (manager as any).taskCwds.set(task.id, tmp);

    expect(manager.listActiveSessionTasks(tmp, 'session-current')).toEqual([task]);
    expect(history.listSessionTasks).not.toHaveBeenCalled();
    expect(history.listSessionTaskMetadata).not.toHaveBeenCalled();
  });

  it('lists persisted current-session tasks after manager reload while excluding other sessions', () => {
    const history = new SubagentHistoryStore();
    const sessionTask: SubagentTask = {
      id: 'subtask_session_current',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      task: 'current session task',
      created_at: new Date().toISOString(),
      session_id: 'session-current',
      result: 'current result',
    } as any;
    const otherTask: SubagentTask = {
      ...sessionTask,
      id: 'subtask_session_other',
      task: 'other session task',
      session_id: 'session-other',
    } as any;
    history.upsertTask(tmp, sessionTask);
    history.upsertTask(tmp, otherTask);

    const manager = new SubagentManager(mockRunner(), history);
    const listed = manager.listSessionTasks(tmp, 'session-current');

    expect(listed.map((task) => task.id)).toContain('subtask_session_current');
    expect(listed.map((task) => task.id)).not.toContain('subtask_session_other');
  });

  it('resolves sqlite history under global data storage like memory, not the project .pi directory', () => {
    expect(resolveSubagentsHistoryHome({ XDG_DATA_HOME: '/xdg' } as any)).toBe(path.join('/xdg', 'pi', 'subagents'));
    expect(resolveSubagentHistoryDbPath({ XDG_DATA_HOME: '/xdg' } as any)).toBe(path.join('/xdg', 'pi', 'subagents', 'subagents-history.sqlite'));
    expect(resolveSubagentHistoryDbPath({ PI_SUBAGENTS_HISTORY_DB_PATH: '/custom/history.sqlite' } as any)).toBe('/custom/history.sqlite');
    expect(resolveSubagentsHistoryHome({ PI_SUBAGENTS_HISTORY_HOME: '/custom/home' } as any)).toBe('/custom/home');

    const store = new SubagentHistoryStore();
    const task: SubagentTask = {
      id: 'subtask_global_history_1',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      task: 'global history location',
      created_at: new Date().toISOString(),
      result: 'stored globally',
    } as any;

    store.upsertTask(tmp, task);

    expect(resolveSubagentHistoryDbPath()).toBe(path.join(tmp, 'global-agent', 'subagents-history.sqlite'));
    expect(fs.existsSync(path.join(tmp, 'global-agent', 'subagents-history.sqlite'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, '.pi', 'subagents-history.sqlite'))).toBe(false);
    expect(store.getTask(tmp, task.id)?.result).toBe('stored globally');
  });

  it('retains immutable creation-time order when a stable task is continued, including after history reload', async () => {
    writeAgent('analyst');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ enable_continue: true }));
    const runner: SubagentRunner = async ({ taskId, task, continuation, nested_session_path, onActivity }) => {
      const sessionPath = nested_session_path ?? path.join(tmp, `${taskId}.jsonl`);
      if (!fs.existsSync(sessionPath)) fs.writeFileSync(sessionPath, '{"type":"session"}\n');
      onActivity?.({ message: 'nested session ready', nested_session_path: sessionPath } as any);
      return { result: continuation ? `continued ${task}` : `completed ${task}`, model: 'mock/model', fallback_used: false, nested_session_path: sessionPath } as any;
    };
    const manager = new SubagentManager(runner);
    const session = { cwd: tmp, sessionId: 'session-activity-order' };
    const taskIds: string[] = [];
    for (const task of ['apply first', 'review second', 'verify third', 'discovery fourth']) {
      const result = await manager.run({ agent: 'analyst', task, mode: 'task' }, session);
      taskIds.push(result.task_ids[0]!);
    }

    const expectedOrder = [...taskIds].reverse();
    expect(manager.listSessionTasks(tmp, session.sessionId).map((task) => task.id)).toEqual(expectedOrder);

    await manager.continueTask({ task_id: taskIds[0]!, prompt: 'Resume the first apply.' }, session);

    // List order remains immutable creation-time order (newest first: taskIds[3], [2], [1], [0])
    expect(manager.listSessionTasks(tmp, session.sessionId).map((task) => task.id)).toEqual(expectedOrder);
    expect(manager.listTasks(tmp).map((task) => task.id)).toEqual(expectedOrder);

    const freshManager = new SubagentManager(runner);
    expect(freshManager.listSessionTasks(tmp, session.sessionId).map((task) => task.id)).toEqual(expectedOrder);
    expect(freshManager.listTasks(tmp).map((task) => task.id)).toEqual(expectedOrder);
  });

  it('uses the same binary id tie-break order in memory and after sqlite reload', () => {
    const history = new SubagentHistoryStore();
    const timestamp = '2026-07-15T12:00:00.000Z';
    const hyphenTask: SubagentTask = {
      id: 'subtask_a-b_same',
      agent: 'a-b',
      mode: 'task',
      status: 'completed',
      task: 'hyphen task',
      created_at: timestamp,
      last_activity_at: timestamp,
      session_id: 'session-binary-tie',
      result: 'hyphen result',
    } as any;
    const underscoreTask: SubagentTask = {
      ...hyphenTask,
      id: 'subtask_a_b_same',
      agent: 'a_b',
      task: 'underscore task',
      result: 'underscore result',
    };
    history.upsertTask(tmp, hyphenTask);
    history.upsertTask(tmp, underscoreTask);

    const manager = new SubagentManager(mockRunner(), history);
    for (const task of [hyphenTask, underscoreTask]) {
      (manager as any).tasks.set(task.id, task);
      (manager as any).taskCwds.set(task.id, tmp);
    }
    const expected = [underscoreTask.id, hyphenTask.id];

    expect(manager.listTasks(tmp).map((task) => task.id)).toEqual(expected);
    expect(manager.listSessionTasks(tmp, 'session-binary-tie').map((task) => task.id)).toEqual(expected);

    const freshManager = new SubagentManager(mockRunner(), history);
    expect(freshManager.listTasks(tmp).map((task) => task.id)).toEqual(expected);
    expect(freshManager.listSessionTasks(tmp, 'session-binary-tie').map((task) => task.id)).toEqual(expected);
  });

  it('retrieves completed tasks from sqlite history when not in memory', async () => {
    writeAgent('analyst');
    const manager = new SubagentManager(mockRunner());
    const result = await manager.run({ agent: 'analyst', task: 'persisted work', mode: 'task' }, { cwd: tmp });
    const id = result.task_ids[0];
    const freshManager = new SubagentManager(mockRunner());
    const persisted = freshManager.getTask(id, tmp);
    expect(persisted?.status).toBe('completed');
    expect(persisted?.result).toContain('analyst handled persisted work');
    expect(freshManager.listSessionTasks(tmp)).toEqual([]);
  });

  it('copies activity and final thread snapshots onto tasks and persists final snapshots through history reload', async () => {
    writeAgent('analyst');
    const activitySnapshot = statusSnapshot('activity snapshot from runner');
    const finalSnapshot = statusSnapshot('final snapshot from runner');
    const seenUpdates: SubagentTask[][] = [];
    const runner: SubagentRunner = async ({ onActivity }) => {
      onActivity?.({ message: 'snapshot activity', thread_snapshot: activitySnapshot });
      return { result: 'snapshot result', model: 'mock/model', fallback_used: false, thread_snapshot: finalSnapshot };
    };
    const manager = new SubagentManager(runner);

    const result = await manager.run(
      { agent: 'analyst', task: 'persist snapshots', mode: 'task' },
      { cwd: tmp },
      undefined,
      (tasks) => seenUpdates.push(tasks.map((task) => ({ ...task }))),
    );

    expect(seenUpdates.flat().some((task) => task.thread_snapshot?.items[0]?.type === 'status' && task.thread_snapshot.items[0].text === 'activity snapshot from runner')).toBe(true);
    expect(result.results?.[0].thread_snapshot).toEqual(finalSnapshot);

    const freshManager = new SubagentManager(mockRunner());
    const persisted = freshManager.getTask(result.task_ids[0], tmp);
    expect(persisted?.thread_snapshot).toEqual(finalSnapshot);
  });

  it('can list session history metadata without heavyweight payloads and hydrate them on demand', () => {
    const store = new SubagentHistoryStore();
    const task: SubagentTask = {
      id: 'subtask_lazy_history_1',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      task: 'lazy history snapshot',
      created_at: new Date().toISOString(),
      session_id: 'session-lazy',
      prompt: 'heavy prompt body',
      transcript: 'heavy transcript body',
      result: 'heavy result body',
      thread_snapshot: statusSnapshot('lazy snapshot body'),
    } as any;
    store.upsertTask(tmp, task);

    const listed = store.listSessionTaskMetadata(tmp, 'session-lazy');
    expect(listed).toHaveLength(1);
    expect(listed[0].prompt).toBeUndefined();
    expect(listed[0].transcript).toBeUndefined();
    expect(listed[0].result).toBeUndefined();
    expect(listed[0].thread_snapshot).toBeUndefined();

    const hydrated = store.getTask(tmp, task.id);
    expect(hydrated?.prompt).toBe('heavy prompt body');
    expect(hydrated?.transcript).toBe('heavy transcript body');
    expect(hydrated?.result).toBe('heavy result body');
    expect(hydrated?.thread_snapshot).toEqual(statusSnapshot('lazy snapshot body'));
  });

  it('persists only bounded valid thread snapshots and ignores corrupt history snapshot JSON', () => {
    const store = new SubagentHistoryStore();
    const task: SubagentTask = {
      id: 'subtask_history_snapshot_1',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      task: 'history snapshot',
      created_at: new Date().toISOString(),
      transcript: 'legacy transcript survives corrupt snapshots',
      result: 'legacy result survives corrupt snapshots',
      thread_snapshot: statusSnapshot('x'.repeat(5000)),
    };

    store.upsertTask(tmp, task);
    const bounded = store.getTask(tmp, task.id)?.thread_snapshot;
    expect(bounded?.items[0]).toMatchObject({ type: 'status', text: expect.stringMatching(/…$/) });
    expect((bounded?.items[0] as any).text.length).toBeLessThanOrEqual(4000);

    const { DatabaseSync } = require('node:sqlite') as any;
    const db = new DatabaseSync(resolveSubagentHistoryDbPath());
    // Old history data may be deleted/reset; v1 deliberately does not migrate flat transcripts into snapshots.
    db.prepare('UPDATE subagent_tasks SET thread_snapshot_json = ? WHERE id = ?').run('{not valid json', task.id);
    const corruptLoaded = store.getTask(tmp, task.id);
    expect(corruptLoaded?.thread_snapshot).toBeUndefined();
    expect(corruptLoaded?.transcript).toContain('legacy transcript survives corrupt snapshots');

    db.prepare('UPDATE subagent_tasks SET thread_snapshot_json = ? WHERE id = ?').run(JSON.stringify({ version: 1, source: 'events', items: [{ type: 'future', text: 'ignored' }] }), task.id);
    const invalidLoaded = store.getTask(tmp, task.id);
    expect(invalidLoaded?.thread_snapshot).toBeUndefined();
    expect(invalidLoaded?.result).toContain('legacy result survives corrupt snapshots');
  });

  it('persists subagent usage stats and effort for display', async () => {
    writeAgent('analyst');
    const runner: SubagentRunner = async () => ({
      result: 'usage-aware result',
      model: 'mock/model',
      effort: 'xhigh',
      fallback_used: false,
      usage: { input: 1200, output: 300, cacheRead: 40, cacheWrite: 5, cost: 0.01, contextTokens: 1545, turns: 1 },
    });
    const manager = new SubagentManager(runner);
    const result = await manager.run({ agent: 'analyst', task: 'measure usage', mode: 'task' }, { cwd: tmp });
    const id = result.task_ids[0];
    const freshManager = new SubagentManager(mockRunner());
    const persisted = freshManager.getTask(id, tmp);
    expect(persisted?.usage).toEqual({ input: 1200, output: 300, cacheRead: 40, cacheWrite: 5, cost: 0.01, contextTokens: 1545, turns: 1 });
    expect(persisted?.effort).toBe('xhigh');
  });

  it('persists effective model and effort source metadata for rendering', async () => {
    writeAgent('analyst');
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ model_profiles: { analyst: { effort: 'high' } } }));
    const manager = new SubagentManager(async ({ effectiveProfile }) => ({
      result: 'source-aware result',
      model: effectiveProfile?.model.label.replace(/^orchestrator: /, ''),
      effort: effectiveProfile?.effort.value,
      fallback_used: false,
    }));
    const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    let result!: Awaited<ReturnType<SubagentManager['run']>>;
    try {
      result = await manager.run({ agent: 'analyst', task: 'source metadata', mode: 'task' }, { cwd: tmp, model: { provider: 'mock', id: 'model' }, thinkingLevel: 'high' });
    } finally {
      if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
    }
    const freshManager = new SubagentManager(mockRunner());
    const persisted = freshManager.getTask(result.task_ids[0], tmp);
    expect(persisted).toMatchObject({ model: 'mock/model', effort: 'high', model_source: 'orchestrator', effort_source: 'orchestrator' });
  });

  it('continues a completed task under the same task id, reuses the nested session, and persists attempts across reloads', async () => {
    writeAgent('analyst');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ enable_continue: true, model_profiles: { analyst: { model: 'profile/default', effort: 'medium' } } }));
    const nestedSessionPath = path.join(tmp, 'nested-session.jsonl');
    fs.writeFileSync(nestedSessionPath, '{"type":"session"}\n');
    const runner = vi.fn<SubagentRunner>(async ({ effectiveProfile, nested_session_path, continuation, onActivity }) => {
      onActivity?.({
        message: 'runner session ready',
        nested_session_path: nestedSessionPath,
        thread_snapshot: continuation
          ? { version: 1, source: 'events', items: [{ type: 'user', label: 'continuation', text: continuation.prompt }] }
          : undefined,
      } as any);
      return {
        result: continuation ? `continued with ${continuation.prompt}` : 'initial result',
        model: effectiveProfile?.model.label.replace(/^(?:profile|orchestrator): /, ''),
        effort: effectiveProfile?.effort.value,
        fallback_used: false,
        nested_session_path: nestedSessionPath,
      } as any;
    });
    const manager = new SubagentManager(runner);

    const initial = await manager.run({ agent: 'analyst', task: 'initial delegated work', mode: 'task' }, { cwd: tmp, model: { provider: 'orchestrator', id: 'default' }, thinkingLevel: 'medium' });
    const taskId = initial.task_ids[0]!;
    const continued = await manager.continueTask({ task_id: taskId, prompt: 'Please continue with the fix.' }, { cwd: tmp, model: { provider: 'orchestrator', id: 'default' }, thinkingLevel: 'medium' });

    expect(continued.task_ids).toEqual([taskId]);
    expect(continued.results?.[0]).toMatchObject({
      id: taskId,
      status: 'completed',
      attempt: 2,
      nested_session_path: nestedSessionPath,
      continuation_prompt: 'Please continue with the fix.',
      result: 'continued with Please continue with the fix.',
      model: 'orchestrator/default',
      effort: 'medium',
    });
    expect(runner).toHaveBeenNthCalledWith(1, expect.objectContaining({ nested_session_path: undefined, continuation: undefined }));
    expect(runner).toHaveBeenNthCalledWith(2, expect.objectContaining({
      taskId,
      nested_session_path: nestedSessionPath,
      continuation: expect.objectContaining({ prompt: 'Please continue with the fix.', attempt: 2 }),
    }));

    const freshHistory = new SubagentHistoryStore();
    expect(freshHistory.getTask(tmp, taskId)).toMatchObject({ attempt: 2, nested_session_path: nestedSessionPath, continuation_prompt: 'Please continue with the fix.' });
    expect(freshHistory.listTaskAttempts(tmp, taskId).map((attempt) => ({ attempt: attempt.attempt, result: attempt.result }))).toEqual([
      { attempt: 1, result: 'initial result' },
      { attempt: 2, result: 'continued with Please continue with the fix.' },
    ]);
  });

  it('rebinds continuation ownership per attempt without replaying prior authorization', async () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ enable_continue: true }));
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'backgrounder.md'), `---\nname: backgrounder\ndescription: background agent\nsubagent_mode: background\ntools:\n  - read\n---\n# Agent`);

    const releases = new Map<number, () => void>();
    const steers = new Map<number, ReturnType<typeof vi.fn>>();
    const manager = new SubagentManager(async ({ continuation, registerLiveBridge }) => {
      const attempt = continuation?.attempt ?? 1;
      const steer = vi.fn();
      steers.set(attempt, steer);
      registerLiveBridge?.({ supported: true, detected_pi_version: '0.82.1', steer });
      return await new Promise((resolve) => {
        releases.set(attempt, () => resolve({ result: `attempt ${attempt} done`, model: 'mock/model', fallback_used: false, nested_session_path: path.join(tmp, 'continuation-owner-session.jsonl') } as any));
      });
    });

    const first = await manager.run({ agent: 'backgrounder', task: 'initial execution', mode: 'background' }, { cwd: tmp, sessionManager: { getSessionId: () => 'parent-a' } });
    const taskId = first.task_ids[0]!;
    await vi.waitFor(() => expect(manager.getTask(taskId)?.status).toBe('running'));
    expect((manager as any).sendMessage({ task_id: taskId, message: 'attempt one', session_id: 'parent-a' })).toMatchObject({ status: 'queued', pending_message_count: 1 });
    expect(steers.get(1)).toHaveBeenCalledWith('attempt one');

    fs.writeFileSync(path.join(tmp, 'continuation-owner-session.jsonl'), '{"type":"session"}\n');
    releases.get(1)?.();
    await vi.waitFor(() => expect(manager.getTask(taskId)?.status).toBe('completed'));

    const continued = await manager.continueTask({ task_id: taskId, prompt: 'Resume under a new owner.' }, { cwd: tmp, sessionManager: { getSessionId: () => 'parent-b' } });
    expect(continued).toMatchObject({ mode: 'background', task_ids: [taskId] });
    await vi.waitFor(() => expect(manager.getTask(taskId)?.status).toBe('running'));
    expect(manager.getTask(taskId)).toMatchObject({ attempt: 2, session_id: 'parent-b', pending_message_count: 0, undelivered_message_count: 0 });

    const staleOwner = (manager as any).sendMessage({ task_id: taskId, message: 'stale owner', session_id: 'parent-a' });
    expect(staleOwner).toMatchObject({ status: 'rejected', reason: 'not_owner' });
    expect(steers.get(2)).not.toHaveBeenCalledWith('stale owner');

    const reboundOwner = (manager as any).sendMessage({ task_id: taskId, message: 'attempt two', session_id: 'parent-b' });
    expect(reboundOwner).toMatchObject({ status: 'queued', pending_message_count: 1 });
    expect(steers.get(2)?.mock.calls).toEqual([['attempt two']]);

    releases.get(2)?.();
    await vi.waitFor(() => expect(manager.getTask(taskId)?.status).toBe('completed'));
  });

  it('continues without mutating project config and rejects non-terminal continuations', async () => {
    writeAgent('analyst');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ enable_continue: true }));
    const nestedSessionPath = path.join(tmp, 'resume-session.jsonl');
    fs.writeFileSync(nestedSessionPath, '{"type":"session"}\n');
    const runner = vi.fn<SubagentRunner>(async ({ effectiveProfile, nested_session_path, continuation, signal }) => {
      if (!continuation) {
        return await new Promise((resolve) => setTimeout(() => resolve({
          result: 'initial complete',
          model: 'mock/initial',
          effort: 'low',
          fallback_used: false,
          nested_session_path: nestedSessionPath,
        } as any), 30));
      }
      return {
        result: 'continued with override',
        model: effectiveProfile?.model.label.replace(/^(?:profile|orchestrator): /, ''),
        effort: effectiveProfile?.effort.value,
        fallback_used: false,
        nested_session_path: nested_session_path,
      } as any;
    });
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ enable_continue: true, model_profiles: { analyst: { model: 'profile/after', effort: 'high' } } }));
    const manager = new SubagentManager(runner);

    const initial = await manager.run({ agent: 'analyst', task: 'first pass', mode: 'task' }, { cwd: tmp, model: { provider: 'mock', id: 'model' }, thinkingLevel: 'low' });
    const taskId = initial.task_ids[0]!;
    const configBefore = fs.readFileSync(path.join(tmp, '.pi', 'subagents.json'), 'utf8');
    const continued = await manager.continueTask({ task_id: taskId, prompt: 'Continue with next turn.' }, { cwd: tmp, model: { provider: 'mock', id: 'model' }, thinkingLevel: 'low' });

    expect(continued.results?.[0]).toMatchObject({ model: 'mock/model', effort: 'low', model_source: 'orchestrator', effort_source: 'orchestrator', attempt: 2 });
    expect(fs.readFileSync(path.join(tmp, '.pi', 'subagents.json'), 'utf8')).toBe(configBefore);

    const runningManager = new SubagentManager(runner);
    const background = await runningManager.run({ agent: 'analyst', task: 'still running', mode: 'background' }, { cwd: tmp });
    await expect(runningManager.continueTask({ task_id: background.task_ids[0]!, prompt: 'should fail' }, { cwd: tmp })).rejects.toThrow('Only completed, failed, or cancelled subagent tasks can continue.');
  });

  it('normalizes friendly display_name, respects precedence over name, ignores blank names, bounds length, and preserves across continuations', async () => {
    writeAgent('analyst');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ enable_continue: true }));
    const nestedSessionPath = path.join(tmp, 'friendly-nested-session.jsonl');
    fs.writeFileSync(nestedSessionPath, '{"type":"session"}\n');
    const runner = vi.fn<SubagentRunner>(async ({ continuation }) => ({
      result: continuation ? 'continued result' : 'initial result',
      model: 'mock/model',
      fallback_used: false,
      nested_session_path: nestedSessionPath,
    }));
    const manager = new SubagentManager(runner);

    // 1. display_name parameter
    const run1 = await manager.run({
      agent: 'analyst',
      task: 'task one',
      display_name: '  Security Scan  ',
      mode: 'task',
    }, { cwd: tmp });
    expect(run1.results?.[0].display_name).toBe('Security Scan');
    expect(run1.results?.[0].id).toMatch(/^subtask_analyst_/);

    // 2. name parameter fallback
    const run2 = await manager.run({
      agent: 'analyst',
      task: 'task two',
      name: 'Code Review',
      mode: 'task',
    }, { cwd: tmp });
    expect(run2.results?.[0].display_name).toBe('Code Review');

    // 3. display_name takes precedence over name
    const run3 = await manager.run({
      agent: 'analyst',
      task: 'task three',
      display_name: 'Primary Display Name',
      name: 'Secondary Fallback Name',
      mode: 'task',
    }, { cwd: tmp });
    expect(run3.results?.[0].display_name).toBe('Primary Display Name');

    // 4. whitespace-only display_name falls back to valid name
    const run4 = await manager.run({
      agent: 'analyst',
      task: 'task four',
      display_name: '   ',
      name: 'Valid Fallback',
      mode: 'task',
    }, { cwd: tmp });
    expect(run4.results?.[0].display_name).toBe('Valid Fallback');

    // 5. whitespace-only name and display_name are ignored (undefined)
    const run5 = await manager.run({
      agent: 'analyst',
      task: 'task five',
      display_name: '   ',
      name: ' \t\n ',
      mode: 'task',
    }, { cwd: tmp });
    expect(run5.results?.[0].display_name).toBeUndefined();

    // 6. bounded to short UI-safe length (80 chars)
    const longName = 'A'.repeat(120);
    const run6 = await manager.run({
      agent: 'analyst',
      task: 'task six',
      display_name: longName,
      mode: 'task',
    }, { cwd: tmp });
    expect(run6.results?.[0].display_name).toHaveLength(80);
    expect(run6.results?.[0].display_name).toBe('A'.repeat(80));

    // 7. continuation preserves display_name
    const continued = await manager.continueTask({
      task_id: run1.task_ids[0]!,
      prompt: 'resume task one',
    }, { cwd: tmp });
    expect(continued.results?.[0].display_name).toBe('Security Scan');
    expect(continued.results?.[0].attempt).toBe(2);
  });

  it('preserves immutable creation-time task ordering regardless of background activity updates (MINI-002)', async () => {
    writeAgent('worker');
    let triggerTask1Activity: ((msg: string) => void) | undefined;
    const runner: SubagentRunner = async ({ taskId, onActivity }) => {
      if (taskId?.includes('first')) {
        triggerTask1Activity = (msg: string) => {
          onActivity?.({ message: msg });
        };
      }
      return { result: 'done' };
    };

    const manager = new SubagentManager(runner);

    // Manually insert two tasks with distinct created_at timestamps into manager
    const olderTime = '2026-10-07T10:00:00.000Z';
    const newerTime = '2026-10-07T11:00:00.000Z';

    const task1: SubagentTask = {
      id: 'subtask_first',
      agent: 'worker',
      mode: 'background',
      status: 'running',
      task: 'first task (older)',
      created_at: olderTime,
      last_activity_at: olderTime,
      session_id: 'sess-1',
    };
    const task2: SubagentTask = {
      id: 'subtask_second',
      agent: 'worker',
      mode: 'background',
      status: 'running',
      task: 'second task (newer)',
      created_at: newerTime,
      last_activity_at: newerTime,
      session_id: 'sess-1',
    };

    (manager as any).tasks.set(task1.id, task1);
    (manager as any).tasks.set(task2.id, task2);
    (manager as any).taskCwds.set(task1.id, tmp);
    (manager as any).taskCwds.set(task2.id, tmp);

    // Initial list: newest-first creation order -> task2 (11:00), then task1 (10:00)
    let list = manager.listSessionTasks(tmp, 'sess-1');
    expect(list.map((t) => t.id)).toEqual(['subtask_second', 'subtask_first']);

    // Now update task1 with very recent activity (12:00:00)
    task1.last_activity_at = '2026-10-07T12:00:00.000Z';

    // List order MUST remain immutable creation-time order: task2 then task1!
    list = manager.listSessionTasks(tmp, 'sess-1');
    expect(list.map((t) => t.id)).toEqual(['subtask_second', 'subtask_first']);
  });

  it('instantiates tasks with model undefined and model_source unresolved while queued, then updates upon CPAMC claim or fallback (MINI-001)', async () => {
    writeAgent('planner');
    class TestBus {
      private handlers = new Map<string, Array<(data: any) => void>>();
      on(channel: string, handler: (data: any) => void) {
        const list = this.handlers.get(channel) ?? [];
        list.push(handler);
        this.handlers.set(channel, list);
        return () => {
          const idx = list.indexOf(handler);
          if (idx >= 0) list.splice(idx, 1);
        };
      }
      emit(channel: string, data: any) {
        for (const h of this.handlers.get(channel) ?? []) h(data);
      }
    }
    const bus = new TestBus();
    let releaseAllocation: (() => void) | undefined;
    bus.on('subagents:task:allocate', (event: SubagentTaskAllocationEvent) => {
      event.claimModel(async (_signal) => {
        await new Promise<void>((resolve) => { releaseAllocation = resolve; });
        return {
          model: { provider: 'cliproxyapi', id: 'claimed-gemini' },
          effort: 'high',
        };
      });
    });

    const runner: SubagentRunner = async () => ({ result: 'done' });
    const manager = new SubagentManager(runner, undefined, undefined, undefined, bus);
    const ctx = {
      cwd: tmp,
      model: { provider: 'anthropic', id: 'parent-claude' },
      thinkingLevel: 'low',
    };

    const runResult = await manager.run({ agent: 'planner', task: 'plan', mode: 'background' }, ctx);
    const taskId = runResult.task_ids[0]!;
    const queuedTask = manager.getTask(taskId)!;

    // While queued and waiting for allocation claim:
    expect(queuedTask.status).toBe('queued');
    expect(queuedTask.model).toBeUndefined();
    expect(queuedTask.model_source).toBe('unresolved');

    // Now release allocation claim:
    releaseAllocation?.();
    await vi.waitFor(() => expect(manager.getTask(taskId)?.status).toBe('completed'));

    const completedTask = manager.getTask(taskId)!;
    expect(completedTask.model).toBe('cliproxyapi/claimed-gemini');
    expect(completedTask.model_source).toBe('allocated');
    expect(completedTask.effort).toBe('high');
    expect(completedTask.effort_source).toBe('allocated');
  });

  it('preserves task.model as undefined when queued task is cancelled before allocation claim (MINI-001)', async () => {
    writeAgent('planner');
    class TestBus {
      private handlers = new Map<string, Array<(data: any) => void>>();
      on(channel: string, handler: (data: any) => void) {
        const list = this.handlers.get(channel) ?? [];
        list.push(handler);
        this.handlers.set(channel, list);
        return () => {
          const idx = list.indexOf(handler);
          if (idx >= 0) list.splice(idx, 1);
        };
      }
      emit(channel: string, data: any) {
        for (const h of this.handlers.get(channel) ?? []) h(data);
      }
    }
    const bus = new TestBus();
    bus.on('subagents:task:allocate', (event: SubagentTaskAllocationEvent) => {
      event.claimModel(async (_signal) => {
        // Never resolves immediately; task will be cancelled while pending
        await new Promise<void>(() => {});
        return { model: { provider: 'cliproxyapi', id: 'claimed-gemini' } };
      });
    });

    const runner: SubagentRunner = async () => ({ result: 'done' });
    const manager = new SubagentManager(runner, undefined, undefined, undefined, bus);
    const ctx = {
      cwd: tmp,
      model: { provider: 'anthropic', id: 'parent-claude' },
      thinkingLevel: 'low',
    };

    const runResult = await manager.run({ agent: 'planner', task: 'plan', mode: 'background' }, ctx);
    const taskId = runResult.task_ids[0]!;

    manager.cancel(taskId, 'user abort');
    await vi.waitFor(() => expect(manager.getTask(taskId)?.status).toBe('cancelled'));

    const cancelledTask = manager.getTask(taskId)!;
    expect(cancelledTask.model).toBeUndefined();
    expect(cancelledTask.model_source).toBe('unresolved');
  });

});
