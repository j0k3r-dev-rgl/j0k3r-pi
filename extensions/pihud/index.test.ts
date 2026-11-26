import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pihud from "./index.ts";

type Pane = { pane_id: string; terminal_id: string };

async function setupEntrypoint(t: any, options: { auto?: string; mockIntervals?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pihud-index-"));
  const socketPath = join(root, "herdr.sock");
  const socketConnections: string[] = [];

  const server = net.createServer((conn) => {
    let buf = "";
    socketConnections.push("connected");
    conn.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      if (buf.includes("\n")) socketConnections.push(buf.trim());
    });
    conn.on("error", () => {});
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });

  if (options.mockIntervals) {
    t.mock.timers.enable({ apis: ["setInterval"] });
  }

  const env: Record<string, string | undefined> = {
    HERDR_ENV: "1",
    HERDR_PANE_ID: "w1:p1",
    HERDR_SOCKET_PATH: socketPath,
    XDG_CACHE_HOME: root,
    PIHUD_AUTO: options.auto ?? "0",
    PIHUD_BIN: "/tmp/pihud-bin",
  };
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const handlers = new Map<string, Function[]>();
  const commands = new Map<string, any>();
  const events = new EventEmitter();
  const notifications: Array<{ message: string; kind: string }> = [];
  const execCalls: string[][] = [];
  const panes = new Map<string, Pane>([
    ["w1:p1", { pane_id: "w1:p1", terminal_id: "pi-term" }],
    ["w1:p9", { pane_id: "w1:p9", terminal_id: "other-term" }],
  ]);
  const control = {
    nextPane: 2,
    failSnapshot: false,
    snapshotWaiter: undefined as (() => void) | undefined,
    snapshotEntered: undefined as (() => void) | undefined,
    snapshotCompleted: undefined as (() => void) | undefined,
    snapshotInFlight: 0,
    maxConcurrentSnapshots: 0,
  };

  const ctx = {
    mode: "tui",
    cwd: "/repo",
    model: { id: "model-a", provider: "provider-a", contextWindow: 100000 },
    thinkingLevel: "high",
    isIdle: () => true,
    isProjectTrusted: () => true,
    sessionManager: {
      getSessionFile: () => "/repo/session.jsonl",
      getSessionId: () => "session-1",
      getBranch: (): any[] => [],
    },
    getContextUsage: () => ({ tokens: 1000, contextWindow: 100000, percent: 1 }),
    ui: {
      notify: (message: string, kind = "info") => notifications.push({ message, kind }),
    },
  };

  async function dispatch(name: string, event: any = {}) {
    for (const handler of handlers.get(name) ?? []) {
      await handler(event, ctx);
    }
  }

  t.after(async () => {
    await dispatch("session_shutdown", { reason: "reload" });
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });

  const api = {
    events: {
      on(name: string, handler: (...args: any[]) => void) {
        events.on(name, handler);
        return () => events.off(name, handler);
      },
      emit: events.emit.bind(events),
    },
    exec: async (_command: string, args: string[]) => {
      execCalls.push(args);
      if (args[0] === "api" && args[1] === "snapshot") {
        control.snapshotInFlight += 1;
        control.maxConcurrentSnapshots = Math.max(control.maxConcurrentSnapshots, control.snapshotInFlight);
        try {
          control.snapshotEntered?.();
          if (control.snapshotWaiter) {
            await new Promise<void>((resolve) => {
              const prev = control.snapshotWaiter;
              control.snapshotWaiter = () => {
                prev?.();
                resolve();
              };
            });
          }
          if (control.failSnapshot) {
            return { code: 1, stderr: "transient socket failure", stdout: "" };
          }
          return {
            code: 0,
            stderr: "",
            stdout: JSON.stringify({ result: { snapshot: { panes: [...panes.values()] } } }),
          };
        } finally {
          control.snapshotInFlight -= 1;
          control.snapshotCompleted?.();
        }
      }
      if (args[0] === "pane" && args[1] === "split") {
        const id = `w1:p${control.nextPane++}`;
        const created = { pane_id: id, terminal_id: `hud-term-${id}` };
        panes.set(id, created);
        return { code: 0, stderr: "", stdout: JSON.stringify({ result: { pane: created } }) };
      }
      if (args[0] === "pane" && args[1] === "run") {
        return { code: 0, stderr: "", stdout: JSON.stringify({ result: {} }) };
      }
      if (args[0] === "pane" && args[1] === "close") {
        panes.delete(args[2]);
        return { code: 0, stderr: "", stdout: JSON.stringify({ result: {} }) };
      }
      return { code: 1, stderr: `unexpected command: ${args.join(" ")}`, stdout: "" };
    },
    on(name: string, handler: Function) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
  };

  pihud(api as any);

  return {
    ctx,
    events,
    panes,
    control,
    execCalls,
    notifications,
    socketConnections,
    command: (args: string) => commands.get("hud").handler(args, ctx),
    dispatch,
  };
}

