import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SubagentManager } from '../../src/manager.js';
import { registerSubagentTools } from '../../src/tools.js';
import { resetExpandKeybindingProviderForTests, setExpandKeybindingProviderForTests } from '../../src/render/tools/expansion-hint.js';
import { inlineComponent } from '../../src/render/tools/components.js';
import { visibleWidth } from '../../src/render/text-width.js';
import { ARCH_ICON } from '../../src/ui/theme.js';
import { taskFromDetails } from '../../src/tools/result-details.js';
import { backgroundLaunchContent } from '../../src/render/tools/formatting.js';
import type { SubagentTask } from '../../src/types.js';
import { installSubagentTestEnv } from '../helpers/subagent-test-helpers.js';

const env = installSubagentTestEnv();

describe('tool render helpers', () => {
  it('reports known launch model, effort and execution identity without inventing unresolved values', () => {
    const task = {
      id: 'task-guardrails', agent: 'analyst', task: 'inspect', status: 'running',
      attempt: 2, model: 'provider/resolved-model', effort: 'high',
      nested_session_path: '/workspace/nested-session.jsonl',
    } as SubagentTask;
    const launch = backgroundLaunchContent([task], 'Started');
    expect(launch).toContain('model: provider/resolved-model');
    expect(launch).toContain('effort: high');
    expect(launch).toContain('attempt: 2');
    expect(launch).toContain('executor: /workspace/nested-session.jsonl');
    const unresolved = backgroundLaunchContent([{ ...task, model: undefined, effort: undefined, nested_session_path: undefined }]);
    expect(unresolved).toContain('model: unresolved');
    expect(unresolved).toContain('effort: unresolved');
    expect(unresolved).not.toContain('default/current');
  });

  it('inlineComponent wraps overflowing headers and expanded bodies without ellipsis, applies muted body color, and never intercepts input', () => {
    const comp: any = inlineComponent({
      header: 'a very long compact header that must wrap cleanly without ellipsis clipping',
      body: ['expanded body line with enough words to require wrapping at narrow width'],
      expanded: true,
    });
    expect(comp.handleMouse).toBeUndefined();
    expect(comp.handleInput).toBeUndefined();

    const narrow = comp.render(24);
    expect(narrow.length).toBeGreaterThan(2);
    for (const line of narrow) expect(visibleWidth(line)).toBeLessThanOrEqual(24);
    const narrowPlain = narrow.map(env.stripAnsi).join('\n');
    expect(narrowPlain).not.toContain('…');
    expect(narrowPlain.replace(/\s+/g, ' ')).toContain('without ellipsis clipping');
    expect(narrowPlain.replace(/\s+/g, ' ')).toContain('expanded body line');

    const collapsed = inlineComponent({ header: 'header only', body: ['hidden body'], expanded: false }).render(40);
    expect(collapsed).toEqual([' header only']);

    expect(inlineComponent({ header: 'x', expanded: true }).render(0)).toEqual([]);
    expect(inlineComponent({ header: 'x', expanded: true }).render(1)).toEqual([' ']);

    const wide2 = inlineComponent({ header: 'A漢B', body: ['A漢B👨‍👩‍👧e\u0301'], expanded: true }).render(2);
    for (const line of wide2) expect(visibleWidth(line)).toBeLessThanOrEqual(2);
    expect(wide2).toContain(' A');
    expect(wide2).toContain('漢');
    expect(wide2).toContain(' B');
    expect(wide2).toContain('👨‍👩‍👧');
    expect(wide2).toContain(' e\u0301');
  });

  it('gates response text on expanded: true and never renders a generated expansion hint', () => {
    const manager = new SubagentManager(env.mockRunner());
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

    const multiLineResponse = 'First line of output\nSecond line of detailed response\nFinal conclusion.';
    const dummyResult = {
      content: [{ type: 'text', text: multiLineResponse }],
      details: {
        task: {
          id: 'task-123',
          agent: 'analyst',
          status: 'completed',
          attempt: 1,
          model: 'mock/model',
          effort: 'medium',
          result: multiLineResponse,
        },
      },
    };

    const collapsedText = runTool.renderResult(dummyResult, { expanded: false, isPartial: false }, { fg: (_n: string, t: string) => t }).render(120).join('\n');
    expect(collapsedText).not.toContain('First line of output');
    expect(collapsedText).not.toContain('Subagent response');
    expect(collapsedText).not.toMatch(/to expand|app\.tools\.expand|ctrl\+o/i);

    const expandedText = runTool.renderResult(dummyResult, { expanded: true, isPartial: false }, { fg: (_n: string, t: string) => t }).render(120).join('\n');
    expect(expandedText).toContain('First line of output');
    expect(expandedText).toContain('Second line of detailed response');
    expect(expandedText).toContain('Subagent response');
    expect(expandedText).not.toMatch(/to expand|app\.tools\.expand|ctrl\+o/i);
  });

  it('renders agent, model, and effort as explicit labels in expanded tool results', async () => {
    env.writeAgent('analyst');
    const manager = new SubagentManager(async () => ({ result: 'clear render', model: 'mock/model', effort: 'high', fallback_used: false }));
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);
    const theme = { fg: (_name: string, text: string) => text };
    const result = await runTool.execute('1', { agent: 'analyst', task: 'render clearly', mode: 'task' }, undefined, undefined, { cwd: env.tmp });

    const collapsed = runTool.renderResult(result, { isPartial: false, expanded: false }, theme).render(200).join('\n');
    expect(collapsed).toContain('analyst');
    expect(collapsed).toContain('status: completed');
    expect(collapsed).toContain('model: mock/model');
    expect(collapsed).toContain('effort: high');

    const expanded = runTool.renderResult(result, { isPartial: false, expanded: true }, theme).render(200).join('\n');
    expect(expanded).toContain('agent: analyst');
    expect(expanded).toContain('effort: high');
    expect(expanded).toContain('model: mock/model');
  });

  it('exposes the manual history route only in expanded output and returns empty tool call lines', () => {
    const manager = new SubagentManager(env.mockRunner());
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

    const callLines = runTool.renderCall({ agent: 'analyst', mode: 'task' }, { fg: (_n: string, t: string) => t, bold: (text: string) => text }).render(200);
    expect(callLines).toHaveLength(0);

    const dummyResult = { details: { task: { id: '1', agent: 'analyst', status: 'completed', attempt: 1, model: 'mock/model', effort: 'medium' } } };
    const collapsed = runTool.renderResult(dummyResult, { expanded: false, isPartial: false }, { fg: (_n: string, t: string) => t, bold: (text: string) => text }).render(200).join('\n');
    expect(collapsed).not.toContain('/subagents');
    const expanded = runTool.renderResult(dummyResult, { expanded: true, isPartial: false }, { fg: (_n: string, t: string) => t, bold: (text: string) => text }).render(200).join('\n');
    expect(expanded).toContain('ctrl+, or /subagents');
  });

  it('renders the effective subagent_run mode inline and returns empty tool call lines', () => {
    fs.writeFileSync(path.join(env.tmp, '.pi', 'subagents.json'), JSON.stringify({ default_mode: 'background' }));
    env.writeAgent('analyst');
    const previousCwd = process.cwd();
    process.chdir(env.tmp);
    try {
      const manager = new SubagentManager(env.mockRunner());
      let runTool: any;
      registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

      const callLines = runTool.renderCall({ agent: 'analyst' }, { fg: (_name: string, text: string) => text, bold: (text: string) => text }).render(200);
      expect(callLines).toHaveLength(0);

      const bgResult = {
        details: {
          mode: 'background',
          task: { id: 't1', agent: 'analyst', status: 'running', mode: 'background', model: 'mock/model', effort: 'high' },
        },
      };
      const renderedBg = runTool.renderResult(bgResult, { expanded: false, isPartial: false }, { fg: (_name: string, text: string) => text, bold: (text: string) => text }).render(200).join('\n');
      expect(renderedBg).toContain('running');
      expect(renderedBg).toContain('background');

      const taskResult = {
        details: {
          mode: 'task',
          task: { id: 't2', agent: 'analyst', status: 'running', mode: 'task', model: 'mock/model', effort: 'high' },
        },
      };
      const renderedTask = runTool.renderResult(taskResult, { expanded: false, isPartial: false }, { fg: (_name: string, text: string) => text, bold: (text: string) => text }).render(200).join('\n');
      expect(renderedTask).toContain('subagent · analyst');
      expect(renderedTask).not.toContain('background');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('renders the configured history shortcut only in expanded subagent results', () => {
    fs.writeFileSync(path.join(env.tmp, '.pi', 'subagents.json'), JSON.stringify({ history_panel_shortcut: 'ctrl+p' }));
    const previousCwd = process.cwd();
    process.chdir(env.tmp);
    try {
      const manager = new SubagentManager(env.mockRunner());
      let runTool: any;
      registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

      const dummyResult = { details: { task: { id: '1', agent: 'analyst', status: 'completed', attempt: 1, model: 'mock/model', effort: 'medium' } } };
      const collapsed = runTool.renderResult(dummyResult, { expanded: false, isPartial: false }, { fg: (_n: string, t: string) => t, bold: (text: string) => text }).render(200).join('\n');
      expect(collapsed).not.toContain('ctrl+p');
      const expanded = runTool.renderResult(dummyResult, { expanded: true, isPartial: false }, { fg: (_n: string, t: string) => t, bold: (text: string) => text }).render(200).join('\n');
      expect(expanded).toContain('ctrl+p or /subagents');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('keeps ansi-styled subagent_run rows width safe without replacement characters', () => {
    const manager = new SubagentManager(env.mockRunner());
    let runTool: any;
    const theme = {
      fg: (_name: string, text: string) => `\u001b[36m${text}\u001b[39m`,
      bold: (text: string) => `\u001b[1m${text}\u001b[22m`,
    };
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

    const dummyResult = { details: { task: { id: '1', agent: 'discovery', status: 'completed', attempt: 1, model: 'mock/model', effort: 'medium' } } };
    const lines = runTool.renderResult(dummyResult, { expanded: true, isPartial: false }, theme).render(80);
    const plainLines = lines.map(env.stripAnsi);
    expect(plainLines.join('\n')).not.toContain('\ufffd');
    for (const line of plainLines) expect(visibleWidth(line)).toBeLessThanOrEqual(80);
    expect(plainLines.join('\n')).not.toMatch(/to expand|ctrl\+o/i);
  });

  it('renders live activity inline without a card frame and keeps complete tool names', () => {
    const manager = new SubagentManager(env.mockRunner());
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);
    const longToolName = 'workspace_graph_status_with_a_very_long_public_name';

    const lines = runTool.renderResult({
      details: {
        frame: 0,
        tasks: [{
          agent: 'analyst',
          status: 'running',
          attempt: 1,
          effort: 'high',
          model: 'mock/model',
          last_activity: `running tool: ${longToolName}`,
          live_activity: {
            trail: [
              { kind: 'thinking', label: 'thinking' },
              { kind: 'streaming_response', label: 'streaming response' },
              { kind: 'tool_running', label: `running tool: ${longToolName}`, tool_names: [longToolName] },
            ],
            current: { kind: 'tool_running', label: `running tool: ${longToolName}`, tool_names: [longToolName] },
          },
        }],
      },
    }, { isPartial: true }, { fg: (_name: string, text: string) => text, bold: (text: string) => text }).render(40);
    const plain = lines.map(env.stripAnsi).join('\n');

    // Collapsed: wraps automatically without ellipsis clipping or card frame.
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(plain).toContain('analyst');
    expect(plain).toContain('running');
    expect(plain).not.toContain('…');
    expect(plain.replace(/\s+/g, '')).toContain(longToolName);
    expect(plain).not.toMatch(/[╭╮╰╯│┌┐└┘]/);
    expect(plain).not.toMatch(/to expand|ctrl\+o/i);
    for (const line of lines.map(env.stripAnsi)) expect(visibleWidth(line)).toBeLessThanOrEqual(40);

    // Expanded: the full live activity trail remains reachable, wrapping instead of clipping.
    const expandedLines = runTool.renderResult({
      details: {
        frame: 0,
        tasks: [{
          agent: 'analyst',
          status: 'running',
          attempt: 1,
          effort: 'high',
          model: 'mock/model',
          last_activity: `running tool: ${longToolName}`,
          live_activity: {
            trail: [
              { kind: 'thinking', label: 'thinking' },
              { kind: 'streaming_response', label: 'streaming response' },
              { kind: 'tool_running', label: `running tool: ${longToolName}`, tool_names: [longToolName] },
            ],
            current: { kind: 'tool_running', label: `running tool: ${longToolName}`, tool_names: [longToolName] },
          },
        }],
      },
    }, { isPartial: true, expanded: true }, { fg: (_name: string, text: string) => text, bold: (text: string) => text }).render(40);
    const expandedPlain = expandedLines.map(env.stripAnsi);
    expect(expandedPlain.join('\n')).toContain('thinking');
    expect(expandedPlain.join('\n')).toContain('streaming response');
    expect(expandedPlain.join('\n').replace(/\s+/g, '')).toContain(longToolName);
    expect(expandedPlain.join('\n')).not.toMatch(/[╭╮╰╯│┌┐└┘]/);
    for (const line of expandedPlain) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
  });

  it('renders the effective continuation mode from explicit override, previous task state, and config fallback', async () => {
    const { resolveContinuationEffectiveMode } = await import('../../src/continuation-mode.js');
    fs.writeFileSync(path.join(env.tmp, '.pi', 'subagents.json'), JSON.stringify({ enable_continue: true, default_mode: 'background' }));
    env.writeAgent('analyst');
    const previousCwd = process.cwd();
    process.chdir(env.tmp);
    try {
      const manager = new SubagentManager(env.mockRunner());
      let continueTool: any;
      registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') continueTool = tool; } }, manager);

      const backgroundTask = await manager.run({ agent: 'analyst', task: 'persist background mode', mode: 'background' }, { cwd: env.tmp });
      const bgTaskObj = manager.getTask(backgroundTask.task_ids[0]!, env.tmp);
      expect(resolveContinuationEffectiveMode({ previousTask: bgTaskObj, config: { default_mode: 'background' } })).toBe('background');

      expect(resolveContinuationEffectiveMode({ explicitMode: 'task', previousTask: bgTaskObj, config: { default_mode: 'background' } })).toBe('task');

      const taskTask = await manager.run({ agent: 'analyst', task: 'persist task mode', mode: 'task' }, { cwd: env.tmp });
      const taskTaskObj = manager.getTask(taskTask.task_ids[0]!, env.tmp);
      expect(resolveContinuationEffectiveMode({ explicitMode: 'background', previousTask: taskTaskObj, config: { default_mode: 'background' } })).toBe('background');

      const legacyTaskId = 'subtask_legacy_render_continue';
      const legacySessionPath = path.join(env.tmp, 'legacy-render-session.jsonl');
      fs.writeFileSync(legacySessionPath, '{"type":"session"}\n');
      (manager as any).history.upsertTask(env.tmp, {
        id: legacyTaskId,
        agent: 'analyst',
        mode: 'legacy',
        status: 'completed',
        task: 'legacy task',
        created_at: new Date().toISOString(),
        nested_session_path: legacySessionPath,
        result: 'legacy result',
        attempt: 1,
      } as any);
      const legacyTaskObj = manager.getTask(legacyTaskId, env.tmp);
      expect(resolveContinuationEffectiveMode({ previousTask: legacyTaskObj, config: { default_mode: 'background' } })).toBe('background');

      // Call lines return 0 lines to avoid separate text outside frame
      const callLines = continueTool.renderCall({ action: 'continue', task_id: legacyTaskId, task: 'Resume the legacy task.' }, { fg: (_name: string, text: string) => text, bold: (text: string) => text }).render(200);
      expect(callLines).toHaveLength(0);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('renders a ctrl+h background hint in partial task-mode results', () => {
    const manager = new SubagentManager(env.mockRunner());
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

    const rendered = runTool.renderResult({ details: { frame: 0, backgroundable: true, tasks: [{ agent: 'analyst', status: 'running', effort: 'high', model: 'mock/model', last_activity: 'working' }] } }, { isPartial: true }, { fg: (_name: string, text: string) => text }).render(200).join('\n');
    expect(rendered).toContain('ctrl+h to send to background');
  });

  it('renders completed subagent_run results as compact unboxed width-safe summaries', () => {
    const manager = new SubagentManager(env.mockRunner());
    let runTool: any;
    const theme = {
      fg: (_name: string, text: string) => `\u001b[2m${text}\u001b[22m`,
      bold: (text: string) => `\u001b[1m${text}\u001b[22m`,
    };
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);
    const rawResponse = '{"id":"mem_j0k3r_j0k3r-pi_1782144305930_cc027e8afb154ba5"} to=functions.memory_get '.repeat(4);

    const renderedLines = runTool.renderResult({
      content: [{ type: 'text', text: `Completed 1 subagent task:\n${rawResponse}` }],
      details: {
        task: {
          id: 'subtask_sdd-verify_1782157254429_2b614a8e',
          agent: 'sdd-verify',
          mode: 'task',
          status: 'completed',
          task: 'verify',
          created_at: new Date().toISOString(),
          result: rawResponse,
          usage: { turns: 11, input: 87000, output: 6800, cacheRead: 574000, cost: 0.462, contextTokens: 79000 },
          model: 'openai-codex/gpt-5.4',
          effort: 'medium',
        },
      },
    }, { isPartial: false }, theme).render(60);
    const plain = renderedLines.map(env.stripAnsi);

    expect(plain.join('\n')).toContain('sdd-verify');
    expect(plain.join('\n')).not.toMatch(/[╭╮╰╯│┌┐└┘]/);
    expect(plain.join('\n')).not.toMatch(/to expand|ctrl\+o|click to view/i);
    expect(plain.join('\n')).not.toContain('subtask_sdd-verify_');
    expect(plain.every((line: string) => visibleWidth(line) <= 60)).toBe(true);
  });

  it('renders tool calls, progress and results without card frames or background fills', async () => {
    env.writeAgent('analyst');
    const manager = new SubagentManager(async () => ({ result: 'completed response', model: 'mock/model', effort: 'high', fallback_used: false }));
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

    const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };
    const callLines = runTool.renderCall({ agent: 'analyst', mode: 'task' }, theme).render(80);
    expect(callLines).toHaveLength(0);

    const result = await runTool.execute('1', { agent: 'analyst', task: 'render cleanly', mode: 'task' }, undefined, undefined, { cwd: env.tmp });
    for (const expanded of [false, true]) {
      const resultLines = runTool.renderResult(result, { expanded, isPartial: false }, theme).render(80);
      const joined = resultLines.join('\n');
      expect(joined).toContain(ARCH_ICON);
      expect(joined).toMatch(/[\u2500]/);
      expect(joined).not.toMatch(/[╭╮╰╯│┌┐└┘]/);
      expect(joined).not.toContain('\x1b[4');
      expect(joined).not.toMatch(/to expand|ctrl\+o|click to view/i);
    }

    const { renderSubagentRunResult } = await import('../../src/render/tools/subagent-run.js');
    const directLines = renderSubagentRunResult(result, { expanded: false }, theme).render(80);
    expect(directLines.join('\n')).toContain(ARCH_ICON);
    expect(directLines.join('\n')).not.toMatch(/[╭╮╰╯│┌┐└┘]/);
    expect(directLines.join('\n')).not.toContain('\x1b[4');
  });

  it('renders active subagent running state as one compact inline row with the Arch icon', () => {
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, new SubagentManager(env.mockRunner()));

    const activePartial = {
      details: {
        frame: 0,
        tasks: [{
          agent: 'sdd-verify',
          status: 'running',
          attempt: 1,
          effort: 'medium',
          model: 'mock/model',
          task: 'verify the implementation',
        }],
      },
    };

    const lines = runTool.renderResult(activePartial, { isPartial: true }, { fg: (_name: string, text: string) => text, bold: (text: string) => text }).render(80);
    const joined = lines.join('\n');
    expect(lines[0]).toContain('sdd-verify');
    expect(lines[0]).toContain('running');
    expect(joined).toContain(ARCH_ICON);
    expect(joined).not.toMatch(/[╭╮╰╯│┌┐└┘]/);
    expect(joined).not.toContain('\x1b[4');
    expect(joined).not.toMatch(/to expand|ctrl\+o/i);
  });

  it('renders background running execution state as one compact inline row marked background', async () => {
    env.writeAgent('sdd-verify');
    const manager = new SubagentManager(env.mockRunner());
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

    const bgResult = {
      details: {
        mode: 'background',
        task_ids: ['subtask_123'],
        task: {
          id: 'subtask_123',
          agent: 'sdd-verify',
          status: 'running',
          mode: 'background',
          model: 'mock/model',
          effort: 'medium',
          task: 'verify task',
        },
      },
    };

    const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };
    const callLines = runTool.renderCall({ agent: 'sdd-verify', mode: 'background' }, theme).render(80);
    expect(callLines).toHaveLength(0);

    const lines = runTool.renderResult(bgResult, { expanded: false, isPartial: false }, theme).render(80);
    const joined = lines.join('\n');
    expect(lines[0]).toContain('sdd-verify');
    expect(lines[0]).toContain('running');
    expect(lines[0]).toContain('background');
    expect(joined).toContain(ARCH_ICON);
    expect(joined).not.toMatch(/[╭╮╰╯│┌┐└┘]/);
    expect(joined).not.toMatch(/to expand|ctrl\+o|click to view/i);
    expect(joined).not.toContain('\x1b[4');
  });

  it('produces one transparent compact row for background execution with no background escapes', async () => {
    env.writeAgent('sdd-verify');
    const manager = new SubagentManager(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { result: 'verified', model: 'cliproxyapi/j0k3r/gemini-3.8-flash-high', effort: 'medium', fallback_used: false };
    });
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);
    const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };

    const result = await runTool.execute('1', {
      agent: 'sdd-verify',
      task: 'verify the implementation',
      mode: 'background',
    }, undefined, undefined, { cwd: env.tmp });

    const callLines = runTool.renderCall({ agent: 'sdd-verify', mode: 'background' }, theme).render(120);
    expect(callLines).toHaveLength(0);

    const resultLines = runTool.renderResult(result, { expanded: false, isPartial: false }, theme).render(120);
    const renderedFull = resultLines.join('\n');
    expect(resultLines[0]).toContain(ARCH_ICON);
    expect(resultLines[0]).toContain('sdd-verify');
    expect(resultLines[0]).toContain('background');
    expect(renderedFull).not.toMatch(/[╭╮╰╯│┌┐└┘]/);
    expect(renderedFull).not.toContain('\x1b[4');
    expect(renderedFull).not.toMatch(/to expand|ctrl\+o|click to view/i);

    const rawTaskId = result.details.task_ids[0];
    expect(rawTaskId).toMatch(/^subtask_sdd-verify_/);
    expect(env.stripAnsi(renderedFull)).not.toContain(rawTaskId);
  });

  it('renders friendly display_name and hides raw task IDs from collapsed output', async () => {
    env.writeAgent('analyst');
    const manager = new SubagentManager(async () => ({ result: 'audited codebase', model: 'mock/model', fallback_used: false }));
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);
    const theme = { fg: (_name: string, text: string) => text };

    const withNameResult = await runTool.execute('1', {
      agent: 'analyst',
      task: 'audit security',
      display_name: 'Security Audit Pass',
      mode: 'task',
    }, undefined, undefined, { cwd: env.tmp });
    const renderedWithName = env.stripAnsi(runTool.renderResult(withNameResult, { expanded: false }, theme).render(120).join('\n'));
    expect(renderedWithName).toContain('Security Audit Pass');
    expect(renderedWithName).not.toContain('subtask_analyst_');

    const withoutNameResult = await runTool.execute('2', {
      agent: 'analyst',
      task: 'inspect dependencies',
      mode: 'task',
    }, undefined, undefined, { cwd: env.tmp });
    const renderedWithoutName = env.stripAnsi(runTool.renderResult(withoutNameResult, { expanded: false }, theme).render(120).join('\n'));
    expect(renderedWithoutName).toContain('analyst');
    expect(renderedWithoutName).not.toContain('subtask_analyst_');
    // The prompt snippet stays available without crowding the live row.
    const expandedWithoutName = env.stripAnsi(runTool.renderResult(withoutNameResult, { expanded: true }, theme).render(120).join('\n'));
    expect(expandedWithoutName).toContain('inspect dependencies');
  });

  it('renders result and response sections only when actual non-whitespace response text exists', async () => {
    const { renderSubagentRunResult } = await import('../../src/render/tools/subagent-run.js');
    const theme = { fg: (_name: string, text: string) => text };

    // Case 1: Empty string result
    const emptyResult = {
      details: {
        task: {
          id: 'subtask_empty_res',
          agent: 'analyst',
          status: 'completed',
          result: '',
          output_preview: 'some activity preview',
        },
      },
    };
    const renderedEmpty = env.stripAnsi(renderSubagentRunResult(emptyResult, { expanded: true }, theme).render(100).join('\n'));
    expect(renderedEmpty).not.toContain('Subagent response');
    expect(renderedEmpty).not.toContain('subagent result ·');
    expect(renderedEmpty).toContain('subagent ·');

    // Case 2: Whitespace-only result
    const whitespaceResult = {
      details: {
        task: {
          id: 'subtask_ws_res',
          agent: 'analyst',
          status: 'completed',
          result: '   \n  \t  ',
        },
      },
    };
    const renderedWs = env.stripAnsi(renderSubagentRunResult(whitespaceResult, { expanded: true }, theme).render(100).join('\n'));
    expect(renderedWs).not.toContain('Subagent response');
    expect(renderedWs).not.toContain('subagent result ·');
    expect(renderedWs).toContain('subagent ·');

    // Case 3: Undefined result (e.g. running or failed without response)
    const runningTask = {
      details: {
        task: {
          id: 'subtask_running_res',
          agent: 'analyst',
          status: 'running',
          output_preview: 'in progress',
        },
      },
    };
    const renderedRunning = env.stripAnsi(renderSubagentRunResult(runningTask, { expanded: false }, theme).render(100).join('\n'));
    expect(renderedRunning).not.toContain('subagent result ·');
    expect(renderedRunning).not.toContain('response:');
    expect(renderedRunning).toContain('subagent ·');

    // Case 4: Error-only task
    const failedTask = {
      details: {
        task: {
          id: 'subtask_failed_no_res',
          agent: 'analyst',
          status: 'failed',
          error: 'fatal crash occurred',
        },
      },
    };
    const renderedFailed = env.stripAnsi(renderSubagentRunResult(failedTask, { expanded: true }, theme).render(100).join('\n'));
    expect(renderedFailed).not.toContain('Subagent response');
    expect(renderedFailed).toContain('Subagent error');
    expect(renderedFailed).toContain('fatal crash occurred');

    // Case 5: Valid non-whitespace response
    const validTask = {
      details: {
        task: {
          id: 'subtask_valid_res',
          agent: 'analyst',
          status: 'completed',
          result: 'All unit tests passed with 100% coverage.',
        },
      },
    };
    const renderedValid = env.stripAnsi(renderSubagentRunResult(validTask, { expanded: true }, theme).render(100).join('\n'));
    expect(renderedValid).toContain('subagent result ·');
    expect(renderedValid).toContain('Subagent response');
    expect(renderedValid).toContain('All unit tests passed with 100% coverage.');
  });

  it('registers only subagent_run with a boxed single-frame contract (renderShell: self, empty call)', () => {
    fs.writeFileSync(path.join(env.tmp, '.pi', 'subagents.json'), JSON.stringify({ enable_continue: true }));
    const registered: Record<string, any> = {};
    const manager = new SubagentManager(env.mockRunner());
    registerSubagentTools({ registerTool: (tool: any) => { registered[tool.name] = tool; } }, manager, env.tmp);

    const expectedTools = ['subagent_run'];

    expect(Object.keys(registered).sort()).toEqual(expectedTools.sort());

    for (const name of expectedTools) {
      const tool = registered[name];
      expect(tool.renderShell, `${name} should have renderShell: self`).toBe('self');
      expect(typeof tool.renderResult, `${name} should have renderResult`).toBe('function');
      if (tool.renderCall) {
        const callLines = tool.renderCall({}, { fg: (_n: string, t: string) => t, bold: (t: string) => t }).render(80);
        expect(callLines, `${name} renderCall should be empty to prevent duplicate rows`).toHaveLength(0);
      }
    }
  });

  it('renders subagent_run operations as compact unboxed rows with width safety in every state', () => {
    fs.writeFileSync(path.join(env.tmp, '.pi', 'subagents.json'), JSON.stringify({ enable_continue: true }));
    const registered: Record<string, any> = {};
    const manager = new SubagentManager(env.mockRunner());
    registerSubagentTools({ registerTool: (tool: any) => { registered[tool.name] = tool; } }, manager, env.tmp);
    const theme = { fg: (_n: string, t: string) => t, bold: (t: string) => t };

    const sampleTask = {
      id: 'subtask_test_123',
      agent: 'analyst',
      status: 'completed',
      attempt: 1,
      model: 'mock/model',
      effort: 'high',
      result: 'task response text',
    };

    const operationResults = [
      { details: { action: 'run', task: sampleTask } },
      { details: { action: 'continue', task: { ...sampleTask, attempt: 2 } } },
      { details: { action: 'message', status: 'queued', task: sampleTask, message: 'queue acknowledgement' } },
    ];

    for (const result of operationResults) {
      const name = result.details.action;
      const tool = registered.subagent_run;

      for (const expanded of [false, true]) {
        const lines = tool.renderResult(result, { expanded, isPartial: false }, theme).render(80);
        const joined = lines.join('\n');
        expect(joined, `${name} has the Arch identity`).toContain(ARCH_ICON);
        expect(joined, `${name} has no card frame`).not.toMatch(/[╭╮╰╯│┌┐└┘]/);
        expect(joined, `${name} has no expansion hint`).not.toMatch(/to expand|ctrl\+o/i);
        expect(joined, `${name} has no background fill`).not.toContain('\x1b[4');
      }

      for (const width of [0, 1, 2, 10, 23, 24, 40, 80, 120]) {
        const lines = tool.renderResult(result, { expanded: false, isPartial: false }, theme).render(width);
        if (width <= 0) expect(lines, `${name} width 0`).toEqual([]);
        else for (const line of lines) expect(visibleWidth(line), `${name} width ${width}`).toBeLessThanOrEqual(width);
      }
    }
  });

  it('renders no expansion guidance regardless of the configured app.tools.expand keybinding', () => {
    fs.writeFileSync(path.join(env.tmp, '.pi', 'subagents.json'), JSON.stringify({ enable_continue: true }));
    const registered: Record<string, any> = {};
    const manager = new SubagentManager(env.mockRunner());
    registerSubagentTools({ registerTool: (tool: any) => { registered[tool.name] = tool; } }, manager, env.tmp);
    const theme = { fg: (_n: string, t: string) => t, bold: (t: string) => t };

    const sampleTask = {
      id: 'subtask_kb_123',
      agent: 'analyst',
      status: 'completed',
      attempt: 1,
      model: 'mock/model',
      effort: 'high',
      result: 'kb response',
    };
    const result = { details: { task: sampleTask } };

    try {
      setExpandKeybindingProviderForTests((kb) => (kb === 'app.tools.expand' ? 'ctrl+e' : undefined));
      for (const expanded of [false, true]) {
        const text = registered.subagent_run.renderResult(result, { expanded }, theme).render(100).join('\n');
        expect(text).not.toMatch(/to expand|ctrl\+e|ctrl\+o/i);
      }

      resetExpandKeybindingProviderForTests();
      for (const expanded of [false, true]) {
        const text = registered.subagent_run.renderResult(result, { expanded }, theme).render(100).join('\n');
        expect(text).not.toMatch(/to expand|ctrl\+o/i);
      }
    } finally {
      resetExpandKeybindingProviderForTests();
    }
  });

  it('renders live-message rejection and queue acknowledgements without raw task IDs', () => {
    let tool: any;
    const manager = new SubagentManager(env.mockRunner());
    registerSubagentTools({ registerTool: (value: any) => { tool = value; } }, manager, env.tmp);
    const theme = { fg: (_n: string, t: string) => t, bold: (t: string) => t };
    for (const status of ['queued', 'rejected']) {
      const result = {
        isError: status === 'rejected',
        content: [{ type: 'text', text: `${status}: acknowledgement` }],
        details: { action: 'message', status, task_id: 'private-id', reason: status === 'rejected' ? 'unsupported_runtime' : undefined, pending_message_count: 2 },
      };
      const collapsed = tool.renderResult(result, { expanded: false }, theme).render(120).join('\n');
      expect(collapsed).toContain('subagent message');
      expect(collapsed).toContain(status);
      expect(collapsed).not.toContain('private-id');
      expect(collapsed).not.toContain('acknowledgement');
      expect(collapsed).not.toMatch(/to expand|ctrl\+o/i);

      const expanded = tool.renderResult(result, { expanded: true }, theme).render(120).join('\n');
      expect(expanded).toContain(`${status}: acknowledgement`);
      expect(expanded).toContain('pending 2');
      expect(expanded).not.toContain('Subagent response');
    }
  });

  it('never steals click/expansion from the tool row: no panel opener hijack and no mouse handler', async () => {
    const { registerSubagentsPanelOpener, resetSubagentsPanelOpenerStateForTests } = await import('../../src/ui/panel-overlay.js');
    const openedTasks: string[] = [];
    registerSubagentsPanelOpener((taskId?: string) => {
      if (taskId) openedTasks.push(taskId);
    });

    try {
      const manager = new SubagentManager(env.mockRunner());
      let runTool: any;
      registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

      const taskResult = {
        details: {
          task: {
            id: 'subtask_click_test_123',
            agent: 'discovery',
            status: 'running',
            mode: 'background',
          },
        },
      };

      const theme = { fg: (_n: string, t: string) => t };
      for (const isPartial of [false, true]) {
        const component: any = runTool.renderResult(taskResult, { expanded: false, isPartial }, theme);
        // Pi must keep ownership of click-to-expand and app.tools.expand for these rows.
        expect(component.handleMouse).toBeUndefined();
        expect(component.handleInput).toBeUndefined();
        component.render(80);
        component.invalidate();
      }
      expect(openedTasks).toEqual([]);
      resetSubagentsPanelOpenerStateForTests();
    } finally {
      registerSubagentsPanelOpener(undefined);
    }
  });

  it('reconciles run card against instance manager: displays pending pre-allocation, CPAMC model upon allocation, and repaints live background cards without mutating tool content (MINI-001)', async () => {
    env.writeAgent('analyst');
    let releaseAllocation: (() => void) | undefined;
    class SimpleEventBus {
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
    const bus = new SimpleEventBus();
    bus.on('subagents:task:allocate', (event: any) => {
      event.claimModel(async () => {
        await new Promise<void>((resolve) => { releaseAllocation = resolve; });
        return {
          model: { provider: 'cliproxyapi', id: 'pdas/gemini-3.8-flash-high' },
          effort: 'high',
        };
      });
    });

    const runner = async () => ({ result: 'done', model: 'cliproxyapi/pdas/gemini-3.8-flash-high', fallback_used: false });
    const manager = new SubagentManager(runner, undefined, undefined, undefined, bus);
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

    const ctx = {
      cwd: env.tmp,
      model: { provider: 'anthropic', id: 'parent-claude' },
      thinkingLevel: 'low',
    };

    // Launch background task
    const executeResult = await runTool.execute('run-1', { agent: 'analyst', task: 'background task', mode: 'background' }, undefined, undefined, ctx);
    const initialContent = JSON.stringify(executeResult.content);

    // 1. Pre-allocation: collapsed & expanded cards must show 'pending', never the parent model
    const preAllocCollapsed = runTool.renderResult(executeResult, { expanded: false, isPartial: false }, { fg: (_n: string, t: string) => t });
    const preAllocCollapsedText = preAllocCollapsed.render(120).join('\n');
    expect(preAllocCollapsedText).toContain('model: pending');
    expect(preAllocCollapsedText).not.toContain('parent-claude');

    const preAllocExpanded = runTool.renderResult(executeResult, { expanded: true, isPartial: false }, { fg: (_n: string, t: string) => t });
    const preAllocExpandedText = preAllocExpanded.render(120).join('\n');
    expect(preAllocExpandedText).toContain('model: pending');
    expect(preAllocExpandedText).not.toContain('parent-claude');

    // 2. Now trigger CPAMC allocation
    releaseAllocation?.();
    const taskId = executeResult.details.tasks[0].id;
    await vi.waitFor(() => expect(manager.getTask(taskId)?.model).toBe('cliproxyapi/pdas/gemini-3.8-flash-high'));

    // 3. Reconciled run card shows CPAMC model, and cached preAllocCollapsed repaints upon invalidation/render
    preAllocCollapsed.invalidate();
    const postAllocCollapsedText = preAllocCollapsed.render(120).join('\n');
    expect(postAllocCollapsedText).toContain('model: cliproxyapi/pdas/gemini-3.8-flash-high');
    expect(postAllocCollapsedText).not.toContain('parent-claude');

    // 4. Model-facing tool content is strictly immutable
    expect(JSON.stringify(executeResult.content)).toBe(initialContent);

    // 5. Persisted SQLite replay: when manager.tasks is cleared (fresh session / memory eviction),
    // run card resolves CPAMC model from SQLite history using derived workspace metadata (MINI-001)
    (manager as any).tasks.clear();
    expect((manager as any).tasks.size).toBe(0);

    const replayedCollapsed = runTool.renderResult(executeResult, { expanded: false, isPartial: false }, { fg: (_n: string, t: string) => t }, { cwd: env.tmp });
    const replayedCollapsedText = replayedCollapsed.render(120).join('\n');
    expect(replayedCollapsedText).toContain('model: cliproxyapi/pdas/gemini-3.8-flash-high');
    expect(replayedCollapsedText).not.toContain('model: pending');

    const replayedExpanded = runTool.renderResult(executeResult, { expanded: true, isPartial: false }, { fg: (_n: string, t: string) => t }, { cwd: env.tmp });
    const replayedExpandedText = replayedExpanded.render(120).join('\n');
    expect(replayedExpandedText).toContain('model: cliproxyapi/pdas/gemini-3.8-flash-high');
    expect(replayedExpandedText).not.toContain('model: pending');

    // 6. Cross-workspace replay isolation: looking up task from an unrelated workspace returns undefined and does not expose task
    const isolatedResult = {
      ...executeResult,
      details: {
        ...executeResult.details,
        cwd: '/unrelated/isolated/workspace',
        tasks: executeResult.details.tasks.map((t: any) => ({ ...t, cwd: '/unrelated/isolated/workspace' })),
      },
    };
    const isolatedCollapsed = runTool.renderResult(isolatedResult, { expanded: false, isPartial: false }, { fg: (_n: string, t: string) => t }, { cwd: '/unrelated/isolated/workspace' });
    const isolatedCollapsedText = isolatedCollapsed.render(120).join('\n');
    expect(isolatedCollapsedText).toContain('model: pending');
    expect(isolatedCollapsedText).not.toContain('cliproxyapi/pdas/gemini-3.8-flash-high');
  });

  it('does not subscribe to task updates for terminal or replayed tasks, and cleans up active subscriptions upon completion or abort (MINI-001)', async () => {
    env.writeAgent('analyst');
    const runner = async () => ({ result: 'done', model: 'cliproxyapi/analyst-model', fallback_used: false });
    const manager = new SubagentManager(runner);
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

    const ctx = { cwd: env.tmp };
    // 1. Launch a task in task mode and wait for completion
    const executeResult = await runTool.execute('run-1', { agent: 'analyst', task: 'finished task', mode: 'task' }, undefined, undefined, ctx);
    const completedTaskId = taskFromDetails(executeResult)!.id;
    expect(manager.getTask(completedTaskId, env.tmp)?.status).toBe('completed');

    // Terminal task must NOT register a listener when rendered
    const initialListeners = (manager as any).taskUpdateListeners.size;
    const termComp = runTool.renderResult(executeResult, { expanded: false }, { fg: (_n: string, t: string) => t }, { cwd: env.tmp });
    expect((manager as any).taskUpdateListeners.size).toBe(initialListeners);

    // Replayed task from SQLite with cleared manager.tasks must NOT register a listener
    (manager as any).tasks.clear();
    const replayComp = runTool.renderResult(executeResult, { expanded: false }, { fg: (_n: string, t: string) => t }, { cwd: env.tmp });
    expect((manager as any).taskUpdateListeners.size).toBe(initialListeners);

    // Non-existent / unknown task must NOT retain queued subscriptions
    const unknownResult = { details: { tasks: [{ id: 'unknown-id', status: 'queued', agent: 'analyst' }] } };
    runTool.renderResult(unknownResult, { expanded: false }, { fg: (_n: string, t: string) => t }, { cwd: env.tmp });
    expect((manager as any).taskUpdateListeners.size).toBe(initialListeners);

    // 2. Active queued task registers a listener and unsubscribes upon reaching terminal status
    const activeTask: SubagentTask = {
      id: 'active-1',
      cwd: env.tmp,
      agent: 'analyst',
      mode: 'background',
      status: 'queued',
      task: 'running background',
      created_at: new Date().toISOString(),
    };
    (manager as any).tasks.set(activeTask.id, activeTask);
    const activeResult = { details: { tasks: [activeTask], cwd: env.tmp } };

    const activeComp = runTool.renderResult(activeResult, { expanded: false }, { fg: (_n: string, t: string) => t }, { cwd: env.tmp });
    expect((manager as any).taskUpdateListeners.size).toBe(initialListeners + 1);

    // Transitioning active task to terminal causes onTaskUpdate to automatically unsubscribe
    activeTask.status = 'completed';
    (manager as any).notifyTaskUpdate(activeTask.id, undefined, true);
    expect((manager as any).taskUpdateListeners.size).toBe(initialListeners);

    // 3. Abort signal on render context cleans up active listener
    activeTask.status = 'queued';
    const abortController = new AbortController();
    runTool.renderResult(activeResult, { expanded: false }, { fg: (_n: string, t: string) => t }, { cwd: env.tmp, signal: abortController.signal });
    expect((manager as any).taskUpdateListeners.size).toBe(initialListeners + 1);

    abortController.abort();
    expect((manager as any).taskUpdateListeners.size).toBe(initialListeners);

    // 4. Repeated render of the same tool call with context.state cleans up previous listener
    const callState: any = {};
    const contextWithState = { cwd: env.tmp, state: callState };
    runTool.renderResult(activeResult, { expanded: false }, { fg: (_n: string, t: string) => t }, contextWithState);
    expect((manager as any).taskUpdateListeners.size).toBe(initialListeners + 1);

    // Re-rendering with expanded: true cleans up the abandoned listener
    runTool.renderResult(activeResult, { expanded: true }, { fg: (_n: string, t: string) => t }, contextWithState);
    expect((manager as any).taskUpdateListeners.size).toBe(initialListeners + 1);

    // Disposing via comp.dispose() or state cleanup clears it
    if (callState.cleanup) callState.cleanup();
    expect((manager as any).taskUpdateListeners.size).toBe(initialListeners);

    // 5. Session shutdown / reload lifecycle event cleans up active listener
    let shutdownHandler: any;
    const mockPi = {
      on: (event: string, handler: any) => {
        if (event === 'session_shutdown') shutdownHandler = handler;
      },
      registerTool: (tool: any) => { if (tool.name === 'subagent_run') runToolWithPi = tool; },
    };
    let runToolWithPi: any;
    registerSubagentTools(mockPi, manager);
    runToolWithPi.renderResult(activeResult, { expanded: false }, { fg: (_n: string, t: string) => t }, { cwd: env.tmp });
    expect((manager as any).taskUpdateListeners.size).toBe(initialListeners + 1);

    // Trigger session shutdown
    if (shutdownHandler) shutdownHandler();
    expect((manager as any).taskUpdateListeners.size).toBe(initialListeners);
  });

  it('styles plain-text expanded bodies with muted color while preserving existing ANSI and wrapping headers without ellipsis (MINI-004)', () => {
    const manager = new SubagentManager(env.mockRunner());
    let runTool: any;
    registerSubagentTools({ registerTool: (tool: any) => { if (tool.name === 'subagent_run') runTool = tool; } }, manager);

    const mutedCalls: string[] = [];
    const ansiTheme = {
      fg: (key: string, text: string) => {
        if (key === 'muted') {
          mutedCalls.push(text);
          return `\x1b[38;2;122;167;184m${text}\x1b[0m`;
        }
        return text;
      },
      bold: (text: string) => text,
    };

    const dummyResult = {
      content: [{ type: 'text', text: 'plain response text\n\x1b[32mhighlighted code line\x1b[0m' }],
      details: {
        task: {
          id: 'task-muted-1',
          agent: 'analyst',
          display_name: 'Very Long Descriptive Task Name That Wraps Cleanly',
          status: 'completed',
          attempt: 1,
          model: 'provider/very-long-model-name',
          effort: 'high',
          result: 'plain response text\n\x1b[32mhighlighted code line\x1b[0m',
        },
      },
    };

    const collapsedNarrow = runTool.renderResult(dummyResult, { expanded: false }, ansiTheme).render(28);
    expect(collapsedNarrow.length).toBeGreaterThan(1);
    for (const line of collapsedNarrow) expect(visibleWidth(line)).toBeLessThanOrEqual(28);
    expect(env.stripAnsi(collapsedNarrow.join('\n'))).not.toContain('…');
    expect(env.stripAnsi(collapsedNarrow.join(' '))).toContain('effort: high');

    const expandedLines = runTool.renderResult(dummyResult, { expanded: true }, ansiTheme).render(80);
    const plainBodyLine = expandedLines.find((line: string) => env.stripAnsi(line).includes('plain response text'));
    const ansiBodyLine = expandedLines.find((line: string) => env.stripAnsi(line).includes('highlighted code line'));
    expect(plainBodyLine).toContain('\x1b[38;2;122;167;184m');
    expect(mutedCalls.some((t) => t.includes('plain response text'))).toBe(true);
    expect(ansiBodyLine).toContain('\x1b[32mhighlighted code line\x1b[0m');
    expect(ansiBodyLine).not.toContain('\x1b[38;2;122;167;184m');

    // Absent theme falls back to #7aa7b8 ANSI muted foreground
    const fallbackLines = runTool.renderResult(dummyResult, { expanded: true }, undefined).render(80);
    const fallbackPlain = fallbackLines.find((line: string) => env.stripAnsi(line).includes('plain response text'));
    expect(fallbackPlain).toContain('\x1b[38;2;122;167;184m');
  });
});
