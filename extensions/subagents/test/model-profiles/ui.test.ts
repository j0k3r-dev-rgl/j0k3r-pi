import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import extension, { ClaudeBackgroundWidget, ClaudeBackgroundWidgetState, completionMessage, createSubagentsPanelKeyMatcher, moveClaudeBackgroundWidgetSelection, renderClaudeBackgroundWidgetLines, resolveRegisteredToolDefinition, sendSubagentCompletionMessage } from '../../index.js';
import { loadSubagents, parseFrontmatter, readSubagentsConfig, resetGlobalSubagentModelProfileField, saveGlobalSubagentModelProfile, subagentSourceWarnings } from '../../src/config.js';
import { resolveEffectiveSubagentProfile } from '../../src/profile-resolver.js';
import { buildPrompt, ThreadSnapshotBuilder } from '../../src/runner.js';
import { SubagentStructuredError, deriveErrorString, normalizeErrorMetadata, parseErrorMetadata, safeErrorMetadataDetails, serializeErrorMetadata } from '../../src/error-metadata.js';
import { applyDirtyProfileEdit, buildModelProfileRows, buildNoChangesModelProfilesMessage, buildNonTuiModelProfilesMessage, commitStagedModelProfiles, createSubagentModelProfilesModal, globalSubagentsConfigPath, groupAvailableModelsByProvider, runSubagentModelsCommand, stageModelProfileEdit } from '../../src/model-profiles-ui.js';
import { resolveSubagentHistoryDbPath, resolveSubagentsHistoryHome, SubagentHistoryStore } from '../../src/history.js';
import { isSubagentsDebugEnabled, writeSubagentsDebugLog } from '../../src/debug.js';
import { createSubagentsRenderLogger, DEFAULT_RENDER_DEBUG_LOG_PATH } from '../../src/render-debug.js';
import { SubagentManager } from '../../src/manager.js';
import { registerSubagentTools } from '../../src/tools.js';
import { SubagentsHistoryPanel } from '../../src/ui.js';
import { boundThreadSnapshot, isValidThreadSnapshot, registerSubagentRuntimeToolDefinition, renderThreadBody, resetPiComponentCacheForTests } from '../../src/thread-view.js';
import type { EffectiveSubagentProfile, SubagentErrorMetadata, SubagentModelProfiles, SubagentRunner, SubagentTask } from '../../src/types.js';

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