test("opening and reusing HUD publishes presence without starting any focus-guard socket subscription", async (t) => {
  const f = await setupEntrypoint(t);
  const presence: boolean[] = [];
  f.events.on("pihud:presence:v1", (payload) => presence.push(payload.visible));

  await f.command("open");
  await f.command("open");
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(presence.at(-1), true);
  assert.deepEqual(f.socketConnections, [], "extension must never subscribe to pane.focused or emit pane.focus");
  assert.ok(!f.execCalls.some((args) => args.includes("focus")), "extension must not invoke herdr focus commands");
});

async function waitForPoll(control: { snapshotCompleted?: () => void }, trigger: () => void) {
  await new Promise<void>((resolve) => {
    control.snapshotCompleted = () => {
      control.snapshotCompleted = undefined;
      resolve();
    };
    trigger();
  });
  await new Promise((resolve) => setImmediate(resolve));
}

test("presence monitor polls every 2s without overlap, tolerates transient failures, and detects external close/reuse", async (t) => {
  const f = await setupEntrypoint(t, { mockIntervals: true });
  const presence: boolean[] = [];
  f.events.on("pihud:presence:v1", (payload) => presence.push(payload.visible));

  await f.command("open");
  // Reusing an already-open HUD must retain the single presence monitor (no duplicate intervals).
  await f.command("open");
  assert.equal(presence.at(-1), true);
  const baselineSnapshots = f.execCalls.filter((args) => args[0] === "api").length;

  // Transient failure must not report the HUD as closed.
  f.control.failSnapshot = true;
  await waitForPoll(f.control, () => t.mock.timers.tick(2000));
  assert.equal(presence.at(-1), true);
  assert.equal(f.execCalls.filter((args) => args[0] === "api").length, baselineSnapshots + 1);

  // Non-overlap guard: while a poll is in flight, additional 2s ticks do not start a second poll.
  f.control.failSnapshot = false;
  const snapshotBeforeHold = f.execCalls.filter((args) => args[0] === "api").length;
  const entered = new Promise<void>((resolve) => {
    f.control.snapshotEntered = () => {
      f.control.snapshotEntered = undefined;
      resolve();
    };
  });
  f.control.snapshotWaiter = () => {};
  t.mock.timers.tick(2000);
  await entered;
  const releasePending = f.control.snapshotWaiter;
  t.mock.timers.tick(2000);
  t.mock.timers.tick(2000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.execCalls.filter((args) => args[0] === "api").length, snapshotBeforeHold + 1);
  assert.equal(f.control.maxConcurrentSnapshots, 1);
  f.control.snapshotWaiter = undefined;
  await waitForPoll(f.control, () => releasePending?.());
  assert.equal(presence.at(-1), true);

  // Reused terminal ID is detected as external close and disposes the monitor.
  f.panes.get("w1:p2")!.terminal_id = "reused-terminal";
  await waitForPoll(f.control, () => t.mock.timers.tick(2000));
  assert.equal(presence.at(-1), false);

  const snapshotsAfterClose = f.execCalls.filter((args) => args[0] === "api").length;
  t.mock.timers.tick(6000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.execCalls.filter((args) => args[0] === "api").length, snapshotsAfterClose, "monitor must stop after external close");
  assert.deepEqual(f.socketConnections, []);
});

test("/hud close and session_shutdown dispose monitoring; quit closes only owned HUD while reload/new/resume keep it", async (t) => {
  const f = await setupEntrypoint(t, { mockIntervals: true });
  const presence: boolean[] = [];
  f.events.on("pihud:presence:v1", (payload) => presence.push(payload.visible));

  await f.command("open");
  assert.ok(f.panes.has("w1:p2"));
  assert.equal(presence.at(-1), true);

  // /hud close stops polling and closes only the owned HUD pane.
  await f.command("close");
  assert.equal(presence.at(-1), false);
  assert.ok(!f.panes.has("w1:p2"));
  assert.ok(f.panes.has("w1:p1"));
  assert.ok(f.panes.has("w1:p9"));

  const snapshotsAfterManualClose = f.execCalls.filter((args) => args[0] === "api").length;
  t.mock.timers.tick(6000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.execCalls.filter((args) => args[0] === "api").length, snapshotsAfterManualClose);

  // Reopen, then reload/new/resume preserve HUD and republish presence without focus guard.
  await f.command("open");
  assert.ok(f.panes.has("w1:p3"));
  for (const reason of ["reload", "new", "resume"]) {
    await f.dispatch("session_shutdown", { reason });
    assert.equal(presence.at(-1), false);
    assert.ok(f.panes.has("w1:p3"), `${reason} must not close the HUD pane`);
    await f.dispatch("session_start", { reason });
    assert.equal(presence.at(-1), true);
  }

  // Quit closes only the owned HUD pane and leaves Pi and unrelated panes untouched.
  await f.dispatch("session_shutdown", { reason: "quit" });
  assert.ok(!f.panes.has("w1:p3"), "quit must close the owned HUD pane");
  assert.ok(f.panes.has("w1:p1"), "quit must never close Pi");
  assert.ok(f.panes.has("w1:p9"), "quit must never close unrelated panes");
  assert.deepEqual(f.socketConnections, []);
});
