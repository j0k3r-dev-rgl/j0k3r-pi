import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { visibleWidth } from '@earendil-works/pi-tui';
import { SubagentManager } from '../../src/manager.js';
import { registerSubagentTools } from '../../src/tools.js';
import { createAskOrchestratorTool } from '../../src/runner/ask-orchestrator-tool.js';
import { createReportOrchestratorTool } from '../../src/runner/report-orchestrator-tool.js';
import { registerSubagentsPanelOpener, resetSubagentsPanelOpenerStateForTests } from '../../src/ui/panel-overlay.js';
import {
  registerSubagentRuntimeToolDefinition,
  renderThreadBody,
  resetPiComponentCacheForTests,
  resolveSubagentExternalToolDefinitionFromInfo,
  setPiComponentProviderForSubagentRendering,
} from '../../src/thread-view.js';
import { installSubagentTestEnv } from '../helpers/subagent-test-helpers.js';

const DEFAULT_INSTALLED_HOST = path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', '@earendil-works', 'pi-coding-agent');
const HOST_ROOT = process.env.PI_SUBAGENTS_TEST_HOST || process.env.PI_COMPACT_TEST_HOST || DEFAULT_INSTALLED_HOST;
const HAS_HOST = fs.existsSync(path.join(HOST_ROOT, 'dist', 'index.js'));

const env = installSubagentTestEnv();

function stripSgrAndOsc(text: string): string {
  return text
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\u001b\][^\u001b]*(?:\u001b\\|\u0007)/g, '');
}

function hasBackgroundEscape(lines: string[]): boolean {
  return /\u001b\[(?:4[0-79]|10[0-7]|48;)/.test(lines.join('\n'));
}

function assertCompactLines(lines: string[], width: number): void {
  if (width <= 0) {
    for (const line of lines) expect(visibleWidth(line)).toBe(0);
    return;
  }
  if (width === 1) {
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(1);
      if (line.length > 0) expect(stripSgrAndOsc(line)).toBe(' ');
    }
    return;
  }
  const joined = lines.join('\n');
  expect(hasBackgroundEscape(lines)).toBe(false);
  expect(stripSgrAndOsc(joined)).not.toContain('…');
  expect(stripSgrAndOsc(joined)).not.toMatch(/[╭╮╰╯│┌┐└┘]/);
  expect(stripSgrAndOsc(joined)).not.toMatch(/to expand|app\.tools\.expand|ctrl\+o|click to view/i);
  for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
}

