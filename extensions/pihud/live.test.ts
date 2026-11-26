import { test } from "node:test";
import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pihud from "./index.ts";
import { livePath } from "./src/live.ts";
import { statePath } from "./src/controller.ts";
import { readPanels } from './src/panels.ts';

async function fixture(t: any, auto = "0") {
  const root = await mkdtemp(join(tmpdir(), "pihud-live-"));
  const env = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_SOCKET_PATH: "/tmp/herdr.sock", XDG_CACHE_HOME: root, PIHUD_AUTO: auto };
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  if (auto === "") delete process.env.PIHUD_AUTO;
  t.after(async () => {
    await dispatch('session_shutdown', { reason: 'reload' });
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });
  const handlers = new Map<string, Function[]>();
  async function dispatch(name: string, event: any = {}) {
    for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
  }
  const ctx = {
    mode: "tui", cwd: "/repo", model: { id: "selected", provider: "provider", contextWindow: 200000 },
    thinkingLevel: "high", isIdle: () => true,
    sessionManager: { getSessionFile: () => "/repo/session.jsonl", getSessionId: () => 'session-one', getBranch: (): any[] => [] },
    isProjectTrusted: () => true,
    getContextUsage: (): any => ({ tokens: 42000, contextWindow: 200000, percent: 21 }),
    ui: { notify: () => {} },
  };
  const calls: string[][] = [];
  const commands = new Map<string, any>();
  const control = { liveHud: false, failSnapshot: false };
  const events = new EventEmitter();
  pihud({ events: {
    on(name: string, handler: (...args: any[]) => void) { events.on(name, handler); return () => events.off(name, handler); },
    emit: events.emit.bind(events),
  }, exec: async (_command: string, args: string[]) => {
    calls.push(args);
    if (args[0] === 'api' && !control.failSnapshot) return { code: 0, stderr: '', stdout: JSON.stringify({ result: { snapshot: { panes: control.liveHud ? [{ pane_id: 'w1:p2', terminal_id: 'hud-terminal' }] : [] } } }) };
    // Stop before creating a real pane.
    return { code: 1, stderr: "test launch boundary", stdout: "" };
  }, on: (name: string, handler: Function) => handlers.set(name, [...(handlers.get(name) ?? []), handler]), registerCommand: (name: string, command: any) => commands.set(name, command) } as any);
  return {
    ctx,
    calls,
    events,
    control,
    command: (action: string) => commands.get('hud').handler(action, ctx),
    async opened() {
      control.liveHud = true;
      await mkdir(join(root, 'j0k3r-pihud'), { recursive: true });
      await writeFile(statePath('w1:p1', '/tmp/herdr.sock', join(root, 'j0k3r-pihud')), JSON.stringify({ piPane: 'w1:p1', hudPane: 'w1:p2', terminalId: 'hud-terminal', visible: true }));
    },
    async readLive() { return JSON.parse(await readFile(livePath("w1:p1", "/tmp/herdr.sock", join(root, "j0k3r-pihud")), "utf8")); },
    liveFile: livePath("w1:p1", "/tmp/herdr.sock", join(root, "j0k3r-pihud")),
    async closed() {
      await mkdir(join(root, "j0k3r-pihud"), { recursive: true });
      await writeFile(statePath("w1:p1", "/tmp/herdr.sock", join(root, "j0k3r-pihud")), JSON.stringify({ piPane: "w1:p1", hudPane: "", terminalId: "", visible: false }));
    },
    shutdown: () => dispatch("session_shutdown", { reason: "reload" }),
    async emit(name: string, event: any = {}) {
      await dispatch(name, event);
      return JSON.parse(await readFile(livePath("w1:p1", "/tmp/herdr.sock", join(root, "j0k3r-pihud")), "utf8"));
    },
  };
}

test("fresh Pi startup opens HUD despite an old closed state", async (t) => {
  const f = await fixture(t, "1");
  await f.closed();
  await f.emit("session_start", { reason: "startup" });
  assert.ok(f.calls.some((args) => args[1] === "split"), "old closed state must not disable a fresh startup");
});

