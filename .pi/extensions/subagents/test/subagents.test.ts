import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import extension, { resolveRegisteredToolDefinition } from '../index.js';
import { loadSubagents, parseFrontmatter, readSubagentsConfig, resetGlobalSubagentModelProfileField, saveGlobalSubagentModelProfile } from '../src/config.js';
import { resolveEffectiveSubagentProfile } from '../src/profile-resolver.js';
import { buildPrompt, ThreadSnapshotBuilder } from '../src/runner.js';
import { applyDirtyProfileEdit, buildModelProfileRows, buildNoChangesModelProfilesMessage, buildNonTuiModelProfilesMessage, commitStagedModelProfiles, createSubagentModelProfilesModal, globalSubagentsConfigPath, groupAvailableModelsByProvider, runSubagentModelsCommand, stageModelProfileEdit } from '../src/model-profiles-ui.js';
import { SubagentHistoryStore } from '../src/history.js';
import { SubagentManager } from '../src/manager.js';
import { registerSubagentTools } from '../src/tools.js';
import { SubagentsHistoryPanel } from '../src/ui.js';
import { boundThreadSnapshot, isValidThreadSnapshot, renderThreadBody, resetPiComponentCacheForTests } from '../src/thread-view.js';
import type { EffectiveSubagentProfile, SubagentModelProfiles, SubagentRunner, SubagentTask } from '../src/types.js';

const require = createRequire(import.meta.url);

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

