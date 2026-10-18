import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import extension from '../index.ts';
import { FlowJournal } from '../src/journal.ts';
import { computeFlowIdentity } from '../src/config.ts';
import { resolveSupervisorConfigPath, selectSupervisorConfigScope, isSupervisorEnabled, loadSupervisorConfig, updateSupervisorConfig, type SupervisorConfig } from '../src/supervisor-config.ts';
import { loadSubagentConfig, resolveSubagentConfigPath } from '../src/subagent-config.ts';
import { defaultSubagentTaskRegistry } from '../src/bridge.ts';
import { getPanelRowIds } from '../src/supervisor-panel.ts';
import { MockCpamcServer } from './fixtures/mock-cpamc.ts';
import { fakeKeybindings, fakeLib, identityTheme } from './fixtures/fake-tui.ts';

/**
 * Every harness starts with this endpoint: it answers 200 with an unusable payload, so
 * account discovery fails immediately instead of retrying with backoff. No test can reach
 * a real CLIProxyAPI on the default `127.0.0.1:8317` (S5 isolation).
 */
const unavailableDiscovery = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{}');
});
await new Promise<void>(resolve => unavailableDiscovery.listen(0, '127.0.0.1', resolve));
const unavailableBaseUrl = `http://127.0.0.1:${(unavailableDiscovery.address() as any).port}`;
after(() => { unavailableDiscovery.close(); });

/** The saved slots the quota fixtures route over: every addressable account route, in order. */
const ROUTING_SLOTS = [
  'cliproxyapi/main/gpt-6.1-sol',
  'cliproxyapi/second/gpt-6.1-sol',
  'cliproxyapi/gemini-account/gemini-3.8-flash-high',
];

/**
 * Opens the configuration panel through its only entry point and returns the live
 * component. The host's `custom` never settles until the panel calls `done()`, so the
 * command promise is deliberately left pending while the test drives the component
 * directly (S1/S4/S7).
 */
async function panelFor(h: any, ctx: any = h.ctx): Promise<any> {
  let panel: any;
  const panelCtx = {
    ...ctx,
    ui: {
      ...ctx.ui,
      custom: async (factory: any) => {
        panel = factory({ requestRender: () => {} }, identityTheme, fakeKeybindings, () => {});
        return await new Promise<void>(() => {});
      },
    },
  };
  void h.commands.get('supervisor').handler('', panelCtx);
  const deadline = Date.now() + 10000;
  while (!panel && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(panel, 'the configuration panel must open');
  return panel;
}

/** Rendered panel or picker lines, joined for regex assertions. */
function panelText(panel: any, width = 200): string {
  return (panel.render(width) as string[]).join('\n');
}

/** The rows the panel exposes for the stored configuration (the list grows with modelCount). */
function rowsFor(h: any): readonly string[] {
  return getPanelRowIds(loadSupervisorConfig(h.dir).config);
}

/** Highlights a row by identity: counting arrows would drift as rows are added. */
function panelHighlight(panel: any, id: string, rows: readonly string[]): void {
  for (let index = 0; index < rows.length; index++) panel.handleInput('\x1b[A');
  for (let index = 0; index < rows.length && panel.selectedRowId !== id; index++) panel.handleInput('\x1b[B');
  assert.equal(panel.selectedRowId, id, `the panel row ${id} must be reachable`);
}

/** Presses Enter on a row by identity. */
function panelEnter(panel: any, id: string, rows: readonly string[]): void {
  panelHighlight(panel, id, rows);
  panel.handleInput('\r');
}

function createMockEventBus() {
  const listeners = new Map<string, Array<(event: any) => void>>();
  const checkpoints = new Map<number, { title: string; content: string; type: string }>();
  return {
    on: (channel: string, handler: (event: any) => void) => {
      const list = listeners.get(channel) ?? [];
      list.push(handler);
      listeners.set(channel, list);
      return () => {
        const current = listeners.get(channel) ?? [];
        const index = current.indexOf(handler);
        if (index >= 0) current.splice(index, 1);
      };
    },
    emit: (channel: string, payload: any) => {
      if (channel === 'memory:supervisor:checkpoint:v1' && payload) {
        if (payload.action === 'save') {
          const id = payload.id ?? 7;
          checkpoints.set(id, { title: payload.title, content: payload.content, type: payload.type });
          payload.respond?.({ ok: true, id, readbackVerified: true });
        } else if (payload.action === 'get') {
          const item = checkpoints.get(payload.id) ?? { title: 'Checkpoint', content: '- Goal\n- Next action', type: 'session_summary' };
          payload.respond?.({ ok: true, id: payload.id, content: item.content, type: item.type });
        }
      }
      const list = listeners.get(channel) ?? [];
      for (const handler of list) handler(payload);
    },
    listenerCount: (channel: string) => (listeners.get(channel) ?? []).length,
  };
}

function host(mode = 'tui', replacement: { beforeHandover?: (ctx: any, hooks: Map<string, any>, commands: Map<string, any>, nextPi?: any) => Promise<void> | void; cancel?: boolean; model?: any } = {}, overrides: any = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'supervisor-host-'));
  process.env.PI_SUPERVISOR_RUNTIME_DIR = join(dir, 'runtime');
  const previousBaseUrl = process.env.CLIPROXYAPI_BASE_URL;
  const previousNotify = process.env.PI_NTFY_URL;
  process.env.CLIPROXYAPI_BASE_URL = overrides.baseUrl ?? unavailableBaseUrl;
  delete process.env.PI_NTFY_URL;
  const hooks = new Map<string, any>(), commands = new Map<string, any>(), tools = new Map<string, any>();
  const sent: any[] = [], notices: any[] = [], statuses: any[] = [];
  let sessionId = 'session-one';
  const instances: any[] = [];
  const branch: any[] = [];
  const events = overrides.events ?? createMockEventBus();
  const pi: any = {
    events,
    on: (name: string, fn: any) => { hooks.set(name, fn); return () => {}; },
    registerCommand: (name: string, value: any) => commands.set(name, value),
    registerTool: (value: any) => { assert.equal(value.name, 'supervisor_rotate'); tools.set(value.name, value); },
    sendUserMessage: (...args: any[]) => sent.push(args),
    sendMessage: (...args: any[]) => sent.push(args),
    getAllTools: () => ['memory_save', 'memory_get', ...Object.keys(overrides.toolResults ?? {})].map(name => ({ name })),
    setModel: async () => true, setThinkingLevel: () => {},
  };
  const ctx: any = { cwd: dir, mode, hasUI: true, isProjectTrusted: () => true, isIdle: () => true,
    events,
    sessionManager: { getSessionId: () => sessionId, getSessionFile: () => 'parent.jsonl', getBranch: () => branch },
    model: { provider: 'custom', id: 'manual', contextWindow: 10000 },
    getContextUsage: () => ({ tokens: 100, contextWindow: 10000, percent: 1 }),
    ui: { notify: (...args: any[]) => notices.push(args), setStatus: (...args: any[]) => statuses.push(args) },
    tools: pi.getAllTools(),
    executeTool: async (name: string, args: any) => {
      const canned = overrides.toolResults?.[name];
      if (canned) return { toolCall: { id: 'nested', name, arguments: args }, isError: false, ...canned };
      const result = { content: [{ type: 'text', text: '{}' }], details: { data: name === 'memory_save' ? { id: 7 } : { id: 7, type: 'session_summary', content: '- Goal\n- Next action' } } };
      return { toolCall: { id: 'nested', name, arguments: args }, result, isError: false };
    },
    newSession: async (options: any) => {
      if (replacement.cancel) return { cancelled: true };
      await hooks.get('session_shutdown')?.({ reason: 'new' }, ctx);
      const oldId = sessionId;
      sessionId = 'session-two';
      const nextHooks = new Map<string, any>(), nextCommands = new Map<string, any>(), nextTools = new Map<string, any>();
      const fresh = { ...ctx,
        events,
        model: replacement.model ?? ctx.model,
        sessionManager: { getSessionId: () => 'session-two', getSessionFile: () => 'new.jsonl' },
        sendMessage: async (...args: any[]) => sent.push(args),
      };
      const nextPi = { ...pi,
        events,
        // The real replacement API changes the incoming session, not the disposed ctx.
        setModel: async (model: any) => { fresh.model = model; return true; },
        on: (name: string, fn: any) => nextHooks.set(name, fn),
        registerCommand: (name: string, value: any) => nextCommands.set(name, value),
        registerTool: (value: any) => nextTools.set(value.name, value),
      };
      extension(nextPi, overrides);
      instances.push({ hooks: nextHooks, commands: nextCommands, tools: nextTools, ctx: fresh });
      await options.setup?.({ appendCustomEntry: () => {} });
      await nextHooks.get('session_start')({ reason: 'new' }, fresh);
      // Real host contexts throw on every access after shutdown/disposal.
      for (const key of Object.keys(ctx)) Object.defineProperty(ctx, key, {
        configurable: true, get: () => { throw new Error(`Stale context for ${oldId}`); },
      });
      await replacement.beforeHandover?.(fresh, nextHooks, nextCommands, nextPi);
      await options.withSession?.(fresh);
      return { cancelled: false };
    },
  };
  extension(pi, overrides);
  return { dir, ctx, pi, hooks, commands, tools, sent, notices, statuses, instances,
    async close() {
      defaultSubagentTaskRegistry.clear();
      if (instances.length) {
        for (const instance of instances) await instance.hooks.get('session_shutdown')?.({ reason: 'quit' }, instance.ctx);
      } else await hooks.get('session_shutdown')?.({ reason: 'quit' }, ctx);
      rmSync(dir, { recursive: true, force: true });
      delete process.env.PI_SUPERVISOR_RUNTIME_DIR;
      if (previousBaseUrl === undefined) delete process.env.CLIPROXYAPI_BASE_URL;
      else process.env.CLIPROXYAPI_BASE_URL = previousBaseUrl;
      if (previousNotify === undefined) delete process.env.PI_NTFY_URL;
      else process.env.PI_NTFY_URL = previousNotify;
    } };
}