test('presence hides footer only for the owned live HUD and restores after external close', async t => {
  const f = await fixture(t);
  const presence: boolean[] = [];
  f.events.on('pihud:presence:v1', value => presence.push(value.visible));
  await f.opened();
  await f.emit('session_start', { reason: 'startup' });
  assert.equal(presence.at(-1), true);
  let current: boolean | undefined;
  f.events.emit('pihud:presence:read:v1', { cwd: '/repo', sessionId: 'session-one', respond: (value: boolean) => { current = value; } });
  assert.equal(current, true);
  f.control.liveHud = false;
  await new Promise(resolve => setTimeout(resolve, 2150));
  assert.equal(presence.at(-1), false);
  await f.shutdown();
  assert.equal(f.events.listenerCount('pihud:presence:read:v1'), 0);
});

test('an already watched HUD republishes presence for a new Pi session', async t => {
  const f = await fixture(t);
  const presence: any[] = [];
  f.events.on('pihud:presence:v1', value => presence.push(value));
  await f.opened();
  await f.emit('session_start', { reason: 'startup' });
  f.ctx.sessionManager.getSessionId = () => 'session-two';
  await f.emit('session_start', { reason: 'switch' });
  assert.deepEqual(presence.at(-1), { cwd: '/repo', sessionId: 'session-two', visible: true });
});

test("reload still respects a manually closed HUD", async (t) => {
  const f = await fixture(t, "1");
  await f.closed();
  await f.emit("session_start", { reason: "reload" });
  assert.equal(f.calls.length, 0);
});

test("plain pi without PIHUD_AUTO never opens a HUD automatically", async (t) => {
  const f = await fixture(t, "");
  await f.emit("session_start", { reason: "startup" });
  assert.equal(f.calls.length, 0, "plain pi must not split a pane");
});

test("explicit auto-open opt-out prevents a fresh startup launch", async (t) => {
  const f = await fixture(t);
  await f.closed();
  await f.emit("session_start", { reason: "startup" });
  assert.equal(f.calls.length, 0);
});

test("session start publishes active identity and metrics even when auto-open is disabled", async (t) => {
  const f = await fixture(t);
  const live = await f.emit("session_start", { reason: "startup" });
  assert.equal(live.sessionPath, "/repo/session.jsonl");
  assert.equal(live.cwd, "/repo");
  assert.equal(live.model, "selected");
  assert.equal(live.provider, "provider");
  assert.equal(live.thinking, "high");
  assert.equal(live.context, 42000);
  assert.equal(live.limit, 200000);
  assert.equal(live.state, "idle");
});

test("tool and selection events retain session identity and lifecycle state", async (t) => {
  const f = await fixture(t);
  await f.emit("session_start", { reason: "startup" });
  f.ctx.isIdle = () => false;
  let live = await f.emit("tool_execution_start", { toolName: "bash", args: { command: "go test" } });
  assert.equal(live.detail, "go test");
  assert.equal(live.state, "working");
  f.ctx.model.id = "changed";
  live = await f.emit("model_select", { model: f.ctx.model });
  assert.equal(live.model, "changed");
  assert.equal(live.state, "working");
  assert.equal(live.sessionPath, "/repo/session.jsonl");
  live = await f.emit("ui_prompt_start", { title: "Confirm", kind: "confirm" });
  assert.equal(live.state, "waiting");
  f.ctx.isIdle = () => true;
  live = await f.emit("ui_prompt_end");
  assert.equal(live.state, "idle");
});

test("metrics match Pi active branch and effective context limit, not abandoned JSONL messages", async (t) => {
  const f = await fixture(t);
  f.ctx.sessionManager.getBranch = () => [
    { type: "message", message: { role: "assistant", usage: { input: 244, output: 24, cacheRead: 17280, cacheWrite: 0, cost: { total: 0.1 } } } },
  ];
  f.ctx.getContextUsage = () => ({ tokens: 17548, contextWindow: 272000, percent: 17548 / 272000 * 100 });
  const live = await f.emit("agent_settled");
  assert.equal(live.input, 244);
  assert.equal(live.output, 24);
  assert.equal(live.cacheRead, 17280);
  assert.equal(live.cost, 0.1);
  assert.equal(live.limit, 272000);
  assert.equal(live.percent, 17548 / 272000 * 100);
  f.ctx.getContextUsage = () => ({ tokens: null, contextWindow: 272000, percent: null });
  const compacted = await f.emit("session_compact");
  assert.equal(compacted.context, null);
  assert.equal(compacted.percent, null);
});