describe.runIf(HAS_HOST)('installed Pi host ToolExecutionComponent conformance (MINI-005)', () => {
  let installedPi: Record<string, any>;
  let loadExtensions: (entries: string[], cwd: string) => Promise<any>;

  beforeEach(async () => {
    resetPiComponentCacheForTests();
    const themeMod = await import(pathToFileURL(path.join(HOST_ROOT, 'dist', 'modes', 'interactive', 'theme', 'theme.js')).href);
    themeMod.initTheme('dark', false);
    installedPi = await import(pathToFileURL(path.join(HOST_ROOT, 'dist', 'index.js')).href);
    const loaderMod = await import(pathToFileURL(path.join(HOST_ROOT, 'dist', 'core', 'extensions', 'loader.js')).href);
    loadExtensions = loaderMod.loadExtensions;
  });

  afterEach(() => {
    resetPiComponentCacheForTests();
    registerSubagentsPanelOpener(undefined);
    resetSubagentsPanelOpenerStateForTests();
  });

  it('loads subagents via installed Pi loadExtensions and exposes compact metadata', async () => {
    const entry = path.resolve(process.cwd(), 'index.ts');
    const loaded = await loadExtensions([entry], env.tmp);
    expect(loaded.errors).toEqual([]);
    const tool = loaded.extensions[0].tools.get('subagent_run')?.definition;
    expect(tool).toBeDefined();
    expect(tool.compactToolRenderingVersion).toBe(1);
    expect(tool.renderShell).toBe('self');
    expect(typeof tool.renderCall).toBe('function');
    expect(typeof tool.renderResult).toBe('function');
  });

  it('renders subagent_run, ask_orchestrator and report_orchestrator inside real ToolExecutionComponent with native expand and zero stolen click', async () => {
    const openedPanels: Array<string | undefined> = [];
    registerSubagentsPanelOpener((taskId) => { openedPanels.push(taskId); });

    const manager = new SubagentManager(env.mockRunner());
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager, env.tmp);
    const askTool = createAskOrchestratorTool(async (question) => `answer:${question}`);
    const reportTool = createReportOrchestratorTool(() => {});

    const tui = { requestRender() {} };
    const { ToolExecutionComponent } = installedPi;

    const cases = [
      {
        def: runTool,
        args: { agent: 'analyst', task: 'audit code', mode: 'task' },
        partial: { content: [], details: { frame: 0, task: { id: 't-run', agent: 'analyst', status: 'running', attempt: 1, model: 'mock/model', effort: 'high' } } },
        result: {
          content: [{ type: 'text', text: 'Full subagent findings line 1\nFull subagent findings line 2' }],
          details: { action: 'run', task: { id: 't-run', agent: 'analyst', status: 'completed', attempt: 1, model: 'mock/model', effort: 'high', result: 'Full subagent findings line 1\nFull subagent findings line 2' } },
          isError: false,
        },
        expectedExpanded: 'Full subagent findings line 2',
      },
      {
        def: askTool,
        args: { question: 'Use port 8080 or 9090?' },
        partial: { content: [], details: {} },
        result: { content: [{ type: 'text', text: 'Orchestrator answer:\nUse port 8080.' }], details: { answered: true }, isError: false },
        expectedExpanded: 'Use port 8080.',
      },
      {
        def: reportTool,
        args: { report: 'Completed unit check.' },
        partial: { content: [], details: {} },
        result: { content: [{ type: 'text', text: 'Report sent to the parent session. Continue the assigned work without waiting for a reply; this is not the final result.' }], details: { sent: true }, isError: false },
        expectedExpanded: 'Report sent to the parent session.',
      },
    ];

    for (const entry of cases) {
      const comp = new ToolExecutionComponent(entry.def.name, `call-${entry.def.name}`, entry.args, {}, entry.def, tui, env.tmp);
      // Streaming args before execution: at most one inline row, no frame/background/hint.
      assertCompactLines(comp.render(80), 80);

      comp.markExecutionStarted();
      comp.setArgsComplete();
      comp.updateResult(entry.partial, true);
      assertCompactLines(comp.render(80), 80);

      comp.updateResult(entry.result, false);
      const collapsed = comp.render(80);
      assertCompactLines(collapsed, 80);
      expect(collapsed.join('\n')).not.toContain(entry.expectedExpanded);

      // Native fullscreen mouse click expands the tool row instead of opening /subagents.
      const clickResult = comp.handleMouse({ type: 'click', button: 'left', y: 1, x: 2, width: 80, height: collapsed.length });
      expect(clickResult?.handled).toBe(true);
      const expanded = comp.render(80);
      assertCompactLines(expanded, 80);
      expect(expanded.join('\n')).toContain(entry.expectedExpanded);

      // Narrow width & zero width safety on real ToolExecutionComponent.
      assertCompactLines(comp.render(24), 24);
      assertCompactLines(comp.render(0), 0);
    }

    expect(openedPanels).toEqual([]);
  });

  it('enforces replay marker policy in real ToolExecutionComponent across runtime, restored, unmarked and throwing definitions', () => {
    setPiComponentProviderForSubagentRendering(installedPi);
    const tui = { requestRender() {} };

    const runtimeMarked = {
      name: 'runtime_marked',
      label: 'Runtime Marked',
      renderShell: 'self',
      compactToolRenderingVersion: 1,
      renderCall: () => ({ invalidate() {}, render: () => ['marked-call'] }),
      renderResult: (result: any, opts: any) => ({
        invalidate() {},
        render: () => [opts.expanded ? `marked-expanded:${result.content[0].text}` : 'marked-collapsed'],
      }),
    };
    const runtimeUnmarked = {
      name: 'runtime_unmarked',
      label: 'Runtime Unmarked',
      renderCall: () => ({ invalidate() {}, render: () => ['╭── unmarked box ──╮'] }),
      renderResult: () => ({ invalidate() {}, render: () => ['│ unmarked body (ctrl+o to expand) │'] }),
    };
    const runtimeThrows = {
      name: 'runtime_throws',
      label: 'Runtime Throws',
      renderShell: 'self',
      compactToolRenderingVersion: 1,
      renderCall: () => { throw new Error('broken call renderer'); },
      renderResult: () => { throw new Error('broken result renderer'); },
    };

    registerSubagentRuntimeToolDefinition('task-host-replay', 'runtime_marked', runtimeMarked);
    registerSubagentRuntimeToolDefinition('task-host-replay', 'runtime_unmarked', runtimeUnmarked);
    registerSubagentRuntimeToolDefinition('task-host-replay', 'runtime_throws', runtimeThrows);

    const restoredDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagents-restored-'));
    try {
      const restoredFile = path.join(restoredDir, 'restored-tools.cjs');
      fs.writeFileSync(restoredFile, `
        exports.registerToolRenderers = function(pi) {
          pi.registerTool({
            name: 'restored_marked',
            label: 'Restored Marked',
            renderShell: 'self',
            compactToolRenderingVersion: 1,
            renderCall: () => ({ invalidate() {}, render: () => [] }),
            renderResult: (res, opts) => ({ invalidate() {}, render: () => [opts.expanded ? 'restored-exp:' + res.content[0].text : 'restored-ok'] }),
          });
          pi.registerTool({
            name: 'restored_unmarked',
            label: 'Restored Unmarked',
            renderShell: 'default',
            renderResult: () => ({ invalidate() {}, render: () => ['restored-unmarked-box (to expand)'] }),
          });
          pi.registerTool({
            name: 'restored_throws',
            label: 'Restored Throws',
            renderShell: 'self',
            compactToolRenderingVersion: 1,
            renderCall: () => ({ invalidate() {}, render: () => { throw new Error('render blowup'); } }),
            renderResult: () => ({ invalidate() {}, render: () => { throw new Error('render blowup'); } }),
          });
        };
      `);

      const restoredCache = new Map<string, any>();
      for (const name of ['restored_marked', 'restored_unmarked', 'restored_throws']) {
        restoredCache.set(name, resolveSubagentExternalToolDefinitionFromInfo(name, { name, sourceInfo: { path: restoredFile } }));
      }

      const snapshot = {
        version: 1,
        source: 'events',
        items: [
          { type: 'tool', id: '1', tool_call_id: 'c1', name: 'runtime_marked', status: 'completed', arguments: {}, result: { content: [{ type: 'text', text: 'rt-ok' }], isError: false } },
          { type: 'tool', id: '2', tool_call_id: 'c2', name: 'runtime_unmarked', status: 'completed', arguments: { path: 'a.ts' }, result: { content: [{ type: 'text', text: 'rt-unmarked-data' }], isError: false } },
          { type: 'tool', id: '3', tool_call_id: 'c3', name: 'runtime_throws', status: 'failed', arguments: { path: 'b.ts' }, result: { content: [{ type: 'text', text: 'rt-throw-data' }], isError: true } },
          { type: 'tool', id: '4', tool_call_id: 'c4', name: 'restored_marked', status: 'completed', arguments: {}, result: { content: [{ type: 'text', text: 'rs-ok' }], isError: false } },
          { type: 'tool', id: '5', tool_call_id: 'c5', name: 'restored_unmarked', status: 'completed', arguments: { path: 'c.ts' }, result: { content: [{ type: 'text', text: 'rs-unmarked-data' }], isError: false } },
          { type: 'tool', id: '6', tool_call_id: 'c6', name: 'restored_throws', status: 'completed', arguments: {}, result: { content: [{ type: 'text', text: 'rs-throw-data' }], isError: false } },
          { type: 'tool', id: '7', tool_call_id: 'c7', name: 'unknown_external_tool', status: 'completed', arguments: { query: 'needle' }, result: { content: [{ type: 'text', text: 'unknown-data' }], isError: false } },
          { type: 'tool_result', id: '8', name: 'orphan_tool', result: { content: [{ type: 'text', text: 'orphan-data' }], isError: false } },
          { type: 'bash', id: '9', command: 'echo hello', output: 'hello', status: 'completed', exitCode: 0 },
        ],
      };

      const renderCtx = {
        cwd: env.tmp,
        taskId: 'task-host-replay',
        tui,
        renderWidth: 80,
        visibleWidth,
        truncateToWidth: (text: string, width: number) => text.slice(0, width),
        getToolDefinition: (name: string) => restoredCache.get(name),
      };

      const collapsed = renderThreadBody(snapshot, renderCtx);
      const collapsedJoined = stripSgrAndOsc(collapsed.join('\n'));
      expect(collapsedJoined).toContain(' marked-collapsed');
      expect(collapsedJoined).toContain(' restored-ok');
      expect(collapsedJoined).not.toContain('  marked-collapsed');
      expect(collapsedJoined).not.toContain('  restored-ok');
      expect(collapsedJoined).toContain('runtime_unmarked completed');
      expect(collapsedJoined).toContain('restored_unmarked completed');
      expect(collapsedJoined).toContain('runtime_throws failed');
      expect(collapsedJoined).toContain('restored_throws completed');
      expect(collapsedJoined).toContain('unknown_external_tool completed ─ query=needle');
      expect(collapsedJoined).toContain('tool result orphan_tool ─ completed');
      expect(collapsedJoined).toContain('bash completed');
      expect(collapsedJoined).toContain('echo hello');
      expect(collapsed.some((line) => line.includes('\x1b[1;38;2;255;140;0m'))).toBe(true);
      expect(collapsedJoined).not.toContain('unmarked box');
      expect(collapsedJoined).not.toContain('restored-unmarked-box');
      expect(hasBackgroundEscape(collapsed)).toBe(false);
      expect(collapsedJoined).not.toMatch(/[╭╮╰╯│┌┐└┘]/);
      expect(collapsedJoined).not.toMatch(/to expand|ctrl\+o/i);

      const expanded = renderThreadBody(snapshot, { ...renderCtx, toolOutputExpanded: true, renderWidth: 28 });
      const expandedJoined = stripSgrAndOsc(expanded.join('\n'));
      expect(expandedJoined.replace(/\s+/g, '')).toContain('marked-expanded:rt-ok');
      expect(expandedJoined.replace(/\s+/g, '')).toContain('rt-unmarked-data');
      expect(expandedJoined.replace(/\s+/g, '')).toContain('rt-throw-data');
      expect(expandedJoined.replace(/\s+/g, '')).toContain('restored-exp:rs-ok');
      expect(expandedJoined.replace(/\s+/g, '')).toContain('rs-unmarked-data');
      expect(expandedJoined.replace(/\s+/g, '')).toContain('rs-throw-data');
      expect(expandedJoined.replace(/\s+/g, '')).toContain('unknown-data');
      expect(expandedJoined.replace(/\s+/g, '')).toContain('orphan-data');
      expect(expandedJoined.replace(/\s+/g, '')).toContain('hello');
      expect(hasBackgroundEscape(expanded)).toBe(false);
      expect(expandedJoined).not.toMatch(/[╭╮╰╯│┌┐└┘]/);
      expect(expandedJoined).not.toMatch(/to expand|ctrl\+o/i);
      for (const line of expanded) expect(visibleWidth(line)).toBeLessThanOrEqual(28);

      // Host-backed nested replay at width 2 preserves wide graphemes and CR/CRLF
      const wideSnap = {
        version: 1,
        source: 'events',
        items: [
          { type: 'tool', id: 'w1', tool_call_id: 'wc1', name: 'runtime_marked', status: 'completed', arguments: {}, result: { content: [{ type: 'text', text: 'A漢B' }], isError: false } },
          { type: 'bash', id: 'w2', command: 'A\r\nB\rC\nA漢B', output: 'X漢Y', status: 'completed', exitCode: 0 },
        ],
      };
      const hostCrLines = renderThreadBody(wideSnap as any, { ...renderCtx, renderWidth: 80 });
      const hostCrUnmargined = hostCrLines.map((l) => stripSgrAndOsc(l).slice(1)).join('\n');
      expect(hostCrUnmargined).toContain('A\r\nB\rC');
      const hostWide2 = renderThreadBody(wideSnap as any, { ...renderCtx, toolOutputExpanded: true, renderWidth: 2 });
      for (const line of hostWide2) expect(visibleWidth(line)).toBeLessThanOrEqual(2);
      const hostWidePlain2 = hostWide2.map(stripSgrAndOsc);
      expect(hostWidePlain2).toContain('漢');
      expect(hostWidePlain2).toContain(' A');
      expect(hostWidePlain2).toContain(' B');
      expect(hostWidePlain2).toContain(' X');
      expect(hostWidePlain2).toContain(' Y');
    } finally {
      fs.rmSync(restoredDir, { recursive: true, force: true });
    }
  });
});
