import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import extension, { ClaudeBackgroundWidget, ClaudeBackgroundWidgetState, completionMessage, createSubagentsPanelKeyMatcher, moveClaudeBackgroundWidgetSelection, renderClaudeBackgroundWidgetLines, resolveRegisteredToolDefinition, sendSubagentCompletionMessage } from '../index.js';
import { loadSubagents, parseFrontmatter, readSubagentsConfig, resetGlobalSubagentModelProfileField, saveGlobalSubagentModelProfile, subagentSourceWarnings } from '../src/config.js';
import { expandToolPatterns, matchesToolPattern } from '../src/tool-patterns.js';
import { resolveEffectiveSubagentProfile } from '../src/profile-resolver.js';
import { buildPrompt, ThreadSnapshotBuilder } from '../src/runner.js';
import { SubagentStructuredError, deriveErrorString, normalizeErrorMetadata, parseErrorMetadata, safeErrorMetadataDetails, serializeErrorMetadata } from '../src/error-metadata.js';
import { applyDirtyProfileEdit, buildModelProfileRows, buildNoChangesModelProfilesMessage, buildNonTuiModelProfilesMessage, commitStagedModelProfiles, createSubagentModelProfilesModal, globalSubagentsConfigPath, groupAvailableModelsByProvider, runSubagentModelsCommand, stageModelProfileEdit } from '../src/model-profiles-ui.js';
import { resolveSubagentHistoryDbPath, resolveSubagentsHistoryHome, SubagentHistoryStore } from '../src/history.js';
import { isSubagentsDebugEnabled, writeSubagentsDebugLog } from '../src/debug.js';
import { createSubagentsRenderLogger, DEFAULT_RENDER_DEBUG_LOG_PATH } from '../src/render-debug.js';
import { SubagentManager } from '../src/manager.js';
import { registerSubagentTools } from '../src/tools.js';
import { SubagentsHistoryPanel } from '../src/ui.js';
import { boundThreadSnapshot, isValidThreadSnapshot, registerSubagentRuntimeToolDefinition, renderThreadBody, resetPiComponentCacheForTests } from '../src/thread-view.js';
import type { EffectiveSubagentProfile, SubagentErrorMetadata, SubagentModelProfiles, SubagentRunner, SubagentTask } from '../src/types.js';

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