test('subagent dashboard saves real JSON and reopens independently of Orchestrator', async () => {
  const h = host('tui', {}, { panelLib: fakeLib });
  try {
    updateSupervisorConfig(h.dir, { enabled: false });
    const mainPath = resolveSupervisorConfigPath(h.dir);
    const mainBefore = readFileSync(mainPath, 'utf8');
    const subagentPath = join(dirname(mainPath), 'subagents.json');
    const models = [
      { provider: 'cliproxyapi', id: 'same-account/model-a' },
      { provider: 'cliproxyapi', id: 'same-account/model-b' },
      { provider: 'other', id: 'model-c' },
      { provider: 'other', id: 'image-only', type: 'image' },
    ];
    h.ctx.modelRegistry = { getAvailable: () => models, getAll: () => models };
    let switches = 0;
    h.pi.setModel = async () => { switches += 1; return true; };
    const panel = await panelFor(h);
    assert.match(panelText(panel), /Orchestrator/);
    assert.match(panelText(panel), /Subagents/);
    assert.throws(() => readFileSync(subagentPath), { code: 'ENOENT' });
    panel.handleInput('\t');
    assert.equal(panel.activeTab, 'subagents');
    assert.throws(() => readFileSync(subagentPath), { code: 'ENOENT' });
    const rows = ['toggle', 'modelCount', 'slot:1', 'slot:2', 'slot:3', 'slot:4', 'slot:5'];
    panelEnter(panel, 'toggle', rows);
    panelHighlight(panel, 'modelCount', rows);
    panel.handleInput('\x1b[D');
    const assign = (slot: number, id: string) => {
      panelEnter(panel, `slot:${slot}`, rows);
      for (const character of id) panel.handleInput(character);
      assert.match(panelText(panel), new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      panel.handleInput('\r');
      assert.match(panelText(panel), /Select reasoning effort/);
      panel.handleInput('\r'); // Confirm Default; neither stage may save alone.
    };
    assign(1, 'cliproxyapi/same-account/model-a');
    assign(2, 'cliproxyapi/same-account/model-b');
    const saved = JSON.parse(readFileSync(subagentPath, 'utf8'));
    assert.equal(saved.enabled, true);
    assert.equal(saved.modelCount, 4);
    assert.deepEqual(saved.priorityCandidateIds, ['cliproxyapi/same-account/model-a', 'cliproxyapi/same-account/model-b']);
    const beforeDuplicate = readFileSync(subagentPath, 'utf8');
    panelEnter(panel, 'slot:3', rows);
    for (const character of 'cliproxyapi/same-account/model-a') panel.handleInput(character);
    panel.handleInput('\r');
    assert.equal(readFileSync(subagentPath, 'utf8'), beforeDuplicate);
    panel.handleInput('\x1b');
    panelEnter(panel, 'slot:3', rows);
    for (const character of 'image-only') panel.handleInput(character);
    assert.match(panelText(panel), /no model matches/i);
    panel.handleInput('\x1b');
    panel.handleInput('\x1b');
    const reopened = await panelFor(h);
    reopened.handleInput('\t');
    assert.match(panelText(reopened), /same-account\/model-a/);
    assert.match(panelText(reopened), /same-account\/model-b/);
    panelHighlight(reopened, 'slot:1', rows);
    reopened.handleInput('d');
    assert.deepEqual(JSON.parse(readFileSync(subagentPath, 'utf8')).priorityCandidateIds,
      ['', 'cliproxyapi/same-account/model-b']);
    const clearedBytes = readFileSync(subagentPath, 'utf8');
    reopened.handleInput('d');
    assert.equal(readFileSync(subagentPath, 'utf8'), clearedBytes, 'clearing an empty slot writes nothing');
    reopened.handleInput('\x1b');
    const afterClear = await panelFor(h);
    afterClear.handleInput('\t');
    assert.match(panelText(afterClear), /1\. \(empty\)/);
    assert.match(panelText(afterClear), /2\. cliproxyapi\/same-account\/model-b/);
    panelEnter(afterClear, 'slot:1', rows);
    for (const character of 'same-account/model-a') afterClear.handleInput(character);
    assert.match(panelText(afterClear), /cliproxyapi\/same-account\/model-a/);
    afterClear.handleInput('\r');
    assert.match(panelText(afterClear), /Select reasoning effort/);
    afterClear.handleInput('\r');
    assert.deepEqual(JSON.parse(readFileSync(subagentPath, 'utf8')).priorityCandidateIds,
      ['cliproxyapi/same-account/model-a', 'cliproxyapi/same-account/model-b']);
    assert.equal(readFileSync(mainPath, 'utf8'), mainBefore);
    assert.equal(h.ctx.model.id, 'manual');
    assert.equal(switches, 0);
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('invalid subagent JSON refuses edits without preventing Orchestrator access', async () => {
  const h = host('tui', {}, { panelLib: fakeLib });
  try {
    updateSupervisorConfig(h.dir, { enabled: false });
    const mainPath = resolveSupervisorConfigPath(h.dir);
    const mainBefore = readFileSync(mainPath, 'utf8');
    const subagentPath = join(dirname(mainPath), 'subagents.json');
    writeFileSync(subagentPath, '{broken-json');
    const panel = await panelFor(h);
    assert.match(panelText(panel), /Orchestrator/);
    panel.handleInput('\t');
    assert.equal(panel.activeTab, 'subagents');
    assert.match(panelText(panel), /invalid JSON|configuration.*(?:unavailable|error)/i);
    panel.handleInput('\r');
    panel.handleInput('\x1b[C');
    assert.equal(readFileSync(subagentPath, 'utf8'), '{broken-json');
    panel.handleInput('\t');
    assert.equal(panel.activeTab, 'orchestrator');
    assert.match(panelText(panel), /Priority slots/);
    assert.equal(readFileSync(mainPath, 'utf8'), mainBefore);
    assert.equal(h.ctx.model.id, 'manual');
  } finally { await h.close(); }
});

test('loads standalone; child sessions do not initialize or execute supervisor', async () => {
  const h = host('json');
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    await assert.rejects(h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx), /parent|interactive|inactive/i);
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('rotation verifies existing tools; reports scheduled, then uses fresh session context', async () => {
  const h = host();
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    const result = await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action', continue_task: true }, undefined, undefined, h.ctx);
    assert.match(result.content[0].text, /scheduled/i);
    assert.doesNotMatch(result.content[0].text, /Session rotated/i);
    await h.hooks.get('agent_settled')({ aborted: false }, h.ctx);
    await new Promise(resolve => setImmediate(resolve));
    const command = h.sent[0][0].split(' ');
    assert.equal(command[0], '/supervisor-rotate');
    await h.commands.get('supervisor-rotate').handler(command.slice(1).join(' '), h.ctx);
    assert.throws(() => h.ctx.sessionManager, /Stale context/);
    assert.equal(h.sent.length, 2);
    assert.equal(h.sent[1][0].customType, 'supervisor-continuity');
    assert.match(h.sent[1][0].content, /Verified session-summary observation #7/);
    assert.equal(h.sent[1][1].triggerTurn, true);
    assert.deepEqual(h.notices.at(-1), ['Session rotated with verified checkpoint #7.', 'info']);
  } finally { await h.close(); }
});

test('a second rotation can be scheduled from the fresh session', async () => {
  const h = host();
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);

    const first = await h.tools.get('supervisor_rotate').execute('first', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx);
    assert.equal(first.details.scheduled, true);
    const firstToken = h.sent[0][0].split(' ')[1];
    await h.commands.get('supervisor-rotate').handler(firstToken, h.ctx);
    assert.equal(h.instances.length, 1);

    // The original user bug: rotation worked once and then stopped working. A fresh
    // runtime must be able to schedule again, with no stale ready/dispatched latch and
    // nothing to resume now that pause is gone.
    const fresh = h.instances[0];
    assert.ok(fresh.tools.has('supervisor_rotate'));
    const second = await fresh.tools.get('supervisor_rotate').execute('second', { summary: '- Goal\n- Next action' }, undefined, undefined, fresh.ctx);
    assert.equal(second.details.scheduled, true);
    assert.equal(h.sent.length, 3);
    assert.equal(h.sent[1][0].customType, 'supervisor-continuity');
    assert.equal(h.sent[2][0].startsWith('/supervisor-rotate '), true);
    assert.notEqual(h.sent[2][0].split(' ')[1], firstToken);
  } finally { await h.close(); }
});

test('replacement rejects unsafe incoming contexts without using the stale outgoing UI', async () => {
  const cases: Record<string, (ctx: any, hooks: Map<string, any>, commands: Map<string, any>) => Promise<void> | void> = {
    untrusted: ctx => { ctx.isProjectTrusted = () => false; },
    noninteractive: ctx => { ctx.mode = 'json'; },
    'different cwd': ctx => { ctx.cwd = join(ctx.cwd, 'other'); },
    'unregistered manager': ctx => { ctx.sessionManager = { getSessionId: () => 'session-two' }; },
    'unchanged identity': ctx => { ctx.sessionManager.getSessionId = () => 'session-one'; },
    'missing identity': ctx => { ctx.sessionManager.getSessionId = () => undefined; },
    'disposed incoming runtime': async (ctx, hooks) => { await hooks.get('session_shutdown')({ reason: 'quit' }, ctx); },
    'pending mutation': async (ctx, hooks) => {
      await hooks.get('tool_call')({ toolCallId: 'pending', toolName: 'write', input: { path: 'example.txt', content: 'pending' } }, ctx);
    },
    'uncertain mutation': async (ctx, hooks) => {
      await hooks.get('tool_call')({ toolCallId: 'uncertain', toolName: 'write', input: { path: 'example.txt', content: 'pending' } }, ctx);
      await hooks.get('session_shutdown')({ reason: 'reload' }, ctx);
      await hooks.get('session_start')({ reason: 'reload' }, ctx);
    },
    'pending background delivery': async (ctx, _hooks, _commands, nextPi) => {
      nextPi.events.emit('subagents:task:allocate', {
        taskId: 'background-task',
        attempt: 1,
        parentSessionId: ctx.sessionManager.getSessionId(),
      });
    },
  };
  for (const [name, beforeHandover] of Object.entries(cases)) {
    const h = host('tui', { beforeHandover }, { panelLib: fakeLib });
    try {
      await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
      await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action', continue_task: true }, undefined, undefined, h.ctx);
      await h.hooks.get('agent_settled')({ aborted: false }, h.ctx);
      await new Promise(resolve => setImmediate(resolve));
      const token = h.sent[0][0].split(' ').slice(1).join(' ');
      await assert.doesNotReject(h.commands.get('supervisor-rotate').handler(token, h.ctx), name);
      assert.equal(h.sent.length, 1, name);
      assert.match(h.notices.at(-1)[0], /^Supervisor handover failed: Error: /, name);
      assert.equal(h.notices.at(-1)[1], 'error', name);
      assert.equal(h.notices.some(([message]) => /^Session rotated/.test(message)), false, name);
    } finally { await h.close(); }
  }
});

test('replacement cancellation retains the original session and clears its handover fence', async () => {
  const h = host('tui', { cancel: true });
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx);
    await h.hooks.get('agent_settled')({ aborted: false }, h.ctx);
    await new Promise(resolve => setImmediate(resolve));
    await h.commands.get('supervisor-rotate').handler(h.sent[0][0].split(' ').slice(1).join(' '), h.ctx);
    assert.equal(h.ctx.sessionManager.getSessionId(), 'session-one');
    assert.equal(h.sent.length, 1);
    assert.deepEqual(h.notices.at(-1), ['Session replacement cancelled; original session retained.', 'warning']);
    const result = await h.tools.get('supervisor_rotate').execute('again', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx);
    assert.equal(result.details.scheduled, true);
  } finally { await h.close(); }
});

test('successful replacement without continuation still wakes the fresh session to report and wait', async () => {
  const h = host();
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx);
    await h.hooks.get('agent_settled')({ aborted: false }, h.ctx);
    await new Promise(resolve => setImmediate(resolve));
    const token = h.sent[0][0].split(' ').slice(1).join(' ');
    await h.commands.get('supervisor-rotate').handler(token, h.ctx);
    assert.equal(h.sent[1][1].triggerTurn, true, 'a rotation always starts exactly one turn in the fresh session');
    assert.equal(h.sent[1][0].details.memoryId, 7);
    assert.match(h.sent[1][0].content, /This checkpoint is historical context, not new consent/);
    assert.match(h.sent[1][0].content, /no unfinished authorized work/i);
    assert.match(h.sent[1][0].content, /in a few lines and then wait/i);
    // Calling the stale command with a valid-looking fresh context cannot reuse readiness.
    const fresh = { cwd: h.dir, mode: 'tui', sessionManager: { getSessionId: () => 'session-two' }, ui: { notify: (...args: any[]) => h.notices.push(args) } };
    await h.commands.get('supervisor-rotate').handler(token, fresh);
    assert.equal(h.sent.length, 2);
    assert.deepEqual(h.notices.at(-1), ['Rotation rejected: no matching verified handover.', 'warning']);
  } finally { await h.close(); }
});