test("streaming updates publish current context without waiting for message_end", async (t) => {
  const f = await fixture(t);
  await f.emit("session_start", { reason: "startup" });
  f.ctx.getContextUsage = () => ({ tokens: 18000, contextWindow: 272000, percent: 18000 / 272000 * 100 });
  const live = await f.emit("message_update", { message: { role: "assistant" } });
  assert.equal(live.context, 18000);
  assert.equal(live.limit, 272000);
  assert.equal(live.tpsSource, undefined, "HUD must work without a theme publisher");
});

test("optional footer TPS is synchronized without replacing activity and unsubscribes on reload", async (t) => {
  const f = await fixture(t);
  await f.emit("session_start", { reason: "startup" });
  f.events.emit("j0k3r-theme:token-speed", "\\x1b[36m⚡ TPS: 57.6 tok/s\\x1b[0m");
  await f.shutdown();
  const live = await f.readLive();
  assert.equal(live.tps, 57.6);
  assert.equal(live.tpsSource, "pi");
  assert.equal(live.label, "listo");
  assert.equal(f.events.listenerCount("j0k3r-theme:token-speed"), 0);
});

test("a trailing TPS update is delivered even when the stream pauses", async (t) => {
  const f = await fixture(t);
  await f.emit("session_start", { reason: "startup" });
  f.ctx.isIdle = () => false;
  f.events.emit("j0k3r-theme:token-speed", "TPS: 20.0 tok/s");
  f.events.emit("j0k3r-theme:token-speed", "TPS: 42.0 tok/s");
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal((await f.readLive()).tps, 42, "last throttled event must not be dropped");
  await f.shutdown();
});

test('panel reads fail closed for untrusted contexts and isolate broken optional providers', () => {
  let calls = 0;
  const pi = { events: { emit: () => { calls++; throw new Error('provider failed'); } } } as any;
  const ctx = { mode: 'tui', cwd: '/repo', sessionManager: { getSessionId: () => 'one' }, isProjectTrusted: () => false };
  assert.ok(readPanels(pi, ctx as any).quota.error);
  assert.equal(calls, 0);
  ctx.isProjectTrusted = () => true;
  const panels = readPanels(pi, ctx as any);
  assert.equal(calls, 5);
  assert.ok(panels.quota.error?.includes('no disponible'));
});

test('todo bridge validates active UI-only data and rejects delayed replies', () => {
  const ctx = { mode: 'tui', cwd: '/repo', sessionManager: { getSessionId: () => 'one' }, isProjectTrusted: () => true };
  let delayed: any;
  let value: any = { lines: [], todo: { title: 'Ship', body: 'PRIVATE BODY', steps: [{ text: 'Tests', status: 'completed' }, { text: 'Code', status: 'open' }] } };
  const pi = { events: { emit(name: string, query: any) { if (name === 'pihud:todo:read:v1') { delayed = query; query.respond(value); } } } } as any;
  const panels = readPanels(pi, ctx as any) as any;
  assert.deepEqual(panels.todo, { lines: [], todo: { title: 'Ship', steps: [{ text: 'Tests', status: 'completed' }, { text: 'Code', status: 'open' }] } });
  delayed.respond({ lines: [], todo: { title: 'Late', steps: [] } });
  assert.equal(panels.todo.todo.title, 'Ship');
  for (const todo of [{ title: 'Broken', steps: [{ text: 'Bad', status: 'unknown' }] }, { title: 1, steps: [] }, { title: 'Bad', steps: 'bad' }]) {
    value = { lines: [], todo };
    assert.equal((readPanels(pi, ctx as any) as any).todo.todo, undefined);
  }
  value = { lines: [] };
  assert.equal((readPanels(pi, ctx as any) as any).todo.todo, undefined);
  ctx.mode = 'rpc';
  assert.equal((readPanels(pi, ctx as any) as any).todo.todo, undefined);
});

