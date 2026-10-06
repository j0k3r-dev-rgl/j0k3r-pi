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
import { boundThreadSnapshot, isValidThreadSnapshot, preloadPiComponentsForSubagentRendering, registerSubagentRuntimeToolDefinition, renderThreadBody, resetPiComponentCacheForTests, setPiComponentProviderForSubagentRendering } from '../../src/thread-view.js';
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

describe('subagents panel and extension ui', () => {
  it('captures later extension tool renderers so inherited tools render inside selected snapshots', () => {
    resetPiComponentCacheForTests();
    try {
      setPiComponentProviderForSubagentRendering({
        ToolExecutionComponent: class {
          private result: any;
          constructor(private name: string, _id: string, private args: any, _options: any, private definition: any) {}
          markExecutionStarted() {}
          setArgsComplete() {}
          updateResult(result: any) { this.result = result; }
          setExpanded() {}
          render(width: number) {
            const call = this.definition.renderCall(this.args, {}, { toolCallId: this.name, isError: false }).render(width).join('\n');
            const result = this.definition.renderResult(this.result, { expanded: false, isPartial: false }, {}, { isError: false }).render(width).join('\n');
            return [`captured:${call}:${result}`];
          }
        },
      });
      const pi: any = { registerTool: (_tool: any) => undefined, registerMessageRenderer: () => undefined, on: () => undefined, registerShortcut: () => undefined, registerCommand: () => undefined };
      extension(pi);
      pi.registerTool({
        name: 'memory_save',
        label: 'Memory: Save',
        description: 'memory save',
        parameters: {},
        renderShell: 'self',
        renderCall: (args: any) => ({ render: () => [`memory-call:${args.title}`], invalidate: () => undefined }),
        renderResult: (result: any) => ({ render: () => [`memory-result:${result.details?.status}`], invalidate: () => undefined }),
      });
      const task: SubagentTask = {
        id: 'subtask_captured_external_renderer',
        agent: 'analyst',
        mode: 'task',
        status: 'completed',
        task: 'render captured external renderer',
        created_at: new Date().toISOString(),
        thread_snapshot: { version: 1, source: 'events', items: [{ type: 'tool', name: 'memory_save', status: 'completed', arguments: { title: 'Fix render' }, result: { content: [{ type: 'text', text: 'Saved' }], details: { status: 'saved' }, isError: false } }] },
      } as any;
      const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, () => false, (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text, { cwd: tmp, tui: { requestRender() {} } });
      const rendered = panel.render(160).join('\n');
      expect(rendered).toContain('captured:memory-call:Fix render:memory-result:saved');
      expect(rendered).not.toContain('memory_save completed');
    } finally {
      resetPiComponentCacheForTests();
    }
  });

  it('uses injected Pi tool components for selected thread snapshots instead of fallback text', () => {
    resetPiComponentCacheForTests();
    try {
      setPiComponentProviderForSubagentRendering({
        ToolExecutionComponent: class {
          private expanded = false;
          private result: any;
          constructor(private name: string, _id: string, private args: any) {}
          markExecutionStarted() {}
          setArgsComplete() {}
          updateResult(result: any) { this.result = result; }
          setExpanded(expanded: boolean) { this.expanded = expanded; }
          render() { return [`native-tool:${this.name}:${this.expanded}:${this.args.path}:${this.result?.content?.[0]?.text ?? ''}`]; }
        },
        createReadToolDefinition: () => ({ name: 'read' }),
      });
      const task: SubagentTask = {
        id: 'subtask_injected_native_component',
        agent: 'analyst',
        mode: 'task',
        status: 'completed',
        task: 'render native component',
        created_at: new Date().toISOString(),
        thread_snapshot: { version: 1, source: 'events', items: [{ type: 'tool', name: 'read', status: 'completed', arguments: { path: 'AGENTS.md' }, result: { content: [{ type: 'text', text: 'body' }], isError: false } }] },
      } as any;
      const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, () => false, (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text, { cwd: tmp, tui: { requestRender() {} } });
      const rendered = panel.render(160).join('\n');
      expect(rendered).toContain('native-tool:read:false:AGENTS.md:body');
      expect(rendered).not.toContain('read completed');
    } finally {
      resetPiComponentCacheForTests();
    }
  });

  it('preloads current ESM Pi bundle chunks for native snapshot rendering', async () => {
    resetPiComponentCacheForTests();
    const packageRoot = path.join(tmp, 'fake-pi-esm-bundle-package');
    fs.mkdirSync(path.join(packageRoot, 'dist', 'bundle', 'chunks'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', type: 'module', main: 'dist/index.js' }));
    fs.writeFileSync(path.join(packageRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    fs.writeFileSync(path.join(packageRoot, 'dist', 'index.js'), "import 'missing-pi-optional-package';\n");
    fs.writeFileSync(path.join(packageRoot, 'dist', 'bundle', 'chunks', 'chunk-native.js'), `
      export class ToolExecutionComponent {
        constructor(name, _id, args) { this.name = name; this.args = args; }
        markExecutionStarted() {}
        setArgsComplete() {}
        updateResult(result) { this.result = result; }
        setExpanded(expanded) { this.expanded = expanded; }
        render() { return ['bundle-native:' + this.name + ':' + this.args.path + ':' + this.result.content[0].text]; }
      }
      export function createReadToolDefinition() { return { name: 'read' }; }
    `);
    const shimDir = path.join(tmp, 'bin-panel-esm-bundle');
    fs.mkdirSync(shimDir);
    fs.symlinkSync(path.join(packageRoot, 'dist', 'cli.js'), path.join(shimDir, 'pi'));
    const oldArgv1 = process.argv[1];
    process.argv[1] = path.join(shimDir, 'pi');
    try {
      await expect(preloadPiComponentsForSubagentRendering()).resolves.toBe(true);
      const rendered = renderThreadBody({
        version: 1,
        source: 'events',
        items: [{ type: 'tool', name: 'read', status: 'completed', arguments: { path: 'AGENTS.md' }, result: { content: [{ type: 'text', text: 'body' }], isError: false } }],
      }, {
        cwd: tmp,
        tui: { requestRender() {} },
        visibleWidth: (text: string) => stripAnsi(text).length,
        truncateToWidth: (text: string, width: number) => text.length > width ? text.slice(0, width) : text,
      }).join('\n');
      expect(rendered).toContain('bundle-native:read:AGENTS.md:body');
      expect(rendered).not.toContain('read completed');
    } finally {
      process.argv[1] = oldArgv1;
      resetPiComponentCacheForTests();
    }
  });

  it('hydrates the selected history task snapshot lazily and memoizes rendered structured body', () => {
    resetPiComponentCacheForTests();
    const packageRoot = path.join(tmp, 'fake-pi-panel-memo-package');
    fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', main: 'index.cjs' }));
    fs.writeFileSync(path.join(packageRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    const shimDir = path.join(tmp, 'bin-panel-memo');
    fs.mkdirSync(shimDir);
    fs.symlinkSync(path.join(packageRoot, 'dist', 'cli.js'), path.join(shimDir, 'pi'));
    fs.writeFileSync(path.join(packageRoot, 'index.cjs'), `
      let assistantRenders = 0;
      exports.__assistantRenders = () => assistantRenders;
      exports.getMarkdownTheme = () => ({});
      exports.AssistantMessageComponent = class {
        constructor(message) { this.message = message; }
        render(width) { assistantRenders += 1; return ['assistant-render:' + width + ':' + this.message.content[0].text]; }
      };
    `);
    const oldArgv1 = process.argv[1];
    process.argv[1] = path.join(shimDir, 'pi');
    try {
      const summaryTask: SubagentTask = {
        id: 'subtask_lazy_panel',
        agent: 'analyst',
        mode: 'task',
        status: 'completed',
        task: 'lazy panel',
        created_at: new Date().toISOString(),
        last_activity_at: '2026-01-01T00:00:00.000Z',
      } as any;
      const fullTask: SubagentTask = {
        ...summaryTask,
        thread_snapshot: { version: 1, updated_at: 'snapshot-v1', source: 'events', items: [{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hydrated snapshot body' }] } }] },
      } as any;
      let detailLoads = 0;
      const panel = new SubagentsHistoryPanel(
        [summaryTask],
        { fg: (_name: string, text: string) => text },
        () => undefined,
        () => false,
        (text) => text.length,
        (text, width) => text.length > width ? text.slice(0, width) : text,
        { cwd: tmp },
        20,
        (id) => { detailLoads += 1; return id === fullTask.id ? fullTask : undefined; },
      );

      expect(panel.render(120).join('\n')).toContain('assistant-render:83:hydrated snapshot body');
      expect(panel.render(120).join('\n')).toContain('assistant-render:83:hydrated snapshot body');
      expect(detailLoads).toBe(1);
      expect(require(packageRoot).__assistantRenders()).toBe(1);
    } finally {
      process.argv[1] = oldArgv1;
      resetPiComponentCacheForTests();
    }
  });

  it('reuses native bash tool components across rerenders and bypasses stale body caching while tools are active', () => {
    resetPiComponentCacheForTests();
    const packageRoot = path.join(tmp, 'fake-pi-panel-active-bash-package');
    fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', main: 'index.cjs' }));
    fs.writeFileSync(path.join(packageRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    const shimDir = path.join(tmp, 'bin-panel-active-bash');
    fs.mkdirSync(shimDir);
    fs.symlinkSync(path.join(packageRoot, 'dist', 'cli.js'), path.join(shimDir, 'pi'));
    fs.writeFileSync(path.join(packageRoot, 'index.cjs'), `
      let constructions = 0;
      exports.__constructions = () => constructions;
      exports.createBashToolDefinition = (cwd) => ({ name: 'bash', cwd, kind: 'native-bash' });
      exports.ToolExecutionComponent = class {
        constructor(name, id, args) {
          constructions += 1;
          this.command = args.command;
          this.renderCount = 0;
        }
        markExecutionStarted() {}
        setArgsComplete() {}
        updateResult() {}
        setExpanded() {}
        render() {
          this.renderCount += 1;
          return ['native-bash-render:' + this.renderCount + ':' + this.command];
        }
      };
    `);
    const oldArgv1 = process.argv[1];
    process.argv[1] = path.join(shimDir, 'pi');
    try {
      const now = new Date().toISOString();
      const task: SubagentTask = {
        id: 'subtask_active_bash_component',
        agent: 'analyst',
        mode: 'task',
        status: 'running',
        task: 'keep native bash active',
        created_at: now,
        last_activity_at: now,
        thread_snapshot: { version: 1, updated_at: now, source: 'events', items: [{ type: 'tool', tool_call_id: 'bash-1', name: 'bash', status: 'running', arguments: { command: 'npm test', timeout: 15 }, started_at: now }] },
      };
      const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, () => false, (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text, { cwd: tmp, tui: { requestRender() {} } });

      expect(panel.render(160).join('\n')).toContain('native-bash-render:1:npm test');
      expect(panel.render(160).join('\n')).toContain('native-bash-render:2:npm test');
      expect(require(packageRoot).__constructions()).toBe(1);
    } finally {
      process.argv[1] = oldArgv1;
      resetPiComponentCacheForTests();
    }
  });

  it('keeps legacy history panel fallback when thread_snapshot is missing or invalid', () => {
    const baseTask: SubagentTask = {
      id: 'subtask_legacy_1',
      agent: 'analyst',
      mode: 'task',
      status: 'failed',
      task: 'legacy task',
      created_at: new Date().toISOString(),
      transcript: 'legacy transcript line',
      result: 'legacy result line',
      error: 'legacy error line',
    };
    const makePanel = (task: SubagentTask) => new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, () => false, (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text);

    expect(makePanel(baseTask).render(160).join('\n')).toContain('legacy transcript line');
    expect(makePanel({ ...baseTask, thread_snapshot: { version: 1, source: 'events', items: [{ type: 'future', text: 'ignore me' }] } as any }).render(160).join('\n')).toContain('legacy error line');
  });

  it('renders valid thread snapshots before legacy transcript text in the history panel', () => {
    const task: SubagentTask = {
      id: 'subtask_thread_1',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      task: 'thread task',
      created_at: new Date().toISOString(),
      transcript: 'legacy transcript should not win',
      result: 'legacy result should not win',
      thread_snapshot: { version: 1, source: 'events', items: [{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'structured snapshot wins' }] } }] },
    };
    const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, () => false, (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text);
    const rendered = panel.render(160).join('\n');

    expect(rendered).toContain('structured snapshot wins');
    expect(rendered).not.toContain('legacy transcript should not win');
    expect(rendered).not.toContain('legacy result should not win');
  });

  it('reloads completed steering projections from persisted snapshots in chronological order without leaking them into task summary fields', () => {
    const steeringText = 'read package.json';
    const task: SubagentTask = {
      id: 'subtask_thread_steering_reload',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      task: 'summarize dependencies',
      created_at: new Date().toISOString(),
      last_activity: 'completed',
      output_preview: 'dependency summary ready',
      result: 'dependency summary ready',
      thread_snapshot: {
        version: 1,
        source: 'mixed',
        items: [
          { type: 'attempt', attempt: 1 },
          { type: 'user', label: 'delegated_task', text: 'summarize dependencies' },
          { type: 'user', id: 'steering-1', label: 'user', text: steeringText },
          { type: 'assistant', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'package.json' } }] } },
          { type: 'tool', tool_call_id: 'read-1', name: 'read', status: 'completed', arguments: { path: 'package.json' }, result: { content: [{ type: 'text', text: 'package body' }], isError: false } },
          { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'dependency summary ready' }] } },
        ],
      },
    } as any;
    const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, () => false, (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text);
    const rendered = panel.render(160).join('\n');

    expect(rendered).toContain(steeringText);
    expect(rendered.indexOf(steeringText)).toBeLessThan(rendered.indexOf('read completed'));
    expect(rendered.indexOf('read completed')).toBeLessThan(rendered.indexOf('dependency summary ready'));
    expect(task.output_preview).toBe('dependency summary ready');
    expect(task.output_preview).not.toContain(steeringText);
    expect(rendered).not.toContain('task: summarize dependencies read package.json');
  });

  it('renders failed and cancelled terminal errors even when a valid thread snapshot exists', () => {
    const failedTask: SubagentTask = {
      id: 'subtask_thread_failed',
      agent: 'analyst',
      mode: 'task',
      status: 'failed',
      task: 'thread task failed',
      created_at: new Date().toISOString(),
      error: 'provider api error',
      thread_snapshot: { version: 1, source: 'events', items: [{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'structured snapshot body' }] } }] },
    };
    const cancelledTask: SubagentTask = {
      id: 'subtask_thread_cancelled',
      agent: 'analyst',
      mode: 'task',
      status: 'cancelled',
      task: 'thread task cancelled',
      created_at: new Date().toISOString(),
      error: 'Subagent cancelled: user request',
      thread_snapshot: { version: 1, source: 'events', items: [{ type: 'status', text: 'cancellation reached runner' }] },
    };
    const makePanel = (task: SubagentTask) => new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, () => false, (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text);

    const failedRendered = makePanel(failedTask).render(160).join('\n');
    const cancelledRendered = makePanel(cancelledTask).render(160).join('\n');

    expect(failedRendered).toContain('structured snapshot body');
    expect(failedRendered).toContain('# error');
    expect(failedRendered).toContain('provider api error');
    expect(cancelledRendered).toContain('cancellation reached runner');
    expect(cancelledRendered).toContain('# error');
    expect(cancelledRendered).toContain('Subagent cancelled: user request');
  });

  it('does not duplicate terminal errors when an equivalent snapshot error item already exists', () => {
    const task: SubagentTask = {
      id: 'subtask_thread_error_dedup',
      agent: 'analyst',
      mode: 'task',
      status: 'failed',
      task: 'thread task dedup',
      created_at: new Date().toISOString(),
      error: 'provider api error',
      thread_snapshot: { version: 1, source: 'events', items: [{ type: 'error', text: 'provider api error' }] },
    };
    const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, () => false, (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text);
    const rendered = panel.render(160).join('\n');

    expect(rendered.match(/provider api error/g)).toHaveLength(1);
    expect(rendered).not.toContain('# error\nprovider api error');
  });

  it('keeps completed snapshot rendering unaffected and preserves boundThreadSnapshot limits', () => {
    const task: SubagentTask = {
      id: 'subtask_thread_completed',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      task: 'thread task completed',
      created_at: new Date().toISOString(),
      error: 'should stay hidden',
      thread_snapshot: { version: 1, source: 'events', items: [{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'completed snapshot body' }] } }] },
    };
    const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, () => false, (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text);
    const rendered = panel.render(160).join('\n');
    const bounded = boundThreadSnapshot({ version: 1, source: 'events', items: [{ type: 'error', text: 'x'.repeat(5000) }, { type: 'status', text: 'second item' }] } as any, { textLimit: 32, maxItems: 1 });

    expect(rendered).toContain('completed snapshot body');
    expect(rendered).not.toContain('# error');
    expect(rendered).not.toContain('should stay hidden');
    expect(bounded?.items).toHaveLength(1);
    expect((bounded?.items[0] as any).text.length).toBeLessThanOrEqual(32);
  });

  it('does not raw-truncate terminal-escaped Pi component lines that visually fit', () => {
    resetPiComponentCacheForTests();
    const packageRoot = path.join(tmp, 'fake-pi-ansi-package');
    fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', main: 'index.cjs' }));
    fs.writeFileSync(path.join(packageRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    const shimDir = path.join(tmp, 'bin-ansi');
    fs.mkdirSync(shimDir);
    fs.symlinkSync(path.join(packageRoot, 'dist', 'cli.js'), path.join(shimDir, 'pi'));
    fs.writeFileSync(path.join(packageRoot, 'index.cjs'), `
      exports.createReadToolDefinition = (cwd) => ({ name: 'read', cwd });
      exports.ToolExecutionComponent = class {
        constructor() {}
        markExecutionStarted() {}
        setArgsComplete() {}
        updateResult() {}
        setExpanded() {}
        render() { return ['\\x1b[42m│\\x1b[0m \\x1b[42mread\\x1b[0m    \\x1b[42mAGENTS.md\\x1b[0m \\x1b[42m│\\x1b[0m']; }
      };
    `);
    const oldArgv1 = process.argv[1];
    process.argv[1] = path.join(shimDir, 'pi');
    try {
      const task: SubagentTask = {
        id: 'subtask_component_ansi',
        agent: 'analyst',
        mode: 'task',
        status: 'completed',
        task: 'preserve ansi component line',
        created_at: new Date().toISOString(),
        thread_snapshot: { version: 1, source: 'events', items: [{ type: 'tool', name: 'read', status: 'completed', arguments: { path: 'AGENTS.md' }, result: { content: [{ type: 'text', text: 'body' }], isError: false } }] },
      };
      const visible = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '').length;
      const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, () => false, visible, (text, width) => text.length > width ? text.slice(0, width) : text, { cwd: tmp, tui: { requestRender() {} } });
      const rendered = panel.render(40).join('\n');

      expect(rendered).toContain('\u001b[42m');
      expect(rendered).toContain('\u001b[0m');
      expect(rendered.replace(/\u001b\[[0-9;]*m/g, '')).toContain('│ read    AGENTS.md │');
    } finally {
      process.argv[1] = oldArgv1;
      resetPiComponentCacheForTests();
    }
  });

  it('does not add body ellipsis for hidden OSC hyperlink escapes in rendered thread lines', () => {
    const hiddenTarget = `file:///tmp/${'x'.repeat(160)}/AGENTS.md`;
    const oscLine = `\u001b]8;;${hiddenTarget}\u001b\\read AGENTS.md\u001b]8;;\u001b\\`;
    const lines = renderThreadBody({
      version: 1,
      source: 'events',
      items: [{ type: 'status', text: oscLine }],
    } as any, {
      cwd: tmp,
      renderWidth: 40,
      visibleWidth: (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '').length,
      truncateToWidth: (text: string, width: number) => text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text,
    } as any);
    const rendered = lines.join('\n');

    expect(rendered).not.toContain('…');
    expect(rendered.replace(/\u001b\][^\u001b]*(?:\u001b\\|\u0007)/g, '')).toContain('info: read AGENTS.md');
  });

  it('preserves Pi component-rendered spacing in selected thread snapshots', () => {
    resetPiComponentCacheForTests();
    const packageRoot = path.join(tmp, 'fake-pi-panel-package');
    fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', main: 'index.cjs' }));
    fs.writeFileSync(path.join(packageRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    const shimDir = path.join(tmp, 'bin-panel');
    fs.mkdirSync(shimDir);
    fs.symlinkSync(path.join(packageRoot, 'dist', 'cli.js'), path.join(shimDir, 'pi'));
    fs.writeFileSync(path.join(packageRoot, 'index.cjs'), `
      exports.createReadToolDefinition = (cwd) => ({ name: 'read', cwd });
      exports.ToolExecutionComponent = class {
        constructor() {}
        markExecutionStarted() {}
        setArgsComplete() {}
        updateResult() {}
        setExpanded() {}
        render() { return ['╭──── read tool ────╮', '│ read    AGENTS.md │']; }
      };
    `);
    const oldArgv1 = process.argv[1];
    process.argv[1] = path.join(shimDir, 'pi');
    try {
      const task: SubagentTask = {
        id: 'subtask_component_spacing',
        agent: 'analyst',
        mode: 'task',
        status: 'completed',
        task: 'preserve component spacing',
        created_at: new Date().toISOString(),
        thread_snapshot: { version: 1, source: 'events', items: [{ type: 'tool', name: 'read', status: 'completed', arguments: { path: 'AGENTS.md' }, result: { content: [{ type: 'text', text: 'body' }], isError: false } }] },
      };
      const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, () => false, (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text, { cwd: tmp, tui: { requestRender() {} } });
      const rendered = panel.render(160).join('\n');

      expect(rendered).toContain('╭──── read tool ────╮');
      expect(rendered).toContain('│ read    AGENTS.md │');
      expect(rendered).not.toContain('│ read AGENTS.md │');
    } finally {
      process.argv[1] = oldArgv1;
      resetPiComponentCacheForTests();
    }
  });

  it('splits multiline Pi component output into width-bounded physical lines', () => {
    resetPiComponentCacheForTests();
    const packageRoot = path.join(tmp, 'fake-pi-panel-multiline-package');
    fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', main: 'index.cjs' }));
    fs.writeFileSync(path.join(packageRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    const shimDir = path.join(tmp, 'bin-panel-multiline');
    fs.mkdirSync(shimDir);
    fs.symlinkSync(path.join(packageRoot, 'dist', 'cli.js'), path.join(shimDir, 'pi'));
    fs.writeFileSync(path.join(packageRoot, 'index.cjs'), `
      exports.createBashToolDefinition = (cwd) => ({ name: 'bash', cwd, kind: 'native-bash' });
      exports.ToolExecutionComponent = class {
        constructor(name, id, args) { this.command = args.command; }
        markExecutionStarted() {}
        setArgsComplete() {}
        updateResult(result) { this.output = result.preview || ''; }
        setExpanded() {}
        render() { return ['go test results:\r\n' + this.output]; }
      };
    `);
    const oldArgv1 = process.argv[1];
    process.argv[1] = path.join(shimDir, 'pi');
    try {
      const task: SubagentTask = {
        id: 'subtask_component_multiline',
        agent: 'analyst',
        mode: 'task',
        status: 'completed',
        task: 'render multiline component output safely',
        created_at: new Date().toISOString(),
        thread_snapshot: {
          version: 1,
          source: 'events',
          items: [{
            type: 'tool',
            name: 'bash',
            status: 'completed',
            arguments: { command: 'go test ./...' },
            result: {
              content: [{ type: 'text', text: [
                'ok github.com/example/project/internal/components 0.929s',
                'ok github.com/example/project/internal/components/communitytool 0.044s',
              ].join('\n') }],
              preview: [
                'ok github.com/example/project/internal/components 0.929s',
                'ok github.com/example/project/internal/components/communitytool 0.044s',
              ].join('\n'),
              isError: false,
            },
          }],
        },
      };
      const panel = new SubagentsHistoryPanel(
        [task],
        { fg: (_name: string, text: string) => text },
        () => undefined,
        () => false,
        (text) => text.length,
        (text, width) => text.length > width ? text.slice(0, width) : text,
        { cwd: tmp, tui: { requestRender() {} } },
      );
      const rendered = panel.render(48);

      expect(rendered.every((line) => !line.includes('\n') && !line.includes('\r'))).toBe(true);
      expect(rendered.every((line) => line.length <= 48)).toBe(true);
      expect(rendered.join('\n')).toContain('go test ./...');
      expect(rendered.join('\n')).toContain('github.com/example/project/internal/compo');
    } finally {
      process.argv[1] = oldArgv1;
      resetPiComponentCacheForTests();
    }
  });

  it('toggles expanded tool output in selected thread snapshots with ctrl+o', () => {
    resetPiComponentCacheForTests();
    const packageRoot = path.join(tmp, 'fake-pi-panel-expand-package');
    fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', main: 'index.cjs' }));
    fs.writeFileSync(path.join(packageRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    const shimDir = path.join(tmp, 'bin-panel-expand');
    fs.mkdirSync(shimDir);
    fs.symlinkSync(path.join(packageRoot, 'dist', 'cli.js'), path.join(shimDir, 'pi'));
    fs.writeFileSync(path.join(packageRoot, 'index.cjs'), `
      exports.createBashToolDefinition = (cwd) => ({ name: 'bash', cwd, kind: 'native-bash' });
      exports.ToolExecutionComponent = class {
        constructor(name, id, args) { this.command = args.command; this.expanded = false; }
        markExecutionStarted() {}
        setArgsComplete() {}
        updateResult(result) { this.output = result.preview || ''; }
        setExpanded(value) { this.expanded = value; }
        render() { return ['bash-expanded:' + this.expanded + ':' + this.command + ':' + this.output]; }
      };
    `);
    const oldArgv1 = process.argv[1];
    process.argv[1] = path.join(shimDir, 'pi');
    try {
      const task: SubagentTask = {
        id: 'subtask_component_expand',
        agent: 'analyst',
        mode: 'task',
        status: 'completed',
        task: 'toggle component expansion',
        created_at: new Date().toISOString(),
        thread_snapshot: { version: 1, source: 'events', items: [{ type: 'tool', name: 'bash', status: 'completed', arguments: { command: 'npm test', timeout: 15 }, result: { content: [{ type: 'text', text: 'long output' }], preview: 'long output', isError: false } }] },
      };
      const keys: Record<string, string> = { 'ctrl+o': '\u000f' };
      const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, (data, key) => data === keys[key], (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text, { cwd: tmp, tui: { requestRender() {} } });

      expect(panel.render(160).join('\n')).toContain('bash-expanded:false:npm test:long output');
      panel.handleInput('\u000f');
      expect(panel.render(160).join('\n')).toContain('bash-expanded:true:npm test:long output');
      panel.handleInput('\u000f');
      expect(panel.render(160).join('\n')).toContain('bash-expanded:false:npm test:long output');
    } finally {
      process.argv[1] = oldArgv1;
      resetPiComponentCacheForTests();
    }
  });

  it('toggles expanded tool output with injected app.tools.expand keybindings', () => {
    resetPiComponentCacheForTests();
    const packageRoot = path.join(tmp, 'fake-pi-panel-expand-keybindings-package');
    fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', main: 'index.cjs' }));
    fs.writeFileSync(path.join(packageRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    const shimDir = path.join(tmp, 'bin-panel-expand-keybindings');
    fs.mkdirSync(shimDir);
    fs.symlinkSync(path.join(packageRoot, 'dist', 'cli.js'), path.join(shimDir, 'pi'));
    fs.writeFileSync(path.join(packageRoot, 'index.cjs'), `
      exports.createBashToolDefinition = (cwd) => ({ name: 'bash', cwd, kind: 'native-bash' });
      exports.ToolExecutionComponent = class {
        constructor(name, id, args) { this.command = args.command; this.expanded = false; }
        markExecutionStarted() {}
        setArgsComplete() {}
        updateResult(result) { this.output = result.preview || ''; }
        setExpanded(value) { this.expanded = value; }
        render() { return ['bash-expanded:' + this.expanded + ':' + this.command + ':' + this.output]; }
      };
    `);
    const oldArgv1 = process.argv[1];
    process.argv[1] = path.join(shimDir, 'pi');
    try {
      const task: SubagentTask = {
        id: 'subtask_component_expand_keybindings',
        agent: 'analyst',
        mode: 'task',
        status: 'completed',
        task: 'toggle component expansion with injected keybindings',
        created_at: new Date().toISOString(),
        thread_snapshot: { version: 1, source: 'events', items: [{ type: 'tool', name: 'bash', status: 'completed', arguments: { command: 'npm test', timeout: 15 }, result: { content: [{ type: 'text', text: 'long output' }], preview: 'long output', isError: false } }] },
      };
      const keybindings = { matches: (data: string, keybinding: string) => keybinding === 'app.tools.expand' && data === '\u001b[111;5u' };
      const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, createSubagentsPanelKeyMatcher(keybindings), (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text, { cwd: tmp, tui: { requestRender() {} } });

      expect(panel.render(160).join('\n')).toContain('bash-expanded:false:npm test:long output');
      panel.handleInput('\u001b[111;5u');
      expect(panel.render(160).join('\n')).toContain('bash-expanded:true:npm test:long output');
    } finally {
      process.argv[1] = oldArgv1;
      resetPiComponentCacheForTests();
    }
  });

  it('shows ctrl+t thinking shortcut in the panel header', () => {
    const task: SubagentTask = {
      id: 'subtask_header_shortcuts',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      task: 'check visible shortcuts',
      created_at: new Date().toISOString(),
      thread_snapshot: statusSnapshot('completed'),
    };
    const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, () => false, (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text, { cwd: tmp });

    const header = panel.render(180)[0];

    expect(header).toContain('ctrl+o expand');
    expect(header).toContain('ctrl+t thinking');
  });

  it('toggles thinking visibility with injected app.thinking.toggle keybindings and ctrl+t', () => {
    resetPiComponentCacheForTests();
    const packageRoot = path.join(tmp, 'fake-pi-panel-thinking-keybindings-package');
    fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', main: 'index.cjs' }));
    fs.writeFileSync(path.join(packageRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    const shimDir = path.join(tmp, 'bin-panel-thinking-keybindings');
    fs.mkdirSync(shimDir);
    fs.symlinkSync(path.join(packageRoot, 'dist', 'cli.js'), path.join(shimDir, 'pi'));
    fs.writeFileSync(path.join(packageRoot, 'index.cjs'), `
      exports.getMarkdownTheme = () => ({});
      exports.AssistantMessageComponent = class {
        constructor(message, hideThinkingBlock) {
          this.message = message;
          this.hideThinkingBlock = hideThinkingBlock;
        }
        render() { return ['thinking-hidden:' + this.hideThinkingBlock + ':' + this.message.content[0].thinking]; }
      };
    `);
    const oldArgv1 = process.argv[1];
    process.argv[1] = path.join(shimDir, 'pi');
    try {
      const task: SubagentTask = {
        id: 'subtask_component_thinking_keybindings',
        agent: 'analyst',
        mode: 'task',
        status: 'completed',
        task: 'toggle thinking visibility',
        created_at: new Date().toISOString(),
        thread_snapshot: { version: 1, source: 'events', items: [{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'private reasoning' }] } }] },
      };
      const keybindings = { matches: (data: string, keybinding: string) => keybinding === 'app.thinking.toggle' && data === '\u001b[116;5u' };
      const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, createSubagentsPanelKeyMatcher(keybindings), (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text, { cwd: tmp });

      expect(panel.render(160).join('\n')).toContain('thinking-hidden:false:private reasoning');
      panel.handleInput('\u001b[116;5u');
      expect(panel.render(160).join('\n')).toContain('thinking-hidden:true:private reasoning');
      panel.handleInput('\u0014');
      expect(panel.render(160).join('\n')).toContain('thinking-hidden:false:private reasoning');
    } finally {
      process.argv[1] = oldArgv1;
      resetPiComponentCacheForTests();
    }
  });

  it('matches injected keybindings for panel navigation, scrolling, and detail cancel controls', () => {
    const matcher = createSubagentsPanelKeyMatcher({
      matches: (data: string, keybinding: string) => ({
        navUp: ['tui.select.up', 'tui.editor.cursorUp'],
        navDown: ['tui.select.down', 'tui.editor.cursorDown'],
        navLeft: ['tui.editor.cursorLeft'],
        navRight: ['tui.editor.cursorRight'],
        pageUpKey: ['tui.select.pageUp', 'tui.editor.pageUp'],
        pageDownKey: ['tui.select.pageDown', 'tui.editor.pageDown'],
        homeKey: ['tui.editor.cursorLineStart'],
        endKey: ['tui.editor.cursorLineEnd'],
        escKey: ['app.interrupt', 'tui.select.cancel'],
        ctrlWFromEditorBinding: ['tui.editor.deleteWordBackward'],
      }[data] ?? []).includes(keybinding),
    });

    expect(matcher('navUp', 'up')).toBe(true);
    expect(matcher('navDown', 'down')).toBe(true);
    expect(matcher('navLeft', 'left')).toBe(true);
    expect(matcher('navRight', 'right')).toBe(true);
    expect(matcher('pageUpKey', 'pageUp')).toBe(true);
    expect(matcher('pageDownKey', 'pageDown')).toBe(true);
    expect(matcher('homeKey', 'home')).toBe(true);
    expect(matcher('endKey', 'end')).toBe(true);
    expect(matcher('escKey', 'escape')).toBe(true);
    expect(matcher('ctrlWFromEditorBinding', 'detailCancel')).toBe(false);
    expect(matcher('other', 'down')).toBe(false);
  });

  it('navigates tasks and scrolls snapshots with injected tui keybindings', () => {
    const tasks: SubagentTask[] = [
      {
        id: 'subtask_keybinding_nav_1',
        agent: 'analyst',
        mode: 'task',
        status: 'completed',
        task: 'first task',
        created_at: new Date().toISOString(),
        thread_snapshot: {
          version: 1,
          source: 'events',
          items: Array.from({ length: 160 }, (_, i) => ({ type: 'status' as const, text: `first line ${String(i).padStart(3, '0')}` })),
        },
      },
      {
        id: 'subtask_keybinding_nav_2',
        agent: 'reviewer',
        mode: 'task',
        status: 'completed',
        task: 'second task',
        created_at: new Date().toISOString(),
        thread_snapshot: {
          version: 1,
          source: 'events',
          items: [{ type: 'status' as const, text: 'second task body' }],
        },
      },
    ];
    const matcher = createSubagentsPanelKeyMatcher({
      matches: (data: string, keybinding: string) => ({
        keyDown: ['tui.select.down'],
        keyUp: ['tui.select.up'],
        keyRight: ['tui.editor.cursorRight'],
        keyLeft: ['tui.editor.cursorLeft'],
        keyPageDown: ['tui.editor.pageDown'],
        keyHome: ['tui.editor.cursorLineStart'],
      }[data] ?? []).includes(keybinding),
    });
    const panel = new SubagentsHistoryPanel(tasks, { fg: (_name: string, text: string) => text }, () => undefined, matcher, (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text);
    const body = () => panel.render(120).join('\n');

    expect(body()).toContain('agent: analyst');
    expect(body()).toContain('first line 159');

    panel.handleInput('keyHome');
    expect(body()).toContain('first line 000');

    panel.handleInput('keyDown');
    expect(body()).toContain('first line 001');

    panel.handleInput('keyPageDown');
    expect(body()).toContain('first line 013');

    panel.handleInput('keyRight');
    expect(body()).toContain('agent: reviewer');
    expect(body()).toContain('second task body');

    panel.handleInput('keyLeft');
    expect(body()).toContain('agent: analyst');

    panel.handleInput('keyHome');
    expect(body()).toContain('first line 000');

    panel.handleInput('keyUp');
    expect(body()).toContain('first line 000');
  });

  it('keeps the selected execution visible and yellow in the horizontal task strip while navigating', () => {
    const tasks: SubagentTask[] = Array.from({ length: 12 }, (_, i) => ({
      id: `subtask_visible_selection_${i + 1}`,
      agent: `agent-${String(i + 1).padStart(2, '0')}`,
      mode: 'task',
      status: 'completed',
      task: `task ${i + 1}`,
      created_at: new Date().toISOString(),
      thread_snapshot: { version: 1, source: 'events', items: [{ type: 'status' as const, text: `body ${i + 1}` }] },
    }));
    const warningSelections: string[] = [];
    const theme = {
      fg: (name: string, text: string) => {
        if (name === 'warning') warningSelections.push(text);
        return `<${name}>${text}</${name}>`;
      },
      bold: (text: string) => text,
    };
    const matcher = (data: string, key: string) => key === 'right' && data === 'right';
    const panel = new SubagentsHistoryPanel(tasks, theme, () => undefined, matcher, (text) => text.replace(/<[^>]+>/g, '').length, (text, width) => text.length > width ? text.slice(0, width) : text, {}, 24);

    for (let i = 0; i < 9; i++) panel.handleInput('right');
    const rendered = panel.render(130).join('\n');

    expect(rendered).toContain('/12');
    expect(rendered).toContain('○ agent-09:completed');
    expect(rendered).toContain('● agent-10:completed');
    expect(rendered).toContain('○ agent-11:completed');
    expect(warningSelections.some((text) => text.includes('● agent-10:completed'))).toBe(true);
  });

  it('preserves panel chrome while rendering selected thread snapshots', () => {
    const task: SubagentTask = {
      id: 'subtask_thread_2',
      agent: 'reviewer',
      mode: 'task',
      status: 'running',
      task: 'keep shell visible',
      created_at: '2026-01-01T00:00:00.000Z',
      started_at: '2026-01-01T00:00:00.000Z',
      ended_at: '2026-01-01T00:00:10.000Z',
      last_activity: 'rendering snapshot',
      model: 'mock/model',
      effort: 'high',
      usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 50_000, turns: 2 },
      thread_snapshot: { version: 1, source: 'events', items: [{ type: 'status', text: 'thread body visible' }] },
    };
    const panel = new SubagentsHistoryPanel(
      [task],
      { fg: (_name: string, text: string) => text, bold: (text: string) => text },
      () => undefined,
      () => false,
      (text) => text.length,
      (text, width) => text.length > width ? text.slice(0, width) : text,
      {},
      42,
      undefined,
      undefined,
      undefined,
      'ctrl+shift+q',
      { timeoutMs: 2_600_000, stallTimeoutMs: 120_000, contextWindowForTask: () => 200_000 },
    );
    const rendered = panel.render(160).join('\n');

    expect(rendered).toContain('subagents');
    expect(rendered).toContain('agent: reviewer');
    expect(rendered).toContain('status: running');
    expect(rendered).toContain('effort: high (ctrl+shift+q cancel)');
    expect(rendered).toContain('model: mock/model');
    expect(rendered).toContain('duration: 10s (timeout 43m20s)');
    expect(rendered).toContain('usage: 2 turns ↑1.0k ↓500 ctx:50k (25%)');
    expect(rendered).toContain('last: rendering snapshot (stall 2m)');
    expect(rendered).toContain('task: keep shell visible');
    expect(rendered).toContain('● reviewer:running effort:high');
    expect(rendered).toContain('thread body visible');
  });

  it('uses the configured available height instead of a fixed overlay viewport', () => {
    const task: SubagentTask = {
      id: 'subtask_viewport_height',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      task: 'bounded viewport',
      created_at: new Date().toISOString(),
      thread_snapshot: {
        version: 1,
        source: 'events',
        items: Array.from({ length: 80 }, (_, i) => ({ type: 'status' as const, text: `viewport line ${String(i).padStart(2, '0')}` })),
      },
    };
    const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, () => false, (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text, {}, () => 60);
    const lines = panel.render(100);

    expect(lines).toHaveLength(60);
    expect(lines.at(-1)).toMatch(/\d+-\d+\/80/);
  });

  it('preserves keyboard scrolling for long thread snapshot bodies', () => {
    const keys: Record<string, string> = { down: 'j', up: 'k', pageDown: 'f', pageUp: 'b', home: 'g', end: 'G' };
    const task: SubagentTask = {
      id: 'subtask_thread_scroll',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      task: 'scroll long thread',
      created_at: new Date().toISOString(),
      thread_snapshot: {
        version: 1,
        source: 'events',
        items: Array.from({ length: 160 }, (_, i) => ({ type: 'status' as const, text: `thread line ${String(i).padStart(3, '0')}` })),
      },
    };
    const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, (data, key) => data === keys[key], (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text);
    const body = () => panel.render(120).join('\n');

    expect(body()).toContain('thread line 159');
    expect(body()).not.toContain('thread line 000');
    panel.handleInput('g');
    expect(body()).toContain('thread line 000');
    panel.handleInput('j');
    expect(body()).toContain('thread line 001');
    panel.handleInput('f');
    expect(body()).toContain('thread line 013');
    panel.handleInput('b');
    expect(body()).toContain('thread line 001');
    panel.handleInput('G');
    expect(body()).toContain('thread line 159');
    expect(body()).not.toContain('thread line 000');
    panel.handleInput('g');
    expect(body()).toContain('thread line 000');
    panel.handleInput('k');
    expect(body()).toContain('thread line 000');
  });

  it('handles normalized fullscreen mouse wheel events without delegating scroll to the transcript', () => {
    const task: SubagentTask = {
      id: 'subtask_thread_mouse_scroll_normalized',
      agent: 'analyst',
      mode: 'task',
      status: 'running',
      task: 'mouse scroll normalized long thread',
      created_at: new Date().toISOString(),
      thread_snapshot: {
        version: 1,
        source: 'events',
        items: Array.from({ length: 160 }, (_, i) => ({ type: 'status' as const, text: `normalized mouse line ${String(i).padStart(3, '0')}` })),
      },
    } as any;
    const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, () => false, (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text);
    const body = () => panel.render(120).join('\n');

    expect(body()).toContain('normalized mouse line 159');
    expect(panel.handleMouse({ type: 'wheel', button: 'none', wheelDelta: -1 })).toEqual({ handled: true, render: true });
    expect(body()).toContain('normalized mouse line 158');
    expect(body()).not.toContain('normalized mouse line 159');
    expect(panel.handleMouse({ type: 'press', button: 'left' })).toEqual({ handled: true, focus: true });
    expect(panel.handleMouse({ type: 'wheel', button: 'none', wheelDelta: 0 })).toBeUndefined();
    expect(panel.handleMouse({ type: 'move', button: 'none' })).toBeUndefined();
    expect(panel.handleMouse({ button: 'none' })).toBeUndefined();
  });

  it('scrolls selected thread snapshots with SGR mouse wheel input', () => {
    const task: SubagentTask = {
      id: 'subtask_thread_mouse_scroll_sgr',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      task: 'mouse scroll long thread',
      created_at: new Date().toISOString(),
      thread_snapshot: {
        version: 1,
        source: 'events',
        items: Array.from({ length: 160 }, (_, i) => ({ type: 'status' as const, text: `mouse sgr line ${String(i).padStart(3, '0')}` })),
      },
    };
    const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, () => false, (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text);
    const body = () => panel.render(120).join('\n');

    expect(body()).toContain('mouse sgr line 159');
    panel.handleInput('\x1b[<64;10;5M');
    expect(body()).toContain('mouse sgr line 158');
    expect(body()).not.toContain('mouse sgr line 159');
    panel.handleInput('\x1b[<65;10;5M');
    expect(body()).toContain('mouse sgr line 159');
  });

  it('acknowledges mouse press with focus and triggers action strictly once on click (MINI-003)', () => {
    let doneCalledCount = 0;
    const task: SubagentTask = {
      id: 'task_mouse_gesture',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      task: 'mouse gesture test',
      created_at: new Date().toISOString(),
      thread_snapshot: {
        version: 1,
        source: 'events',
        items: [{ type: 'status', text: 'gesture line' }],
      },
    };
    const panel = new SubagentsHistoryPanel(
      [task],
      { fg: (_name: string, text: string) => text },
      () => { doneCalledCount++; },
      () => false,
      (text) => text.length,
      (text, width) => (text.length > width ? text.slice(0, width) : text)
    );
    panel.render(120);

    // Press over close button on top header row (x: 110, y: 0)
    const pressResult = panel.handleMouse({ type: 'press', button: 'left', x: 110, y: 0 });
    expect(pressResult).toEqual({ handled: true, focus: true });
    expect(doneCalledCount).toBe(0);

    // Release event does not trigger action
    const releaseResult = panel.handleMouse({ type: 'release', button: 'left', x: 110, y: 0 });
    expect(releaseResult).toEqual({ handled: true });
    expect(doneCalledCount).toBe(0);

    // Click event triggers done exactly once
    const clickResult = panel.handleMouse({ type: 'click', button: 'left', x: 110, y: 0 });
    expect(clickResult).toEqual({ handled: true, render: true });
    expect(doneCalledCount).toBe(1);
  });

  it('routes wheel scroll to sidebar in split mode using x when event.col is undefined (MINI-003)', () => {
    const tasks: SubagentTask[] = Array.from({ length: 20 }, (_, i) => ({
      id: `task_split_${i}`,
      agent: `agent_${i}`,
      mode: 'task',
      status: 'completed',
      task: `task ${i}`,
      created_at: new Date().toISOString(),
      thread_snapshot: {
        version: 1,
        source: 'events',
        items: Array.from({ length: 50 }, (_, j) => ({ type: 'status', text: `thread line ${j}` })),
      },
    }));

    const panel = new SubagentsHistoryPanel(
      tasks,
      { fg: (_name: string, text: string) => text },
      () => undefined,
      () => false,
      (text) => text.length,
      (text, width) => (text.length > width ? text.slice(0, width) : text)
    );
    // Render with width >= 100 to trigger split view (lastIsSplit = true)
    panel.render(120);
    const initialSidebarScroll = (panel as any).sidebarScroll;
    const initialThreadScroll = (panel as any).scroll;

    // Wheel over sidebar: col <= sidebarWidth + 2. In Pi TUI, only x and y are passed, event.col is undefined!
    const wheelSidebar = panel.handleMouse({ type: 'wheel', button: 'none', wheelDelta: 1, x: 10, y: 5 });
    expect(wheelSidebar).toEqual({ handled: true, render: true });
    expect((panel as any).sidebarScroll).toBe(initialSidebarScroll + 1);
    expect((panel as any).scroll).toBe(initialThreadScroll);

    // Wheel over main detail thread: x > sidebarWidth + 2
    const wheelMain = panel.handleMouse({ type: 'wheel', button: 'none', wheelDelta: -1, x: 80, y: 5 });
    expect(wheelMain).toEqual({ handled: true, render: true });
    // Detail thread scroll changes
    expect((panel as any).scroll).toBe(initialThreadScroll - 1);
  });

  it('eliminates cross-column task hit-test collisions in split mode (MINI-003)', () => {
    const tasks: SubagentTask[] = [
      {
        id: 'sidebar_task_0',
        agent: 'agent_0',
        mode: 'task',
        status: 'completed',
        task: 'sidebar task 0',
        created_at: new Date().toISOString(),
        thread_snapshot: {
          version: 1,
          source: 'events',
          items: [
            { type: 'status', text: 'subtask link', taskId: 'sidebar_task_1' } as any,
          ],
        },
      },
      {
        id: 'sidebar_task_1',
        agent: 'agent_1',
        mode: 'task',
        status: 'completed',
        task: 'sidebar task 1',
        created_at: new Date().toISOString(),
        thread_snapshot: {
          version: 1,
          source: 'events',
          items: [
            { type: 'status', text: 'plain line without subtask' },
          ],
        },
      },
    ];

    const panel = new SubagentsHistoryPanel(
      tasks,
      { fg: (_name: string, text: string) => text },
      () => undefined,
      () => false,
      (text) => text.length,
      (text, width) => (text.length > width ? text.slice(0, width) : text)
    );
    // Render at width 120 (split view: left column sidebar, right column detail)
    panel.render(120);

    // Initial selected task is index 0 (sidebar_task_0)
    expect((panel as any).selected).toBe(0);

    // On row 3 (first body row):
    // Left column (x: 5 <= sidebarWidth + 2): points to sidebar_task_0
    // Right column (x: 60 > sidebarWidth + 2): has detail item with taskId = 'sidebar_task_1'

    // Clicking left column on row 3 should select sidebar_task_0 (index 0)
    // First, let's select index 1
    (panel as any).selected = 1;
    expect((panel as any).selected).toBe(1);
    panel.render(120);

    // Now click on row 4, left column (x: 5): should select sidebar_task_0 (index 0)
    // Even if right column on row 4 had subtask taskId 'sidebar_task_1', clicking left column MUST select sidebar_task_0!
    panel.handleMouse({ type: 'click', button: 'left', x: 5, y: 4 });
    expect((panel as any).selected).toBe(0);

    // Now panel is on task 0. Row 5 (second body row) has plain text without subtask on right side.
    // Clicking right column (x: 60) on row 5 must NOT select sidebar_task_1!
    panel.render(120);
    panel.handleMouse({ type: 'click', button: 'left', x: 60, y: 5 });
    expect((panel as any).selected).toBe(0); // must remain 0, not jump to sidebar_task_1
  });

  it('scrolls selected thread snapshots with legacy X10 mouse wheel input', () => {
    const task: SubagentTask = {
      id: 'subtask_thread_mouse_scroll_x10',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      task: 'mouse scroll x10 long thread',
      created_at: new Date().toISOString(),
      thread_snapshot: {
        version: 1,
        source: 'events',
        items: Array.from({ length: 160 }, (_, i) => ({ type: 'status' as const, text: `mouse x10 line ${String(i).padStart(3, '0')}` })),
      },
    };
    const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, () => false, (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text);
    const body = () => panel.render(120).join('\n');

    expect(body()).toContain('mouse x10 line 159');
    panel.handleInput(`\x1b[M${String.fromCharCode(32 + 64)}!!`);
    expect(body()).toContain('mouse x10 line 158');
    expect(body()).not.toContain('mouse x10 line 159');
    panel.handleInput(`\x1b[M${String.fromCharCode(32 + 65)}!!`);
    expect(body()).toContain('mouse x10 line 159');
  });

  it('follows newly appended thread lines only while the viewer is at the bottom', () => {
    const keys: Record<string, string> = { up: 'k', end: 'G' };
    const snapshot = {
      version: 1 as const,
      source: 'events' as const,
      items: Array.from({ length: 80 }, (_, i) => ({ type: 'status' as const, text: `tail line ${String(i).padStart(3, '0')}` })),
    };
    const task: SubagentTask = {
      id: 'subtask_thread_autotail',
      agent: 'analyst',
      mode: 'task',
      status: 'running',
      task: 'auto tail thread',
      created_at: new Date().toISOString(),
      thread_snapshot: snapshot,
    };
    const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text }, () => undefined, (data, key) => data === keys[key], (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text);
    const body = () => panel.render(120).join('\n');

    expect(body()).toContain('tail line 079');
    snapshot.items.push({ type: 'status', text: 'tail line 080' });
    expect(body()).toContain('tail line 080');

    panel.handleInput('k');
    expect(body()).toContain('tail line 079');
    expect(body()).not.toContain('tail line 080');
    snapshot.items.push({ type: 'status', text: 'tail line 081' });
    expect(body()).toContain('tail line 079');
    expect(body()).not.toContain('tail line 081');

    panel.handleInput('G');
    expect(body()).toContain('tail line 081');
    snapshot.items.push({ type: 'status', text: 'tail line 082' });
    expect(body()).toContain('tail line 082');
  });

  it('notifies duplicate agents/subagents names at session startup', async () => {
    const agentDir = path.join(tmp, 'global-agent');
    fs.mkdirSync(path.join(agentDir, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(agentDir, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'agents', 'dup.md'), `---\nname: dup\ndescription: global agents dup\n---\n# Dup`);
    fs.writeFileSync(path.join(agentDir, 'subagents', 'dup.md'), `---\nname: dup\ndescription: global subagents dup\n---\n# Dup`);
    const notifications: Array<[string, string | undefined]> = [];
    let sessionStart: any;
    const previousCwd = process.cwd();
    process.chdir(tmp);
    try {
      const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
      process.env.PI_CODING_AGENT_DIR = agentDir;
      try {
        extension({
          registerTool: () => undefined,
          registerCommand: () => undefined,
          registerShortcut: () => undefined,
          on: (event: string, handler: any) => { if (event === 'session_start') sessionStart = handler; },
        });
        await sessionStart?.({}, { cwd: tmp, ui: { notify: (message: string, level?: string) => notifications.push([message, level]) } });
      } finally {
        if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
    } finally {
      process.chdir(previousCwd);
    }

    expect(notifications).toHaveLength(1);
    expect(notifications[0][0]).toContain('Duplicate subagent name');
    expect(notifications[0][0]).toContain('dup');
    expect(notifications[0][0]).toContain('using subagents');
    expect(notifications[0][1]).toBe('warning');
  });

  it('registers the configured history, detail cancel, and background handoff shortcuts at extension startup', () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ history_panel_shortcut: 'ctrl+p', detail_cancel_shortcut: 'ctrl+shift+q' }));
    const previousCwd = process.cwd();
    process.chdir(tmp);
    try {
      const shortcuts: string[] = [];
      extension({
        registerTool: () => undefined,
        registerCommand: () => undefined,
        registerShortcut: (key: string) => shortcuts.push(key),
      });
      expect(shortcuts).toEqual(['ctrl+p', 'ctrl+shift+q', 'ctrl+h']);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('detail cancel shortcut only cancels while the subagents panel is active', async () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ detail_cancel_shortcut: 'ctrl+shift+q' }));
    let cancelShortcut: any;
    let subagentsCommand: any;
    const previousCwd = process.cwd();
    process.chdir(tmp);
    try {
      extension({
        registerTool: () => undefined,
        registerCommand: (name: string, command: any) => { if (name === 'subagents') subagentsCommand = command; },
        registerShortcut: (key: string, shortcut: any) => { if (key === 'ctrl+shift+q') cancelShortcut = shortcut.handler; },
      });
    } finally {
      process.chdir(previousCwd);
    }

    await cancelShortcut({ cwd: tmp });

    const customStarted = new Promise<void>((resolve) => {
      void subagentsCommand.handler('', {
        cwd: tmp,
        ui: {
          custom: async (factory: any) => {
            factory({ terminal: { write: () => undefined }, requestRender() {} }, { fg: (_name: string, text: string) => text }, {}, () => undefined);
            resolve();
            await new Promise(() => undefined);
          },
        },
      });
    });
    await customStarted;
    await cancelShortcut({ cwd: tmp });
  });

  it('subagents history panel can start focused on a selected task id', () => {
    const now = new Date().toISOString();
    const tasks = [
      { id: 'task-1', agent: 'first', mode: 'background', status: 'running', task: 'first task', created_at: now, last_activity_at: now, last_activity: 'running first' },
      { id: 'task-2', agent: 'second', mode: 'background', status: 'running', task: 'second task', created_at: now, last_activity_at: now, last_activity: 'running second' },
    ] as any;
    const panel = new SubagentsHistoryPanel(
      tasks,
      { fg: (_name: string, text: string) => text, bold: (text: string) => text },
      () => undefined,
      () => false,
      (text) => text.length,
      (text, width) => text.length > width ? text.slice(0, width) : text,
      {},
      () => 30,
      undefined,
      'task-2',
    );

    const rendered = panel.render(120).join('\n');
    expect(rendered).toContain('2/2');
    expect(rendered).toContain('agent: second');
  });

  it('cancels only the active task currently selected in the history panel with the configured detail shortcut', () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ detail_cancel_shortcut: 'w' }));
    expect(readSubagentsConfig(tmp).detail_cancel_shortcut).toBe('w');
    const now = new Date().toISOString();
    const tasks = [
      { id: 'task-1', agent: 'first', mode: 'background', status: 'running', task: 'first task', created_at: now },
      { id: 'task-2', agent: 'second', mode: 'background', status: 'completed', task: 'second task', created_at: now },
    ] as any;
    const cancelled: string[] = [];
    const panel = new SubagentsHistoryPanel(
      tasks,
      { fg: (_name: string, text: string) => text, bold: (text: string) => text },
      () => undefined,
      (data, key) => key === 'detailCancel' && data === readSubagentsConfig(tmp).detail_cancel_shortcut,
      (text) => text.length,
      (text, width) => text.length > width ? text.slice(0, width) : text,
      {},
      () => 30,
      undefined,
      undefined,
      (id) => { cancelled.push(id); tasks.find((task: any) => task.id === id)!.status = 'cancelled'; },
      'w',
    );

    const header = panel.render(120).join('\n');
    expect(header).toContain('w cancel active');

    panel.handleInput('w');
    expect(cancelled).toEqual(['task-1']);

    panel.handleInput('\u001b[C');
    panel.handleInput('w');
    expect(cancelled).toEqual(['task-1']);
  });

  it('registers the configured background handoff shortcut at extension startup', () => {
    fs.writeFileSync(path.join(tmp, '.pi', 'subagents.json'), JSON.stringify({ background_handoff_shortcut: 'ctrl+b' }));
    const previousCwd = process.cwd();
    process.chdir(tmp);
    try {
      const shortcuts: string[] = [];
      extension({
        registerTool: () => undefined,
        registerCommand: () => undefined,
        registerShortcut: (key: string) => shortcuts.push(key),
      });
      expect(shortcuts).toEqual(['ctrl+,', 'ctrl+b']);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('does not install a recurring background widget timer at session startup', async () => {
    const handlers: Record<string, any> = {};
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    try {
      extension({
        on: (event: string, handler: any) => { handlers[event] = handler; },
        registerTool: () => undefined,
        registerCommand: () => undefined,
        registerShortcut: () => undefined,
      });

      await handlers.session_start?.({}, {
        cwd: tmp,
        ui: {
          setWidget: vi.fn(),
          onTerminalInput: vi.fn(() => () => undefined),
        },
      });

      expect(setIntervalSpy).not.toHaveBeenCalled();
    } finally {
      setIntervalSpy.mockRestore();
      await handlers.session_shutdown?.({}, { ui: { setWidget: vi.fn() } });
    }
  });

  it('registers terminal input routing and cleans it up on shutdown', async () => {
    const handlers: Record<string, any> = {};
    const off = vi.fn();
    const setWidget = vi.fn();
    extension({
      on: (event: string, handler: any) => { handlers[event] = handler; },
      registerTool: () => undefined,
      registerCommand: () => undefined,
      registerShortcut: () => undefined,
    });

    await handlers.session_start?.({}, {
      cwd: tmp,
      ui: {
        setWidget,
        onTerminalInput: vi.fn(() => off),
      },
    });

    expect(setWidget).toHaveBeenCalled();
    expect(off).not.toHaveBeenCalled();

    await handlers.session_shutdown?.({}, { ui: { setWidget } });
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('keeps the history shortcut and command available together', async () => {
    let historyShortcutHandler: any;
    let subagentsCommand: any;
    const custom = vi.fn();
    extension({
      registerTool: () => undefined,
      registerCommand: (name: string, command: any) => { if (name === 'subagents') subagentsCommand = command; },
      registerShortcut: (key: string, shortcut: any) => { if (key === 'ctrl+,') historyShortcutHandler = shortcut.handler; },
    });

    await historyShortcutHandler({ cwd: tmp, ui: { custom } });
    expect(custom).toHaveBeenCalledTimes(1);

    await subagentsCommand.handler('', { cwd: tmp, ui: { custom } });
    expect(custom).toHaveBeenCalledTimes(2);
  });

  it('opens the subagents history panel as a full-screen overlay with bounded height', async () => {
    let subagentsCommand: any;
    let customOptions: any;
    let renderedLines: string[] = [];
    const writes: string[] = [];
    const rows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
    Object.defineProperty(process.stdout, 'rows', { configurable: true, value: 50 });
    extension({
      registerTool: () => undefined,
      registerCommand: (name: string, command: any) => { if (name === 'subagents') subagentsCommand = command; },
    });

    await subagentsCommand.handler('', {
      cwd: tmp,
      ui: {
        custom: async (factory: any, options: any) => {
          customOptions = options;
          const component = factory({ mode: 'fullscreen', terminal: { write: (text: string) => writes.push(text) }, requestRender() {} }, { fg: (_name: string, text: string) => text }, {}, () => undefined);
          renderedLines = component.render(80);
          component.handleInput('\x1b');
        },
      },
    });

    expect(customOptions).toEqual({ overlay: true, overlayOptions: { anchor: 'top-left', width: '100%', maxHeight: '100%', margin: 0 } });
    expect(renderedLines).toHaveLength(50);
    expect(writes.join('')).not.toContain('\x1b[?1000h');
    if (rows) Object.defineProperty(process.stdout, 'rows', rows);
    else delete (process.stdout as any).rows;
  });

  it('renders fallback execution flow with boxed section headers and no background fills for tool lines', () => {
    const task: SubagentTask = {
      id: 'subtask_fallback_boxed_flow',
      agent: 'analyst',
      mode: 'task',
      status: 'completed',
      task: 'fallback task to box',
      created_at: new Date().toISOString(),
      prompt: '## delegated task\nanalyze codebase',
      transcript: 'subagent analyst started\nread src/ui/theme.ts\nbash npm test\n',
      result: 'analysis finished',
    };
    const theme = {
      fg: (name: string, text: string) => `FG(${name}:${text})`,
      bg: (name: string, text: string) => `BG(${name}:${text})`,
      bold: (text: string) => text,
    };
    const stripTheme = (text: string) => text.replace(/FG\([^:]+:|\)/g, '').replace(/\u001b\[[0-9;]*m/g, '');
    const panel = new SubagentsHistoryPanel(
      [task],
      theme,
      () => undefined,
      () => false,
      (text) => stripTheme(text).length,
      (text, width) => stripTheme(text).length > width ? text.slice(0, width) : text,
      {},
      40,
    );
    const rendered = panel.render(120).join('\n');

    // Section headings are boxed/framed with ┌─ ... ─┐
    expect(rendered).toContain('FG(accent:┌─ )');
    expect(rendered).toContain('FG(accent:┐)');
    expect(rendered).toContain('FG(mdHeading:delegated task)');
    expect(rendered).toContain('FG(mdHeading:execution)');

    // Tool lines use electric border indicators without toolPendingBg
    expect(rendered).toContain('FG(accent:│ )');
    expect(rendered).toContain('FG(toolTitle:read src/ui/theme.ts)');
    expect(rendered).not.toContain('toolPendingBg');
    expect(rendered).not.toContain('BG(');
  });

  it('renders friendly display_name in panel header, hides raw task IDs, and omits response heading when empty', () => {
    const taskWithName: SubagentTask = {
      id: 'subtask_panel_friendly_test',
      display_name: 'Database Schema Migration',
      agent: 'database',
      mode: 'task',
      status: 'completed',
      task: 'migrate tables',
      created_at: new Date().toISOString(),
      result: '', // empty result
    };
    const theme = {
      fg: (_name: string, text: string) => text,
      bg: (_name: string, text: string) => text,
      bold: (text: string) => text,
    };
    const panel = new SubagentsHistoryPanel(
      [taskWithName],
      theme,
      () => undefined,
      () => false,
      (text) => text.length,
      (text, width) => text.length > width ? text.slice(0, width) : text,
      {},
      30,
    );
    const rendered = panel.render(120).join('\n');

    // Friendly name is shown in header
    expect(rendered).toContain('Database Schema Migration');
    // Raw task ID is hidden from user-visible header
    expect(rendered).not.toContain('id: subtask_');
    expect(rendered).not.toContain('subtask_panel_friendly_test');
    // Response heading is absent when result is empty
    expect(rendered).not.toContain('# response sent to orchestrator');
    expect(rendered).not.toContain('Preparing for response');
  });

  it('navigates to referenced subagent execution on mouse click from a fallback flow row', () => {
    const now = new Date().toISOString();
    const tasks: SubagentTask[] = [
      {
        id: 'task_parent_001',
        agent: 'orchestrator',
        mode: 'task',
        status: 'completed',
        task: 'coordinate pipeline',
        created_at: now,
        transcript: 'subagent sdd-apply started\nread src/ui/theme.ts\nbash npm test\n',
      },
      {
        id: 'subtask_apply_002',
        agent: 'sdd-apply',
        display_name: 'Apply Feature',
        mode: 'task',
        status: 'running',
        task: 'apply changes',
        created_at: now,
      },
    ];
    const panel = new SubagentsHistoryPanel(
      tasks,
      { fg: (_name: string, text: string) => text, bold: (text: string) => text },
      () => undefined,
      () => false,
      (text) => text.length,
      (text, width) => text.length > width ? text.slice(0, width) : text,
      {},
      30,
    );

    const initialRender = panel.render(120);
    expect(panel.getRenderDebugState().selectedIndex).toBe(0);

    // Find terminal row of "subagent sdd-apply"
    const flowRowIndex = initialRender.findIndex((line) => line.includes('subagent sdd-apply'));
    expect(flowRowIndex).toBeGreaterThan(0);

    const clickResult = panel.handleMouse({ type: 'click', row: flowRowIndex });
    expect(clickResult).toEqual({ handled: true, focus: true, render: true });
    expect(panel.getRenderDebugState().selectedIndex).toBe(1);

    const secondRender = panel.render(120).join('\n');
    expect(secondRender).toContain('2/2');
    expect(secondRender).toContain('Apply Feature');
    expect(secondRender).toContain('subagent: sdd-apply');
  });

  it('navigates to referenced subagent execution from structured thread snapshot and hides raw IDs', () => {
    resetPiComponentCacheForTests();
    const now = new Date().toISOString();
    const tasks: SubagentTask[] = [
      {
        id: 'task_root',
        agent: 'main',
        mode: 'task',
        status: 'completed',
        task: 'execute tools',
        created_at: now,
        thread_snapshot: {
          version: 1,
          source: 'events',
          items: [
            {
              type: 'tool',
              name: 'subagent_run',
              status: 'completed',
              arguments: { agent: 'analyst', task: 'analyze performance' },
              result: {
                details: { task: { id: 'subtask_secret_id_987', agent: 'analyst' } },
                content: [{ type: 'text', text: 'analyst executed successfully' }],
                preview: 'analyst executed successfully',
                isError: false,
              },
            },
            {
              type: 'tool',
              name: 'bash',
              status: 'completed',
              arguments: { command: 'git status' },
              result: {
                content: [{ type: 'text', text: 'nothing to commit' }],
                preview: 'nothing to commit',
                isError: false,
              },
            },
          ],
        },
      },
      {
        id: 'subtask_secret_id_987',
        agent: 'analyst',
        display_name: 'Performance Analysis',
        mode: 'task',
        status: 'completed',
        task: 'analyze performance',
        created_at: now,
      },
    ];

    const panel = new SubagentsHistoryPanel(
      tasks,
      { fg: (_name: string, text: string) => text, bold: (text: string) => text },
      () => undefined,
      () => false,
      (text) => text.length,
      (text, width) => text.length > width ? text.slice(0, width) : text,
      { cwd: tmp, tui: { requestRender() {} } },
      30,
    );

    const initialLines = panel.render(120);
    const initialText = initialLines.join('\n');

    // MINI-002 / MINI-005: Raw task ID must remain hidden from rendered output
    expect(initialText).not.toContain('subtask_secret_id_987');
    expect(panel.getRenderDebugState().selectedIndex).toBe(0);

    // Find row corresponding to the subagent_run entry
    const subagentRow = initialLines.findIndex((line) => line.includes('analyst executed successfully') || line.includes('subagent_run'));
    expect(subagentRow).toBeGreaterThan(0);

    // Click navigation targets the referenced task
    const clickResult = panel.handleMouse({ type: 'click', row: subagentRow });
    expect(clickResult).toEqual({ handled: true, focus: true, render: true });
    expect(panel.getRenderDebugState().selectedIndex).toBe(1);

    // Render now shows the selected task
    const nextRender = panel.render(120).join('\n');
    expect(nextRender).toContain('Performance Analysis');
    expect(nextRender).not.toContain('subtask_secret_id_987');
  });

  it('ignores clicks on non-body rows, non-subagent body rows, and empty padding', () => {
    const now = new Date().toISOString();
    const tasks: SubagentTask[] = [
      {
        id: 'task_1',
        agent: 'first',
        mode: 'task',
        status: 'completed',
        task: 'inspect rows',
        created_at: now,
        transcript: 'subagent second started\nread src/ui/theme.ts\nbash npm test\n',
      },
      {
        id: 'task_2',
        agent: 'second',
        mode: 'task',
        status: 'completed',
        task: 'second task',
        created_at: now,
      },
    ];

    const panel = new SubagentsHistoryPanel(
      tasks,
      { fg: (_name: string, text: string) => text, bold: (text: string) => text },
      () => undefined,
      () => false,
      (text) => text.length,
      (text, width) => text.length > width ? text.slice(0, width) : text,
      {},
      30,
    );

    const rendered = panel.render(120);
    expect(panel.getRenderDebugState().selectedIndex).toBe(0);

    // Header row 0
    expect(panel.handleMouse({ type: 'click', row: 0 })).toEqual({ handled: true, focus: true });
    expect(panel.getRenderDebugState().selectedIndex).toBe(0);

    // Top frame row 1
    expect(panel.handleMouse({ type: 'click', row: 1 })).toEqual({ handled: true, focus: true });
    expect(panel.getRenderDebugState().selectedIndex).toBe(0);

    // Metadata row 2
    expect(panel.handleMouse({ type: 'click', row: 2 })).toEqual({ handled: true, focus: true });
    expect(panel.getRenderDebugState().selectedIndex).toBe(0);

    // Task strip row
    const taskStripRow = rendered.findIndex((line) => line.includes('executions 1-2/2'));
    expect(taskStripRow).toBeGreaterThan(0);
    expect(panel.handleMouse({ type: 'click', row: taskStripRow })).toEqual({ handled: true, focus: true });
    expect(panel.getRenderDebugState().selectedIndex).toBe(0);

    // Non-subagent body tool row: "bash npm test"
    const bashRow = rendered.findIndex((line) => line.includes('bash npm test'));
    expect(bashRow).toBeGreaterThan(0);
    expect(panel.handleMouse({ type: 'click', row: bashRow })).toEqual({ handled: true, focus: true });
    expect(panel.getRenderDebugState().selectedIndex).toBe(0);

    // Non-subagent body tool row: "read src/ui/theme.ts"
    const readRow = rendered.findIndex((line) => line.includes('read src/ui/theme.ts'));
    expect(readRow).toBeGreaterThan(0);
    expect(panel.handleMouse({ type: 'click', row: readRow })).toEqual({ handled: true, focus: true });
    expect(panel.getRenderDebugState().selectedIndex).toBe(0);

    // Bottom frame row
    const bottomRow = rendered.length - 1;
    expect(panel.handleMouse({ type: 'click', row: bottomRow })).toEqual({ handled: true, focus: true });
    expect(panel.getRenderDebugState().selectedIndex).toBe(0);

    // Wheel scrolling does not change selected task
    expect(panel.handleMouse({ type: 'wheel', wheelDelta: 1 })).toEqual({ handled: true, render: true });
    expect(panel.getRenderDebugState().selectedIndex).toBe(0);
  });

  it('safely handles stale or missing task-id mappings without throwing or exposing IDs', () => {
    const now = new Date().toISOString();
    const tasks: SubagentTask[] = [
      {
        id: 'task_parent',
        agent: 'orchestrator',
        mode: 'task',
        status: 'completed',
        task: 'manage execution',
        created_at: now,
        // References a missing subtask ID in transcript
        transcript: 'subagent deleted-agent (subtask_ghost_9999) started\nread notes.md\n',
      },
    ];

    const panel = new SubagentsHistoryPanel(
      tasks,
      { fg: (_name: string, text: string) => text, bold: (text: string) => text },
      () => undefined,
      () => false,
      (text) => text.length,
      (text, width) => text.length > width ? text.slice(0, width) : text,
      {},
      30,
    );

    const rendered = panel.render(120);
    // Raw task ID must remain hidden from user-visible lines
    expect(rendered.join('\n')).not.toContain('subtask_ghost_9999');

    const ghostRow = rendered.findIndex((line) => line.includes('deleted-agent'));
    expect(ghostRow).toBeGreaterThan(0);

    // Clicking does not throw, does not change selection, and returns handled: true, focus: true
    expect(() => {
      const res = panel.handleMouse({ type: 'click', row: ghostRow });
      expect(res).toEqual({ handled: true, focus: true });
    }).not.toThrow();

    expect(panel.getRenderDebugState().selectedIndex).toBe(0);
  });

  it('preserves keyboard, expansion, thinking, and cancellation behaviors during click navigation', () => {
    const now = new Date().toISOString();
    const cancelled: string[] = [];
    const tasks: SubagentTask[] = [
      {
        id: 'task_active_1',
        agent: 'first',
        mode: 'task',
        status: 'running',
        task: 'first running task',
        created_at: now,
        transcript: 'subagent second started\n',
      },
      {
        id: 'task_active_2',
        agent: 'second',
        mode: 'task',
        status: 'running',
        task: 'second running task',
        created_at: now,
      },
    ];

    const keys: Record<string, string> = {
      'ctrl+o': '\u000f',
      'ctrl+t': '\u0014',
      detailCancel: 'x',
    };

    const panel = new SubagentsHistoryPanel(
      tasks,
      { fg: (_name: string, text: string) => text, bold: (text: string) => text },
      () => undefined,
      (data, key) => data === keys[key],
      (text) => text.length,
      (text, width) => text.length > width ? text.slice(0, width) : text,
      {},
      30,
      undefined,
      undefined,
      (id) => cancelled.push(id),
      'x',
    );

    // Toggle ctrl+o and ctrl+t via keyboard
    panel.handleInput('\u000f'); // toolOutputExpanded = true
    panel.handleInput('\u0014'); // hideThinkingBlock = true

    const rendered = panel.render(120);
    const flowRow = rendered.findIndex((line) => line.includes('subagent second'));
    expect(flowRow).toBeGreaterThan(0);

    // Mouse click navigates to task 2
    panel.handleMouse({ type: 'click', row: flowRow });
    expect(panel.getRenderDebugState().selectedIndex).toBe(1);

    // Flow entry click must NOT have triggered cancellation
    expect(cancelled).toHaveLength(0);

    // Keyboard cancellation on newly selected task works as expected
    panel.handleInput('x');
    expect(cancelled).toEqual(['task_active_2']);
  });

  it('handles SGR mouse click input from handleInput', () => {
    const now = new Date().toISOString();
    const tasks: SubagentTask[] = [
      {
        id: 'task_a',
        agent: 'orchestrator',
        mode: 'task',
        status: 'completed',
        task: 'root task',
        created_at: now,
        transcript: '󰣇 sdd-apply tool completed: bash\n',
      },
      {
        id: 'task_b',
        agent: 'sdd-apply',
        mode: 'task',
        status: 'completed',
        task: 'apply task',
        created_at: now,
      },
    ];

    const panel = new SubagentsHistoryPanel(
      tasks,
      { fg: (_name: string, text: string) => text, bold: (text: string) => text },
      () => undefined,
      () => false,
      (text) => text.length,
      (text, width) => text.length > width ? text.slice(0, width) : text,
      {},
      30,
    );

    const rendered = panel.render(120);
    const flowRow = rendered.findIndex((line) => line.includes('sdd-apply tool completed: bash'));
    expect(flowRow).toBeGreaterThan(0);

    // Send SGR mouse click on the detail column: \x1b[<button;col;rowM (1-based row = flowRow + 1)
    const sgrInput = `\x1b[<0;50;${flowRow + 1}M`;
    panel.handleInput(sgrInput);

    expect(panel.getRenderDebugState().selectedIndex).toBe(1);
  });

  it('renders responsive narrow view with subagents list at bottom and close button', () => {
    let closed = false;
    const now = new Date().toISOString();
    const tasks: SubagentTask[] = [
      { id: 'task-1', agent: 'orchestrator', mode: 'task', status: 'completed', task: 'coordinate workflow', created_at: now, thread_snapshot: { version: 1, source: 'events', items: [{ type: 'status', text: 'orch status' }] } },
      { id: 'task-2', agent: 'analyst', display_name: 'Deep Analysis', mode: 'task', status: 'running', task: 'analyze performance', created_at: now, thread_snapshot: { version: 1, source: 'events', items: [{ type: 'status', text: 'analyst status' }] } },
      { id: 'task-3', agent: 'sdd-apply', mode: 'task', status: 'queued', task: 'apply modifications', created_at: now },
      { id: 'task-4', agent: 'sdd-verify', mode: 'task', status: 'queued', task: 'verify results', created_at: now },
    ];

    const visible = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '').length;
    const panel = new SubagentsHistoryPanel(
      tasks,
      { fg: (_name: string, text: string) => text, bold: (text: string) => text },
      () => { closed = true; },
      () => false,
      visible,
      (text, width) => text.length > width ? text.slice(0, width) : text,
      {},
      24,
    );

    const rendered = panel.render(60);
    expect(rendered.every((line) => visible(line) <= 60)).toBe(true);

    const fullText = rendered.join('\n');
    // Header must contain close button
    expect(rendered[0]).toContain('[✕ Cerrar]');
    // Footer must contain close button
    expect(rendered[rendered.length - 1]).toContain('[✕ Cerrar]');

    // Bottom section must show the executions list
    expect(fullText).toContain('executions [1-4/4]');
    expect(fullText).toContain('orchestrator · completed');
    expect(fullText).toContain('Deep Analysis · running');
    expect(fullText).toContain('sdd-apply · queued');

    // Click on the second subagent row in the bottom list to select it
    const analystRow = rendered.findIndex((line) => line.includes('Deep Analysis'));
    expect(analystRow).toBeGreaterThan(0);
    const clickResult = panel.handleMouse({ type: 'click', row: analystRow, col: 10 });
    expect(clickResult).toEqual({ handled: true, focus: true, render: true });
    expect(panel.getRenderDebugState().selectedIndex).toBe(1);

    // Click on header close button closes panel
    panel.handleMouse({ type: 'click', row: 0, col: 55 });
    expect(closed).toBe(true);

    // Reset and click on footer close button closes panel
    closed = false;
    panel.handleMouse({ type: 'click', row: rendered.length - 1, col: 55 });
    expect(closed).toBe(true);
  });

  it('supports scrolling the bottom subagents list with mouse wheel in narrow view', () => {
    const now = new Date().toISOString();
    const tasks: SubagentTask[] = Array.from({ length: 6 }, (_, i) => ({
      id: `task-${i + 1}`,
      agent: `agent-${i + 1}`,
      mode: 'task' as const,
      status: 'completed' as const,
      task: `task number ${i + 1}`,
      created_at: now,
      thread_snapshot: { version: 1 as const, source: 'events' as const, items: [{ type: 'status' as const, text: `line ${i + 1}` }] },
    }));

    const visible = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '').length;
    const panel = new SubagentsHistoryPanel(
      tasks,
      { fg: (_name: string, text: string) => text, bold: (text: string) => text },
      () => undefined,
      () => false,
      visible,
      (text, width) => text.length > width ? text.slice(0, width) : text,
      {},
      24,
    );

    const initial = panel.render(60);
    const listRowIndex = initial.findIndex((line) => line.includes('● 1. agent-1'));
    expect(listRowIndex).toBeGreaterThan(0);

    // Wheel down on the list row scrolls the subagent list
    const wheelResult = panel.handleMouse({ type: 'wheel', wheelDelta: 1, row: listRowIndex, col: 10 });
    expect(wheelResult).toEqual({ handled: true, render: true });

    const scrolled = panel.render(60).join('\n');
    expect(scrolled).toContain('executions [2-5/6]');
  });

  it('renders clean narrow view at minimum width (40) with no line exceeding 40 columns', () => {
    const now = new Date().toISOString();
    const tasks: SubagentTask[] = [
      {
        id: 'task-min',
        agent: 'analyst',
        mode: 'task',
        status: 'running',
        task: 'very long task description that definitely exceeds forty columns of space',
        created_at: now,
      },
    ];

    const visible = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '').length;
    const panel = new SubagentsHistoryPanel(
      tasks,
      { fg: (_name: string, text: string) => text, bold: (text: string) => text },
      () => undefined,
      () => false,
      visible,
      (text, width) => text.length > width ? text.slice(0, width) : text,
      {},
      20,
    );

    const rendered = panel.render(40);
    expect(rendered.every((line) => visible(line) <= 40)).toBe(true);
    expect(rendered[0]).toContain('[✕ Cerrar]');
    expect(rendered[rendered.length - 1]).toContain('[✕ Cerrar]');
    expect(rendered.join('\n')).toContain('executions [1-1/1]');
  });

  it('renders narrow stacked view with intact borders and clean task description', async () => {
    const { truncateToWidth: realTruncate, visibleWidth: realVisible } = await import('../../src/render/text-width.js');
    resetPiComponentCacheForTests();
    try {
      setPiComponentProviderForSubagentRendering({
        ToolExecutionComponent: class {
          constructor(private name: string, _id: string, private args: any) {}
          markExecutionStarted() {}
          setArgsComplete() {}
          updateResult() {}
          setExpanded() {}
          render(width: number) {
            const innerWidth = Math.max(10, width - 4);
            const topBar = '─'.repeat(Math.max(0, innerWidth - this.name.length - 1));
            return [
              `┌ ${this.name} ${topBar}┐`,
              `│ $ ${this.args?.command ?? 'cmd'} │`,
              `└${'─'.repeat(innerWidth)}┘`,
            ];
          }
        },
        AssistantMessageComponent: class {
          constructor(private msg: any) {}
          render(_width: number) {
            const text = this.msg?.content?.[0]?.text ?? '';
            return text.split('\n');
          }
        },
      });

      const now = new Date().toISOString();
      const task: SubagentTask = {
        id: 'subtask_archive',
        agent: 'sdd-apply',
        display_name: 'Archive verified definitive mobile redesign',
        mode: 'task',
        status: 'completed',
        task: 'Archive verified definitive mobile redesign: 1. Goal: Archive the ve...',
        created_at: now,
        started_at: now,
        ended_at: now,
        thread_snapshot: {
          version: 1,
          source: 'events',
          items: [
            {
              type: 'tool',
              id: 'tool-bash',
              name: 'bash',
              status: 'completed',
              arguments: { command: 'ls -la "openspec/changes"' },
              result: { content: [{ type: 'text', text: 'total 12' }], isError: false },
            },
            {
              type: 'assistant',
              id: 'asst-1',
              message: {
                role: 'assistant',
                content: [
                  {
                    type: 'text',
                    text: 'success: agent settled\n\nHandoff\n\n- Status: READY\n- Artifact: openspec/archive/2026-09-15/redisenio-mobile-definitivo\n- Blockers: None\n- Next action: None',
                  },
                ],
              },
            },
          ],
        },
      };

      const panel = new SubagentsHistoryPanel(
        [task],
        { fg: (_name: string, text: string) => `\x1b[36m${text}\x1b[0m`, bold: (text: string) => `\x1b[1m${text}\x1b[0m` },
        () => {},
        () => false,
        realVisible,
        realTruncate,
        { tui: { requestRender() {} } },
        30,
      );

      const width = 76;
      const rendered = panel.render(width);

      // 1. Every single rendered line must not exceed width
      for (let i = 0; i < rendered.length; i++) {
        const vis = realVisible(rendered[i]!);
        expect(vis, `line ${i} visible width (${vis}) must be <= ${width}: ${rendered[i]}`).toBeLessThanOrEqual(width);
      }

      // 2. Top frame must end with [✕ Cerrar] and right corner
      expect(rendered[0]).toContain('[✕ Cerrar]');
      expect(rendered[0]).toContain('─╮');

      // 3. Subheader Row 1 must have completed status, agent, and right border
      expect(rendered[1]).toContain('sdd-apply');
      expect(rendered[1]).toContain('completed');
      expect(stripAnsi(rendered[1]!).trimEnd().endsWith('│')).toBe(true);

      // 4. Subheader Row 2 must have clean non-duplicated task description
      expect(rendered[2]).toContain('Archive verified definitive mobile redesign');
      expect(rendered[2]).not.toContain('Archive verified definitive mobile redesign: Archive verified');
      expect(stripAnsi(rendered[2]!).trimEnd().endsWith('│')).toBe(true);

      // 5. Divider line must connect properly
      expect(rendered[3]).toContain('├');
      expect(rendered[3]).toContain('┤');

      // 6. Body rows must have left and right borders
      const bodyRows = rendered.slice(4, rendered.length - 3);
      expect(bodyRows.length).toBeGreaterThan(0);
      for (const row of bodyRows) {
        expect(stripAnsi(row).startsWith('│')).toBe(true);
        expect(stripAnsi(row).trimEnd().endsWith('│')).toBe(true);
      }

      // 7. Footer line must end with [✕ Cerrar] and bottom right corner
      const lastLine = rendered[rendered.length - 1]!;
      expect(lastLine).toContain('[✕ Cerrar]');
      expect(stripAnsi(lastLine!).trimEnd().endsWith('─╯')).toBe(true);
    } finally {
      resetPiComponentCacheForTests();
    }
  });

});