describe('subagents extension', () => {
  it('validates and bounds v1 subagent thread snapshots safely', () => {
    const snapshot = {
      version: 1,
      source: 'events',
      items: [
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hello from assistant' }] } },
        { type: 'tool', name: 'read', status: 'completed', arguments: { path: 'README.md' }, result: { content: [{ type: 'text', text: 'file body' }], isError: false } },
        { type: 'bash', command: 'npm test', output: 'passed', status: 'completed', exitCode: 0 },
        { type: 'error', text: 'safe error row' },
      ],
    };

    expect(isValidThreadSnapshot(snapshot)).toBe(true);
    expect(renderThreadBody(snapshot as any, { visibleWidth: (text) => text.length, truncateToWidth: (text, width) => text.slice(0, width), cwd: tmp }).join('\n')).toContain('hello from assistant');
    expect(renderThreadBody(snapshot as any, { visibleWidth: (text) => text.length, truncateToWidth: (text, width) => text.slice(0, width), cwd: tmp }).join('\n')).toContain('read completed');

    const bounded = boundThreadSnapshot({ version: 1, source: 'events', items: [{ type: 'status', text: 'x'.repeat(5000) }] } as any, { textLimit: 32 });
    expect(bounded?.items[0]).toMatchObject({ type: 'status', text: expect.stringMatching(/…$/) });
    expect((bounded?.items[0] as any).text.length).toBeLessThanOrEqual(32);
  });

  it('rejects malformed, missing, and future subagent thread snapshots', () => {
    expect(isValidThreadSnapshot(undefined)).toBe(false);
    expect(isValidThreadSnapshot(null)).toBe(false);
    expect(isValidThreadSnapshot({ version: 2, source: 'events', items: [] })).toBe(false);
    expect(isValidThreadSnapshot({ version: 1, source: 'events', items: [{ type: 'future', text: 'nope' }] })).toBe(false);
    expect(isValidThreadSnapshot({ version: 1, source: 'events', items: [{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text' }] } }] })).toBe(false);
  });

  it('loads Pi message components from the running Pi package and renders them at the requested width', () => {
    const packageRoot = path.join(tmp, 'fake-pi-package');
    fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', main: 'index.cjs' }));
    fs.writeFileSync(path.join(packageRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    const shimDir = path.join(tmp, 'bin-message');
    fs.mkdirSync(shimDir);
    fs.symlinkSync(path.join(packageRoot, 'dist', 'cli.js'), path.join(shimDir, 'pi'));
    fs.writeFileSync(path.join(packageRoot, 'index.cjs'), `
      exports.getMarkdownTheme = () => ({ fakeMarkdownTheme: true });
      exports.AssistantMessageComponent = class {
        constructor(message, hideThinkingBlock, markdownTheme) { this.message = message; this.markdownTheme = markdownTheme; }
        render(width) { return ['pi-assistant:' + width + ':' + this.markdownTheme.fakeMarkdownTheme + ':' + this.message.content[0].text]; }
      };
      exports.UserMessageComponent = class {
        constructor(text, markdownTheme) { this.text = text; this.markdownTheme = markdownTheme; }
        render(width) { return ['pi-user:' + width + ':' + this.markdownTheme.fakeMarkdownTheme + ':' + this.text]; }
      };
    `);
    const oldArgv1 = process.argv[1];
    process.argv[1] = path.join(shimDir, 'pi');
    try {
      const lines = renderThreadBody({
        version: 1,
        source: 'events',
        items: [
          { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'from pi component' }] } },
          { type: 'user', text: 'user component text', label: 'user' },
        ],
      } as any, {
        cwd: tmp,
        renderWidth: 42,
        visibleWidth: (text: string) => text.length,
        truncateToWidth: (text: string, width: number) => text.length > width ? text.slice(0, width) : text,
      } as any);

      expect(lines.join('\n')).toContain('pi-assistant:42:true:from pi component');
      expect(lines.join('\n')).toContain('pi-user:42:true:user component text');
    } finally {
      process.argv[1] = oldArgv1;
      resetPiComponentCacheForTests();
    }
  });

  it('includes the delegated orchestrator prompt and context as first user rows in thread snapshots', () => {
    const builder = new ThreadSnapshotBuilder('delegated prompt body', 'orchestrator context body');
    const snapshot = builder.snapshot();

    expect(snapshot?.items[0]).toMatchObject({ type: 'user', label: 'delegated_task', text: 'delegated prompt body' });
    expect(snapshot?.items[1]).toMatchObject({ type: 'user', label: 'context', text: 'orchestrator context body' });
  });

  it('resolves registered extension tool definitions from pi/context arrays and maps', () => {
    const memoryTool = { name: 'memory_search', label: 'Memory Search' };
    const readTool = { name: 'read', label: 'Read' };

    expect(resolveRegisteredToolDefinition({}, { tools: [memoryTool] }, 'memory_search')).toBe(memoryTool);
    expect(resolveRegisteredToolDefinition({ tools: new Map([['memory_search', memoryTool]]) }, {}, 'memory_search')).toBe(memoryTool);
    expect(resolveRegisteredToolDefinition({ pi: { getToolDefinition: (name: string) => name === 'read' ? readTool : undefined } }, { tools: [memoryTool] }, 'read')).toBe(readTool);
  });

  it('renders extension tool rows with Pi ToolExecutionComponent when the context supplies a tool definition', () => {
    resetPiComponentCacheForTests();
    const packageRoot = path.join(tmp, 'fake-pi-extension-tools-package');
    fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', main: 'index.cjs' }));
    fs.writeFileSync(path.join(packageRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    const shimDir = path.join(tmp, 'bin-extension-tools');
    fs.mkdirSync(shimDir);
    fs.symlinkSync(path.join(packageRoot, 'dist', 'cli.js'), path.join(shimDir, 'pi'));
    fs.writeFileSync(path.join(packageRoot, 'index.cjs'), `
      exports.ToolExecutionComponent = class {
        constructor(name, id, args, options, definition) { this.name = name; this.args = args; this.definition = definition; }
        markExecutionStarted() {}
        setArgsComplete() {}
        updateResult(result) { this.result = result; }
        setExpanded() {}
        render(width) { return ['pi-extension-tool:' + width + ':' + this.name + ':' + this.definition.label + ':' + this.args.query + ':' + this.result.content[0].text]; }
      };
    `);
    const oldArgv1 = process.argv[1];
    process.argv[1] = path.join(shimDir, 'pi');
    try {
      const lines = renderThreadBody({
        version: 1,
        source: 'events',
        items: [{ type: 'tool', name: 'memory_search', status: 'completed', arguments: { query: 'thread view' }, result: { content: [{ type: 'text', text: 'Found 1 memory result(s).' }], isError: false } }],
      } as any, {
        cwd: tmp,
        tui: { requestRender() {} },
        getToolDefinition: (name: string) => name === 'memory_search' ? { name, label: 'Memory Search' } : undefined,
        renderWidth: 180,
        visibleWidth: (text: string) => text.length,
        truncateToWidth: (text: string, width: number) => text.length > width ? text.slice(0, width) : text,
      } as any);

      expect(lines.join('\n')).toContain('pi-extension-tool:180:memory_search:Memory Search:thread view:Found 1 memory result(s).');
      expect(lines.join('\n')).not.toContain('memory_search completed ·');
    } finally {
      process.argv[1] = oldArgv1;
      resetPiComponentCacheForTests();
    }
  });

  it('renders built-in tool rows with Pi ToolExecutionComponent from exported per-tool definitions', () => {
    resetPiComponentCacheForTests();
    const packageRoot = path.join(tmp, 'fake-pi-tools-package');
    fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', main: 'index.cjs' }));
    fs.writeFileSync(path.join(packageRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    const shimDir = path.join(tmp, 'bin-tools');
    fs.mkdirSync(shimDir);
    fs.symlinkSync(path.join(packageRoot, 'dist', 'cli.js'), path.join(shimDir, 'pi'));
    fs.writeFileSync(path.join(packageRoot, 'index.cjs'), `
      exports.createReadToolDefinition = (cwd) => ({ name: 'read', cwd });
      exports.ToolExecutionComponent = class {
        constructor(name, id, args, options, definition, tui, cwd) { this.name = name; this.args = args; this.definition = definition; this.cwd = cwd; }
        markExecutionStarted() {}
        setArgsComplete() {}
        updateResult(result) { this.result = result; }
        setExpanded() {}
        render(width) { return ['pi-tool:' + width + ':' + this.name + ':' + this.definition.cwd + ':' + this.args.path + ':' + this.result.content[0].text]; }
      };
    `);
    const oldArgv1 = process.argv[1];
    process.argv[1] = path.join(shimDir, 'pi');
    try {
      const lines = renderThreadBody({
        version: 1,
        source: 'events',
        items: [{ type: 'tool', name: 'read', status: 'completed', arguments: { path: 'AGENTS.md' }, result: { content: [{ type: 'text', text: 'file result' }], isError: false } }],
      } as any, {
        cwd: tmp,
        tui: { requestRender() {} },
        renderWidth: 200,
        visibleWidth: (text: string) => text.length,
        truncateToWidth: (text: string, width: number) => text.length > width ? text.slice(0, width) : text,
      } as any);

      expect(lines.join('\n')).toContain(`pi-tool:200:read:${tmp}:AGENTS.md:file result`);
      expect(lines.join('\n')).not.toContain('read completed ·');
    } finally {
      process.argv[1] = oldArgv1;
      resetPiComponentCacheForTests();
    }
  });

  it('does not render assistant toolCall parts as raw requested text when tool rows exist', () => {
    const snapshot = {
      version: 1,
      source: 'mixed',
      items: [
        { type: 'assistant', message: { role: 'assistant', content: [
          { type: 'toolCall', id: 'call-read', name: 'read', arguments: { path: 'AGENTS.md' } },
          { type: 'text', text: 'Summary after reading files.' },
        ] } },
        { type: 'tool', tool_call_id: 'call-read', name: 'read', status: 'completed', arguments: { path: 'AGENTS.md' }, result: { content: [{ type: 'text', text: '# Agent Guide' }], isError: false } },
      ],
    };

    const text = renderText(snapshot as any);

    expect(text).toContain('Summary after reading files.');
    expect(text).toContain('read');
    expect(text).toContain('AGENTS.md');
    expect(text).toContain('# Agent Guide');
    expect(text).not.toContain('tool read requested');
  });

  it('filters assistant toolCall parts before using Pi assistant components to avoid duplicate raw JSON', () => {
    resetPiComponentCacheForTests();
    const packageRoot = path.join(tmp, 'fake-pi-toolcall-filter-package');
    fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', main: 'index.cjs' }));
    fs.writeFileSync(path.join(packageRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    const shimDir = path.join(tmp, 'bin-toolcall-filter');
    fs.mkdirSync(shimDir);
    fs.symlinkSync(path.join(packageRoot, 'dist', 'cli.js'), path.join(shimDir, 'pi'));
    fs.writeFileSync(path.join(packageRoot, 'index.cjs'), `
      exports.getMarkdownTheme = () => ({});
      exports.createReadToolDefinition = () => ({ name: 'read' });
      exports.AssistantMessageComponent = class {
        constructor(message) { this.message = message; }
        render() { return this.message.content.map((part) => part.type === 'toolCall' ? 'raw-tool-json:' + JSON.stringify(part.arguments) : 'assistant-text:' + part.text); }
      };
      exports.ToolExecutionComponent = class {
        constructor(name, id, args) { this.name = name; this.args = args; }
        markExecutionStarted() {}
        setArgsComplete() {}
        updateResult(result) { this.result = result; }
        setExpanded() {}
        render() { return ['pi-tool-row:' + this.name + ':' + this.args.path]; }
      };
    `);
    const oldArgv1 = process.argv[1];
    process.argv[1] = path.join(shimDir, 'pi');
    try {
      const text = renderText({
        version: 1,
        source: 'mixed',
        items: [
          { type: 'assistant', message: { role: 'assistant', content: [
            { type: 'toolCall', id: 'call-read', name: 'read', arguments: { path: 'AGENTS.md' } },
            { type: 'text', text: 'final answer' },
          ] } },
          { type: 'tool', tool_call_id: 'call-read', name: 'read', status: 'completed', arguments: { path: 'AGENTS.md' }, result: { content: [{ type: 'text', text: '# Agent Guide' }], isError: false } },
        ],
      } as any, { tui: { requestRender() {} } });

      expect(text).toContain('assistant-text:final answer');
      expect(text).toContain('pi-tool-row:read:AGENTS.md');
      expect(text).not.toContain('raw-tool-json');
      expect(text).not.toContain('{"path":"AGENTS.md"}');
    } finally {
      process.argv[1] = oldArgv1;
      resetPiComponentCacheForTests();
    }
  });

  it('renders memory tool fallback as a concise tool call instead of raw JSON arguments', () => {
    const text = renderText({
      version: 1,
      source: 'events',
      items: [
        { type: 'tool', name: 'memory_search', status: 'completed', arguments: { query: 'subagent memory tools render', limit: 3, scopes: ['project', 'general', 'global'], compact: true }, result: { content: [{ type: 'text', text: 'Found 3 memory result(s).' }], isError: false } },
      ],
    } as any);

    expect(text).toContain('memory_search completed');
    expect(text).toContain('subagent memory tools render');
    expect(text).toContain('Found 3 memory result(s).');
    expect(text).not.toContain('{"query"');
    expect(text).not.toContain('"scopes"');
  });

  it('renders structured thread body rows with safe generic fallbacks', () => {
    const snapshot = {
      version: 1,
      source: 'events',
      items: [
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'assistant explains the plan' }] } },
        { type: 'tool', name: 'memory_search', status: 'completed', arguments: { query: 'thread view' }, result: { content: [{ type: 'text', text: 'memory result text' }], isError: false } },
        { type: 'bash', command: 'npm test -- --run', output: 'vitest passed', status: 'completed', exitCode: 0 },
        { type: 'tool', name: 'edit', status: 'completed', arguments: { path: 'src/thread-view.ts' }, result: { content: [{ type: 'text', text: 'updated one file' }], isError: false } },
        { type: 'tool', name: 'read', status: 'completed', arguments: { path: 'README.md' }, result: { content: [{ type: 'text', text: 'read preview' }], isError: false } },
        { type: 'tool', name: 'custom_tool', status: 'failed', arguments: { value: 'custom args' }, result: { content: [{ type: 'text', text: 'custom failure text' }], isError: true } },
        { type: 'custom', customType: 'extension.event', fallbackText: 'custom fallback text' },
        { type: 'error', text: 'renderer-safe error row' },
      ],
    };

    const text = renderText(snapshot as any);

    expect(text).toContain('assistant explains the plan');
    expect(text).toContain('memory_search');
    expect(text).toContain('thread view');
    expect(text).toContain('bash');
    expect(text).toContain('npm test -- --run');
    expect(text).toContain('vitest passed');
    expect(text).toContain('edit');
    expect(text).toContain('src/thread-view.ts');
    expect(text).toContain('read');
    expect(text).toContain('README.md');
    expect(text).toContain('custom_tool');
    expect(text).toContain('failed');
    expect(text).toContain('custom failure text');
    expect(text).toContain('custom fallback text');
    expect(text).toContain('renderer-safe error row');
  });

  it('bounds malformed thread items and continues rendering later rows', () => {
    const snapshot = {
      version: 1,
      source: 'events',
      items: [
        { type: 'status', text: 'before malformed' },
        { type: 'tool', name: `bad_tool_${'x'.repeat(160)}`, status: 'completed', arguments: { circular: true } },
        { type: 'future_tool_shape', raw: { name: 'future_custom', text: 'malformed item text' } },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'after malformed still visible' }] } },
      ],
    };
    (snapshot.items[1] as any).arguments.self = (snapshot.items[1] as any).arguments;

    const text = renderText(snapshot as any, { truncateToWidth: (line, width) => {
      if (line.includes('bad_tool')) throw new Error('forced renderer failure');
      return line.length > width ? line.slice(0, width) : line;
    } });

    expect(text).toContain('thread item unavailable');
    expect(text).toContain('malformed thread item');
    expect(text).toContain('after malformed still visible');
  });

  it('uses bounded body widths for long rendered rows', () => {
    const widths: number[] = [];
    const text = renderText({
      version: 1,
      source: 'events',
      items: [{ type: 'bash', command: `node ${'x'.repeat(180)}`, output: 'done', status: 'completed', exitCode: 0 }],
    } as any, {
      truncateToWidth: (line, width) => {
        widths.push(width);
        return line.length > 72 ? `${line.slice(0, 71)}…` : line;
      },
    });

    expect(Math.max(...widths)).toBeLessThanOrEqual(100);
    expect(text).toContain('…');
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
      exports.BashExecutionComponent = class {
        constructor(command) { this.command = command; this.expanded = false; }
        appendOutput(output) { this.output = output; }
        setComplete() {}
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
        thread_snapshot: { version: 1, source: 'events', items: [{ type: 'bash', command: 'npm test', output: 'long output', status: 'completed', exitCode: 0 }] },
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

  it('preserves panel chrome while rendering selected thread snapshots', () => {
    const task: SubagentTask = {
      id: 'subtask_thread_2',
      agent: 'reviewer',
      mode: 'task',
      status: 'running',
      task: 'keep shell visible',
      created_at: new Date().toISOString(),
      last_activity: 'rendering snapshot',
      model: 'mock/model',
      effort: 'high',
      thread_snapshot: { version: 1, source: 'events', items: [{ type: 'status', text: 'thread body visible' }] },
    };
    const panel = new SubagentsHistoryPanel([task], { fg: (_name: string, text: string) => text, bold: (text: string) => text }, () => undefined, () => false, (text) => text.length, (text, width) => text.length > width ? text.slice(0, width) : text);
    const rendered = panel.render(120).join('\n');

    expect(rendered).toContain('subagents');
    expect(rendered).toContain('agent: reviewer');
    expect(rendered).toContain('status: running');
    expect(rendered).toContain('model: mock/model');
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

  it('registers agent-facing tools only', () => {
    const tools: string[] = [], commands: string[] = [];
    extension({ registerTool: (tool: any) => tools.push(tool.name), registerCommand: (name: string) => commands.push(name) });
    expect(tools).toContain('subagent_run');
    expect(tools).toContain('subagent_list_agents');
    expect(tools).toContain('subagent_status');
    expect(tools).toContain('subagent_result');
    expect(commands).toEqual(['subagents', 'subagent-models']);
  });

  it('enables mouse tracking while the subagents history panel is open and disables it on close', async () => {
    let subagentsCommand: any;
    const writes: string[] = [];
    extension({
      registerTool: () => undefined,
      registerCommand: (name: string, command: any) => { if (name === 'subagents') subagentsCommand = command; },
    });

    await subagentsCommand.handler('', {
      cwd: tmp,
      ui: {
        custom: async (factory: any) => {
          const component = factory({ terminal: { write: (text: string) => writes.push(text) }, requestRender() {} }, { fg: (_name: string, text: string) => text }, {}, () => undefined);
          component.handleInput('\x1b');
        },
      },
    });

    expect(writes.join('')).toContain('\x1b[?1000h\x1b[?1006h');
    expect(writes.join('')).toContain('\x1b[?1006l\x1b[?1000l');
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

  it('builds model profile rows for loaded agents and known SDD phases with labels', () => withAgentDir(path.join(tmp, 'isolated-agent'), () => {
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
    expect(rendered).toContain('target: global');
    expect(rendered).toContain('pending: none');
    expect(rendered).toContain('agent/phase');
    expect(rendered).toContain('model');
    expect(rendered).toContain('effort');
    expect(lines.some((line) => line.startsWith('│ target: global'))).toBe(true);
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
    expect(initial).toContain('target: global');
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

  it('subagent models command uses custom modal overlay and saves exactly dirty rows globally', async () => {
    writeAgent('analyst');
    writeAgent('reviewer');
    const agentDir = path.join(tmp, 'global-agent');
    const notifications: Array<[string, string | undefined]> = [];
    let capturedOptions: any;
    const custom = vi.fn(async (factory: any, options: any) => {
      capturedOptions = options;
      let result: any;
      const component = factory({ requestRender() {} }, {}, {}, (value: any) => { result = value; });
      component.handleInput('enter');
      component.handleInput('down');
      component.handleInput('enter');
      component.handleInput('enter');
      component.handleInput('down');
      component.handleInput('e');
      for (let i = 0; i < 5; i += 1) component.handleInput('down');
      component.handleInput('enter');
      component.handleInput('s');
      return result;
    });

    const message = await withAgentDir(agentDir, () => runSubagentModelsCommand({
      cwd: tmp,
      agentDir,
      modelRegistry: { getAvailable: async () => [{ provider: 'openai', id: 'gpt-5.2', label: 'GPT 5.2' }] },
      ui: { custom, notify: (text: string, level?: string) => notifications.push([text, level]) },
    }));

    expect(custom).toHaveBeenCalledTimes(1);
    expect(capturedOptions).toEqual({ overlay: true, overlayOptions: { anchor: 'center', width: '90%', maxHeight: '85%', minWidth: 74 } });
    expect(message).toBe(`Saved subagent model profiles to ${globalSubagentsConfigPath(agentDir)}.`);
    expect(notifications).toEqual([[message, 'info']]);
    expect(JSON.parse(fs.readFileSync(path.join(agentDir, 'subagents.json'), 'utf8'))).toEqual({
      model_profiles: {
        analyst: { model: 'openai/gpt-5.2' },
        reviewer: { effort: 'high' },
      },
    });
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

    expect(message).toBe(`Saved subagent model profiles to ${globalSubagentsConfigPath(agentDir)}.`);
    expect(select).toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(path.join(agentDir, 'subagents.json'), 'utf8'))).toEqual({
      model_profiles: { analyst: { model: 'openai/gpt-5.2-codex', effort: 'high' } },
    });
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

  it('does not use sqlite schema migrations for subagent history', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src', 'history.ts'), 'utf8');
    expect(source).not.toContain('ALTER TABLE');
    expect(source).not.toContain('ensureColumn');
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
    const db = new DatabaseSync(path.join(tmp, '.pi', 'subagents-history.sqlite'));
    // Old `.pi/subagents-history.sqlite` data may be deleted/reset; v1 deliberately does not migrate flat transcripts into snapshots.
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

  it('keeps subagent_run command results compact when tasks include large thread snapshots', async () => {
    writeAgent('analyst');
    const manager = new SubagentManager(async () => ({
      result: 'compact result',
      model: 'mock/model',
      fallback_used: false,
      thread_snapshot: statusSnapshot('oversized snapshot text '.repeat(400)),
    }));
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

    const result = await runTool.execute('1', { agent: 'analyst', task: 'compact snapshots', mode: 'task' }, undefined, undefined, { cwd: tmp });
    const serialized = JSON.stringify(result);

    expect(result.content[0].text).toContain('Completed 1 subagent task');
    expect(serialized).not.toContain('thread_snapshot');
    expect(serialized).not.toContain('oversized snapshot text oversized snapshot text oversized snapshot text');
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

  it('ignores marker-like prose and docs text as actionable permission requests and keeps final output marker-free', async () => {
    writeAgent('analyst');
    const markerLikeText = [
      'documentation example:',
      'permission_required:{"type":"permission_required","requestId":"fake"}',
      'tool output fixture mentions permission_required:{"type":"permission_required","requestId":"fake-2"}',
    ].join('\n');
    const runner = vi.fn(async () => ({
      result: markerLikeText,
      model: 'mock/model',
      fallback_used: false,
      thread_snapshot: {
        version: 1,
        source: 'events',
        items: [
          { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: markerLikeText }] } },
          { type: 'tool', name: 'read', status: 'completed', arguments: { path: 'docs.md' }, result: { content: [{ type: 'text', text: markerLikeText }], isError: false } },
        ],
      },
    }));
    const manager = new SubagentManager(runner as any);
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);
    const select = vi.fn();

    const result = await runTool.execute('1', { agent: 'analyst', task: 'document marker handling', mode: 'task' }, undefined, undefined, { cwd: tmp, ui: { select } });

    expect(select).not.toHaveBeenCalled();
    expect(runner).toHaveBeenCalledOnce();
    expect(result.isError).toBeUndefined();
    expect(JSON.stringify(result.details.results[0])).not.toContain('permission_required:');
  });

  it('prompts the main thread from the latest authentic structured permission request, retries, and keeps history surfaces marker-free', async () => {
    writeAgent('analyst');
    const latestPayload = {
      type: 'permission_required',
      requestId: 'req-latest',
      tool: 'bash',
      action: 'bash',
      origin: 'subagent',
      requester: { subagentName: 'analyst' },
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
    let attempts = 0;
    const runner = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          result: [
            'stale transcript mentions permission_required:{"type":"permission_required","requestId":"stale"}',
            'intermediate transcript',
          ].join('\n'),
          model: 'mock/model',
          fallback_used: false,
          permission_request: latestPayload,
          transcript: 'stale transcript mentions permission_required:{"type":"permission_required","requestId":"stale"}',
          thread_snapshot: {
            version: 1,
            source: 'events',
            items: [
              { type: 'status', text: 'permission_required:{"type":"permission_required","requestId":"stale"}' },
            ],
          },
        } as any;
      }
      return {
        result: 'command succeeded after approval',
        model: 'mock/model',
        fallback_used: false,
        thread_snapshot: {
          version: 1,
          source: 'events',
          items: [{ type: 'status', text: 'command succeeded after approval' }],
        },
      } as any;
    });
    const manager = new SubagentManager(runner);
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);
    const select = vi.fn(async (message: string, choices: string[]) => {
      expect(choices).toEqual(['Allow once', 'Allow for session', 'Allow for project', 'Deny']);
      expect(message).toContain('Latest bash approval.');
      expect(message).toContain('find .pi/extensions/permission-guard -maxdepth 4 -type f');
      expect(message).not.toContain('stale');
      return 'Allow once';
    });

    const result = await runTool.execute('1', { agent: 'analyst', task: 'inspect permissions', mode: 'task' }, undefined, undefined, { cwd: tmp, ui: { select } });
    const task = manager.listTasks(tmp)[0];

    expect(select).toHaveBeenCalledOnce();
    expect(runner).toHaveBeenCalledTimes(2);
    expect(result.isError).toBeUndefined();
    expect(JSON.stringify(result.details.results[0])).not.toContain('permission_required:');
    expect(JSON.stringify(task)).not.toContain('permission_required:');
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
    const runner = vi.fn(async () => ({ result: output, model: 'mock/model', fallback_used: false, permission_request: latestPayload }));
    const manager = new SubagentManager(runner as any);
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
    let attempts = 0;
    const runner = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) return { result: 'permission request pending', model: 'mock/model', fallback_used: false, permission_request: payload };
      const saved = JSON.parse(fs.readFileSync(path.join(tmp, '.pi', 'permissions.json'), 'utf8'));
      expect(saved.bash.safeCommands).toContain(payload.projectScope.safeCommandPattern);
      return { result: 'command succeeded after project approval', model: 'mock/model', fallback_used: false };
    });
    const manager = new SubagentManager(runner as any);
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
    let attempts = 0;
    const runner = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) return { result: 'permission request pending', model: 'mock/model', fallback_used: false, permission_request: payload };
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
    const manager = new SubagentManager(runner as any);
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