test('a replacement with continuation tells the fresh turn to resume the authorized work immediately', async () => {
  const h = host();
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action', continue_task: true }, undefined, undefined, h.ctx);
    await h.hooks.get('agent_settled')({ aborted: false }, h.ctx);
    await new Promise(resolve => setImmediate(resolve));
    const token = h.sent[0][0].split(' ').slice(1).join(' ');
    await h.commands.get('supervisor-rotate').handler(token, h.ctx);
    assert.equal(h.sent[1][1].triggerTurn, true);
    assert.match(h.sent[1][0].content, /unfinished, already-authorized work/i);
    assert.match(h.sent[1][0].content, /without waiting for a new human message/i);
  } finally { await h.close(); }
});

test('S8: a rotation dispatches exactly one continuity turn and no other fresh-session wake', async () => {
  for (const continueTask of [false, true]) {
    const h = host();
    try {
      await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
      await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action', continue_task: continueTask }, undefined, undefined, h.ctx);
      await h.hooks.get('agent_settled')({ aborted: false }, h.ctx);
      await new Promise(resolve => setImmediate(resolve));
      await h.commands.get('supervisor-rotate').handler(h.sent[0][0].split(' ').slice(1).join(' '), h.ctx);
      const continuity = h.sent.filter(a => a[0]?.customType === 'supervisor-continuity');
      assert.equal(continuity.length, 1, `one continuity message (continue_task=${continueTask})`);
      assert.equal(continuity[0][1].triggerTurn, true, `triggerTurn true (continue_task=${continueTask})`);
      assert.equal(h.sent.filter(a => a[1]?.triggerTurn === true).length, 1, `one triggered message (continue_task=${continueTask})`);
      assert.match(continuity[0][0].content, /historical context, not new consent/);
      assert.match(continuity[0][0].content, /do not continue automatically/);
      if (continueTask) assert.match(continuity[0][0].content, /resume it now in this session, without waiting for a new human message/);
      else assert.match(continuity[0][0].content, /state what is pending or blocked in a few lines and then wait; do not start, resume or widen work\./);
    } finally { await h.close(); }
  }
});

test('supervisor_rotate dispatches the handover the moment the tool runs, without waiting for settlement', async () => {
  const h = host();
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action', continue_task: true }, undefined, undefined, h.ctx);
    assert.equal(h.sent.length, 1, 'the tool itself must dispatch the instant handover');
    assert.match(h.sent[0][0], /^\/supervisor-rotate [0-9a-f-]{36}$/);
    await h.hooks.get('agent_settled')({ aborted: false }, h.ctx);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.sent.length, 1, 'settlement must not dispatch a second handover for the same readiness');
  } finally { await h.close(); }
});

test('a pending verified rotation blocks mutating tools but not read-only tools', async () => {
  const h = host();
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx);
    const readCall = await h.hooks.get('tool_call')({ toolCallId: 'read-1', toolName: 'read', input: { path: 'notes.md' } }, h.ctx);
    assert.equal(readCall, undefined, 'read-only verification must keep working while a rotation is scheduled');
    const writeCall = await h.hooks.get('tool_call')({ toolCallId: 'write-1', toolName: 'write', input: { path: 'notes.md', content: 'x' } }, h.ctx);
    assert.equal(writeCall?.block, true);
    assert.match(writeCall.reason, /rotation is scheduled/i);
  } finally { await h.close(); }
});

test('S6: an aborted handover cancels only that rotation and never halts the supervisor', async () => {
  const h = host();
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx);
    assert.equal(h.sent.length, 1);
    await h.hooks.get('agent_settled')({ aborted: true }, h.ctx);
    // No pause/cancel row exists: stopping a response only retires the interrupted work.
    const write = await h.hooks.get('tool_call')({ toolCallId: 'write-after-abort', toolName: 'write', input: { path: 'notes.md', content: 'x' } }, h.ctx);
    assert.equal(write, undefined, 'an abort must not fence mutations');
    await h.hooks.get('tool_result')({ toolCallId: 'write-after-abort', toolName: 'write', isError: false }, h.ctx);
    const again = await h.tools.get('supervisor_rotate').execute('again', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx);
    assert.equal(again.details.scheduled, true, 'the supervisor stays usable after an aborted handover');
    assert.equal(h.sent.length, 2);
  } finally { await h.close(); }
});

test('rotation waits for subagents:task:terminal, not permitting rotation while task is allocated', async () => {
  const h = host();
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);

    // Allocate task for this session on pi.events
    h.pi.events.emit('subagents:task:allocate', {
      taskId: 'background-task-1',
      attempt: 1,
      parentSessionId: 'session-one',
      agent: 'worker',
    });

    // Rotation must defer while task is active
    await assert.rejects(
      h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx),
      /Rotation deferred: active tasks \(background-task-1\)/,
    );
    assert.equal(h.sent.length, 0);

    // Terminal event settles task
    h.pi.events.emit('subagents:task:terminal', {
      taskId: 'background-task-1',
      parentSessionId: 'session-one',
      status: 'completed',
    });

    const result = await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx);
    assert.equal(result.details.scheduled, true);
  } finally { await h.close(); }
});

test('tasks of another parentSessionId ignored during rotation', async () => {
  const h = host();
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);

    // Allocate task belonging to another session
    h.pi.events.emit('subagents:task:allocate', {
      taskId: 'other-session-task',
      attempt: 1,
      parentSessionId: 'session-other-999',
      agent: 'worker',
    });

    // Rotation for session-one must NOT be blocked
    const result = await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx);
    assert.equal(result.details.scheduled, true);
  } finally { await h.close(); }
});

test('rotation deferred while multiple tasks are active, permits rotation once all are terminal', async () => {
  const h = host();
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);

    h.pi.events.emit('subagents:task:allocate', {
      taskId: 'task-a',
      attempt: 1,
      parentSessionId: 'session-one',
    });
    h.pi.events.emit('subagents:task:allocate', {
      taskId: 'task-b',
      attempt: 1,
      parentSessionId: 'session-one',
    });

    await assert.rejects(
      h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx),
      /active tasks/,
    );

    // Settle task-a: task-b still active
    h.pi.events.emit('subagents:task:terminal', {
      taskId: 'task-a',
      parentSessionId: 'session-one',
      status: 'completed',
    });

    await assert.rejects(
      h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx),
      /active tasks \(task-b\)/,
    );

    // Settle task-b: now all settled
    h.pi.events.emit('subagents:task:terminal', {
      taskId: 'task-b',
      parentSessionId: 'session-one',
      status: 'failed',
    });

    const result = await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx);
    assert.equal(result.details.scheduled, true);
  } finally { await h.close(); }
});

test('mutation fences and uncertain effects still block rotation without active subagents', async () => {
  for (const fence of ['none', 'mutation', 'uncertain']) {
    const h = host('tui', {}, { panelLib: fakeLib });
    try {
      await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
      if (fence === 'mutation' || fence === 'uncertain') {
        await h.hooks.get('tool_call')({ toolCallId: 'write', toolName: 'write', input: { path: 'example.txt', content: 'pending' } }, h.ctx);
        if (fence === 'uncertain') {
          await h.hooks.get('session_shutdown')({ reason: 'reload' }, h.ctx);
          await h.hooks.get('session_start')({ reason: 'reload' }, h.ctx);
        }
      }
      const execute = () => h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx);
      if (fence === 'none') assert.equal((await execute()).details.scheduled, true);
      else await assert.rejects(execute(), fence === 'mutation' ? /unsettled mutation effects/ : /interrupted mutation effects are unconfirmed/);
      assert.equal(h.sent.length, fence === 'none' ? 1 : 0);
    } finally { await h.close(); }
  }
});

test('aborted run boundary never requests an automatic continuation', async () => {
  const h = host();
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    assert.equal(await h.hooks.get('agent_before_settle')({ outcome: 'aborted', entries: [], continue: false, context: { canContinue: true } }, h.ctx), undefined);
  } finally { await h.close(); }
});

async function quotaHost(config: Partial<SupervisorConfig> = {}, serverOptions: Record<string, unknown> = {}, replacement: Parameters<typeof host>[1] = {}) {
  const server = new MockCpamcServer({ mainWhamUsedPercentPrimary: 99, secondWhamUsedPercentPrimary: 99, geminiRemainingFraction: 0, ...serverOptions });
  const h = host('tui', replacement, { panelLib: fakeLib, baseUrl: await server.start() });
  // Automatic routing competes over the saved slots only: the fixtures save one per account.
  updateSupervisorConfig(h.dir, { priorityCandidateIds: ROUTING_SLOTS, ...config });
  h.ctx.model = { provider: 'cliproxyapi', id: 'main/gpt-6.1-sol', contextWindow: 272000 };
  h.ctx.modelRegistry = { find: (provider: string, id: string) => ({ provider, id, contextWindow: 272000 }) };
  h.pi.setModel = async (model: any) => { h.ctx.model = model; return true; };
  // Records startup routing efforts; later tests may still replace this recorder.
  const startupEfforts: string[] = [];
  h.pi.setThinkingLevel = (level: string) => { startupEfforts.push(level); };
  let tick: any;
  let intervalMs: number | undefined;
  const realInterval = globalThis.setInterval;
  globalThis.setInterval = ((callback: any, ms?: number) => {
    tick = callback; intervalMs = ms; return realInterval(callback, ms as any);
  }) as any;
  try { await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx); }
  finally { globalThis.setInterval = realInterval; }
  return { ...h, server, startupEfforts, tick: async () => { await tick(); }, intervalMs: () => intervalMs,
    async close() { await h.close(); await server.stop(); } };
}
const failedMessage = { role: 'assistant', stopReason: 'error', errorMessage: 'insufficient_quota' };
// Pi cannot continue directly after an assistant error: the boundary must add
// a recovery message (or omit the failed assistant) before requesting a call.
const errorBoundary = () => ({ outcome: 'error', entries: [], continue: false, context: { canContinue: false } });

test('exhausted accounts wait without prompts; quota recovery wakes only one owed provider turn', async () => {
  const h = await quotaHost();
  try {
    await h.hooks.get('before_agent_start')({ messageType: 'user', prompt: 'authorized work' }, h.ctx);
    await h.hooks.get('turn_end')({ message: failedMessage }, h.ctx);
    assert.equal(await h.hooks.get('agent_before_settle')(errorBoundary(), h.ctx), undefined);
    await h.hooks.get('agent_settled')({ aborted: false }, h.ctx);
    assert.equal(h.sent.length, 0);
    h.server.options.secondWhamUsedPercentPrimary = 10;
    await h.tick();
    assert.equal(h.ctx.model.id, 'second/gpt-6.1-sol');
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0][0].customType, 'supervisor-provider-recovery');
    assert.equal(h.sent[0][1].triggerTurn, true);
    await h.tick();
    assert.equal(h.sent.length, 1);
  } finally { await h.close(); }
});

