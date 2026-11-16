import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createController, statePath } from "./src/controller.ts";

type Pane = { pane_id: string; terminal_id: string };

async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), "pihud-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pane = "w1:p1";
  const socket = "/tmp/herdr.sock";
  const file = statePath(pane, socket, root);
  const calls: string[][] = [];
  const panes = new Map<string, Pane>([
    [pane, { pane_id: pane, terminal_id: "pi-term" }],
    ["w1:p9", { pane_id: "w1:p9", terminal_id: "unrelated" }],
  ]);
  const control = { failRun: false, failClose: false, failSnapshot: false, next: 2 };
  const exec = async (args: string[], _signal?: AbortSignal) => {
    calls.push(args);
    if (args[0] === "api") {
      if (control.failSnapshot) throw new Error("socket unavailable");
      return { result: { snapshot: { panes: [...panes.values()] } } };
    }
    if (args[1] === "split") {
      const id = `w1:p${control.next++}`;
      const created = { pane_id: id, terminal_id: `term-${id}` };
      panes.set(id, created);
      return { result: { pane: created } };
    }
    if (args[1] === "run" && control.failRun) throw new Error("run failed");
    if (args[1] === "close") {
      if (control.failClose) throw new Error("close failed");
      panes.delete(args[2]);
    }
    return { result: {} };
  };
  const options = { pane, socket, file, bin: "/tmp/a hud'bin", ratio: "0.80", exec };
  return {
    ...options,
    calls,
    panes,
    control,
    controller: createController(options),
  };
}

test("state is isolated by Pi pane and herdr socket", () => {
  assert.notEqual(statePath("w1:p1", "a"), statePath("w1:p2", "a"));
  assert.notEqual(statePath("w1:p1", "a"), statePath("w1:p1", "b"));
});

test("open never focuses, quotes commands, and is idempotent", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.controller.open("/tmp/cwd ' spaces"), "opened");
  const split = f.calls.find((c) => c[1] === "split")!;
  assert.ok(split.includes("--no-focus"));
  assert.ok(!split.includes("--focus"));
  assert.equal(split[2], f.pane);
  assert.equal(split[split.indexOf("--cwd") + 1], "/tmp/cwd ' spaces");
  assert.equal(split[split.indexOf("--ratio") + 1], "0.8");
  const run = f.calls.find((c) => c[1] === "run")!;
  assert.match(run[3], /^exec '/);
  assert.ok(run[3].includes("'\\''"));
  assert.match(run[3], /--pane 'w1:p1'/);
  assert.equal(await f.controller.open("/elsewhere"), "already-open");
  assert.equal(f.calls.filter((c) => c[1] === "split").length, 1);
  assert.ok(!f.calls.some((c) => c.includes("focus")));
  const state = JSON.parse(await readFile(f.file, "utf8"));
  assert.equal(state.visible, true);
  assert.equal(state.hudPane, "w1:p2");
});

test("close only touches the owned HUD and records a closed state", async (t) => {
  const f = await fixture(t);
  await f.controller.open("/tmp");
  assert.equal(await f.controller.close(), "closed");
  assert.ok(f.panes.has("w1:p9"));
  assert.ok(f.panes.has(f.pane));
  assert.equal(await f.controller.close(), "already-closed");
  const state = JSON.parse(await readFile(f.file, "utf8"));
  assert.equal(state.visible, false);
  assert.equal(state.hudPane, "");
});

test("closed state survives reload and blocks auto-open", async (t) => {
  const f = await fixture(t);
  await f.controller.open("/tmp");
  await f.controller.close();
  const reopened = createController(f);
  assert.equal((await reopened.status())?.visible, false);
  assert.equal(await reopened.close(), "already-closed");
  assert.equal(f.calls.filter((c) => c[1] === "split").length, 1);
});

test("stale state cannot close a reused terminal or Pi itself", async (t) => {
  const f = await fixture(t);
  await f.controller.open("/tmp");
  f.panes.get("w1:p2")!.terminal_id = "replacement";
  assert.equal(await f.controller.close(), "already-closed");
  assert.ok(f.panes.has("w1:p2"));

  await f.controller.open("/tmp");
  const state = JSON.parse(await readFile(f.file, "utf8"));
  state.hudPane = f.pane;
  state.terminalId = "pi-term";
  await writeFile(f.file, JSON.stringify(state));
  assert.equal(await f.controller.close(), "already-closed");
  assert.ok(f.panes.has(f.pane));
});

test("concurrent opens split once; a missing HUD reopens", async (t) => {
  const f = await fixture(t);
  await Promise.all([f.controller.open("/tmp"), f.controller.open("/tmp")]);
  assert.equal(f.calls.filter((c) => c[1] === "split").length, 1);
  f.panes.delete("w1:p2");
  assert.equal(await f.controller.open("/tmp"), "opened");
  assert.equal(f.calls.filter((c) => c[1] === "split").length, 2);
});

test("failed launch cleans up its own pane", async (t) => {
  const f = await fixture(t);
  f.control.failRun = true;
  await assert.rejects(f.controller.open("/tmp"), /run failed/);
  assert.ok(!f.panes.has("w1:p2"));
  assert.equal(await f.controller.status(), undefined);
});

test("failed close preserves ownership", async (t) => {
  const f = await fixture(t);
  await f.controller.open("/tmp");
  f.control.failClose = true;
  await assert.rejects(f.controller.close(), /close failed/);
  const state = JSON.parse(await readFile(f.file, "utf8"));
  assert.equal(state.hudPane, "w1:p2");
  assert.equal(state.visible, true);
});

test("transport failures never create panes", async (t) => {
  const f = await fixture(t);
  await f.controller.open("/tmp");
  f.control.failSnapshot = true;
  await assert.rejects(f.controller.open("/tmp"), /socket unavailable/);
  assert.equal(f.calls.filter((c) => c[1] === "split").length, 1);
});

test("invalid ratio aborts before splitting", async (t) => {
  const f = await fixture(t);
  await assert.rejects(createController({ ...f, ratio: "oops" }).open("/tmp"), /PIHUD_RATIO/);
  assert.equal(f.calls.filter((c) => c[1] === "split").length, 0);
});
