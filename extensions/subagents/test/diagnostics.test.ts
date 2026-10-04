import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import extension, { ClaudeBackgroundWidget, ClaudeBackgroundWidgetState, completionMessage, createSubagentsPanelKeyMatcher, moveClaudeBackgroundWidgetSelection, renderClaudeBackgroundWidgetLines, resolveRegisteredToolDefinition, sendSubagentCompletionMessage } from '../index.js';
import { loadSubagents, parseFrontmatter, readSubagentsConfig, resetGlobalSubagentModelProfileField, saveGlobalSubagentModelProfile, subagentSourceWarnings } from '../src/config.js';
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

describe('diagnostics and debug logging', () => {
  it('keeps subagent debug logging disabled by default', () => {
    const logFile = path.join(tmp, '.pi', 'subagents-debug.log');
    expect(readSubagentsConfig(tmp).debug).toBe(false);
    expect(isSubagentsDebugEnabled(tmp)).toBe(false);
    writeSubagentsDebugLog(tmp, 'disabled_event', { ok: true });
    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('keeps render diagnostics disabled by default and ignores malformed settings', () => {
    expect(readSubagentsConfig(tmp).render_debug).toBeUndefined();

    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ render_debug: { enabled: 'true', path: 42 } }));

    expect(readSubagentsConfig(tmp).render_debug).toBeUndefined();
  });

  it('parses render diagnostics config from snake_case and camelCase with project override merging', () => {
    const globalAgentDir = path.join(tmp, 'global-agent');
    const projectRoot = path.join(tmp, 'project-root');
    fs.mkdirSync(globalAgentDir, { recursive: true });
    fs.mkdirSync(path.join(projectRoot, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(globalAgentDir, 'subagents.json'), JSON.stringify({ render_debug: { enabled: true, path: '/tmp/global-render.jsonl' } }));
    fs.writeFileSync(path.join(projectRoot, '.pi', 'subagents.json'), JSON.stringify({ renderDebug: { enabled: true, path: '/tmp/project-render.jsonl' } }));

    const config = withAgentDir(globalAgentDir, () => readSubagentsConfig(projectRoot));

    expect(config.render_debug).toEqual({ enabled: true, path: '/tmp/project-render.jsonl' });

    fs.writeFileSync(path.join(projectRoot, '.pi', 'subagents.json'), JSON.stringify({ renderDebug: { enabled: true } }));
    expect(withAgentDir(globalAgentDir, () => readSubagentsConfig(projectRoot)).render_debug).toEqual({ enabled: true, path: '/tmp/global-render.jsonl' });

    fs.writeFileSync(path.join(globalAgentDir, 'subagents.json'), JSON.stringify({ render_debug: { enabled: true } }));
    fs.rmSync(path.join(projectRoot, '.pi', 'subagents.json'));
    expect(withAgentDir(globalAgentDir, () => readSubagentsConfig(projectRoot)).render_debug).toEqual({ enabled: true, path: DEFAULT_RENDER_DEBUG_LOG_PATH });
  });

  it('lets project render diagnostics disable a globally enabled render logger', () => {
    const globalAgentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(globalAgentDir, { recursive: true });
    fs.writeFileSync(path.join(globalAgentDir, 'subagents.json'), JSON.stringify({ render_debug: { enabled: true, path: '/tmp/global-render.jsonl' } }));
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ render_debug: { enabled: false } }));

    const config = withAgentDir(globalAgentDir, () => readSubagentsConfig(tmp));

    expect(config.render_debug).toBeUndefined();
  });

  it('writes render diagnostics JSONL with allowlisted metadata and monotonic sequence only', () => {
    const logFile = path.join(tmp, 'render-debug.jsonl');
    const task: SubagentTask = {
      id: 'task-sensitive-123',
      agent: 'analyst',
      mode: 'task',
      status: 'running',
      task: 'SENTINEL_TASK_TEXT',
      prompt: 'SENTINEL_PROMPT_TEXT',
      result: 'SENTINEL_OUTPUT_TEXT',
      created_at: new Date().toISOString(),
      thread_snapshot: { version: 1, source: 'events', items: [{ type: 'status', text: 'SENTINEL_RENDERED_LINE' }] },
    };
    const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, () => false, (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text, {}, () => 18);
    panel.render(72);

    const logger = createSubagentsRenderLogger({
      cwd: tmp,
      sessionId: 'session-sensitive-456',
      config: { enabled: true, path: logFile },
      env: {
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        TERM_PROGRAM: 'ghostty',
        SECRET_TOKEN: 'SENTINEL_SECRET_TOKEN',
      } as NodeJS.ProcessEnv,
    });

    logger.log({ event: 'panel_created' });
    logger.log({ event: 'render_started', reason: 'initial', renderCycle: 1, dimensions: { stdoutColumns: 120, stdoutRows: 40, renderWidth: 72 } });
    logger.log({ event: 'render_completed', reason: 'initial', renderCycle: 1, durationMs: 2.5, dimensions: { stdoutColumns: 120, stdoutRows: 40, renderWidth: 72 }, state: panel.getRenderDebugState() });

    const records = readJsonl(logFile);
    const serialized = JSON.stringify(records);

    expect(records.map((record) => record.sequence)).toEqual([1, 2, 3]);
    expect(records.every((record) => record.panel_instance_id === records[0].panel_instance_id)).toBe(true);
    expect(records[1]).toMatchObject({ event: 'render_started', reason: 'initial', render_cycle: 1 });
    expect(records[2]).toMatchObject({ event: 'render_completed', reason: 'initial', render_cycle: 1 });
    expect(records[2].terminal).toEqual({ term: 'xterm-256color', colorterm: 'truecolor', term_program: 'ghostty', inside_tmux: false, inside_herdr: false });
    expect(records[2].state).toMatchObject({ task_count: 1, selected_index: 0, selected_status: 'running', has_usage: false });
    expect(records[2].session_id_hash).toMatch(/^sha256:/);
    expect(serialized).not.toContain('SENTINEL_TASK_TEXT');
    expect(serialized).not.toContain('SENTINEL_PROMPT_TEXT');
    expect(serialized).not.toContain('SENTINEL_OUTPUT_TEXT');
    expect(serialized).not.toContain('SENTINEL_RENDERED_LINE');
    expect(serialized).not.toContain('SENTINEL_SECRET_TOKEN');
    expect(serialized).not.toContain('task-sensitive-123');
    expect(serialized).not.toContain('session-sensitive-456');
  });

  it('swallows render diagnostics filesystem errors', () => {
    const logDir = path.join(tmp, 'render-debug-dir');
    fs.mkdirSync(logDir, { recursive: true });
    const logger = createSubagentsRenderLogger({ cwd: tmp, config: { enabled: true, path: logDir } });

    expect(() => logger.log({ event: 'panel_created' })).not.toThrow();
    expect(fs.readdirSync(logDir)).toHaveLength(0);
  });

  it('logs subagents panel lifecycle diagnostics without raw input or rendered text', async () => {
    vi.useFakeTimers();
    try {
      const logFile = path.join(tmp, 'subagents-panel-render.jsonl');
      fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ render_debug: { enabled: true, path: logFile } }));
      let subagentsCommand: any;
      const requestRender = vi.fn();
      extension({
        registerTool: () => undefined,
        registerCommand: (name: string, command: any) => { if (name === 'subagents') subagentsCommand = command; },
      });

      await subagentsCommand.handler('', {
        cwd: tmp,
        ui: {
          custom: async (factory: any) => {
            const component = factory(
              { terminal: { write: () => undefined }, requestRender },
              { fg: (_name: string, text: string) => text, bold: (text: string) => text },
              {},
              () => undefined,
            );
            component.render(90);
            vi.advanceTimersByTime(1000);
            component.render(90);
            component.handleInput('\u001b[B');
            component.render(90);
            component.handleInput('\u001b');
          },
        },
      });

      const records = readJsonl(logFile);
      const events = records.map((record) => record.event);
      const serialized = JSON.stringify(records);

      expect(events).toContain('panel_created');
      expect(events).toContain('render_requested');
      expect(events).toContain('render_started');
      expect(events).toContain('render_completed');
      expect(events).toContain('input_received');
      expect(events).toContain('panel_disposed');
      expect(records.filter((record) => record.event === 'render_requested').map((record) => record.reason)).toEqual(expect.arrayContaining(['initial', 'interval', 'input']));
      expect(records.filter((record) => record.event === 'input_received').map((record) => record.input)).toEqual([{ category: 'navigation', action: 'down' }, { category: 'lifecycle', action: 'close' }]);
      expect(records.filter((record) => record.event === 'render_completed').every((record) => typeof record.duration_ms === 'number' && record.duration_ms >= 0)).toBe(true);
      expect(serialized).not.toContain('\u001b[B');
      expect(serialized).not.toContain('No subagent tasks recorded in this session yet.');
      expect(serialized).not.toContain('session execution flow');
      expect(requestRender).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('enables subagent debug logging from config and writes to the executing project .pi directory', () => {
    const globalAgentDir = path.join(tmp, 'global-agent');
    const projectRoot = path.join(tmp, 'project-root');
    fs.mkdirSync(path.join(globalAgentDir), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(globalAgentDir, 'subagents.json'), JSON.stringify({ debug: true }));
    const config = withAgentDir(globalAgentDir, () => readSubagentsConfig(projectRoot));
    expect(config.debug).toBe(true);
    expect(withAgentDir(globalAgentDir, () => isSubagentsDebugEnabled(projectRoot))).toBe(true);
    withAgentDir(globalAgentDir, () => writeSubagentsDebugLog(projectRoot, 'config_enabled_event', { ok: true }));
    expect(fs.readFileSync(path.join(projectRoot, '.pi', 'subagents-debug.log'), 'utf8')).toContain('config_enabled_event');
    expect(fs.existsSync(path.join(globalAgentDir, '.pi', 'subagents-debug.log'))).toBe(false);
  });

  it('lets project subagents debug config override global debug config', () => {
    const globalAgentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(globalAgentDir, { recursive: true });
    fs.writeFileSync(path.join(globalAgentDir, 'subagents.json'), JSON.stringify({ debug: true }));
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ debug: false }));

    const config = withAgentDir(globalAgentDir, () => readSubagentsConfig(tmp));

    expect(config.debug).toBe(false);
    expect(withAgentDir(globalAgentDir, () => isSubagentsDebugEnabled(tmp))).toBe(false);
  });

  it('adds the subagent debug log path to gitignore when debug logs are written inside a git repo', () => {
    fs.mkdirSync(path.join(tmp, '.git'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ debug: true }));
    fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules\n');

    writeSubagentsDebugLog(tmp, 'gitignore_event', { ok: true });

    const gitignore = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf8');
    expect(gitignore).toContain('node_modules\n');
    expect(gitignore).toContain('.pi/subagents-debug.log\n');
    expect(gitignore.match(/\.pi\/subagents-debug\.log/g)).toHaveLength(1);
  });

});
