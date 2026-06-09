import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import extension from '../index.js';
import { loadSubagents, parseFrontmatter, readSubagentsConfig } from '../src/config.js';
import { buildPrompt } from '../src/runner.js';
import { SubagentManager } from '../src/manager.js';
import { registerSubagentTools } from '../src/tools.js';
import type { SubagentRunner } from '../src/types.js';

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagents-test-')); fs.mkdirSync(path.join(tmp, '.pi', 'subagents'), { recursive: true }); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function writeAgent(name: string, body = '# Agent\nhello') {
  fs.writeFileSync(path.join(tmp, '.pi', 'subagents', `${name}.md`), `---\nname: ${name}\ndescription: ${name} agent\ntools:\n  - read\n  - memory_search\n---\n${body}`);
}

function mockRunner(delay = 0): SubagentRunner {
  return async ({ definition, task }) => {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    return { result: `${definition.name} handled ${task}`, model: 'mock/model', fallback_used: false };
  };
}

describe('subagents extension', () => {
  it('registers agent-facing tools only', () => {
    const tools: string[] = [], commands: string[] = [];
    extension({ registerTool: (tool: any) => tools.push(tool.name), registerCommand: (name: string) => commands.push(name) });
    expect(tools).toContain('subagent_run');
    expect(tools).toContain('subagent_list_agents');
    expect(tools).toContain('subagent_status');
    expect(tools).toContain('subagent_result');
    expect(commands).toEqual(['subagents']);
  });

  it('parses markdown agents with frontmatter', () => {
    const parsed = parseFrontmatter('---\nname: analyst\ntools:\n  - read\n---\n# Body');
    expect(parsed.data.name).toBe('analyst');
    expect(parsed.data.tools).toEqual(['read']);
    expect(parsed.body).toContain('# Body');
  });

  it('loads agent names from markdown files and config default model', () => {
    writeAgent('analyst');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ default_model: 'openai/gpt-5.2', stall_timeout_ms: 10 }));
    const agents = loadSubagents(tmp);
    const config = readSubagentsConfig(tmp);
    expect(agents.map((a) => a.name)).toEqual(['analyst']);
    expect(config.default_model).toEqual({ provider: 'openai', id: 'gpt-5.2' });
    expect(config.stall_timeout_ms).toBe(10);
  });

  it('falls back for invalid numeric config values', () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ max_concurrency: 'bad', timeout_ms: 'bad', stall_timeout_ms: -1 }));
    const config = readSubagentsConfig(tmp);
    expect(config.max_concurrency).toBe(5);
    expect(config.timeout_ms).toBe(600000);
    expect(config.stall_timeout_ms).toBe(120000);
  });

  it('loads global subagents and lets project-local agents/config override them', () => {
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(path.join(agentDir, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'subagents', 'analyst.md'), `---\nname: analyst\ndescription: global analyst\ntools:\n  - read\n---\n# Global Analyst`);
    fs.writeFileSync(path.join(agentDir, 'subagents', 'reviewer.md'), `---\nname: reviewer\ndescription: global reviewer\ntools:\n  - read\n---\n# Global Reviewer`);
    fs.writeFileSync(path.join(agentDir, 'subagents.json'), JSON.stringify({ max_concurrency: 1, default_tools: ['read'] }));
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'analyst.md'), `---\nname: analyst\ndescription: project analyst\ntools:\n  - memory_search\n---\n# Project Analyst`);
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ max_concurrency: 2 }));
    const old = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const agents = loadSubagents(tmp);
    const config = readSubagentsConfig(tmp);
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    expect(agents.map((a) => `${a.name}:${a.description}`).sort()).toEqual(['analyst:project analyst', 'reviewer:global reviewer']);
    expect(config.max_concurrency).toBe(2);
    expect(config.default_tools).toEqual(['read']);
  });

  it('filters delegation tools from subagent tool allowlists', () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'analyst.md'), `---\nname: analyst\ntools:\n  - read\n  - subagent_run\n  - subagent_result\n  - memory_search\n---\n# Agent`);
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ default_tools: ['read', 'subagent_run', 'memory_search'] }));
    const agents = loadSubagents(tmp);
    const config = readSubagentsConfig(tmp);
    expect(agents[0].tools).toEqual(['read', 'memory_search']);
    expect(config.default_tools).toEqual(['read', 'memory_search']);
  });

  it('allows sdd agents to receive memory write tools while still blocking delegation tools', () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'sdd-explore.md'), `---\nname: sdd-explore\ntools:\n  - read\n  - memory_search\n  - memory_get\n  - memory_add\n  - memory_update\n  - subagent_run\n---\n# SDD Explore`);
    const agents = loadSubagents(tmp);
    expect(agents[0].tools).toEqual(['read', 'memory_search', 'memory_get', 'memory_add', 'memory_update']);
  });

  it('builds read-only memory constraints when no memory write tools are available', () => {
    const prompt = buildPrompt({ name: 'analyst', description: 'analyst', filePath: 'analyst.md', instructions: '# Analyst', tools: ['read', 'memory_search', 'memory_get'] }, 'inspect', undefined, ['read', 'memory_search', 'memory_get']);
    expect(prompt).toContain('use memory tools read-only');
    expect(prompt).toContain('do not save durable memory');
  });

  it('builds sdd flow memory write constraints without read-only contradiction', () => {
    const prompt = buildPrompt({ name: 'sdd-explore', description: 'sdd', filePath: 'sdd-explore.md', instructions: '# SDD Explore', tools: ['read', 'memory_search', 'memory_get', 'memory_add', 'memory_update'] }, 'explore feature', undefined, ['read', 'memory_search', 'memory_get', 'memory_add', 'memory_update']);
    expect(prompt).toContain('may create or update memory only for the active sdd flow');
    expect(prompt).toContain('search for the existing sdd flow memory before writing');
    expect(prompt).toContain('when artifact_store is memory');
    expect(prompt).not.toContain('do not save durable memory');
    expect(prompt).not.toContain('use memory tools read-only');
  });

  it('loads only project sdd subagents with memory write tools and no delegation tools', () => {
    const repoRoot = path.resolve(process.cwd(), '..', '..', '..');
    const agents = loadSubagents(repoRoot);
    expect(agents.map((agent) => agent.name).sort()).toEqual([
      'sdd-apply',
      'sdd-archive',
      'sdd-design',
      'sdd-explore',
      'sdd-proposal',
      'sdd-spec',
      'sdd-task',
      'sdd-verify',
    ]);
    for (const agent of agents) {
      expect(agent.tools).toContain('memory_add');
      expect(agent.tools).toContain('memory_update');
      expect(agent.tools.some((tool) => tool.startsWith('subagent_'))).toBe(false);
    }
  });

  it('runs one subagent as task and waits for result', async () => {
    writeAgent('analyst');
    const manager = new SubagentManager(mockRunner());
    const result = await manager.run({ agent: 'analyst', task: 'check scope', mode: 'task' }, { cwd: tmp });
    expect(result.results?.[0].status).toBe('completed');
    expect(result.results?.[0].result).toContain('analyst handled check scope');
  });

  it('runs multiple subagents in one task call', async () => {
    writeAgent('analyst');
    writeAgent('reviewer');
    const manager = new SubagentManager(mockRunner());
    const result = await manager.run({ agents: ['analyst', 'reviewer'], task: 'review plan', mode: 'task' }, { cwd: tmp });
    expect(result.task_ids.length).toBe(2);
    expect(result.results?.map((r) => r.agent).sort()).toEqual(['analyst', 'reviewer']);
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

  it('enforces configured timeout_ms even when runner ignores abort', async () => {
    writeAgent('analyst');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ timeout_ms: 20 }));
    const runner: SubagentRunner = async () => new Promise(() => {});
    const manager = new SubagentManager(runner);
    const result = await manager.run({ agent: 'analyst', task: 'timeout', mode: 'task' }, { cwd: tmp });
    expect(result.results?.[0].status).toBe('failed');
    expect(result.results?.[0].error).toContain('timed out');
  });

  it('starts background tasks and notifies completion', async () => {
    writeAgent('analyst');
    const notifications: string[] = [];
    const manager = new SubagentManager(mockRunner(20));
    const result = await manager.run({ agent: 'analyst', task: 'background work', mode: 'background' }, { cwd: tmp, ui: { notify: (msg: string) => notifications.push(msg) } });
    expect(result.results).toBeUndefined();
    const id = result.task_ids[0];
    expect(manager.getTask(id)?.status).toMatch(/queued|running/);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(manager.getTask(id)?.status).toBe('completed');
    expect(notifications.some((n) => n.includes('completed'))).toBe(true);
  });

  it('cancels running background tasks', async () => {
    writeAgent('analyst');
    const manager = new SubagentManager(mockRunner(100));
    const result = await manager.run({ agent: 'analyst', task: 'slow work', mode: 'background' }, { cwd: tmp });
    const task = manager.cancel(result.task_ids[0]);
    expect(task.status).toBe('cancelled');
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

  it('persists subagent usage stats for token display', async () => {
    writeAgent('analyst');
    const runner: SubagentRunner = async () => ({
      result: 'usage-aware result',
      model: 'mock/model',
      fallback_used: false,
      usage: { input: 1200, output: 300, cacheRead: 40, cacheWrite: 5, cost: 0.01, contextTokens: 1545, turns: 1 },
    });
    const manager = new SubagentManager(runner);
    const result = await manager.run({ agent: 'analyst', task: 'measure usage', mode: 'task' }, { cwd: tmp });
    const id = result.task_ids[0];
    const freshManager = new SubagentManager(mockRunner());
    const persisted = freshManager.getTask(id, tmp);
    expect(persisted?.usage).toEqual({ input: 1200, output: 300, cacheRead: 40, cacheWrite: 5, cost: 0.01, contextTokens: 1545, turns: 1 });
  });

  it('returns an error tool result when any task-mode subagent fails', async () => {
    writeAgent('analyst');
    const manager = new SubagentManager(async () => { throw new Error('review failed'); });
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);
    const result = await runTool.execute('1', { agent: 'analyst', task: 'fail', mode: 'task' }, undefined, undefined, { cwd: tmp });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('failed');
  });

  it('prompts the main thread and stops the subagent when a nested permission request is denied', async () => {
    writeAgent('analyst');
    const payload = {
      type: 'permission_required',
      requestId: 'req-deny',
      tool: 'read',
      action: 'read',
      origin: 'subagent',
      reason: 'Outside-workspace read requires approval.',
      reasonCode: 'outside_workspace_read_requires_approval',
      riskLevel: 'medium',
      prompt: {
        title: 'Permission required for read',
        message: 'Outside-workspace read requires approval.',
        choices: ['Allow once', 'Allow for session', 'Allow for project', 'Deny'],
        safeTarget: '/tmp/outside.txt',
      },
      sessionScope: {
        cacheKey: 'target:test-policy:read:read:/tmp/outside.txt',
        action: 'read',
        tool: 'read',
        targetPattern: '/tmp/outside.txt',
        policyIdentity: 'test-policy',
      },
    };
    const marker = `permission_required:${JSON.stringify(payload)}`;
    const runner = vi.fn(async () => ({ result: marker, model: 'mock/model', fallback_used: false }));
    const manager = new SubagentManager(runner);
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);
    const select = vi.fn(async (_message: string, choices: string[]) => {
      expect(choices).toEqual(['Allow once', 'Allow for session', 'Allow for project', 'Deny']);
      return 'Deny';
    });

    const result = await runTool.execute('1', { agent: 'analyst', task: 'read outside', mode: 'task' }, undefined, undefined, { cwd: tmp, ui: { select } });

    expect(select).toHaveBeenCalledOnce();
    expect(runner).toHaveBeenCalledOnce();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Subagent permission denied by main user');
  });

  it('records an allow-for-project decision in project permissions and retries the subagent task successfully', async () => {
    writeAgent('analyst');
    const payload = {
      type: 'permission_required',
      requestId: 'req-project',
      tool: 'bash',
      action: 'bash',
      origin: 'subagent',
      reason: 'Bash command requires approval.',
      reasonCode: 'bash_default_requires_approval',
      riskLevel: 'medium',
      prompt: {
        title: 'Permission required for bash',
        message: 'Bash command requires approval.',
        choices: ['Allow once', 'Allow for session', 'Allow for project', 'Deny'],
        safeCommandSummary: 'npm --prefix .pi/extensions/permission-guard test -- --run',
      },
      sessionScope: {
        cacheKey: 'bash:test-policy:npm --prefix .pi/extensions/permission-guard test -- --run',
        action: 'bash',
        tool: 'bash',
        commandPattern: 'npm --prefix .pi/extensions/permission-guard test -- --run',
        policyIdentity: 'test-policy',
      },
      projectScope: {
        safeCommandPattern: 'regex:^npm\\s+--prefix\\s+(?!/|~|\\.\\.(?:/|$)|.*\\/\\.\\.(?:/|$))[A-Za-z0-9._/@+-]+\\s+test\\s+--\\s+--run$',
      },
    };
    const marker = `permission_required:${JSON.stringify(payload)}`;
    let attempts = 0;
    const runner = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) return { result: marker, model: 'mock/model', fallback_used: false };
      const saved = JSON.parse(fs.readFileSync(path.join(tmp, '.pi', 'permissions.json'), 'utf8'));
      expect(saved.bash.safeCommands).toContain(payload.projectScope.safeCommandPattern);
      return { result: 'command succeeded after project approval', model: 'mock/model', fallback_used: false };
    });
    const manager = new SubagentManager(runner);
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);
    const select = vi.fn(async (_message: string, choices: string[]) => {
      expect(choices).toEqual(['Allow once', 'Allow for session', 'Allow for project', 'Deny']);
      return 'Allow for project';
    });

    const result = await runTool.execute('1', { agent: 'analyst', task: 'run project-safe command', mode: 'task' }, undefined, undefined, { cwd: tmp, ui: { select } });

    expect(select).toHaveBeenCalledOnce();
    expect(runner).toHaveBeenCalledTimes(2);
    expect(result.isError).toBeUndefined();
    expect(result.details.results[0].result).toContain('command succeeded after project approval');
  });

  it('records a main-thread allow-once decision and retries the subagent task successfully', async () => {
    writeAgent('analyst');
    const registryKey = Symbol.for('pi.permissionGuard.mainThreadApprovals');
    const holder = globalThis as Record<symbol, unknown>;
    const previousRegistry = holder[registryKey];
    delete holder[registryKey];
    const payload = {
      type: 'permission_required',
      requestId: 'req-allow',
      tool: 'read',
      action: 'read',
      origin: 'subagent',
      reason: 'Outside-workspace read requires approval.',
      reasonCode: 'outside_workspace_read_requires_approval',
      riskLevel: 'medium',
      prompt: {
        title: 'Permission required for read',
        message: 'Outside-workspace read requires approval.',
        choices: ['Allow once', 'Allow for session', 'Allow for project', 'Deny'],
        safeTarget: '/tmp/outside.txt',
      },
      sessionScope: {
        cacheKey: 'target:test-policy:read:read:/tmp/outside.txt',
        action: 'read',
        tool: 'read',
        targetPattern: '/tmp/outside.txt',
        policyIdentity: 'test-policy',
      },
    };
    const marker = `permission_required:${JSON.stringify(payload)}`;
    let attempts = 0;
    const runner = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) return { result: marker, model: 'mock/model', fallback_used: false };
      const registry = holder[registryKey] as Map<string, any> | undefined;
      expect([...(registry?.values() ?? [])]).toContainEqual(expect.objectContaining({
        mode: 'once',
        action: 'read',
        tool: 'read',
        targetPattern: '/tmp/outside.txt',
        policyIdentity: 'test-policy',
      }));
      return { result: 'read succeeded after approval', model: 'mock/model', fallback_used: false };
    });
    const manager = new SubagentManager(runner);
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);
    const select = vi.fn(async (_message: string, choices: string[]) => {
      expect(choices).toEqual(['Allow once', 'Allow for session', 'Allow for project', 'Deny']);
      return 'Allow once';
    });

    try {
      const result = await runTool.execute('1', { agent: 'analyst', task: 'read outside', mode: 'task' }, undefined, undefined, { cwd: tmp, ui: { select } });

      expect(select).toHaveBeenCalledOnce();
      expect(runner).toHaveBeenCalledTimes(2);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('completed');
      expect(result.details.results[0].result).toContain('read succeeded after approval');
    } finally {
      if (previousRegistry === undefined) delete holder[registryKey];
      else holder[registryKey] = previousRegistry;
    }
  });
});
