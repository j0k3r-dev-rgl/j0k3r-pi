import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import extension from '../index.js';
import { loadSubagents, parseFrontmatter, readSubagentsConfig, resetGlobalSubagentModelProfileField, saveGlobalSubagentModelProfile } from '../src/config.js';
import { resolveEffectiveSubagentProfile } from '../src/profile-resolver.js';
import { buildPrompt } from '../src/runner.js';
import { buildModelProfileRows, buildNonTuiModelProfilesMessage, commitStagedModelProfiles, groupAvailableModelsByProvider, runSubagentModelsCommand, stageModelProfileEdit } from '../src/model-profiles-ui.js';
import { SubagentManager } from '../src/manager.js';
import { registerSubagentTools } from '../src/tools.js';
import { SubagentsHistoryPanel } from '../src/ui.js';
import type { EffectiveSubagentProfile, SubagentModelProfiles, SubagentRunner, SubagentTask } from '../src/types.js';

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

describe('subagents extension', () => {
  it('registers agent-facing tools only', () => {
    const tools: string[] = [], commands: string[] = [];
    extension({ registerTool: (tool: any) => tools.push(tool.name), registerCommand: (name: string) => commands.push(name) });
    expect(tools).toContain('subagent_run');
    expect(tools).toContain('subagent_list_agents');
    expect(tools).toContain('subagent_status');
    expect(tools).toContain('subagent_result');
    expect(commands).toEqual(['subagents', 'subagent-models']);
  });

  it('parses markdown agents with frontmatter', () => {
    const parsed = parseFrontmatter('---\nname: analyst\ntools:\n  - read\n---\n# Body');
    expect(parsed.data.name).toBe('analyst');
    expect(parsed.data.tools).toEqual(['read']);
    expect(parsed.body).toContain('# Body');
  });

  it('loads agent names from markdown files and config default model/effort', () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'analyst.md'), `---\nname: analyst\ndescription: analyst agent\nmodel: anthropic/claude-sonnet-4-5\neffort: high\ntools:\n  - read\n---\n# Agent`);
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ default_model: 'openai/gpt-5.2', default_effort: 'medium', stall_timeout_ms: 10 }));
    const agents = loadSubagents(tmp);
    const config = readSubagentsConfig(tmp);
    expect(agents.map((a) => a.name)).toEqual(['analyst']);
    expect(agents[0].model).toEqual({ provider: 'anthropic', id: 'claude-sonnet-4-5' });
    expect(agents[0].effort).toBe('high');
    expect(config.default_model).toEqual({ provider: 'openai', id: 'gpt-5.2' });
    expect(config.default_effort).toBe('medium');
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

  it('loads model_profiles from global and project config with invalid fields ignored', () => {
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'subagents.json'), JSON.stringify({
      model_profiles: {
        analyst: { model: 'anthropic/claude-sonnet-4-5', effort: 'high' },
        invalidEffort: { model: 'openai/gpt-5.2', effort: 'extreme' },
        invalidModel: { model: 'missing-provider', effort: 'low' },
      },
    }));
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({
      model_profiles: {
        reviewer: { model: { provider: 'openai', id: 'gpt-5.2-codex' }, effort: 'medium' },
      },
    }));

    const config = withAgentDir(agentDir, () => readSubagentsConfig(tmp));

    expect(config.model_profiles).toEqual({
      analyst: { model: { provider: 'anthropic', id: 'claude-sonnet-4-5' }, effort: 'high' },
      invalidEffort: { model: { provider: 'openai', id: 'gpt-5.2' } },
      invalidModel: { effort: 'low' },
      reviewer: { model: { provider: 'openai', id: 'gpt-5.2-codex' }, effort: 'medium' },
    });
  });

  it('defaults missing model_profiles to an empty map and preserves legacy config behavior', () => {
    const agentDir = path.join(tmp, 'isolated-global-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({
      default_model: 'openai/gpt-5.2',
      default_effort: 'medium',
      timeout_ms: 123,
      stall_timeout_ms: 45,
      max_concurrency: 3,
      default_tools: ['read', 'subagent_run', 'memory_search'],
    }));

    const config = withAgentDir(agentDir, () => readSubagentsConfig(tmp));

    expect(config.model_profiles).toEqual({});
    expect(config.default_model).toEqual({ provider: 'openai', id: 'gpt-5.2' });
    expect(config.default_effort).toBe('medium');
    expect(config.timeout_ms).toBe(123);
    expect(config.stall_timeout_ms).toBe(45);
    expect(config.max_concurrency).toBe(3);
    expect(config.default_tools).toEqual(['read', 'memory_search']);
  });

  it('deep-merges model_profiles with project field precedence while scalar config precedence is unchanged', () => {
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'subagents.json'), JSON.stringify({
      default_model: 'global/model',
      default_effort: 'low',
      timeout_ms: 100,
      stall_timeout_ms: 200,
      max_concurrency: 1,
      default_tools: ['read'],
      model_profiles: {
        analyst: { model: 'global/analyst', effort: 'low' },
        reviewer: { effort: 'minimal' },
      },
    }));
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({
      default_model: 'project/model',
      default_effort: 'high',
      timeout_ms: 300,
      stall_timeout_ms: 400,
      max_concurrency: 2,
      default_tools: ['memory_search'],
      model_profiles: {
        analyst: { effort: 'xhigh' },
        reviewer: { model: 'project/reviewer' },
      },
    }));

    const config = withAgentDir(agentDir, () => readSubagentsConfig(tmp));

    expect(config.model_profiles).toEqual({
      analyst: { model: { provider: 'global', id: 'analyst' }, effort: 'xhigh' },
      reviewer: { model: { provider: 'project', id: 'reviewer' }, effort: 'minimal' },
    });
    expect(config.default_model).toEqual({ provider: 'project', id: 'model' });
    expect(config.default_effort).toBe('high');
    expect(config.timeout_ms).toBe(300);
    expect(config.stall_timeout_ms).toBe(400);
    expect(config.max_concurrency).toBe(2);
    expect(config.default_tools).toEqual(['memory_search']);
  });

  it('saves global model profiles without dropping supported or unknown config keys', () => {
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'subagents.json'), JSON.stringify({
      default_model: 'openai/gpt-5.2',
      timeout_ms: 600,
      future_unknown_key: { keep: true },
      model_profiles: { reviewer: { effort: 'medium' } },
    }));

    saveGlobalSubagentModelProfile({ agentName: 'analyst', profile: { model: { provider: 'anthropic', id: 'claude-sonnet-4-5' }, effort: 'high' }, agentDir });

    const text = fs.readFileSync(path.join(agentDir, 'subagents.json'), 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({
      default_model: 'openai/gpt-5.2',
      timeout_ms: 600,
      future_unknown_key: { keep: true },
      model_profiles: {
        reviewer: { effort: 'medium' },
        analyst: { model: 'anthropic/claude-sonnet-4-5', effort: 'high' },
      },
    });
  });

  it('creates global config and removes empty profile entries after resets', () => {
    const agentDir = path.join(tmp, 'global-agent');
    saveGlobalSubagentModelProfile({ agentName: 'analyst', profile: { model: { provider: 'openai', id: 'gpt-5.2' } }, agentDir });
    resetGlobalSubagentModelProfileField({ agentName: 'analyst', field: 'model', agentDir });

    const text = fs.readFileSync(path.join(agentDir, 'subagents.json'), 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({});
  });

  it('resolves effective subagent profile with independent precedence and provenance labels', () => {
    const definition = {
      name: 'analyst',
      description: 'analyst',
      filePath: 'analyst.md',
      instructions: '# Analyst',
      model: { provider: 'definition', id: 'model' },
      effort: 'medium' as const,
      tools: ['read'],
    };
    const config = {
      default_model: { provider: 'default', id: 'model' },
      default_effort: 'low' as const,
      timeout_ms: 1,
      stall_timeout_ms: 1,
      max_concurrency: 1,
      default_tools: ['read'],
      model_profiles: { analyst: { model: { provider: 'profile', id: 'model' } } },
    };

    const resolved = resolveEffectiveSubagentProfile({
      agentName: 'analyst',
      definition,
      config,
      ctx: { model: { provider: 'orchestrator', id: 'model' }, pi: { getThinkingLevel: () => 'xhigh' } },
    });

    expect(resolved.model).toMatchObject({ value: { provider: 'profile', id: 'model' }, source: 'profile', label: 'profile: profile/model' });
    expect(resolved.effort).toMatchObject({ value: 'medium', source: 'definition', label: 'definition: medium' });
  });

  it('resolves definition defaults and orchestrator fallbacks independently', () => {
    const baseDefinition = { name: 'reviewer', description: 'reviewer', filePath: 'reviewer.md', instructions: '# Reviewer', tools: ['read'] };
    const config = { timeout_ms: 1, stall_timeout_ms: 1, max_concurrency: 1, default_tools: ['read'], model_profiles: { reviewer: { effort: 'high' as const } } };

    expect(resolveEffectiveSubagentProfile({
      agentName: 'reviewer',
      definition: baseDefinition,
      config,
      ctx: { model: { provider: 'orchestrator', id: 'model' }, thinkingLevel: 'low' },
    })).toMatchObject({
      model: { value: { provider: 'orchestrator', id: 'model' }, source: 'orchestrator', label: 'orchestrator: orchestrator/model' },
      effort: { value: 'high', source: 'profile', label: 'profile: high' },
    });

    expect(resolveEffectiveSubagentProfile({
      agentName: 'reviewer',
      definition: baseDefinition,
      config: { ...config, default_model: { provider: 'default', id: 'model' }, default_effort: 'minimal' as const, model_profiles: {} },
      ctx: { model: { provider: 'orchestrator', id: 'model' }, thinkingLevel: 'low' },
    })).toMatchObject({
      model: { value: { provider: 'default', id: 'model' }, source: 'default', label: 'default: default/model' },
      effort: { value: 'minimal', source: 'default', label: 'default: minimal' },
    });
  });

  it('builds model profile rows for loaded agents and known SDD phases with labels', () => {
    writeAgent('analyst');
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({
      model_profiles: {
        analyst: { model: 'missing/provider-model', effort: 'high' },
        'sdd-spec': { effort: 'medium' },
      },
    }));
    const definitions = loadSubagents(tmp);
    const config = readSubagentsConfig(tmp);
    const rows = buildModelProfileRows({
      definitions,
      config,
      ctx: { model: { provider: 'openai', id: 'gpt-5.2' }, thinkingLevel: 'low' },
      availableModels: [{ provider: 'openai', id: 'gpt-5.2' }],
    });

    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining(['analyst', 'sdd-explore', 'sdd-spec', 'sdd-apply', 'sdd-verify']));
    expect(rows.find((row) => row.name === 'analyst')).toMatchObject({
      explicitProfile: { model: { provider: 'missing', id: 'provider-model' }, effort: 'high' },
      modelLabel: 'profile: missing/provider-model (unavailable)',
      effortLabel: 'profile: high',
    });
    expect(rows.find((row) => row.name === 'sdd-explore')).toMatchObject({ modelLabel: 'orchestrator: openai/gpt-5.2', effortLabel: 'orchestrator: low' });
    expect(rows.find((row) => row.name === 'sdd-spec')).toMatchObject({ effortLabel: 'profile: medium' });
  });

  it('groups available models by provider for provider and model selection', () => {
    expect(groupAvailableModelsByProvider([
      { provider: 'openai', id: 'gpt-5.2' },
      { provider: 'anthropic', name: 'claude-sonnet-4-5' },
      { provider: { id: 'openai' }, model: 'gpt-5.2-codex' },
    ])).toEqual({
      anthropic: [{ provider: 'anthropic', id: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' }],
      openai: [
        { provider: 'openai', id: 'gpt-5.2', label: 'gpt-5.2' },
        { provider: 'openai', id: 'gpt-5.2-codex', label: 'gpt-5.2-codex' },
      ],
    });
  });

  it('stages selected row edits and reset operations without changing other rows', () => {
    let staged: SubagentModelProfiles = {
      analyst: { model: { provider: 'openai', id: 'gpt-5.2' }, effort: 'high' as const },
      reviewer: { effort: 'medium' as const },
    };

    staged = stageModelProfileEdit(staged, { agentName: 'analyst', model: { provider: 'anthropic', id: 'claude-sonnet-4-5' }, effort: 'low' });
    expect(staged.analyst).toEqual({ model: { provider: 'anthropic', id: 'claude-sonnet-4-5' }, effort: 'low' });
    expect(staged.reviewer).toEqual({ effort: 'medium' });

    staged = stageModelProfileEdit(staged, { agentName: 'analyst', reset: 'model' });
    expect(staged.analyst).toEqual({ effort: 'low' });
    staged = stageModelProfileEdit(staged, { agentName: 'analyst', reset: 'effort' });
    expect(staged.analyst).toEqual({});
    staged = stageModelProfileEdit(staged, { agentName: 'reviewer', reset: 'row' });
    expect(staged.reviewer).toEqual({});
  });

  it('commits staged model profile saves and leaves config unchanged on cancel', () => {
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'subagents.json'), JSON.stringify({
      default_model: 'openai/gpt-5.2',
      model_profiles: {
        analyst: { model: 'openai/gpt-5.2', effort: 'high' },
        reviewer: { effort: 'medium' },
      },
    }));
    const beforeCancel = fs.readFileSync(path.join(agentDir, 'subagents.json'), 'utf8');
    expect(commitStagedModelProfiles({ agentDir, stagedProfiles: { analyst: {} }, save: false })).toMatch(/Cancelled/);
    expect(fs.readFileSync(path.join(agentDir, 'subagents.json'), 'utf8')).toBe(beforeCancel);

    const message = commitStagedModelProfiles({
      agentDir,
      stagedProfiles: {
        analyst: { effort: 'low' },
        reviewer: {},
        'sdd-apply': { model: { provider: 'anthropic', id: 'claude-sonnet-4-5' } },
      },
      save: true,
    });

    expect(message).toContain('Saved subagent model profiles');
    expect(JSON.parse(fs.readFileSync(path.join(agentDir, 'subagents.json'), 'utf8'))).toEqual({
      default_model: 'openai/gpt-5.2',
      model_profiles: {
        analyst: { effort: 'low' },
        'sdd-apply': { model: 'anthropic/claude-sonnet-4-5' },
      },
    });
  });

  it('returns non-TUI fallback text with the global subagents config path', async () => {
    const message = buildNonTuiModelProfilesMessage('/home/example/.pi/agent');
    expect(message).toContain('subagent model profiles require Pi TUI');
    expect(message).toContain('/home/example/.pi/agent/subagents.json');

    await expect(runSubagentModelsCommand({ cwd: tmp })).resolves.toContain(path.join(os.homedir(), '.pi', 'agent', 'subagents.json'));
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

  it('loads project subagents with no delegation tools and memory writes only for sdd agents', () => {
    const repoRoot = path.resolve(process.cwd(), '..', '..', '..');
    const agents = loadSubagents(repoRoot);
    expect(agents.map((agent) => agent.name).sort()).toEqual([
      'discovery',
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
      if (agent.name.startsWith('sdd-')) {
        expect(agent.tools).toContain('memory_add');
        expect(agent.tools).toContain('memory_update');
      } else {
        expect(agent.tools).not.toContain('memory_add');
        expect(agent.tools).not.toContain('memory_update');
      }
      expect(agent.tools.some((tool) => tool.startsWith('subagent_'))).toBe(false);
    }
  });

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
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({
      model_profiles: { analyst: { model: 'profile/model', effort: 'xhigh' } },
    }));
    const seenUpdates: SubagentTask[][] = [];
    let runnerProfile: EffectiveSubagentProfile | undefined;
    const runner: SubagentRunner = async ({ effectiveProfile }) => {
      runnerProfile = effectiveProfile;
      return { result: 'profiled result', model: effectiveProfile?.model.label.replace(/^profile: /, ''), effort: effectiveProfile?.effort.value, fallback_used: false };
    };
    const manager = new SubagentManager(runner);

    const result = await manager.run(
      { agent: 'analyst', task: 'profiled work', mode: 'task' },
      { cwd: tmp, model: { provider: 'orchestrator', id: 'model' }, thinkingLevel: 'low' },
      undefined,
      (tasks) => seenUpdates.push(tasks.map((task) => ({ ...task }))),
    );

    const queued = seenUpdates.flat().find((task) => task.status === 'queued');
    expect(queued).toMatchObject({ model: 'profile/model', effort: 'xhigh', model_source: 'profile', effort_source: 'profile' });
    expect(runnerProfile).toMatchObject({
      agent: 'analyst',
      model: { value: { provider: 'profile', id: 'model' }, source: 'profile', label: 'profile: profile/model' },
      effort: { value: 'xhigh', source: 'profile', label: 'profile: xhigh' },
    });
    expect(result.results?.[0]).toMatchObject({ model: 'profile/model', effort: 'xhigh', model_source: 'profile', effort_source: 'profile' });
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
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ model_profiles: { analyst: { effort: 'high' } } }));
    const manager = new SubagentManager(async ({ effectiveProfile }) => ({
      result: 'source-aware result',
      model: effectiveProfile?.model.label.replace(/^orchestrator: /, ''),
      effort: effectiveProfile?.effort.value,
      fallback_used: false,
    }));
    const result = await manager.run({ agent: 'analyst', task: 'source metadata', mode: 'task' }, { cwd: tmp, model: { provider: 'mock', id: 'model' } });
    const freshManager = new SubagentManager(mockRunner());
    const persisted = freshManager.getTask(result.task_ids[0], tmp);
    expect(persisted).toMatchObject({ model: 'mock/model', effort: 'high', model_source: 'orchestrator', effort_source: 'profile' });
  });

  it('renders agent, model, and effort as explicit labels in tool results', async () => {
    writeAgent('analyst');
    const manager = new SubagentManager(async () => ({ result: 'clear render', model: 'mock/model', effort: 'high', fallback_used: false }));
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);
    const result = await runTool.execute('1', { agent: 'analyst', task: 'render clearly', mode: 'task' }, undefined, undefined, { cwd: tmp });
    const rendered = runTool.renderResult(result, { isPartial: false }, { fg: (_name: string, text: string) => text }).render(200).join('\n');
    expect(rendered).toContain('agent: analyst');
    expect(rendered).toContain('model: mock/model');
    expect(rendered).toContain('effort: high');
  });

  it('renders agent, model, and effort as explicit labels in the history panel', () => {
    const task: SubagentTask = {
      id: 'subtask_analyst_1',
      agent: 'analyst',
      mode: 'task',
      status: 'running',
      task: 'render panel clearly',
      created_at: new Date().toISOString(),
      last_activity: 'started',
      model: 'mock/model',
      effort: 'xhigh',
    };
    const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, () => false, (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text);
    const rendered = panel.render(160).join('\n');
    expect(rendered).toContain('agent: analyst');
    expect(rendered).toContain('model: mock/model');
    expect(rendered).toContain('effort: xhigh');
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

  it('prompts for the latest nested permission payload when subagent output contains stale permission markers', async () => {
    writeAgent('analyst');
    const stalePayload = {
      type: 'permission_required',
      requestId: 'req-stale',
      tool: 'read',
      action: 'read',
      origin: 'subagent',
      reason: 'Stale read approval.',
      reasonCode: 'outside_workspace_read_requires_approval',
      riskLevel: 'medium',
      prompt: {
        title: 'Permission required for read',
        message: 'Stale read approval.',
        choices: ['Allow once', 'Allow for session', 'Allow for project', 'Deny'],
        safeTarget: '/tmp/stale.txt',
      },
      sessionScope: {
        cacheKey: 'target:test-policy:read:read:/tmp/stale.txt',
        action: 'read',
        tool: 'read',
        targetPattern: '/tmp/stale.txt',
        policyIdentity: 'test-policy',
      },
    };
    const latestPayload = {
      type: 'permission_required',
      requestId: 'req-latest',
      tool: 'bash',
      action: 'bash',
      origin: 'subagent',
      reason: 'Latest bash approval.',
      reasonCode: 'bash_default_requires_approval',
      riskLevel: 'medium',
      prompt: {
        title: 'Permission required for bash',
        message: 'Latest bash approval.',
        choices: ['Allow once', 'Allow for session', 'Allow for project', 'Deny'],
        safeCommandSummary: 'find .pi/extensions/permission-guard -maxdepth 4 -type f',
      },
      sessionScope: {
        cacheKey: 'bash:test-policy:find .pi/extensions/permission-guard -maxdepth 4 -type f',
        action: 'bash',
        tool: 'bash',
        commandPattern: 'find .pi/extensions/permission-guard -maxdepth 4 -type f',
        policyIdentity: 'test-policy',
      },
    };
    const output = [
      `permission_required:${JSON.stringify(stalePayload)}`,
      'intermediate transcript',
      `permission_required:${JSON.stringify(latestPayload)}`,
    ].join('\n');
    const runner = vi.fn(async () => ({ result: output, model: 'mock/model', fallback_used: false }));
    const manager = new SubagentManager(runner);
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);
    const select = vi.fn(async (message: string, choices: string[]) => {
      expect(choices).toEqual(['Allow once', 'Allow for session', 'Allow for project', 'Deny']);
      expect(message).toContain('Latest bash approval.');
      expect(message).toContain('find .pi/extensions/permission-guard -maxdepth 4 -type f');
      expect(message).not.toContain('/tmp/stale.txt');
      return 'Deny';
    });

    const result = await runTool.execute('1', { agent: 'analyst', task: 'inspect permissions', mode: 'task' }, undefined, undefined, { cwd: tmp, ui: { select } });

    expect(select).toHaveBeenCalledOnce();
    expect(runner).toHaveBeenCalledOnce();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Subagent permission denied by main user: bash_default_requires_approval');
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