test('main bridge preserves metadata and structured quota without accepting delayed session replies', () => {
  const ctx = { mode: 'tui', cwd: '/repo', sessionManager: { getSessionId: () => 'one' }, isProjectTrusted: () => true };
  let delayed: any;
  const panels = readPanels({ events: { emit(name: string, query: any) {
    if (name === 'pihud:main:read:v1') { delayed = query; query.respond({ lines: [], dir: '~/repo', repo: 'repo', branch: 'main', modelQuota: '5h 70%' }); }
    if (name === 'pihud:quota:read:v1') query.respond({ lines: [], accounts: [{ id: 'one', provider: 'openai', name: 'account', plan: 'pro', summary: '', error: '', fiveHourPercent: 70, fiveHourCount: 1, pools: [] }] });
  } } } as any, ctx as any);
  assert.equal(panels.main.dir, '~/repo');
  assert.equal(panels.main.branch, 'main');
  assert.equal(panels.main.modelQuota, '5h 70%');
  assert.equal(panels.quota.accounts?.[0].fiveHourPercent, 70);
  ctx.sessionManager.getSessionId = () => 'two';
  delayed.respond({ lines: [], modelQuota: 'wrong session' });
  assert.equal(panels.main.modelQuota, '5h 70%');
});

test('optional panel bridges refresh while idle, bind session and stop on shutdown', async t => {
  const f = await fixture(t);
  let reads = 0;
  f.events.on('pihud:quota:read:v1', request => {
    assert.equal(request.cwd, '/repo');
    assert.equal(request.sessionId, 'session-one');
    reads++;
    request.respond({ lines: ['cached quota'], updatedAt: 'today' });
  });
  await f.emit('session_start', { reason: 'startup' });
  await new Promise(resolve => setTimeout(resolve, 780));
  const live = await f.readLive();
  assert.deepEqual(live.panels.quota.lines, ['cached quota']);
  assert.equal(live.sessionId, 'session-one');
  assert.ok(live.panels.mem.error.includes('no disponible'));
  const changed = await f.emit('model_select', { model: { id: 'new-model', provider: 'provider' } });
  assert.deepEqual(changed.panels.main, { lines: [] }, 'model changes must discard the previous model quota immediately');
  await f.shutdown();
  const stopped = reads;
  await new Promise(resolve => setTimeout(resolve, 730));
  assert.equal(reads, stopped);
});

test('branch navigation clears the previous checklist before the next provider read', async t => {
  const f = await fixture(t);
  f.events.on('pihud:todo:read:v1', query => query.respond({ lines: [], todo: { title: 'Old branch', steps: [{ text: 'old step', status: 'open' }] } }));
  await f.emit('session_start', { reason: 'startup' });
  await new Promise(resolve => setTimeout(resolve, 780));
  assert.equal((await f.readLive()).panels.todo.todo.title, 'Old branch');
  const live = await f.emit('session_tree');
  assert.deepEqual(live.panels.todo, { lines: [] });
});

test("reload drains writes and does not keep a previous session identity", async (t) => {
  const f = await fixture(t);
  await f.emit("session_start", { reason: "startup" });
  await f.shutdown();
  f.ctx.sessionManager.getSessionFile = () => "";
  f.ctx.getContextUsage = () => ({ tokens: 0 });
  const live = await f.emit("session_start", { reason: "reload" });
  assert.equal(live.sessionPath, "");
  assert.equal(live.context, 0);
});

async function settleIo() {
  await new Promise((resolve) => setTimeout(resolve, 40));
}