describe('model profiles ui', () => {
  it('keeps project model_profiles precedence while scalar config precedence is unchanged', () => {
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
      analyst: { effort: 'xhigh' },
      reviewer: { model: { provider: 'project', id: 'reviewer' } },
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

  it('builds model profile rows only for loaded agents without preloading synthetic phases', () => withAgentDir(path.join(tmp, 'isolated-agent'), () => {
    writeAgent('analyst');
    const agentDir = path.join(tmp, 'isolated-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'subagents.json'), JSON.stringify({
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

    expect(rows.map((row) => row.name)).toEqual(['analyst']);
    expect(rows.find((row) => row.name === 'analyst')).toMatchObject({
      explicitProfile: {},
      scope: 'project',
      modelLabel: 'orchestrator: openai/gpt-5.2',
      effortLabel: 'orchestrator: low',
    });
    expect(rows.find((row) => row.name === 'sdd-explore')).toBeUndefined();
    expect(rows.find((row) => row.name === 'sdd-spec')).toBeUndefined();
  }));

  it('builds model profile rows with source scope for global and project definitions', () => withAgentDir(path.join(tmp, 'global-agent'), () => {
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(path.join(agentDir, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'subagents', 'shared.md'), `---\nname: shared\ndescription: global shared\n---\n# Global Shared`);
    fs.writeFileSync(path.join(agentDir, 'subagents', 'global-only.md'), `---\nname: global-only\ndescription: global only\n---\n# Global Only`);
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'shared.md'), `---\nname: shared\ndescription: project shared\n---\n# Project Shared`);
    const definitions = loadSubagents(tmp);
    const rows = buildModelProfileRows({
      definitions,
      config: readSubagentsConfig(tmp),
      ctx: { model: { provider: 'openai', id: 'gpt-5.2' }, thinkingLevel: 'low' },
    });

    expect(rows.find((row) => row.name === 'shared')).toMatchObject({ description: 'project shared', scope: 'project' });
    expect(rows.find((row) => row.name === 'global-only')).toMatchObject({ description: 'global only', scope: 'global' });
  }));

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

  it('tracks only dirty model profile rows while preserving reset semantics', () => {
    const baseProfiles: SubagentModelProfiles = {
      analyst: { model: { provider: 'openai', id: 'gpt-5.2' }, effort: 'high' },
      reviewer: {},
      'sdd-apply': { effort: 'medium' },
    };

    let dirty: SubagentModelProfiles = {};
    dirty = applyDirtyProfileEdit({
      baseProfiles,
      dirtyProfiles: dirty,
      edit: { agentName: 'analyst', effort: 'low' },
    });
    expect(dirty).toEqual({
      analyst: { model: { provider: 'openai', id: 'gpt-5.2' }, effort: 'low' },
    });
    expect(dirty).not.toHaveProperty('reviewer');

    dirty = applyDirtyProfileEdit({
      baseProfiles,
      dirtyProfiles: dirty,
      edit: { agentName: 'reviewer', model: { provider: 'anthropic', id: 'claude-sonnet-4-5' } },
    });
    expect(dirty).toEqual({
      analyst: { model: { provider: 'openai', id: 'gpt-5.2' }, effort: 'low' },
      reviewer: { model: { provider: 'anthropic', id: 'claude-sonnet-4-5' } },
    });

    dirty = applyDirtyProfileEdit({
      baseProfiles,
      dirtyProfiles: dirty,
      edit: { agentName: 'analyst', effort: 'high' },
    });
    expect(dirty).toEqual({
      reviewer: { model: { provider: 'anthropic', id: 'claude-sonnet-4-5' } },
    });

    dirty = applyDirtyProfileEdit({
      baseProfiles,
      dirtyProfiles: dirty,
      edit: { agentName: 'sdd-apply', reset: 'row' },
    });
    expect(dirty).toEqual({
      reviewer: { model: { provider: 'anthropic', id: 'claude-sonnet-4-5' } },
      'sdd-apply': {},
    });
    expect(dirty).not.toHaveProperty('sdd-spec');
  });

  it('returns an exact no-op Save All message without writing model profiles', () => {
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    const existingConfig = {
      default_model: 'openai/gpt-5.2',
      model_profiles: { analyst: { effort: 'high' } },
    };
    fs.writeFileSync(path.join(agentDir, 'subagents.json'), JSON.stringify(existingConfig));

    const message = buildNoChangesModelProfilesMessage(agentDir);

    expect(message).toBe(`No subagent model profile changes to save. Nothing written to ${globalSubagentsConfigPath(agentDir)}.`);
    expect(JSON.parse(fs.readFileSync(path.join(agentDir, 'subagents.json'), 'utf8'))).toEqual(existingConfig);
  });

  it('builds local rows with only local explicit profiles even when a global profile is inherited', () => withAgentDir(path.join(tmp, 'global-agent'), () => {
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(path.join(agentDir, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'subagents', 'analyst.md'), `---\nname: analyst\ndescription: global analyst\n---\n# Global Analyst`);
    fs.writeFileSync(path.join(agentDir, 'subagents.json'), JSON.stringify({ model_profiles: { analyst: { model: 'global/model', effort: 'low' } } }));
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'analyst.md'), `---\nname: analyst\ndescription: project analyst\n---\n# Project Analyst`);

    const config = readSubagentsConfig(tmp);
    const rows = buildModelProfileRows({ definitions: loadSubagents(tmp), config, ctx: {} });
    const analyst = rows.find((row) => row.name === 'analyst');

    expect(analyst).toMatchObject({ scope: 'project', modelLabel: 'unresolved', effortLabel: 'unresolved' });
    expect(analyst?.explicitProfile).toEqual({});
  }));

  it('ignores project-local model profiles for global-only subagent definitions', () => withAgentDir(path.join(tmp, 'global-agent'), () => {
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(path.join(agentDir, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'subagents', 'tool-smoke.md'), `---\nname: tool-smoke\ndescription: global smoke\n---\n# Global Smoke`);
    fs.writeFileSync(path.join(agentDir, 'subagents.json'), JSON.stringify({ model_profiles: { 'tool-smoke': { model: 'global/smoke', effort: 'low' } } }));
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ model_profiles: { 'tool-smoke': { model: 'project/wrong', effort: 'high' } } }));

    const rows = buildModelProfileRows({ definitions: loadSubagents(tmp), config: readSubagentsConfig(tmp), ctx: {} });
    const smoke = rows.find((row) => row.name === 'tool-smoke');

    expect(smoke).toMatchObject({ scope: 'global', modelLabel: 'profile: global/smoke', effortLabel: 'profile: low' });
    expect(smoke?.explicitProfile).toEqual({ model: { provider: 'global', id: 'smoke' }, effort: 'low' });
  }));

  it('commits staged model profile saves to global and project config by row scope', () => {
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'subagents.json'), JSON.stringify({
      default_model: 'openai/gpt-5.2',
      model_profiles: { global_agent: { effort: 'medium' }, local_agent: { effort: 'low' } },
    }));
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({
      timeout_ms: 123,
      model_profiles: { local_agent: { effort: 'high' } },
    }));

    const message = commitStagedModelProfiles({
      agentDir,
      cwd: tmp,
      profileScopes: { local_agent: 'project', global_agent: 'global' },
      stagedProfiles: {
        local_agent: { model: { provider: 'anthropic', id: 'claude-sonnet-4-5' }, effort: 'xhigh' },
        global_agent: { model: { provider: 'openai', id: 'gpt-5.2-codex' } },
      },
      save: true,
    });

    expect(message).toContain(path.join(tmp, '.pi', 'subagents.json'));
    expect(message).toContain(globalSubagentsConfigPath(agentDir));
    expect(JSON.parse(fs.readFileSync(path.join(tmp, '.pi', 'subagents.json'), 'utf8'))).toEqual({
      timeout_ms: 123,
      model_profiles: { local_agent: { model: 'anthropic/claude-sonnet-4-5', effort: 'xhigh' } },
    });
    expect(JSON.parse(fs.readFileSync(path.join(agentDir, 'subagents.json'), 'utf8'))).toEqual({
      default_model: 'openai/gpt-5.2',
      model_profiles: {
        global_agent: { model: 'openai/gpt-5.2-codex' },
        local_agent: { effort: 'low' },
      },
    });
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

  it('modal navigates rows with arrow/vim/home/end keys and saves selected model identifiers', () => {
    const completions: any[] = [];
    let renderRequests = 0;
    const modal = createSubagentModelProfilesModal({
      rows: [
        { name: 'analyst', description: 'analysis agent', kind: 'subagent', modelLabel: 'default: openai/gpt-5.2', effortLabel: 'default: medium', effectiveModel: { provider: 'openai', id: 'gpt-5.2' }, effectiveEffort: 'medium', explicitProfile: {} },
        { name: 'reviewer', description: 'review agent', kind: 'subagent', modelLabel: 'orchestrator: openai/gpt-5.2-codex', effortLabel: 'orchestrator: low', effectiveModel: { provider: 'openai', id: 'gpt-5.2-codex' }, effectiveEffort: 'low', explicitProfile: {} },
        { name: 'sdd-apply', description: 'apply phase', kind: 'sdd-phase', modelLabel: 'unresolved model', effortLabel: 'unresolved effort', explicitProfile: {} },
      ],
      availableModels: [
        { provider: 'anthropic', id: 'claude-sonnet-4-5', label: 'Claude Sonnet' },
        { provider: 'openai', id: 'gpt-5.2-codex', label: 'GPT Codex' },
      ],
      tui: { requestRender: () => { renderRequests += 1; } },
      done: (result: any) => completions.push(result),
    });

    modal.handleInput('down');
    expect(stripAnsi(modal.render(100).join('\n'))).toMatch(/›\s+reviewer/);
    modal.handleInput('j');
    expect(stripAnsi(modal.render(100).join('\n'))).toMatch(/›\s+sdd-apply/);
    modal.handleInput('up');
    expect(stripAnsi(modal.render(100).join('\n'))).toMatch(/›\s+reviewer/);
    modal.handleInput('k');
    expect(stripAnsi(modal.render(100).join('\n'))).toMatch(/›\s+analyst/);
    modal.handleInput('end');
    expect(stripAnsi(modal.render(100).join('\n'))).toMatch(/›\s+sdd-apply/);
    modal.handleInput('home');
    expect(stripAnsi(modal.render(100).join('\n'))).toMatch(/›\s+analyst/);
    modal.handleInput('G');
    expect(stripAnsi(modal.render(100).join('\n'))).toMatch(/›\s+sdd-apply/);
    modal.handleInput('g');
    expect(stripAnsi(modal.render(100).join('\n'))).toMatch(/›\s+analyst/);

    modal.handleInput('enter');
    expect(stripAnsi(modal.render(100).join('\n'))).toContain('Select model provider for analyst');
    modal.handleInput('down');
    modal.handleInput('enter');
    expect(stripAnsi(modal.render(100).join('\n'))).toContain('Select anthropic model for analyst');
    modal.handleInput('enter');
    modal.handleInput('s');

    expect(completions).toEqual([{ action: 'save', dirtyProfiles: { analyst: { model: { provider: 'anthropic', id: 'claude-sonnet-4-5' } } } }]);
    expect(renderRequests).toBeGreaterThan(0);
  });

  it('modal scrolls and live-filters large provider model lists', () => {
    const completions: any[] = [];
    const modal = createSubagentModelProfilesModal({
      rows: [{ name: 'analyst', description: 'analysis agent', kind: 'subagent', modelLabel: 'default: openai/gpt-5.2', effortLabel: 'default: medium', explicitProfile: {} }],
      availableModels: Array.from({ length: 15 }, (_, index) => ({
        provider: 'openai',
        id: index === 14 ? 'target-model' : `model-${String(index + 1).padStart(2, '0')}`,
        label: index === 14 ? 'Target Model' : `Model ${String(index + 1).padStart(2, '0')}`,
      })),
      done: (result: any) => completions.push(result),
    });

    modal.handleInput('m');
    modal.handleInput('down');
    modal.handleInput('enter');
    expect(stripAnsi(modal.render(120).join('\n'))).toContain('showing 1-10');

    for (let i = 0; i < 11; i += 1) modal.handleInput('down');
    const scrolled = stripAnsi(modal.render(120).join('\n'));
    expect(scrolled).toContain('showing 3-12');
    expect(scrolled).not.toContain('Model 01');
    expect(scrolled).toMatch(/›\s+Model 12/);

    for (const char of 'model') modal.handleInput(char);
    modal.handleInput('\u001b[B');
    modal.handleInput('\u001b[A');
    let filtered = stripAnsi(modal.render(120).join('\n'));
    expect(filtered).toContain('15/15 matches');
    expect(filtered).toContain('search: model');
    expect(filtered).toMatch(/›\s+Model 01/);

    modal.handleInput('\u007f');
    modal.handleInput('\u007f');
    modal.handleInput('\u007f');
    modal.handleInput('\u007f');
    modal.handleInput('\u007f');
    for (const char of 'target') modal.handleInput(char);
    filtered = stripAnsi(modal.render(120).join('\n'));
    expect(filtered).toContain('1/15 match');
    expect(filtered).toContain('search: target');
    expect(filtered).toMatch(/›\s+Target Model/);

    modal.handleInput('enter');
    modal.handleInput('s');
    expect(completions).toEqual([{ action: 'save', dirtyProfiles: { analyst: { model: { provider: 'openai', id: 'target-model' } } } }]);
  });

  it('modal handles main reset hotkeys, effort picker values, nested back, save, and cancel', () => {
    const rows = [
      { name: 'analyst', description: 'analysis agent', kind: 'subagent' as const, modelLabel: 'profile: openai/gpt-5.2', effortLabel: 'profile: medium', effectiveModel: { provider: 'openai', id: 'gpt-5.2' }, effectiveEffort: 'medium' as const, explicitProfile: { model: { provider: 'openai', id: 'gpt-5.2' }, effort: 'medium' as const } },
      { name: 'reviewer', description: 'review agent', kind: 'subagent' as const, modelLabel: 'orchestrator: openai/gpt-5.2-codex', effortLabel: 'orchestrator: low', effectiveModel: { provider: 'openai', id: 'gpt-5.2-codex' }, effectiveEffort: 'low' as const, explicitProfile: {} },
    ];
    const saved: any[] = [];
    const modal = createSubagentModelProfilesModal({ rows, availableModels: [{ provider: 'openai', id: 'gpt-5.2-codex', label: 'GPT Codex' }], done: (result: any) => saved.push(result) });

    modal.handleInput('e');
    const effortPicker = stripAnsi(modal.render(100).join('\n'));
    for (const label of ['inherit/reset effort', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh']) expect(effortPicker).toContain(label);
    for (let i = 0; i < 5; i += 1) modal.handleInput('down');
    modal.handleInput('enter');
    modal.handleInput('M');
    modal.handleInput('E');
    modal.handleInput('r');
    modal.handleInput('down');
    modal.handleInput('m');
    modal.handleInput('q');
    modal.handleInput('s');

    expect(saved).toEqual([{ action: 'save', dirtyProfiles: { analyst: {} } }]);

    const cancelled: any[] = [];
    const cancelModal = createSubagentModelProfilesModal({ rows, availableModels: [], done: (result: any) => cancelled.push(result) });
    cancelModal.handleInput('q');
    expect(cancelled).toEqual([{ action: 'cancel' }]);

    const escaped: any[] = [];
    const escapeModal = createSubagentModelProfilesModal({ rows, availableModels: [], done: (result: any) => escaped.push(result) });
    escapeModal.handleInput('esc');
    expect(escaped).toEqual([{ action: 'cancel' }]);
  });

  it('modal preserves unrelated dirty rows when nested pickers are cancelled', () => {
    const results: any[] = [];
    const modal = createSubagentModelProfilesModal({
      rows: [
        { name: 'analyst', description: 'analysis agent', kind: 'subagent', modelLabel: 'default: openai/gpt-5.2', effortLabel: 'default: medium', effectiveModel: { provider: 'openai', id: 'gpt-5.2' }, effectiveEffort: 'medium', explicitProfile: {} },
        { name: 'reviewer', description: 'review agent', kind: 'subagent', modelLabel: 'orchestrator: openai/gpt-5.2-codex', effortLabel: 'orchestrator: low', effectiveModel: { provider: 'openai', id: 'gpt-5.2-codex' }, effectiveEffort: 'low', explicitProfile: {} },
      ],
      availableModels: [{ provider: 'openai', id: 'gpt-5.2-codex', label: 'GPT Codex' }],
      done: (result: any) => results.push(result),
    });

    modal.handleInput('e');
    for (let i = 0; i < 6; i += 1) modal.handleInput('down');
    modal.handleInput('enter');
    modal.handleInput('down');
    modal.handleInput('m');
    modal.handleInput('esc');
    modal.handleInput('s');

    expect(results).toEqual([{ action: 'save', dirtyProfiles: { analyst: { effort: 'xhigh' } } }]);
  });

  it('modal labels each subagent row with a dimmed local/global scope', () => {
    const dimmed: string[] = [];
    const modal = createSubagentModelProfilesModal({
      rows: [
        { name: 'analyst', description: 'analysis agent', kind: 'subagent', scope: 'project', modelLabel: 'default: openai/gpt-5.2', effortLabel: 'default: medium', explicitProfile: {} },
        { name: 'reviewer', description: 'review agent', kind: 'subagent', scope: 'global', modelLabel: 'orchestrator: openai/gpt-5.2-codex', effortLabel: 'orchestrator: low', explicitProfile: {} },
      ],
      theme: { fg: (name: string, text: string) => { if (name === 'dim') dimmed.push(text); return text; } },
      availableModels: [],
      done: () => undefined,
    });

    const rendered = stripAnsi(modal.render(120).join('\n'));

    expect(rendered).toContain('analyst (local)');
    expect(rendered).toContain('reviewer (global)');
    expect(dimmed).toEqual(expect.arrayContaining(['(local)', '(global)']));
  });

  it('modal renders a compact model/effort editor without noisy descriptions', () => {
    const modal = createSubagentModelProfilesModal({
      rows: [
        { name: 'analyst', description: 'long analysis description that should not take vertical space in the compact default view', kind: 'subagent', modelLabel: 'default: openai/gpt-5.2', effortLabel: 'default: medium', effectiveModel: { provider: 'openai', id: 'gpt-5.2' }, effectiveEffort: 'medium', explicitProfile: {} },
        { name: 'reviewer', description: 'review agent', kind: 'subagent', modelLabel: 'orchestrator: openai/gpt-5.2-codex', effortLabel: 'orchestrator: low', effectiveModel: { provider: 'openai', id: 'gpt-5.2-codex' }, effectiveEffort: 'low', explicitProfile: {} },
        { name: 'sdd-apply', description: 'apply phase', kind: 'sdd-phase', modelLabel: 'orchestrator: openai/gpt-5.5', effortLabel: 'orchestrator: high', effectiveModel: { provider: 'openai', id: 'gpt-5.5' }, effectiveEffort: 'high', explicitProfile: {} },
      ],
      availableModels: [],
      done: () => undefined,
    });

    const lines = modal.render(120).map(stripAnsi);
    const rendered = lines.join('\n');

    expect(rendered).toContain('Subagent model profiles');
    expect(rendered).toContain('target: local/global by subagent scope');
    expect(rendered).toContain('pending: none');
    expect(rendered).toContain('agent/phase');
    expect(rendered).toContain('model');
    expect(rendered).toContain('effort');
    expect(lines.some((line) => line.startsWith('│ target: local/global by subagent scope'))).toBe(true);
    expect(rendered).toContain('›   analyst');
    expect(rendered).toContain('reviewer');
    expect(rendered).toContain('sdd-apply');
    expect(rendered).toContain('selected: analyst');
    expect(rendered).not.toContain('long analysis description');
    expect(lines.length).toBeLessThanOrEqual(12);
  });

  it('modal renders a framed compact layout with destination and dirty status', () => {
    const modal = createSubagentModelProfilesModal({
      rows: [
        { name: 'analyst', description: 'analysis agent', kind: 'subagent', modelLabel: 'default: openai/gpt-5.2', effortLabel: 'default: medium', effectiveModel: { provider: 'openai', id: 'gpt-5.2' }, effectiveEffort: 'medium', explicitProfile: {} },
        { name: 'reviewer', description: 'review agent', kind: 'subagent', modelLabel: 'orchestrator: openai/gpt-5.2-codex', effortLabel: 'orchestrator: low', effectiveModel: { provider: 'openai', id: 'gpt-5.2-codex' }, effectiveEffort: 'low', explicitProfile: {} },
      ],
      availableModels: [{ provider: 'openai', id: 'gpt-5.2-codex', label: 'GPT Codex' }],
      done: () => undefined,
    });

    const initial = stripAnsi(modal.render(120).join('\n'));
    expect(initial).toContain('╭');
    expect(initial).toContain('Subagent model profiles');
    expect(initial).toContain('target: local/global by subagent scope');
    expect(initial).toContain('pending: none');
    expect(initial).toContain('agent/phase');
    expect(initial).toContain('model');
    expect(initial).toContain('effort');
    expect(initial).toContain('selected: analyst');
    expect(initial).toContain('enter/m model');

    modal.handleInput('e');
    for (let i = 0; i < 5; i += 1) modal.handleInput('down');
    modal.handleInput('enter');
    const dirty = stripAnsi(modal.render(120).join('\n'));
    expect(dirty).toContain('pending: 1 change');
    expect(dirty).toContain('* analyst');
  });

  it('modal keeps unavailable model text discoverable and constrains rendered width', () => {
    const modal = createSubagentModelProfilesModal({
      rows: [{
        name: 'analyst',
        description: `analysis agent with ${'very '.repeat(20)}long description`,
        kind: 'subagent',
        modelLabel: `profile: missing/${'model-'.repeat(20)} (unavailable)`,
        effortLabel: 'profile: high',
        effectiveModel: { provider: 'missing', id: `${'model-'.repeat(20)}legacy` },
        effectiveEffort: 'high',
        explicitProfile: { model: { provider: 'missing', id: `${'model-'.repeat(20)}legacy` }, effort: 'high' },
      }],
      availableModels: [],
      done: () => undefined,
    });

    for (const width of [42, 120]) {
      const lines = modal.render(width).map(stripAnsi);
      expect(lines.every((line) => line.length <= width)).toBe(true);
    }
    expect(stripAnsi(modal.render(120).join('\n'))).toContain('unavailable');
  });

  it('returns non-TUI fallback text with the global subagents config path', async () => {
    const message = buildNonTuiModelProfilesMessage('/home/example/.pi/agent');
    expect(message).toContain('subagent model profiles require Pi TUI');
    expect(message).toContain('/home/example/.pi/agent/subagents.json');

    await expect(runSubagentModelsCommand({ cwd: tmp })).resolves.toContain(path.join(os.homedir(), '.pi', 'agent', 'subagents.json'));
  });

  it('subagent models command custom Save All with no dirty rows writes nothing and notifies exact no-op message', async () => {
    writeAgent('analyst');
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'subagents.json'), JSON.stringify({ model_profiles: { analyst: { effort: 'medium' } } }));
    const before = fs.readFileSync(path.join(agentDir, 'subagents.json'), 'utf8');
    const notifications: Array<[string, string | undefined]> = [];

    const message = await withAgentDir(agentDir, () => runSubagentModelsCommand({
      cwd: tmp,
      agentDir,
      modelRegistry: { getAvailable: async () => [] },
      ui: {
        custom: async (factory: any) => {
          let result: any;
          const component = factory({ requestRender() {} }, {}, {}, (value: any) => { result = value; });
          component.handleInput('s');
          return result;
        },
        notify: (text: string, level?: string) => notifications.push([text, level]),
      },
    }));

    expect(message).toBe(`No subagent model profile changes to save. Nothing written to ${globalSubagentsConfigPath(agentDir)}.`);
    expect(notifications).toEqual([[message, 'info']]);
    expect(fs.readFileSync(path.join(agentDir, 'subagents.json'), 'utf8')).toBe(before);
  });

  it('subagent models command custom top-level cancel writes nothing and preserves cancel warning', async () => {
    writeAgent('analyst');
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'subagents.json'), JSON.stringify({ model_profiles: { analyst: { effort: 'medium' } } }));
    const before = fs.readFileSync(path.join(agentDir, 'subagents.json'), 'utf8');
    const notifications: Array<[string, string | undefined]> = [];

    const message = await withAgentDir(agentDir, () => runSubagentModelsCommand({
      cwd: tmp,
      agentDir,
      modelRegistry: { getAvailable: async () => [] },
      ui: {
        custom: async (factory: any) => {
          let result: any;
          const component = factory({ requestRender() {} }, {}, {}, (value: any) => { result = value; });
          component.handleInput('e');
          component.handleInput('down');
          component.handleInput('enter');
          component.handleInput('q');
          return result;
        },
        notify: (text: string, level?: string) => notifications.push([text, level]),
      },
    }));

    expect(message).toBe(`Cancelled. No changes written to ${globalSubagentsConfigPath(agentDir)}.`);
    expect(notifications).toEqual([[message, 'warning']]);
    expect(fs.readFileSync(path.join(agentDir, 'subagents.json'), 'utf8')).toBe(before);
  });

  it('fallback select wizard remains usable when custom ui is absent', async () => {
    writeAgent('analyst');
    const agentDir = path.join(tmp, 'global-agent');
    const select = vi.fn(async (prompt: string, choices: string[]) => {
      if (prompt.startsWith('Select subagent')) return choices.find((choice) => choice.startsWith('analyst'));
      if (prompt.startsWith('Configure analyst')) return 'Set provider/model/effort';
      if (prompt.startsWith('Select provider')) return 'openai';
      if (prompt.startsWith('Select model')) return 'GPT Codex';
      if (prompt.startsWith('Select effort')) return 'high';
      if (prompt.startsWith('Save subagent')) return 'Save';
      return choices[0];
    });

    const message = await withAgentDir(agentDir, () => runSubagentModelsCommand({
      cwd: tmp,
      agentDir,
      modelRegistry: { getAvailable: async () => [{ provider: 'openai', id: 'gpt-5.2-codex', label: 'GPT Codex' }] },
      ui: { select },
    }));

    expect(message).toBe(`Saved subagent model profiles to ${path.join(tmp, '.pi', 'subagents.json')}.`);
    expect(select).toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(path.join(tmp, '.pi', 'subagents.json'), 'utf8'))).toEqual({
      model_profiles: { analyst: { model: 'openai/gpt-5.2-codex', effort: 'high' } },
    });
    expect(fs.existsSync(path.join(agentDir, 'subagents.json'))).toBe(false);
  });

  it('fallback select wizard cancel writes nothing and non-tui fallback remains compatible', async () => {
    writeAgent('analyst');
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'subagents.json'), JSON.stringify({ model_profiles: { analyst: { effort: 'medium' } } }));
    const before = fs.readFileSync(path.join(agentDir, 'subagents.json'), 'utf8');
    const select = vi.fn(async (prompt: string, choices: string[]) => {
      if (prompt.startsWith('Select subagent')) return choices.find((choice) => choice.startsWith('analyst'));
      if (prompt.startsWith('Configure analyst')) return 'Cancel';
      return choices[0];
    });

    const message = await withAgentDir(agentDir, () => runSubagentModelsCommand({ cwd: tmp, agentDir, ui: { select } }));

    expect(message).toBe(`Cancelled. No changes written to ${globalSubagentsConfigPath(agentDir)}.`);
    expect(fs.readFileSync(path.join(agentDir, 'subagents.json'), 'utf8')).toBe(before);
    await expect(runSubagentModelsCommand({ cwd: tmp, agentDir, ui: {} })).resolves.toBe(buildNonTuiModelProfilesMessage(agentDir));
  });

});
