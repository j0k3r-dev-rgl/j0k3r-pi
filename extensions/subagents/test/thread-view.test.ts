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

describe('thread view and render', () => {
  it('does not statically depend on sibling extension internals', () => {
    const srcDir = path.join(process.cwd(), 'src');
    const files = fs.readdirSync(srcDir, { recursive: true })
      .filter((entry) => typeof entry === 'string' && entry.endsWith('.ts')) as string[];
    const source = files.map((file) => fs.readFileSync(path.join(srcDir, file), 'utf8')).join('\n');

    expect(source).not.toContain('../..');
    expect(source).not.toContain('/extensions/');
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

  it('groups initial and continued messages chronologically under explicit attempt boundaries without duplicating context', () => {
    const first = new ThreadSnapshotBuilder('delegated prompt body', 'orchestrator context body', tmp, undefined, 'delegated_task', 1)
      .finalize([{ role: 'assistant', content: [{ type: 'text', text: 'first response' }] }]);
    const second = new ThreadSnapshotBuilder('continue with step two', 'orchestrator context body', tmp, first, 'continuation', 2)
      .finalize([{ role: 'assistant', content: [{ type: 'text', text: 'second response' }] }]);
    const third = new ThreadSnapshotBuilder('continue with step three', 'orchestrator context body', tmp, second, 'continuation', 3)
      .finalize([{ role: 'assistant', content: [{ type: 'text', text: 'third response' }] }]);

    const sequence = third?.items.map((item: any) => {
      if (item.type === 'attempt') return `attempt:${item.attempt}`;
      if (item.type === 'user') return `${item.label}:${item.text}`;
      if (item.type === 'assistant') return `assistant:${item.message.content.map((part: any) => part.text ?? part.thinking ?? '').join('')}`;
      return item.type;
    });
    expect(sequence).toEqual([
      'attempt:1',
      'context:orchestrator context body',
      'delegated_task:delegated prompt body',
      'assistant:first response',
      'attempt:2',
      'continuation:continue with step two',
      'assistant:second response',
      'attempt:3',
      'continuation:continue with step three',
      'assistant:third response',
    ]);

    const rendered = renderText(third);
    expect(rendered.match(/orchestrator context body/g)).toHaveLength(1);
    expect(rendered).toContain('attempt 1');
    expect(rendered).toContain('orchestrator context');
    expect(rendered).toContain('delegated task');
    expect(rendered).toContain('attempt 2');
    expect(rendered).toContain('continuation prompt');
    expect(rendered.indexOf('first response')).toBeLessThan(rendered.indexOf('attempt 2'));
    expect(rendered.indexOf('continue with step two')).toBeLessThan(rendered.indexOf('second response'));
    expect(rendered.indexOf('second response')).toBeLessThan(rendered.indexOf('attempt 3'));
  });

  it('renders legacy continuation snapshots as auditable attempt groups without repeating embedded context', () => {
    const legacy = {
      version: 1,
      source: 'mixed',
      items: [
        { type: 'user', label: 'delegated_task', text: '## orchestrator context\nshared legacy context\n\n## delegated task\ngenerate the original code' },
        { type: 'user', label: 'context', text: 'shared legacy context' },
        { type: 'user', label: 'continuation', text: 'repeat the original code' },
        { type: 'user', label: 'continuation', text: 'change only the suffix' },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'CODE: ORIGINAL' }] } },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'CODE: ORIGINAL' }] } },
        { type: 'assistant', id: 'streaming-assistant-1', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'selecting suffix' }] } },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'CODE: UPDATED' }] } },
      ],
    } as any;

    const rendered = renderText(legacy);
    expect(rendered.match(/shared legacy context/g)).toHaveLength(1);
    expect(rendered).toContain('attempt 1');
    expect(rendered).toContain('attempt 2');
    expect(rendered).toContain('attempt 3');
    expect(rendered.indexOf('generate the original code')).toBeLessThan(rendered.indexOf('CODE: ORIGINAL'));
    expect(rendered.indexOf('CODE: ORIGINAL')).toBeLessThan(rendered.indexOf('attempt 2'));
    expect(rendered.indexOf('repeat the original code')).toBeLessThan(rendered.lastIndexOf('CODE: ORIGINAL'));
    expect(rendered.lastIndexOf('CODE: ORIGINAL')).toBeLessThan(rendered.indexOf('attempt 3'));
    expect(rendered.indexOf('change only the suffix')).toBeLessThan(rendered.indexOf('selecting suffix'));
    expect(rendered.indexOf('selecting suffix')).toBeLessThan(rendered.indexOf('CODE: UPDATED'));
  });

  it('renders queued steering rows distinctly while preserving normal Pi-style consumed user rows', () => {
    resetPiComponentCacheForTests();
    const packageRoot = path.join(tmp, 'fake-pi-user-queue-package');
    fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', main: 'index.cjs' }));
    fs.writeFileSync(path.join(packageRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    const shimDir = path.join(tmp, 'bin-user-queue');
    fs.mkdirSync(shimDir);
    fs.symlinkSync(path.join(packageRoot, 'dist', 'cli.js'), path.join(shimDir, 'pi'));
    fs.writeFileSync(path.join(packageRoot, 'index.cjs'), `
      exports.getMarkdownTheme = () => ({ fakeMarkdownTheme: true });
      exports.UserMessageComponent = class {
        constructor(text, markdownTheme) { this.text = text; this.markdownTheme = markdownTheme; }
        render(width) { return ['pi-user:' + width + ':' + this.markdownTheme.fakeMarkdownTheme + ':' + this.text]; }
      };
    `);
    const oldArgv1 = process.argv[1];
    process.argv[1] = path.join(shimDir, 'pi');
    try {
      const rendered = renderThreadBody({
        version: 1,
        source: 'events',
        items: [
          { type: 'attempt', attempt: 1 },
          { type: 'user', label: 'queued', text: 'queued steering body' },
          { type: 'user', label: 'user', text: 'consumed steering body' },
        ],
      } as any, {
        cwd: tmp,
        renderWidth: 80,
        visibleWidth: (text: string) => text.length,
        truncateToWidth: (text: string, width: number) => text.length > width ? text.slice(0, width) : text,
      } as any).join('\n');

      expect(rendered).toContain('pi-user:80:true:## queued live message\n\nqueued steering body');
      expect(rendered).toContain('pi-user:80:true:consumed steering body');
      expect(rendered).not.toContain('## queued live message\n\nconsumed steering body');
    } finally {
      process.argv[1] = oldArgv1;
      resetPiComponentCacheForTests();
    }
  });

  it('resolves registered extension tool definitions from pi/context arrays and maps', () => {
    const memoryTool = { name: 'memory_search', label: 'Memory Search' };
    const readTool = { name: 'read', label: 'Read' };

    expect(resolveRegisteredToolDefinition({}, { tools: [memoryTool] }, 'memory_search')).toBe(memoryTool);
    expect(resolveRegisteredToolDefinition({ tools: new Map([['memory_search', memoryTool]]) }, {}, 'memory_search')).toBe(memoryTool);
    expect(resolveRegisteredToolDefinition({ pi: { getAllTools: () => [memoryTool] } }, {}, 'memory_search')).toBe(memoryTool);
    expect(resolveRegisteredToolDefinition({}, { getAllTools: () => [memoryTool] }, 'memory_search')).toBe(memoryTool);
    expect(resolveRegisteredToolDefinition({ pi: { getToolDefinition: (name: string) => name === 'read' ? readTool : undefined } }, { tools: [memoryTool] }, 'read')).toBe(readTool);
  });

  it('rehydrates renderer-bearing extension tool definitions from getAllTools source metadata', () => {
    resetPiComponentCacheForTests();
    const source = path.join(tmp, 'external-renderer.cjs');
    fs.writeFileSync(source, `
      module.exports = function extension(pi) {
        pi.registerTool({
          name: 'external_memory',
          label: 'External Memory',
          description: 'external memory',
          parameters: {},
          renderShell: 'self',
          renderResult() { return { render: () => ['external-renderer-inherited'], invalidate() {} }; },
        });
      }
    `);
    const packageRoot = path.join(tmp, 'fake-pi-rehydrate-package');
    fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(packageRoot, 'node_modules', 'jiti'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', main: 'index.cjs' }));
    fs.writeFileSync(path.join(packageRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    fs.writeFileSync(path.join(packageRoot, 'node_modules', 'jiti', 'package.json'), JSON.stringify({ main: 'index.cjs' }));
    fs.writeFileSync(path.join(packageRoot, 'node_modules', 'jiti', 'index.cjs'), `exports.createJiti = () => require;\n`);
    const shimDir = path.join(tmp, 'bin-rehydrate');
    fs.mkdirSync(shimDir);
    fs.symlinkSync(path.join(packageRoot, 'dist', 'cli.js'), path.join(shimDir, 'pi'));
    const oldArgv1 = process.argv[1];
    process.argv[1] = path.join(shimDir, 'pi');
    try {
      const definition = resolveRegisteredToolDefinition({
        pi: {
          getAllTools: () => [{
            name: 'external_memory',
            description: 'metadata only',
            parameters: {},
            sourceInfo: { path: source, source: 'external-renderer', scope: 'user', origin: 'package' },
          }],
        },
      }, {}, 'external_memory') as any;

      expect(definition?.renderShell).toBe('self');
      expect(definition?.renderResult?.({}, {}, {}, {})?.render(80).join('\n')).toContain('external-renderer-inherited');
    } finally {
      process.argv[1] = oldArgv1;
      resetPiComponentCacheForTests();
    }
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

  it('renders runtime subagent tool rows with Pi ToolExecutionComponent using the captured real tool definition', () => {
    resetPiComponentCacheForTests();
    const packageRoot = path.join(tmp, 'fake-pi-runtime-tool-package');
    fs.mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', main: 'index.cjs' }));
    fs.writeFileSync(path.join(packageRoot, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    const shimDir = path.join(tmp, 'bin-runtime-tool');
    fs.mkdirSync(shimDir);
    fs.symlinkSync(path.join(packageRoot, 'dist', 'cli.js'), path.join(shimDir, 'pi'));
    fs.writeFileSync(path.join(packageRoot, 'index.cjs'), `
      exports.ToolExecutionComponent = class {
        constructor(name, id, args, options, definition) { this.name = name; this.args = args; this.definition = definition; }
        markExecutionStarted() {}
        setArgsComplete() {}
        updateResult(result) { this.result = result; }
        setExpanded() {}
        render(width) { return ['pi-runtime-tool:' + width + ':' + this.name + ':' + this.definition.label + ':' + this.args.symbol + ':' + this.result.content[0].text]; }
      };
    `);
    const oldArgv1 = process.argv[1];
    process.argv[1] = path.join(shimDir, 'pi');
    try {
      registerSubagentRuntimeToolDefinition('task-runtime-tools', 'find_symbol', { name: 'find_symbol', label: 'Find Symbol' });
      const lines = renderThreadBody({
        version: 1,
        source: 'events',
        items: [{ type: 'tool', name: 'find_symbol', status: 'completed', arguments: { symbol: 'registerSubagentTools' }, result: { content: [{ type: 'text', text: 'Found 1 match.' }], isError: false } }],
      } as any, {
        cwd: tmp,
        taskId: 'task-runtime-tools',
        tui: { requestRender() {} },
        renderWidth: 180,
        visibleWidth: (text: string) => text.length,
        truncateToWidth: (text: string, width: number) => text.length > width ? text.slice(0, width) : text,
      } as any);

      expect(lines.join('\n')).toContain('pi-runtime-tool:180:find_symbol:Find Symbol:registerSubagentTools:Found 1 match.');
      expect(lines.join('\n')).not.toContain('find_symbol completed ·');
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
      let readDefinitionCalls = 0;
      exports.createReadToolDefinition = (cwd) => { readDefinitionCalls += 1; return { name: 'read', cwd, readDefinitionCalls }; };
      exports.__readDefinitionCalls = () => readDefinitionCalls;
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

      const second = renderThreadBody({
        version: 1,
        source: 'events',
        items: [{ type: 'tool', name: 'read', status: 'completed', arguments: { path: 'README.md' }, result: { content: [{ type: 'text', text: 'second result' }], isError: false } }],
      } as any, {
        cwd: tmp,
        tui: { requestRender() {} },
        renderWidth: 200,
        visibleWidth: (text: string) => text.length,
        truncateToWidth: (text: string, width: number) => text.length > width ? text.slice(0, width) : text,
      } as any);
      expect(second.join('\n')).toContain('README.md:second result');
      expect(require(packageRoot).__readDefinitionCalls()).toBe(1);
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

});