test("unchanged 700ms panel ticks skip .live.json rewrites while panel, lifecycle, selection, and metric changes publish immediately", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = await fixture(t);
  let quotaReads = 0;
  let quotaState: any = {
    lines: ["quota v1"],
    updatedAt: "2026-11-25T10:00:00Z",
    accounts: [{ id: "acc-1", provider: "openai", name: "main", plan: "pro", summary: "", error: "", fiveHourPercent: 80, fiveHourCount: 1, pools: [] }],
  };
  let todoState: any = { lines: [], todo: { title: "Plan", steps: [{ text: "Step 1", status: "open" }] } };
  let memState: any = { lines: ["#1 note"], header: ["e5 ok"] };
  let supState: any = { lines: ["sup idle"] };

  f.events.on("pihud:quota:read:v1", (q) => { quotaReads++; q.respond(quotaState); });
  f.events.on("pihud:todo:read:v1", (q) => q.respond(todoState));
  f.events.on("pihud:mem:read:v1", (q) => q.respond(memState));
  f.events.on("pihud:sup:read:v1", (q) => q.respond(supState));

  const initial = await f.emit("session_start", { reason: "startup" });
  assert.equal(initial.seq, 1);

  // First 700ms tick populates panels and writes once.
  t.mock.timers.tick(700);
  await settleIo();
  const afterFirstTick = await f.readLive();
  const firstStat = await stat(f.liveFile);
  assert.equal(quotaReads, 1);
  assert.equal(afterFirstTick.seq, 2);
  assert.deepEqual(afterFirstTick.panels.quota.lines, ["quota v1"]);

  // Subsequent 700ms ticks with identical bridge data (even with reordered object keys) must not rewrite .live.json.
  quotaState = {
    updatedAt: "2026-11-25T10:00:00Z",
    accounts: [{ pools: [], fiveHourCount: 1, fiveHourPercent: 80, error: "", summary: "", plan: "pro", name: "main", provider: "openai", id: "acc-1" }],
    lines: ["quota v1"],
  };
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(700);
    await settleIo();
  }
  const afterIdleTicks = await f.readLive();
  const idleStat = await stat(f.liveFile);
  assert.equal(quotaReads, 5, "panel bridge polling must remain active during idle");
  assert.equal(afterIdleTicks.seq, afterFirstTick.seq, "unchanged ticks must not advance seq");
  assert.equal(afterIdleTicks.at, afterFirstTick.at, "unchanged ticks must not update timestamp");
  assert.equal(idleStat.ino, firstStat.ino, "unchanged ticks must not rewrite or rename .live.json");

  // Changes in quota, todo, mem, and sup panels publish immediately on the next tick.
  quotaState = { ...quotaState, lines: ["quota v2"], updatedAt: "2026-11-25T10:00:30Z" };
  t.mock.timers.tick(700);
  await settleIo();
  let current = await f.readLive();
  assert.equal(current.seq, 3);
  assert.deepEqual(current.panels.quota.lines, ["quota v2"]);

  todoState = { lines: [], todo: { title: "Plan", steps: [{ text: "Step 1", status: "completed" }] } };
  t.mock.timers.tick(700);
  await settleIo();
  current = await f.readLive();
  assert.equal(current.seq, 4);
  assert.equal(current.panels.todo.todo.steps[0].status, "completed");

  memState = { lines: ["#1 note", "#2 new"], header: ["e5 ok"] };
  t.mock.timers.tick(700);
  await settleIo();
  current = await f.readLive();
  assert.equal(current.seq, 5);
  assert.deepEqual(current.panels.mem.lines, ["#1 note", "#2 new"]);

  supState = { lines: ["sup active"] };
  t.mock.timers.tick(700);
  await settleIo();
  current = await f.readLive();
  assert.equal(current.seq, 6);
  assert.deepEqual(current.panels.sup.lines, ["sup active"]);

  // Pi lifecycle event, model/thinking selection, and streaming metrics publish immediately with incremented seq.
  f.ctx.isIdle = () => false;
  current = await f.emit("tool_execution_start", { toolName: "read", args: { path: "README.md" } });
  assert.equal(current.seq, 7);
  assert.equal(current.detail, "README.md");

  f.ctx.model = { id: "model-v2", provider: "provider", contextWindow: 200000 };
  current = await f.emit("model_select", { model: f.ctx.model });
  assert.equal(current.seq, 8);
  assert.equal(current.model, "model-v2");

  f.ctx.thinkingLevel = "medium";
  current = await f.emit("thinking_level_select", { level: "medium" });
  assert.equal(current.seq, 9);
  assert.equal(current.thinking, "medium");

  f.ctx.getContextUsage = () => ({ tokens: 55000, contextWindow: 200000, percent: 27.5 });
  current = await f.emit("message_update", { message: { role: "assistant" } });
  assert.equal(current.seq, 10);
  assert.equal(current.context, 55000);
});

test("session_start and session_shutdown reset deduplication so fresh sessions always publish", async (t) => {
  const f = await fixture(t);
  const first = await f.emit("session_start", { reason: "startup" });
  assert.equal(first.seq, 1);

  // Another session_start with identical context/metrics still publishes a fresh snapshot.
  const second = await f.emit("session_start", { reason: "switch" });
  assert.equal(second.seq, 2);

  await f.shutdown();
  const third = await f.emit("session_start", { reason: "reload" });
  assert.equal(third.seq, 3);
});