describe('config and workflow loading', () => {
  it('parses markdown agents with multiline or comma-separated inline tools', () => {
    const multiline = parseFrontmatter('---\nname: analyst\ntools:\n  - read\n  - write\n---\n# Body');
    expect(multiline.data.name).toBe('analyst');
    expect(multiline.data.tools).toEqual(['read', 'write']);
    expect(multiline.body).toContain('# Body');

    const inline = parseFrontmatter('---\nname: analyst\ndescription: reads, writes, and reviews\ntools: read, write, bash\n---\n# Body');
    expect(inline.data.description).toBe('reads, writes, and reviews');
    expect(inline.data.tools).toEqual(['read', 'write', 'bash']);
    expect(inline.body).toContain('# Body');
  });

  it('loads comma-separated inline tools as the effective allowlist', () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'worker.md'), `---\nname: worker\ntools: read, write, bash\n---\n# Worker`);

    expect(loadSubagents(tmp).find((agent) => agent.name === 'worker')?.tools).toEqual(['read', 'write', 'bash']);
  });

  it('parses Windows CRLF frontmatter', () => {
    const parsed = parseFrontmatter('---\r\nname: analyst\r\ntools: read, write\r\n---\r\n# Body');

    expect(parsed.data.name).toBe('analyst');
    expect(parsed.data.tools).toEqual(['read', 'write']);
    expect(parsed.body).toBe('# Body');
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

  it('parses model ids that contain slashes by splitting on the first separator', () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'analyst.md'), `---\nname: analyst\ndescription: analyst agent\nmodel: openrouter/stealth/ox-alpha\n---\n# Agent`);
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ default_model: 'openrouter/meta-llama/llama-4-scout' }));
    const agents = loadSubagents(tmp);
    const config = readSubagentsConfig(tmp);
    expect(agents[0].model).toEqual({ provider: 'openrouter', id: 'stealth/ox-alpha' });
    expect(config.default_model).toEqual({ provider: 'openrouter', id: 'meta-llama/llama-4-scout' });
  });

  it('loads default_mode through the global/project config cascade and falls back to task for invalid values', () => {
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'subagents.json'), JSON.stringify({ default_mode: 'background' }));

    withAgentDir(agentDir, () => {
      expect(readSubagentsConfig(tmp).default_mode).toBe('background');

      fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ default_mode: 'task' }));
      expect(readSubagentsConfig(tmp).default_mode).toBe('task');

      fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ default_mode: 'sidecar' }));
      expect(readSubagentsConfig(tmp).default_mode).toBe('task');
    });
  });

  it('loads enable_continue through the global/project config cascade with a default of false', () => {
    expect(readSubagentsConfig(tmp).enable_continue).toBe(false);

    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'subagents.json'), JSON.stringify({ enable_continue: true }));

    withAgentDir(agentDir, () => {
      expect(readSubagentsConfig(tmp).enable_continue).toBe(true);

      fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ default_mode: 'task' }));
      expect(readSubagentsConfig(tmp).enable_continue).toBe(true);

      fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ enable_continue: false }));
      expect(readSubagentsConfig(tmp).enable_continue).toBe(false);

      fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ enable_continue: true }));
      expect(readSubagentsConfig(tmp).enable_continue).toBe(true);
    });
  });

  it('rejects invalid subagent_mode values and defaults omitted definitions to task', () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'analyst.md'), `---\nname: analyst\ndescription: analyst agent\nsubagent_mode: background\ntools:\n  - read\n---\n# Agent`);
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'reviewer.md'), `---\nname: reviewer\ndescription: reviewer agent\ntools:\n  - read\n---\n# Agent`);
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'invalid.md'), `---\nname: invalid\ndescription: invalid agent\nsubagent_mode: sidecar\ntools:\n  - read\n---\n# Agent`);

    const agents = loadSubagents(tmp);
    const warnings = subagentSourceWarnings(tmp);

    expect(agents.find((agent) => agent.name === 'analyst')).toMatchObject({ subagent_mode: 'background' });
    expect(agents.find((agent) => agent.name === 'reviewer')).toMatchObject({ subagent_mode: undefined });
    expect(agents.find((agent) => agent.name === 'invalid')).toBeUndefined();
    expect(warnings).toContainEqual(expect.stringContaining('Subagent "invalid"'));
    expect(warnings).toContainEqual(expect.stringContaining('subagent_mode'));
    expect(warnings).toContainEqual(expect.stringContaining('task'));
    expect(warnings).toContainEqual(expect.stringContaining('background'));
  });

  it('falls back for invalid numeric config values', () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ max_concurrency: 'bad', timeout_ms: 'bad', stall_timeout_ms: -1 }));
    const config = readSubagentsConfig(tmp);
    expect(config.max_concurrency).toBe(5);
    expect(config.timeout_ms).toBe(1200000);
    expect(config.stall_timeout_ms).toBe(240000);
    expect(config.default_mode).toBe('task');
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

  it('loads agents and subagents sources with project-local definitions taking precedence', () => {
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(path.join(agentDir, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(agentDir, 'subagents'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.pi', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'agents', 'shared.md'), `---\nname: shared\ndescription: global agents shared\ntools:\n  - read\n---\n# Global Agents Shared`);
    fs.writeFileSync(path.join(agentDir, 'subagents', 'shared.md'), `---\nname: shared\ndescription: global subagents shared\ntools:\n  - read\n---\n# Global Subagents Shared`);
    fs.writeFileSync(path.join(agentDir, 'agents', 'global-only.md'), `---\nname: global-only\ndescription: global agents only\ntools:\n  - read\n---\n# Global Agents Only`);
    fs.writeFileSync(path.join(tmp, '.pi', 'agents', 'shared.md'), `---\nname: shared\ndescription: project agents shared\ntools:\n  - read\n---\n# Project Agents Shared`);
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'shared.md'), `---\nname: shared\ndescription: project subagents shared\ntools:\n  - read\n---\n# Project Subagents Shared`);
    fs.writeFileSync(path.join(tmp, '.pi', 'agents', 'project-only.md'), `---\nname: project-only\ndescription: project agents only\ntools:\n  - read\n---\n# Project Agents Only`);

    const agents = withAgentDir(agentDir, () => loadSubagents(tmp));

    expect(agents.map((a) => `${a.name}:${a.description}`).sort()).toEqual([
      'global-only:global agents only',
      'project-only:project agents only',
      'shared:project subagents shared',
    ]);
  });

  it('blocks ambiguous mixed tools definitions and reports the affected subagent', () => {
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(path.join(agentDir, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'subagents', 'worker.md'), `---\nname: worker\ntools:\n  - read\n---\n# Global Worker`);
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'worker.md'), `---\nname: worker\ntools: read, write\n  - bash\n---\n# Project Worker`);

    const agents = withAgentDir(agentDir, () => loadSubagents(tmp));
    const warnings = withAgentDir(agentDir, () => subagentSourceWarnings(tmp));

    expect(agents.find((agent) => agent.name === 'worker')).toBeUndefined();
    expect(warnings).toContainEqual(expect.stringContaining('Subagent "worker"'));
    expect(warnings).toContainEqual(expect.stringContaining(path.join(tmp, '.pi', 'subagents', 'worker.md')));
    expect(warnings).toContainEqual(expect.stringContaining('choose either comma-separated inline tools or a multiline YAML tools list'));
    expect(warnings).toContainEqual(expect.stringContaining('not loaded'));
  });

  it('blocks repeated tools declarations that use both supported formats', () => {
    const filePath = path.join(tmp, '.pi', 'subagents', 'worker.md');
    fs.writeFileSync(filePath, `---\nname: worker\ntools: read, write\ntools:\n  - bash\n---\n# Worker`);

    expect(loadSubagents(tmp).find((agent) => agent.name === 'worker')).toBeUndefined();
    expect(subagentSourceWarnings(tmp)).toContainEqual(expect.stringContaining('Subagent "worker"'));
  });

  it('reports duplicate names between agents and subagents at the same scope', () => {
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(path.join(agentDir, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(agentDir, 'subagents'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.pi', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'agents', 'dup.md'), `---\nname: dup\ndescription: global agents dup\n---\n# Dup`);
    fs.writeFileSync(path.join(agentDir, 'subagents', 'dup.md'), `---\nname: dup\ndescription: global subagents dup\n---\n# Dup`);
    fs.writeFileSync(path.join(tmp, '.pi', 'agents', 'local-dup.md'), `---\nname: local-dup\ndescription: project agents dup\n---\n# Dup`);
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'local-dup.md'), `---\nname: local-dup\ndescription: project subagents dup\n---\n# Dup`);

    const warnings = withAgentDir(agentDir, () => subagentSourceWarnings(tmp));

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('global');
    expect(warnings[0]).toContain('dup');
    expect(warnings[0]).toContain('agents');
    expect(warnings[0]).toContain('subagents');
    expect(warnings[1]).toContain('project');
    expect(warnings[1]).toContain('local-dup');
  });

  it('merges model_profiles from global and project config with project precedence', () => {
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'subagents.json'), JSON.stringify({
      model_profiles: {
        analyst: { model: 'anthropic/claude-sonnet-4-5', effort: 'high' },
        reviewer: { model: 'openai/gpt-5.2', effort: 'low' },
        maxEffort: { model: 'openai/gpt-5.2', effort: 'max' },
        invalidEffort: { model: 'openai/gpt-5.2', effort: 'extreme' },
        invalidModel: { model: 'missing-provider', effort: 'low' },
      },
    }));
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({
      model_profiles: {
        analyst: { model: { provider: 'openai', id: 'gpt-5.2-codex' }, effort: 'medium' },
        projectOnly: { model: 'anthropic/claude-opus-4-5', effort: 'xhigh' },
      },
    }));

    const config = withAgentDir(agentDir, () => readSubagentsConfig(tmp));

    expect(config.model_profiles).toEqual({
      analyst: { model: { provider: 'openai', id: 'gpt-5.2-codex' }, effort: 'medium' },
      reviewer: { model: { provider: 'openai', id: 'gpt-5.2' }, effort: 'low' },
      maxeffort: { model: { provider: 'openai', id: 'gpt-5.2' }, effort: 'max' },
      invalideffort: { model: { provider: 'openai', id: 'gpt-5.2' } },
      invalidmodel: { effort: 'low' },
      projectonly: { model: { provider: 'anthropic', id: 'claude-opus-4-5' }, effort: 'xhigh' },
    });
  });

  it('defaults nested subagent sessions to lean resources and preserves legacy config behavior', () => {
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
    expect(config.session_resources).toBe('lean');
  });

  it('allows explicitly opting nested subagent sessions back into full resource loading', () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ session_resources: 'full' }));

    expect(readSubagentsConfig(tmp).session_resources).toBe('full');

    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ sessionResources: 'full' }));

    expect(readSubagentsConfig(tmp).session_resources).toBe('full');

    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ session_resources: 'invalid' }));

    expect(readSubagentsConfig(tmp).session_resources).toBe('lean');
  });

  it('ignores legacy ui mode config values', () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ mode: 'claude' }));
    expect(readSubagentsConfig(tmp)).not.toHaveProperty('mode');

    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ mode: 'opencode' }));
    expect(readSubagentsConfig(tmp)).not.toHaveProperty('mode');

    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ mode: 'invalid' }));
    expect(readSubagentsConfig(tmp)).not.toHaveProperty('mode');
  });

  it('supports configurable background handoff shortcuts with ctrl+h fallback', () => {
    expect(readSubagentsConfig(tmp).background_handoff_shortcut).toBe('ctrl+h');

    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ background_handoff_shortcut: 'ctrl+b' }));
    expect(readSubagentsConfig(tmp).background_handoff_shortcut).toBe('ctrl+b');

    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ backgroundHandoffShortcut: 'CTRL+X' }));
    expect(readSubagentsConfig(tmp).background_handoff_shortcut).toBe('ctrl+x');

    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ background_handoff_shortcut: 'alt+b' }));
    expect(readSubagentsConfig(tmp).background_handoff_shortcut).toBe('ctrl+h');
  });

  it('supports configurable history and detail cancel shortcuts', () => {
    expect(readSubagentsConfig(tmp).history_panel_shortcut).toBe('ctrl+,');
    expect(readSubagentsConfig(tmp).detail_cancel_shortcut).toBe('x');

    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ history_panel_shortcut: 'CTRL+P', detail_cancel_shortcut: 'x' }));
    expect(readSubagentsConfig(tmp).history_panel_shortcut).toBe('ctrl+p');
    expect(readSubagentsConfig(tmp).detail_cancel_shortcut).toBe('x');

    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ history_panel_shortcut: 'ctrl+shift+,', detailCancelShortcut: 'CTRL+SHIFT+Q' }));
    expect(readSubagentsConfig(tmp).history_panel_shortcut).toBe('ctrl+shift+,');
    expect(readSubagentsConfig(tmp).detail_cancel_shortcut).toBe('ctrl+shift+q');

    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ historyPanelShortcut: 'shift+alt+,', detailCancelShortcut: 'alt+w' }));
    expect(readSubagentsConfig(tmp).history_panel_shortcut).toBe('shift+alt+,');
    expect(readSubagentsConfig(tmp).detail_cancel_shortcut).toBe('x');

    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ historyPanelShortcut: 'plain', detailCancelShortcut: 'alt+w' }));
    expect(readSubagentsConfig(tmp).history_panel_shortcut).toBe('ctrl+,');
    expect(readSubagentsConfig(tmp).detail_cancel_shortcut).toBe('x');
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

  it('keeps wildcard entries in config and expands them only against active tools', () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents', 'worker.md'), `---\nname: worker\ntools: tool_*, read, subagent_*\n---\n# Worker`);
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ default_tools: ['context7_*', 'read'] }));

    expect(loadSubagents(tmp).find((agent) => agent.name === 'worker')?.tools).toEqual(['tool_*', 'read']);
    expect(readSubagentsConfig(tmp).default_tools).toEqual(['context7_*', 'read']);
    expect(expandToolPatterns(['tool_*', 'read', 'subagent_*'], ['tool_lookup', 'tool_write', 'subagent_run', 'read'])).toEqual(['tool_lookup', 'tool_write', 'read']);
    expect(expandToolPatterns(['tool_*'], ['read'])).toEqual([]);
    expect(matchesToolPattern('tool_lookup', 'tool_*')).toBe(true);
    expect(matchesToolPattern('tool_lookup', 'tool_?')).toBe(false);
  });

  it('keeps orchestrator context in the delegated user prompt when supplied', () => {
    const prompt = buildPrompt({ name: 'sdd-explore', description: 'sdd', filePath: 'sdd-explore.md', instructions: '# SDD Explore', tools: ['read'] }, 'explore feature', 'CWD: /tmp/project', ['read']);
    expect(prompt).toBe('## orchestrator context\nCWD: /tmp/project\n\n## delegated task\nexplore feature');
  });

  it('loads configured workflow subagents with no delegation tools and memory writes only for phase agents', () => {
    const writeConfiguredSubagent = (name: string, tools: string[]) => {
      fs.writeFileSync(path.join(tmp, '.pi', 'subagents', `${name}.md`), [
        '---',
        `name: ${name}`,
        `description: ${name} agent`,
        'tools:',
        ...tools.map((tool) => `  - ${tool}`),
        '---',
        `# ${name}`,
      ].join('\n'));
    };
    writeConfiguredSubagent('discovery', ['read', 'bash', 'memory_search', 'memory_get', 'subagent_run']);
    writeConfiguredSubagent('prd-review', ['read', 'bash', 'memory_search', 'memory_get', 'memory_add', 'memory_update', 'subagent_cancel']);
    writeConfiguredSubagent('sdd-explore', [
      'read',
      'bash',
      'skill_registry_resolve',
      'context7_status',
      'context7_search_library',
      'context7_get_context',
      'context7_resolve_and_get_context',
      'write',
      'edit',
      'memory_search',
      'memory_get',
      'memory_add',
      'memory_update',
      'subagent_status',
    ]);
    writeConfiguredSubagent('tool-smoke', ['read', 'bash', 'skill_registry_resolve', 'context7_status', 'subagent_result']);

    const agents = loadSubagents(tmp);
    expect(agents.map((agent) => agent.name).sort()).toEqual(['discovery', 'prd-review', 'sdd-explore', 'tool-smoke']);
    const toolSmoke = agents.find((agent) => agent.name === 'tool-smoke');
    expect(toolSmoke?.tools).toEqual(['read', 'bash', 'skill_registry_resolve', 'context7_status']);
    const sddExplore = agents.find((agent) => agent.name === 'sdd-explore');
    expect(sddExplore?.tools).toEqual([
      'read',
      'bash',
      'skill_registry_resolve',
      'context7_status',
      'context7_search_library',
      'context7_get_context',
      'context7_resolve_and_get_context',
      'write',
      'edit',
      'memory_search',
      'memory_get',
      'memory_add',
      'memory_update',
    ]);
    for (const agent of agents) {
      if (agent.name.startsWith('sdd-') || agent.name === 'prd-review') {
        expect(agent.tools).toContain('memory_add');
        expect(agent.tools).toContain('memory_update');
        expect(agent.tools).not.toContain('memory_context');
        expect(agent.tools).not.toContain('memory_recall');
      } else {
        expect(agent.tools).not.toContain('memory_add');
        expect(agent.tools).not.toContain('memory_update');
      }
      expect(agent.tools.some((tool) => tool.startsWith('subagent_'))).toBe(false);
    }
  });

});