test('manual Gemini selection survives prompts and polling even when Codex is available', async () => {
  const h = await quotaHost();
  try {
    h.ctx.model = { provider: 'cliproxyapi', id: 'gemini-account/gemini-3.8-flash-high', contextWindow: 370000 };
    h.server.options.mainWhamUsedPercentPrimary = 10;
    h.server.options.geminiRemainingFraction = 1;
    await h.hooks.get('before_agent_start')({ messageType: 'user', prompt: 'orchestrate' }, h.ctx);
    assert.equal(h.ctx.model.id, 'gemini-account/gemini-3.8-flash-high');
    await h.tick();
    await h.hooks.get('before_agent_start')({ messageType: 'user', prompt: 'next' }, h.ctx);
    assert.equal(h.ctx.model.id, 'gemini-account/gemini-3.8-flash-high');
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('status discovers accounts immediately after reload without changing model or starting work', async () => {
  const h = await quotaHost();
  try {
    h.ctx.model = { provider: 'cliproxyapi', id: 'second/gpt-6.1-sol', contextWindow: 272000 };
    h.server.options.mainWhamUsedPercentPrimary = 10;
    // Opening the panel performs the catalogue refresh the old status command triggered.
    const panel = await panelFor(h);
    const text = panelText(panel);
    assert.match(text, /inventory: cliproxyapi\/main\/gpt-6.1-sol/);
    assert.doesNotMatch(text, /inventory: .*—/, 'a clean inventory read must not carry an error');
    assert.doesNotMatch(text, /not discovered yet/);
    assert.equal(h.ctx.model.id, 'second/gpt-6.1-sol');
    assert.equal(h.sent.length, 0);
    await h.hooks.get('session_shutdown')({ reason: 'reload' }, h.ctx);
    await h.hooks.get('session_start')({ reason: 'reload' }, h.ctx);
    const reloaded = await panelFor(h);
    assert.match(panelText(reloaded), /inventory: cliproxyapi\/main\/gpt-6.1-sol/);
    assert.equal(h.ctx.model.id, 'second/gpt-6.1-sol');
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('status reports failed discovery truthfully and preserves the last inventory and the safety state', async () => {
  const h = await quotaHost();
  try {
    const panel = await panelFor(h);
    assert.match(panelText(panel), /inventory: cliproxyapi\/main\/gpt-6.1-sol/);
    h.server.options.inventoryUnavailable = true;
    const failed = await panelFor(h);
    const text = panelText(failed);
    assert.match(text, /inventory: .*cliproxyapi\/main\/gpt-6\.1-sol/);
    assert.match(text, /— Account inventory unavailable/);
    assert.doesNotMatch(text, /not discovered yet/);
    assert.equal(h.sent.length, 0);
    // A fresh runtime must report a failure, not pretend the query never ran.
    await h.hooks.get('session_shutdown')({ reason: 'reload' }, h.ctx);
    await h.hooks.get('session_start')({ reason: 'reload' }, h.ctx);
    const fresh = await panelFor(h);
    assert.match(panelText(fresh), /Account inventory unavailable/);
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('status distinguishes an empty registered-model inventory from undiscovered accounts', async () => {
  const h = await quotaHost();
  try {
    h.ctx.modelRegistry.find = () => undefined;
    const panel = await panelFor(h);
    const text = panelText(panel);
    assert.match(text, /inventory: none/);
    assert.doesNotMatch(text, /not discovered yet/);
    assert.equal(h.ctx.model.id, 'main/gpt-6.1-sol');
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('only /supervisor exists: every removed subcommand is a usage error and changes nothing', async () => {
  const h = host();
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    const before = h.notices.length;
    const statusesBefore = h.statuses.length;
    const usage = ['Usage: /supervisor (opens the configuration panel). Only settings live there; rotation stays automatic or on explicit request.', 'warning'];
    for (const args of ['status', 'models', 'models list', 'models enable cliproxyapi/main/gpt-6.1-sol',
      'models disable cliproxyapi/main/gpt-6.1-sol', 'pause', 'resume', 'cancel', 'rotate', 'panel']) {
      await h.commands.get('supervisor').handler(args, h.ctx);
      assert.deepEqual(h.notices.at(-1), usage, `${args}: exactly one usage notice`);
    }
    assert.equal(h.notices.length, before + 10, 'one notice per call, nothing else happened');
    assert.equal(h.sent.length, 0, 'no removed subcommand may dispatch work');
    assert.equal(h.statuses.length, statusesBefore, 'no removed subcommand may change the status line');
  } finally { await h.close(); }
});

test('new user input retires deferred recovery even if account quota returns afterward', async () => {
  const h = await quotaHost();
  try {
    await h.hooks.get('turn_end')({ message: failedMessage }, h.ctx);
    assert.equal(await h.hooks.get('agent_before_settle')(errorBoundary(), h.ctx), undefined);
    await h.hooks.get('before_agent_start')({ messageType: 'user', prompt: 'different authorized work' }, h.ctx);
    h.server.options.secondWhamUsedPercentPrimary = 10;
    await h.tick();
    assert.equal(h.ctx.model.id, 'main/gpt-6.1-sol');
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('S3: a route outside the saved slots is never a failover target', async () => {
  const h = await quotaHost({ priorityCandidateIds: ['cliproxyapi/main/gpt-6.1-sol'] }, { secondWhamUsedPercentPrimary: 10 });
  try {
    // `second` is available the whole time but is not one of the saved slots.
    await h.hooks.get('turn_end')({ message: failedMessage }, h.ctx);
    assert.equal(await h.hooks.get('agent_before_settle')(errorBoundary(), h.ctx), undefined);
    await h.tick();
    assert.equal(h.ctx.model.id, 'main/gpt-6.1-sol');
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('S9: the supervisor_rotate tool still rotates with automatic rotation switched off', async () => {
  const h = host();
  try {
    updateSupervisorConfig(h.dir, { autoRotate: false });
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    // A user-requested rotation is not an automatic capability, so the switch must not gate it.
    await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action', continue_task: true }, undefined, undefined, h.ctx);
    assert.equal(h.sent.length, 1, 'the tool dispatches the verified handover with the switch off');
    assert.match(h.sent[0][0], /^\/supervisor-rotate [0-9a-f-]{36}$/);
  } finally { await h.close(); }
});

test('S9: with automatic rotation on, the boundary still requests the checkpoint', async () => {
  const h = host();
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    h.ctx.getContextUsage = () => ({ tokens: 9900, contextWindow: 10000, percent: 99 });
    const result = await h.hooks.get('agent_before_settle')(
      { outcome: 'continue', entries: [], continue: false, context: { canContinue: true } }, h.ctx);
    assert.equal(result?.continue, true);
    assert.equal(result?.entries?.[0]?.customType, 'supervisor-checkpoint-request');
  } finally { await h.close(); }
});

test('S9: automatic rotation off suppresses only the threshold request', async () => {
  const h = host('tui', {}, { panelLib: fakeLib });
  try {
    updateSupervisorConfig(h.dir, { autoRotate: false });
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    h.ctx.getContextUsage = () => ({ tokens: 9900, contextWindow: 10000, percent: 99 });
    const boundary = { outcome: 'continue', entries: [], continue: false, context: { canContinue: true } };
    assert.equal(await h.hooks.get('agent_before_settle')(boundary, h.ctx), undefined, 'no automatic checkpoint request');
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('S9: automatic model switching off leaves the startup and failover model untouched, and keeps the debt', async () => {
  const control = await quotaHost({}, { secondWhamUsedPercentPrimary: 10 });
  try {
    assert.equal(control.ctx.model.id, 'second/gpt-6.1-sol', 'control: startup routing still switches by default');
  } finally { await control.close(); }

  const h = await quotaHost({ autoSwitchModel: false }, { secondWhamUsedPercentPrimary: 10 });
  try {
    assert.equal(h.ctx.model.id, 'main/gpt-6.1-sol', 'startup must not switch the model');

    await h.hooks.get('turn_end')({ message: failedMessage }, h.ctx);
    const result = await h.hooks.get('agent_before_settle')(errorBoundary(), h.ctx);
    assert.equal(h.ctx.model.id, 'main/gpt-6.1-sol', 'failover must not switch the model');
    assert.equal(result, undefined, 'no recovery turn is fabricated on the same route');
    assert.equal(h.sent.length, 0);

    // The recovery debt survives, so turning the capability back on resumes it. The reload
    // builds a new runtime with its own poll timer, so capture that callback (the first
    // runtime's `tick` polls a disposed runtime and would prove nothing).
    await h.hooks.get('session_shutdown')({ reason: 'reload' }, h.ctx);
    updateSupervisorConfig(h.dir, { autoSwitchModel: true });
    const spy = installTimerSpy();
    try { await h.hooks.get('session_start')({ reason: 'reload' }, h.ctx); }
    finally { spy.restore(); }
    assert.equal(spy.intervals.length, 1, 'the reload runtime starts exactly one poll timer');
    await spy.intervals[0].callback();
    assert.equal(h.ctx.model.id, 'second/gpt-6.1-sol');
  } finally { await h.close(); }
});

test('provider failover adds a valid recovery message when the assistant error cannot continue', async () => {
  const h = await quotaHost();
  try {
    h.server.options.secondWhamUsedPercentPrimary = 10;
    await h.hooks.get('turn_end')({ message: failedMessage }, h.ctx);
    const result = await h.hooks.get('agent_before_settle')(errorBoundary(), h.ctx);
    assert.equal(h.ctx.model.id, 'second/gpt-6.1-sol');
    assert.equal(result?.continue, true);
    assert.equal(result?.entries?.length, 1);
    assert.equal(result.entries[0].type, 'custom_message');
    assert.equal(result.entries[0].customType, 'supervisor-provider-recovery');
    assert.match(result.entries[0].content, /do not replay mutations/i);
    assert.equal(h.sent.length, 0);
    await h.tick();
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('S6: transient retry adds recovery context, keeps the model, and a master disable during backoff cancels it', async () => {
  const h = await quotaHost();
  try {
    await h.hooks.get('turn_end')({ message: { role: 'assistant', stopReason: 'error', errorMessage: '503 overloaded' } }, h.ctx);
    const retry = await h.hooks.get('agent_before_settle')(errorBoundary(), h.ctx);
    assert.equal(retry?.continue, true);
    assert.equal(retry?.entries?.[0]?.customType, 'supervisor-provider-recovery');
    assert.equal(h.ctx.model.id, 'main/gpt-6.1-sol');
    await h.hooks.get('turn_end')({ message: { role: 'assistant', stopReason: 'error', errorMessage: '503 overloaded' } }, h.ctx);
    const pending = h.hooks.get('agent_before_settle')(errorBoundary(), h.ctx);
    // The master switch is the only human stop now: disabling it tears the runtime down.
    updateSupervisorConfig(h.dir, { enabled: false });
    assert.equal(await pending, undefined);
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('manual model event retires pending recovery instead of switching back', async () => {
  const h = await quotaHost();
  try {
    await h.hooks.get('turn_end')({ message: failedMessage }, h.ctx);
    h.ctx.model = { provider: 'cliproxyapi', id: 'gemini-account/gemini-3.8-flash-high', contextWindow: 370000 };
    await h.hooks.get('model_select')({ source: 'cycle', model: h.ctx.model }, h.ctx);
    assert.equal(await h.hooks.get('agent_before_settle')(errorBoundary(), h.ctx), undefined);
    await h.tick();
    assert.equal(h.ctx.model.id, 'gemini-account/gemini-3.8-flash-high');
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('manual model changes during asynchronous fallback discovery cancel the old switch', async () => {
  const h = await quotaHost();
  const originalFetch = globalThis.fetch;
  let release!: () => void;
  let entered!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    h.server.options.secondWhamUsedPercentPrimary = 10;
    let held = false;
    globalThis.fetch = (async (input: any, init: any) => {
      if (!held && String(input).endsWith('/v0/management/auth-files')) {
        held = true; entered(); await gate;
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    await h.hooks.get('turn_end')({ message: failedMessage }, h.ctx);
    const fallback = h.hooks.get('agent_before_settle')(errorBoundary(), h.ctx);
    await reached;
    h.ctx.model = { provider: 'cliproxyapi', id: 'gemini-account/gemini-3.8-flash-high', contextWindow: 370000 };
    await h.hooks.get('model_select')({ source: 'set', model: h.ctx.model }, h.ctx);
    release();
    assert.equal(await fallback, undefined);
    assert.equal(h.ctx.model.id, 'gemini-account/gemini-3.8-flash-high');
    await h.tick();
    assert.equal(h.sent.length, 0);
  } finally { release?.(); globalThis.fetch = originalFetch; await h.close(); }
});

test('supervisor model events do not invalidate their own fallback continuation', async () => {
  const h = await quotaHost();
  try {
    h.server.options.secondWhamUsedPercentPrimary = 10;
    h.pi.setModel = async (model: any) => {
      const previousModel = h.ctx.model;
      h.ctx.model = model;
      await h.hooks.get('model_select')({ source: 'set', model, previousModel }, h.ctx);
      return true;
    };
    await h.hooks.get('turn_end')({ message: failedMessage }, h.ctx);
    const result = await h.hooks.get('agent_before_settle')(errorBoundary(), h.ctx);
    assert.equal(h.ctx.model.id, 'second/gpt-6.1-sol');
    assert.equal(result?.continue, true);
    assert.equal(result?.entries?.[0]?.customType, 'supervisor-provider-recovery');
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('fresh startup selects once and reload or session restore does not reselect', async () => {
  const h = await quotaHost();
  try {
    h.server.options.mainWhamUsedPercentPrimary = 10;
    h.ctx.model = { provider: 'cliproxyapi', id: 'gemini-account/gemini-3.8-flash-high', contextWindow: 370000 };
    for (const reason of ['reload', 'resume', 'new']) {
      await h.hooks.get('session_shutdown')({ reason: 'reload' }, h.ctx);
      await h.hooks.get('session_start')({ reason }, h.ctx);
      assert.equal(h.ctx.model.id, reason === 'new' ? 'main/gpt-6.1-sol' : 'gemini-account/gemini-3.8-flash-high');
    }
    h.ctx.model = { provider: 'cliproxyapi', id: 'gemini-account/gemini-3.8-flash-high', contextWindow: 370000 };
    await h.hooks.get('model_select')({ source: 'set', model: h.ctx.model }, h.ctx);
    await h.hooks.get('before_agent_start')({ messageType: 'user' }, h.ctx);
    assert.equal(h.ctx.model.id, 'gemini-account/gemini-3.8-flash-high');
  } finally { await h.close(); }
});

test('interrupting a response keeps the supervisor active across reload and allows unimpeded rotation', async () => {
  const h = await quotaHost();
  try {
    await h.hooks.get('before_agent_start')({ messageType: 'user', prompt: 'authorized work' }, h.ctx);
    await h.hooks.get('turn_end')({ message: failedMessage }, h.ctx);
    await h.hooks.get('agent_before_settle')(errorBoundary(), h.ctx);
    await h.hooks.get('agent_settled')({ aborted: true }, h.ctx);
    assert.match(panelText(await panelFor(h)), /runtime: active/);
    assert.doesNotMatch(panelText(await panelFor(h)), /halted/);
    assert.equal(h.sent.length, 0, 'an abort must not start a continuation');

    await h.hooks.get('session_shutdown')({ reason: 'reload' }, h.ctx);
    await h.hooks.get('session_start')({ reason: 'reload' }, h.ctx);
    h.server.options.secondWhamUsedPercentPrimary = 10;
    await h.tick();
    assert.equal(h.sent.length, 0, 'interrupted recovery debt must stay retired after reload');
    assert.equal(h.ctx.model.id, 'main/gpt-6.1-sol');
    assert.match(panelText(await panelFor(h)), /runtime: active/);
    const result = await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx);
    assert.equal(result.details.scheduled, true);
    assert.equal(h.sent.length, 1);
    assert.match(h.sent[0][0], /^\/supervisor-rotate [0-9a-f-]{36}$/);
  } finally { await h.close(); }
});

test('S6: an abort and reload preserve the uncertain-effect fence until explicit confirmation', async () => {
  const h = await quotaHost();
  try {
    await h.hooks.get('tool_call')({ toolCallId: 'interrupted-write', toolName: 'write', input: { path: 'example.txt', content: 'pending' } }, h.ctx);
    await h.hooks.get('session_shutdown')({ reason: 'reload' }, h.ctx);
    await h.hooks.get('session_start')({ reason: 'reload' }, h.ctx);
    await h.hooks.get('agent_settled')({ aborted: true }, h.ctx);
    assert.match(panelText(await panelFor(h)), /uncertain effects: 1/);
    await assert.rejects(h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx), /interrupted mutation effects are unconfirmed/i);
    const blocked = await h.hooks.get('tool_call')({ toolCallId: 'new-write', toolName: 'write', input: { path: 'other.txt', content: 'new' } }, h.ctx);
    assert.equal(blocked?.block, true, 'uncertain effects fence new mutations');
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('S6: escape, completed responses and a halted supervisor never wake on restored quota', async () => {
  for (const stop of ['escape', 'completed', 'uncertain']) {
    const h = await quotaHost();
    try {
      if (stop === 'uncertain') {
        await h.hooks.get('tool_call')({ toolCallId: 'pending-write', toolName: 'write', input: { path: 'example.txt', content: 'pending' } }, h.ctx);
        await h.hooks.get('session_shutdown')({ reason: 'reload' }, h.ctx);
        await h.hooks.get('session_start')({ reason: 'reload' }, h.ctx);
      } else {
        await h.hooks.get('before_agent_start')({ messageType: 'user', prompt: 'work' }, h.ctx);
        await h.hooks.get('turn_end')({ message: failedMessage }, h.ctx);
        await h.hooks.get('agent_before_settle')(errorBoundary(), h.ctx);
        if (stop === 'completed') await h.hooks.get('turn_end')({ message: { role: 'assistant', stopReason: 'stop', content: [] } }, h.ctx);
        else await h.hooks.get('agent_settled')({ aborted: true }, h.ctx);
      }
      h.server.options.secondWhamUsedPercentPrimary = 10;
      await h.tick();
      assert.equal(h.sent.length, 0, stop);
    } finally { await h.close(); }
  }
});

test('S3: the picker catalogue is Pi chat models only; discovery enriches quota, never invents models', async () => {
  const h = await quotaHost();
  try {
    h.ctx.modelRegistry.getAvailable = () => [
      { provider: 'anthropic', id: 'claude-sonnet-4-5', contextWindow: 200000 },
      { provider: 'openai', id: 'gpt-5', contextWindow: 400000 },
      { provider: 'imagen', id: 'image-1', type: 'image' },
    ];
    await h.hooks.get('session_shutdown')({ reason: 'reload' }, h.ctx);
    await h.hooks.get('session_start')({ reason: 'reload' }, h.ctx);
    const report = panelText(await panelFor(h));
    assert.match(report, /inventory: .*anthropic\/claude-sonnet-4-5/);
    assert.match(report, /inventory: .*openai\/gpt-5/);
    assert.doesNotMatch(report, /imagen/, 'non-chat models are never routing targets');
    assert.equal(h.ctx.model.id, 'main/gpt-6.1-sol');
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('S3: the host catalogue falls back to getAll when no model is available', async () => {
  const h = await quotaHost();
  try {
    h.ctx.modelRegistry.getAvailable = () => [];
    h.ctx.modelRegistry.getAll = () => [{ provider: 'ollama', id: 'llama3.1:8b' }];
    assert.match(panelText(await panelFor(h)), /ollama\/llama3\.1:8b/);
  } finally { await h.close(); }
});

test('S3: host models stay selectable when account discovery is unavailable', async () => {
  const h = await quotaHost();
  try {
    h.ctx.modelRegistry.getAvailable = () => [{ provider: 'anthropic', id: 'claude-sonnet-4-5' }];
    h.server.options.inventoryUnavailable = true;
    const report = panelText(await panelFor(h));
    assert.match(report, /Account inventory unavailable/);
    assert.match(report, /anthropic\/claude-sonnet-4-5/);
    assert.equal(h.ctx.model.id, 'main/gpt-6.1-sol');
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('S3: the saved slots route a new session from an outside default without starting work', async () => {
  const target = 'cliproxyapi/second/gpt-6.1-sol';
  const h = await quotaHost({ priorityCandidateIds: [target] }, { mainWhamUsedPercentPrimary: 10, secondWhamUsedPercentPrimary: 10 });
  try {
    h.ctx.model = { provider: 'custom', id: 'default', contextWindow: 10000 };
    await h.hooks.get('session_shutdown')({ reason: 'reload' }, h.ctx);
    await h.hooks.get('session_start')({ reason: 'new' }, h.ctx);
    assert.equal(h.ctx.model.id, 'second/gpt-6.1-sol');
    assert.equal(h.sent.length, 0, 'startup selection must not start a turn');

    // A later manual model choice outside the slots remains protected.
    const manual = { provider: 'custom', id: 'manual', contextWindow: 10000 };
    h.ctx.model = manual;
    await h.hooks.get('model_select')({ model: manual, source: 'user' }, h.ctx);
    await h.hooks.get('turn_end')({ message: failedMessage }, h.ctx);
    await h.tick();
    assert.equal(h.ctx.model, manual);
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('rotation selects a configured slot before the only continuity turn, unless autoswitch is off', async () => {
  for (const autoSwitchModel of [true, false]) {
    const initialModel = { provider: 'custom', id: 'default', contextWindow: 10000 };
    let checkedIncoming = false;
    const h = await quotaHost(
      { autoSwitchModel, priorityCandidateIds: ['cliproxyapi/second/gpt-6.1-sol'] },
      { secondWhamUsedPercentPrimary: 10 },
      { model: initialModel, beforeHandover: fresh => {
        checkedIncoming = true;
        assert.equal(fresh.model.provider, autoSwitchModel ? 'cliproxyapi' : 'custom');
        assert.equal(fresh.model.id, autoSwitchModel ? 'second/gpt-6.1-sol' : 'default');
      } },
    );
    try {
      await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action', continue_task: true }, undefined, undefined, h.ctx);
      const dispatch = h.sent.find(([message]: any[]) => typeof message === 'string' && message.startsWith('/supervisor-rotate '));
      assert.ok(dispatch);
      await h.commands.get('supervisor-rotate').handler(dispatch[0].split(' ')[1], h.ctx);
      assert.equal(checkedIncoming, true);
      const continuity = h.sent.filter(([message]: any[]) => message.customType === 'supervisor-continuity');
      assert.equal(continuity.length, 1);
      assert.equal(continuity[0][1].triggerTurn, true);
      assert.equal(h.notices.some(([message]: any[]) => /handover failed/i.test(message)), false);
    } finally { await h.close(); }
  }
});

test('startup reports unavailable configured slots without selecting a non-slot model or starting work', async () => {
  const h = await quotaHost({ priorityCandidateIds: ['cliproxyapi/second/gpt-6.1-sol'] }, { mainWhamUsedPercentPrimary: 10 });
  try {
    assert.equal(h.ctx.model.id, 'main/gpt-6.1-sol');
    assert.ok(h.statuses.some(([, text]: any[]) => /startup routing unavailable.*no eligible routing model/i.test(text)));
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('S3: with an empty selection startup never routes or hijacks the model', async () => {
  const h = await quotaHost({ priorityCandidateIds: [] }, { mainWhamUsedPercentPrimary: 10, secondWhamUsedPercentPrimary: 10 });
  try {
    assert.equal(h.ctx.model.id, 'main/gpt-6.1-sol');
    h.ctx.model = { provider: 'custom', id: 'default', contextWindow: 10000 };
    await h.hooks.get('session_shutdown')({ reason: 'reload' }, h.ctx);
    await h.hooks.get('session_start')({ reason: 'new' }, h.ctx);
    assert.equal(h.ctx.model.id, 'default', 'an empty selection means no routing, not a computed order');
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------
// T3 (S4/S5/S6 wiring/S7): persisted per-project enable/disable and live
// bootstrap/teardown of the runtime. S9 defaults must stay unchanged.
// ---------------------------------------------------------------------------

function installTimerSpy() {
  const realSetInterval = globalThis.setInterval, realClearInterval = globalThis.clearInterval;
  const intervals: Array<{ callback: any; ms: number }> = [];
  const cleared: any[] = [];
  globalThis.setInterval = ((callback: any, ms?: number) => {
    intervals.push({ callback, ms: ms ?? 0 });
    return realSetInterval(callback as any, ms as any);
  }) as any;
  globalThis.clearInterval = ((handle: any) => { cleared.push(handle); return realClearInterval(handle); }) as any;
  return { intervals, cleared, restore: () => { globalThis.setInterval = realSetInterval; globalThis.clearInterval = realClearInterval; } };
}

test('T3/S5: a disabled project creates no runtime and its panel reports it off', async () => {
  const h = host('tui', {}, { panelLib: fakeLib });
  try {
    updateSupervisorConfig(h.dir, { enabled: false });
    const spy = installTimerSpy();
    try { await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx); }
    finally { spy.restore(); }
    assert.deepEqual(spy.intervals, [], 'a disabled project must not start the poll timer');
    assert.equal(h.statuses.some(([key, value]) => key === 'orchestrator-supervisor' && value === undefined), true,
      'session_start must clear a stale status line');
    const panel = await panelFor(h);
    assert.match(panelText(panel), /off for this project/);
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('T3/S5: a malformed config keeps the supervisor disabled, reports why and is never rewritten', async () => {
  const h = host('tui', {}, { panelLib: fakeLib });
  try {
    const path = resolveSupervisorConfigPath(h.dir);
    mkdirSync(dirname(path), { recursive: true });
    const raw = '{ not json';
    writeFileSync(path, raw);
    const spy = installTimerSpy();
    try { await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx); }
    finally { spy.restore(); }
    assert.deepEqual(spy.intervals, [], 'an unusable file must not start the supervisor');
    const diagnostic = h.notices.find(([message]) => /Malformed supervisor configuration/.test(message));
    assert.ok(diagnostic, 'the failure must be reported');
    assert.equal(diagnostic[1], 'warning');
    // A damaged source stays read-only while both tabs and source selection remain usable.
    const panel = await panelFor(h);
    assert.match(panelText(panel), /configuration error:.*invalid JSON/);
    panel.handleInput('\r');
    assert.equal(loadSupervisorConfig(h.dir).source, 'invalid');
    assert.equal(readFileSync(path, 'utf8'), raw, 'a malformed file is never rewritten');
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('T3/S7: the poll timer does not act once the project is disabled', async () => {
  const h = host('tui', {}, { panelLib: fakeLib });
  try {
    const spy = installTimerSpy();
    let tick: any;
    try { await h.hooks.get('session_start')({ reason: 'reload' }, h.ctx); tick = spy.intervals.at(-1)?.callback; }
    finally { spy.restore(); }
    assert.equal(spy.intervals.length, 1);
    updateSupervisorConfig(h.dir, { enabled: false });
    const clearSpy = installTimerSpy();
    try { await tick(); } finally { clearSpy.restore(); }
    assert.equal(clearSpy.cleared.length, 1, 'the disabled poll timer is stopped');
    assert.equal(h.sent.length, 0, 'a disabled supervisor never dispatches work');
    const panel = await panelFor(h);
    assert.match(panelText(panel), /off for this project/);
  } finally { await h.close(); }
});

test('T3/S7: disabling mid-session stops the timer and cancels a pending rotation', async () => {
  const h = host('tui', {}, { panelLib: fakeLib });
  try {
    await h.hooks.get('session_start')({ reason: 'reload' }, h.ctx);
    await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action', continue_task: true }, undefined, undefined, h.ctx);
    const token = h.sent[0][0].split(' ')[1];
    const panel = await panelFor(h);
    const spy = installTimerSpy();
    try { panel.handleInput('\r'); } finally { spy.restore(); }
    assert.equal(spy.cleared.length, 1, 'disabling stops the poll timer immediately');
    assert.equal(isSupervisorEnabled(h.dir), false, 'the panel persisted the disable');
    assert.match(panelText(panel), /off for this project/);
    assert.equal(h.statuses.at(-1)[1], undefined, 'the status line is cleared');
    await h.commands.get('supervisor-rotate').handler(token, h.ctx);
    assert.deepEqual(h.notices.at(-1), ['Rotation rejected: no matching verified handover.', 'warning']);
    assert.equal(h.sent.length, 1, 'the dispatched handover is not repeated after disabling');
  } finally { await h.close(); }
});

test('T3/S4: enabling again in the same session recreates the runtime without a reload', async () => {
  const h = host('tui', {}, { panelLib: fakeLib });
  try {
    await h.hooks.get('session_start')({ reason: 'reload' }, h.ctx);
    const panel = await panelFor(h);
    panel.handleInput('\r'); // on -> off
    assert.equal(isSupervisorEnabled(h.dir), false);
    assert.match(panelText(panel), /off for this project/);
    const spy = installTimerSpy();
    try { panel.handleInput('\r'); } finally { spy.restore(); } // off -> on recreates the runtime
    assert.deepEqual(spy.intervals.map(entry => entry.ms), [60000], 'the poll timer runs again with the default interval');
    assert.equal(h.statuses.at(-1)[1], 'supervisor · active');
  } finally { await h.close(); }
});

test('T3/S6: the configured poll interval drives the timer instead of the hardcoded 60000', async () => {
  const h = host();
  try {
    updateSupervisorConfig(h.dir, { pollIntervalSeconds: 7 });
    const spy = installTimerSpy();
    try { await h.hooks.get('session_start')({ reason: 'reload' }, h.ctx); } finally { spy.restore(); }
    assert.deepEqual(spy.intervals.map(entry => entry.ms), [7000]);
  } finally { await h.close(); }
});

test('T3/S9: with no config file the supervisor keeps its previous defaults', async () => {
  const h = await quotaHost();
  try {
    assert.equal(h.intervalMs(), 60000, 'the default poll interval is unchanged');
    assert.equal(isSupervisorEnabled(h.dir), true);
    assert.match(panelText(await panelFor(h)), /inventory: cliproxyapi\/main\/gpt-6\.1-sol/);
    assert.equal(h.ctx.model.id, 'main/gpt-6.1-sol', 'the active model is unchanged');
    assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('T3/S7: an out-of-band disable stops a runtime left running from an earlier session_start', async () => {
  const h = host('tui', {}, { panelLib: fakeLib });
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    updateSupervisorConfig(h.dir, { enabled: false });
    // No session_shutdown: the flag changed behind the runtime's back, so the next
    // session_start must stop it now instead of waiting up to a full poll interval.
    const spy = installTimerSpy();
    try { await h.hooks.get('session_start')({ reason: 'reload' }, h.ctx); } finally { spy.restore(); }
    assert.equal(spy.cleared.length, 1, 'the running poll timer is stopped by the disable, not by the next tick');
    const panel = await panelFor(h);
    assert.match(panelText(panel), /off for this project/);
    assert.equal(h.statuses.at(-1)[1], undefined, 'the status line is cleared');
    assert.equal(h.sent.length, 0, 'no automatic work is dispatched');
  } finally { await h.close(); }
});

test('T6/S4: the panel opens with the supervisor off, switches it on and off, and an edit applies live', async () => {
  const server = new MockCpamcServer();
  const h = host('tui', {}, { panelLib: fakeLib, baseUrl: await server.start() });
  try {
    updateSupervisorConfig(h.dir, { enabled: false });

    let panel: any;
    let closed = 0;
    let panelDone: () => void = () => {};
    const ctx = {
      ...h.ctx,
      ui: {
        ...h.ctx.ui,
        // Mirrors the host: `custom` settles when the component calls `done()`.
        custom: async (factory: any) => {
          panel = factory({ requestRender: () => {} }, identityTheme, fakeKeybindings, () => { closed += 1; panelDone(); });
          return await new Promise<void>(resolve => { panelDone = resolve; });
        },
      },
    };
    const opened = h.commands.get('supervisor').handler('', ctx);
    const deadline = Date.now() + 10000;
    while (!panel && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(panel, 'the panel must open while the supervisor is off');
    assert.ok(panel.render(80).length > 0, 'it renders a modal body');
    assert.match(panelText(panel), /off for this project/);

    // Off -> on from the panel: the runtime and its timer appear without a reload.
    const on = installTimerSpy();
    try { panel.handleInput('\r'); } finally { on.restore(); }
    assert.equal(isSupervisorEnabled(h.dir), true, 'the panel persisted the enable');
    assert.deepEqual(on.intervals.map(entry => entry.ms), [60000], 'the runtime starts polling');
    assert.equal(h.statuses.at(-1)[1], 'supervisor · active');

    // On -> off from the panel: pending automatic work is cancelled at once (S7).
    const off = installTimerSpy();
    try { panel.handleInput('\r'); } finally { off.restore(); }
    assert.equal(isSupervisorEnabled(h.dir), false);
    assert.equal(off.cleared.length, 1, 'disabling stops the running timer at once');

    // Back on, then edit the poll interval: the live runtime adopts it without a reload (S6).
    const again = installTimerSpy();
    try { panel.handleInput('\r'); } finally { again.restore(); }
    panelHighlight(panel, 'poll', rowsFor(h));
    const live = installTimerSpy();
    try { panel.handleInput('\x1b[C'); } finally { live.restore(); }
    assert.equal(loadSupervisorConfig(h.dir).config.pollIntervalSeconds, 65, 'the panel persisted the new interval');
    assert.deepEqual(live.intervals.map(entry => entry.ms), [65000], 'the live timer adopts the new interval');
    assert.equal(live.cleared.length, 1, 'the old timer is replaced, not duplicated');

    panel.handleInput('\x1b');
    assert.equal(closed, 1, 'Escape closes the panel');
    await opened;
  } finally {
    await h.close();
    await server.stop();
  }
});

test('T6/S4: an unusable source remains read-only without blocking the other tab', async () => {
  const h = host('tui', {}, { panelLib: fakeLib });
  try {
    const path = resolveSupervisorConfigPath(h.dir);
    mkdirSync(dirname(path), { recursive: true });
    const raw = '{ not json';
    writeFileSync(path, raw);

    const panel = await panelFor(h);
    assert.match(panelText(panel), /configuration error:.*invalid JSON/);
    panel.handleInput('\r');
    assert.equal(readFileSync(path, 'utf8'), raw, 'the file is untouched');
    panel.handleInput('\t');
    assert.match(panelText(panel), /Subagent router configuration/);
    assert.doesNotMatch(panelText(panel), /configuration error:/);
  } finally { await h.close(); }
});

test('T6/S4: a panel bound to a replaced session closes without writing', async () => {
  const h = host('tui', {}, { panelLib: fakeLib });
  try {
    updateSupervisorConfig(h.dir, { enabled: true, priorityCandidateIds: [] });
    const path = resolveSupervisorConfigPath(h.dir);
    const before = readFileSync(path);

    let panel: any;
    let doneCount = 0;
    const ctx = { ...h.ctx, ui: { ...h.ctx.ui,
      custom: async (factory: any) => {
        panel = factory({ requestRender: () => {} }, identityTheme, fakeKeybindings, () => { doneCount += 1; });
        return undefined;
      } } };
    await h.commands.get('supervisor').handler('', ctx);
    assert.ok(panel, 'panel opened');

    // Replace the session: every access on the old context now throws, as the host does.
    for (const key of Object.keys(ctx)) Object.defineProperty(ctx, key, { configurable: true, get: () => { throw new Error('Stale context'); } });
    panel.handleInput('\r'); // Enter on the toggle must not write
    panel.handleMouse({ type: 'press', button: 'left', x: 5, y: 4 });
    assert.ok(doneCount >= 1, 'unbound panel closes');
    assert.deepEqual(readFileSync(path), before, 'no write from a replaced session');
  } finally { await h.close(); }
});

test('T3/S7: a single out-of-band disable tears the runtime down exactly once across repeated commands', async () => {
  const h = host('tui', {}, { panelLib: fakeLib });
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    updateSupervisorConfig(h.dir, { enabled: false });
    const spy = installTimerSpy();
    try {
      const panel = await panelFor(h);
      // The out-of-band disable left the runtime running; the panel rebinds it, then the
      // second flip tears it down exactly once.
      panel.handleInput('\r');
      panel.handleInput('\r');
      await panelFor(h);
      await panelFor(h);
    } finally { spy.restore(); }
    assert.equal(spy.cleared.length, 1, 'one teardown, not one per command');
  } finally { await h.close(); }
});

test('T3/S7: re-enabling repeatedly never duplicates the poll timer', async () => {
  const h = host('tui', {}, { panelLib: fakeLib });
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    updateSupervisorConfig(h.dir, { enabled: false });
    const panel = await panelFor(h);
    panel.handleInput('\r'); // rebinds the still-running runtime
    panel.handleInput('\r'); // first teardown
    const spy = installTimerSpy();
    try {
      panel.handleInput('\r'); // re-enable: exactly one runtime timer
      await panelFor(h);
      await panelFor(h);
    } finally { spy.restore(); }
    assert.equal(spy.intervals.length, 1, 'exactly one runtime timer created');
  } finally { await h.close(); }
});

test('T3/S7: disabling during an in-flight rotation neither throws nor rotates', async () => {
  const h = host('tui', { beforeHandover: () => { updateSupervisorConfig(h.dir, { enabled: false }); } });
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action', continue_task: true }, undefined, undefined, h.ctx);
    await h.hooks.get('agent_settled')({ aborted: false }, h.ctx);
    await new Promise(resolve => setImmediate(resolve));
    const token = h.sent[0][0].split(' ').slice(1).join(' ');
    await assert.doesNotReject(h.commands.get('supervisor-rotate').handler(token, h.ctx));
    assert.equal(isSupervisorEnabled(h.dir), false, 'the disable persisted');
    assert.equal(h.notices.some(([message]) => /^Session rotated/.test(message)), false, 'no rotation succeeded');
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------
// T3 (S3/S5/S6): modelCount bounds the active prefix, legacy pause state is
// inert, and only an explicit panel confirmation clears uncertain effects.
// ---------------------------------------------------------------------------

test('S3: modelCount selects the first saved slots and a live change activates more without touching the list', async () => {
  const h = await quotaHost({ priorityCandidateIds: ROUTING_SLOTS, modelCount: 2 },
    { mainWhamUsedPercentPrimary: 99, secondWhamUsedPercentPrimary: 99, geminiRemainingFraction: 1 });
  try {
    // Only the first two saved slots compete: gemini is available but outside the prefix.
    await h.hooks.get('turn_end')({ message: failedMessage }, h.ctx);
    await h.hooks.get('agent_before_settle')(errorBoundary(), h.ctx);
    await h.tick();
    assert.equal(h.ctx.model.id, 'main/gpt-6.1-sol');
    assert.equal(h.sent.length, 0);

    // Raising the count from the panel activates the stored third slot in the live runtime.
    const panel = await panelFor(h);
    panelHighlight(panel, 'modelCount', rowsFor(h));
    panel.handleInput('\x1b[C');
    assert.equal(loadSupervisorConfig(h.dir).config.modelCount, 3);
    assert.deepEqual(loadSupervisorConfig(h.dir).config.priorityCandidateIds, ROUTING_SLOTS, 'the saved list is never truncated');

    await h.tick();
    assert.equal(h.ctx.model.id, 'gemini-account/gemini-3.8-flash-high');
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0][0].customType, 'supervisor-provider-recovery');
  } finally { await h.close(); }
});

test('S6: legacy userPaused/userCancelled state never gates a live runtime', async () => {
  const h = host();
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    const statePath = join(h.dir, 'runtime', computeFlowIdentity(h.dir, 'session-one'), 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    // Persist the flags the way an older version did, then reload.
    writeFileSync(statePath, JSON.stringify({ ...state, userPaused: true, userCancelled: true, status: 'paused' }));
    await h.hooks.get('session_shutdown')({ reason: 'reload' }, h.ctx);
    await h.hooks.get('session_start')({ reason: 'reload' }, h.ctx);

    const result = await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx);
    assert.equal(result.details.scheduled, true, 'the legacy flags must not block rotation');
    const persisted = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(persisted.userPaused, undefined, 'the legacy flag is dropped, not carried forward');
    assert.equal(persisted.userCancelled, undefined);
    assert.equal(h.sent.length, 1);
  } finally { await h.close(); }
});

test('S6: interrupted effects require explicit panel confirmation, never a reload', async () => {
  const h = host('tui', {}, { panelLib: fakeLib });
  try {
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    await h.hooks.get('tool_call')({ toolCallId: 'interrupted', toolName: 'write', input: { path: 'a.txt', content: 'x' } }, h.ctx);
    await h.hooks.get('session_shutdown')({ reason: 'reload' }, h.ctx);
    // A reload recovers the pending mutation as uncertain, but never acknowledges it.
    await h.hooks.get('session_start')({ reason: 'reload' }, h.ctx);
    await assert.rejects(h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx), /interrupted mutation effects are unconfirmed/i);
    await h.hooks.get('session_shutdown')({ reason: 'reload' }, h.ctx);

    // Off-state diagnostics read the persisted journal, so the panel asks first.
    updateSupervisorConfig(h.dir, { enabled: false });
    const panel = await panelFor(h);
    assert.match(panelText(panel), /off for this project/);
    panel.handleInput('\r');
    assert.equal(isSupervisorEnabled(h.dir), false, 'the first Enter only arms the confirmation');
    assert.match(panelText(panel), /press enter again to confirm enabling/i);
    panel.handleInput('\r');
    assert.equal(isSupervisorEnabled(h.dir), true, 'the second Enter confirms and enables');

    const result = await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx);
    assert.equal(result.details.scheduled, true, 'the confirmed runtime is no longer fenced');
    assert.equal(h.sent.length, 1);
  } finally { await h.close(); }
});

test('S6: rejected credentials are an honest safety fault cleared only by an explicit enable', async () => {
  const h = await quotaHost();
  try {
    await h.hooks.get('turn_end')({ message: { role: 'assistant', stopReason: 'error', errorMessage: 'Invalid API key (401)' } }, h.ctx);
    await assert.rejects(h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx), /credentials fault/i);
    assert.equal(h.sent.length, 0);

    // The state view must expose the same fault that blocks automatic work and rotation.
    const panel = await panelFor(h);
    assert.match(panelText(panel), /runtime: halted: credentials/);
    assert.doesNotMatch(panelText(panel), /runtime: active/);
    panel.handleInput('\r'); // off
    assert.equal(isSupervisorEnabled(h.dir), false);
    panel.handleInput('\r'); // on: the explicit enable clears the recorded fault
    assert.equal(isSupervisorEnabled(h.dir), true);

    const result = await h.tools.get('supervisor_rotate').execute('rotate', { summary: '- Goal\n- Next action' }, undefined, undefined, h.ctx);
    assert.equal(result.details.scheduled, true);
    assert.equal(h.sent.length, 1);
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------
// 3-failure failover and turn continuation (S1-S5)
// ---------------------------------------------------------------------------

test('S2/S5: 3 consecutive transient provider failures trigger failover to the next candidate and dispatch a triggerTurn continuation', async () => {
  const h = await quotaHost({ priorityCandidateIds: ROUTING_SLOTS }, { mainWhamUsedPercentPrimary: 10, secondWhamUsedPercentPrimary: 10 });
  try {
    const transientError = { role: 'assistant', stopReason: 'error', errorMessage: '503 overloaded' };
    assert.equal(h.ctx.model.id, 'main/gpt-6.1-sol');

    // Failure 1
    await h.hooks.get('turn_end')({ message: transientError }, h.ctx);
    const retry1 = await h.hooks.get('agent_before_settle')(errorBoundary(), h.ctx);
    assert.equal(retry1?.continue, true);
    assert.equal(h.ctx.model.id, 'main/gpt-6.1-sol');

    // Failure 2
    await h.hooks.get('turn_end')({ message: transientError }, h.ctx);
    const retry2 = await h.hooks.get('agent_before_settle')(errorBoundary(), h.ctx);
    assert.equal(retry2?.continue, true);
    assert.equal(h.ctx.model.id, 'main/gpt-6.1-sol');

    // Failure 3 -> main goes into cooldown, failover switches to second/gpt-6.1-sol
    await h.hooks.get('turn_end')({ message: transientError }, h.ctx);
    const failover = await h.hooks.get('agent_before_settle')(errorBoundary(), h.ctx);
    assert.equal(h.ctx.model.id, 'second/gpt-6.1-sol');
    assert.equal(failover?.continue, true);

    // After settling, a recovery turn must be dispatched via sendMessage with triggerTurn: true
    await h.hooks.get('agent_settled')({ aborted: false }, h.ctx);
    assert.equal(h.sent.length, 1);
    const [sentMsg, sentOpts] = h.sent[0];
    assert.equal(sentMsg.customType, 'supervisor-provider-recovery');
    assert.equal(sentOpts?.triggerTurn, true);
  } finally { await h.close(); }
});

test('S1/S2: 3 failures on an unselected active model fail over to the configured candidate slots', async () => {
  const h = await quotaHost({ priorityCandidateIds: ROUTING_SLOTS }, { mainWhamUsedPercentPrimary: 10, secondWhamUsedPercentPrimary: 10 });
  try {
    h.ctx.model = { provider: 'nan', id: 'unselected-deepseek', contextWindow: 276000 };
    const transientError = { role: 'assistant', stopReason: 'error', errorMessage: '500 internal server error' };

    // Fail 3 times on the unselected model
    for (let i = 0; i < 3; i++) {
      await h.hooks.get('turn_end')({ message: transientError }, h.ctx);
      await h.hooks.get('agent_before_settle')(errorBoundary(), h.ctx);
    }

    assert.equal(h.ctx.model.id, 'main/gpt-6.1-sol');
    await h.hooks.get('agent_settled')({ aborted: false }, h.ctx);
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0][1]?.triggerTurn, true);
  } finally { await h.close(); }
});


test('configuration scopes: public panel persists independent sources, reopens, and applies runtime switches without acknowledging effects', async () => {
  const h = host('tui', {}, { panelLib: fakeLib });
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(h.dir, 'active-pi');
  try {
    updateSupervisorConfig(h.dir, { enabled: false });
    const legacy = resolveSupervisorConfigPath(h.dir), before = readFileSync(legacy, 'utf8');
    selectSupervisorConfigScope(h.dir, 'project');
    updateSupervisorConfig(h.dir, { enabled: false, modelCount: 3 });
    selectSupervisorConfigScope(h.dir, 'global');
    updateSupervisorConfig(h.dir, { enabled: true, autoSwitchModel: false, modelCount: 2 });
    await h.hooks.get('session_start')({ reason: 'startup' }, h.ctx);
    await h.hooks.get('tool_call')({ toolCallId: 'scope-write', toolName: 'write', input: { path: 'example.txt', content: 'pending' } }, h.ctx);
    await h.hooks.get('session_shutdown')({ reason: 'reload' }, h.ctx);
    await h.hooks.get('session_start')({ reason: 'reload' }, h.ctx);
    const panel = await panelFor(h);
    const scopeRows = ['scope', ...rowsFor(h)];
    assert.match(panelText(panel), /Configuration source: Global/);
    panelHighlight(panel, 'scope', scopeRows); panel.handleInput('\x1b[D');
    assert.match(panelText(panel), /Configuration source: Project/);
    assert.equal(loadSupervisorConfig(h.dir).config.enabled, false);
    assert.match(panelText(panel), /off for this project/);
    panel.handleInput('\x1b[C');
    assert.equal(loadSupervisorConfig(h.dir).config.enabled, true);
    assert.match(panelText(panel), /uncertain effects: 1/);
    const blocked = await h.hooks.get('tool_call')({ toolCallId: 'rejected', toolName: 'write', input: {} }, h.ctx);
    assert.equal(blocked?.block, true, 'scope changes must never acknowledge uncertain effects');
    panel.handleInput('\t');
    panelHighlight(panel, 'scope', ['scope', 'toggle', 'modelCount']); panel.handleInput('\r');
    assert.match(panelText(panel), /Configuration source: Project/);
    panelEnter(panel, 'modelCount', ['scope', 'toggle', 'modelCount']); panel.handleInput('\x1b[C');
    assert.equal(loadSubagentConfig(h.dir).config.modelCount, 6);
    assert.equal(resolveSubagentConfigPath(h.dir), join(h.dir, '.pi', 'orchestrator-supervisor', 'subagents.json'));
    const reopened = await panelFor(h);
    assert.match(panelText(reopened), /Configuration source: Global/);
    reopened.handleInput('\t');
    assert.match(panelText(reopened), /Configuration source: Project/);
    assert.match(panelText(reopened), /Model count\s+\[-\] 6/);
    assert.equal(readFileSync(legacy, 'utf8'), before);
    assert.equal(h.sent.length, 0);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await h.close();
  }
});


test('effort selection: public dashboard saves Default atomically and restores it on reopen', async () => {
  const h = host('tui', {}, { panelLib: fakeLib });
  try {
    updateSupervisorConfig(h.dir, { enabled: false });
    const candidate = { provider: 'test', id: 'reasoner', reasoning: true };
    h.ctx.modelRegistry = { getAvailable: () => [candidate], getAll: () => [candidate] };
    const panel = await panelFor(h);
    const rows = ['scope', ...rowsFor(h)];
    const before = readFileSync(resolveSupervisorConfigPath(h.dir), 'utf8');
    panelEnter(panel, 'slot:1', rows);
    for (const character of 'test/reasoner') panel.handleInput(character);
    panel.handleInput('\r');
    assert.match(panelText(panel), /Select reasoning effort/);
    assert.equal(readFileSync(resolveSupervisorConfigPath(h.dir), 'utf8'), before, 'choosing a model alone must not save');
    // Standalone node has no host capability module: the honest available option is Default.
    assert.match(panelText(panel), /Default/);
    panel.handleInput('\r');
    assert.deepEqual(loadSupervisorConfig(h.dir).config.priorityCandidateIds, ['test/reasoner']);
    assert.equal(loadSupervisorConfig(h.dir).config.modelEfforts, undefined);
    const reopened = await panelFor(h);
    assert.match(panelText(reopened), /test\/reasoner \[Default\]/);
    reopened.handleInput('\t');
    panelEnter(reopened, 'slot:1', ['scope', 'toggle', 'modelCount', 'slot:1']);
    for (const character of 'test/reasoner') reopened.handleInput(character);
    reopened.handleInput('\r');
    assert.match(panelText(reopened), /Select reasoning effort/);
    reopened.handleInput('\x1b');
    assert.match(panelText(reopened), /Assign subagent slot/);
    assert.equal(loadSubagentConfig(h.dir).source, 'default', 'cancel must not create a child preference file');
  } finally { await h.close(); }
});


test('effort overrides: provider recovery applies the effort of the actual failover model only', async () => {
  const target = 'cliproxyapi/second/gpt-6.1-sol';
  const h = await quotaHost({ modelEfforts: { [target]: 'low', 'cliproxyapi/main/gpt-6.1-sol': 'xhigh' } });
  const efforts: string[] = [];
  h.pi.setThinkingLevel = (level: string) => { efforts.push(level); };
  try {
    await h.hooks.get('before_agent_start')({ messageType: 'user', prompt: 'authorized work' }, h.ctx);
    await h.hooks.get('turn_end')({ message: failedMessage }, h.ctx);
    await h.hooks.get('agent_before_settle')(errorBoundary(), h.ctx);
    await h.hooks.get('agent_settled')({ aborted: false }, h.ctx);
    assert.deepEqual(efforts, [], 'no effort change while no selected model can be applied');
    h.server.options.secondWhamUsedPercentPrimary = 10;
    await h.tick();
    assert.equal(h.ctx.model.id, 'second/gpt-6.1-sol');
    assert.deepEqual(efforts, ['low'], 'failover must use its own stored override, not the outgoing model effort');
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0][0].customType, 'supervisor-provider-recovery');
    assert.equal(h.sent[0][1].triggerTurn, true);
  } finally { await h.close(); }
});


test('effort enrichment: session replaced during subagent capability lookup never opens a stale panel', async () => {
  const h = host('tui', {}, { panelLib: fakeLib });
  try {
    updateSupervisorConfig(h.dir, { enabled: false });
    const path = resolveSupervisorConfigPath(h.dir);
    const before = readFileSync(path, 'utf8');
    const model = { provider: 'test', id: 'reasoner', reasoning: true };
    let trusted = true;
    let customCalls = 0;
    let finds = 0;
    h.ctx.isProjectTrusted = () => trusted;
    h.ctx.modelRegistry = {
      getAvailable: () => [model], getAll: () => [model],
      find: () => { if (++finds === 2) trusted = false; return model; },
    };
    h.ctx.ui.custom = async () => { customCalls++; };
    await h.commands.get('supervisor').handler('', h.ctx);
    assert.equal(finds, 2, 'both tab catalogues must be enriched');
    assert.equal(customCalls, 0, 'the context must be rechecked after the last await');
    assert.equal(readFileSync(path, 'utf8'), before);
    assert.equal(loadSubagentConfig(h.dir).source, 'default');
  } finally { await h.close(); }
});


test('effort overrides: a live panel Default edit applies at the next successful model switch without reload', async () => {
  const target = 'cliproxyapi/second/gpt-6.1-sol';
  const h = await quotaHost({ modelEfforts: { [target]: 'low' } });
  const efforts: string[] = [];
  h.pi.setThinkingLevel = (level: string) => { efforts.push(level); };
  try {
    h.ctx.modelRegistry.getAvailable = () => ROUTING_SLOTS.map(id => ({ provider: 'cliproxyapi', id: id.slice('cliproxyapi/'.length) }));
    const panel = await panelFor(h);
    assert.match(panelText(panel), /second\/gpt-6.1-sol \[low\]/);
    panelEnter(panel, 'slot:2', ['scope', ...rowsFor(h)]);
    for (const character of target) panel.handleInput(character);
    panel.handleInput('\r');
    assert.match(panelText(panel), /Select reasoning effort/);
    panel.handleInput('\r'); // Default: standalone host cannot prove explicit capabilities.
    assert.deepEqual(loadSupervisorConfig(h.dir).config.modelEfforts, {});
    assert.deepEqual(efforts, [], 'a panel save must not mutate the current model effort');
    await h.hooks.get('before_agent_start')({ messageType: 'user', prompt: 'authorized work' }, h.ctx);
    await h.hooks.get('turn_end')({ message: failedMessage }, h.ctx);
    await h.hooks.get('agent_before_settle')(errorBoundary(), h.ctx);
    await h.hooks.get('agent_settled')({ aborted: false }, h.ctx);
    h.server.options.secondWhamUsedPercentPrimary = 10;
    await h.tick();
    assert.equal(h.ctx.model.id, 'second/gpt-6.1-sol');
    assert.deepEqual(efforts, ['high'], 'the live runtime must use Default, not the obsolete low map');
  } finally { await h.close(); }
});

/**
 * Startup routing (S1, S2): replaces the former registry-only runtime fixture, whose failed
 * account discovery made startup routing skip the switch entirely. Here the second account
 * has headroom, so startup really switches and the effort line is exercised.
 */
for (const [name, modelEfforts, expected] of [
  ['no stored override keeps the former high default', undefined, 'high'],
  ['an explicit override for the switched-to model applies verbatim', { 'cliproxyapi/second/gpt-6.1-sol': 'low' }, 'low'],
  ['an override for another model never leaks onto the switched-to model', { 'cliproxyapi/main/gpt-6.1-sol': 'xhigh' }, 'high'],
] as const) {
  test(`effort startup: ${name}`, async () => {
    const h = await quotaHost(modelEfforts ? { modelEfforts } : {}, { secondWhamUsedPercentPrimary: 10 });
    try {
      assert.equal(h.ctx.model.id, 'second/gpt-6.1-sol', 'startup must switch to the account with headroom');
      assert.deepEqual(h.startupEfforts, [expected]);
    } finally { await h.close(); }
  });
}
