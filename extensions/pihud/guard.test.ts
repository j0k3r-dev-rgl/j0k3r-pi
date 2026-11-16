import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createFocusGuard } from "./src/guard.ts";

class FakeSocket extends EventEmitter {
  written: string[] = [];
  destroyed = false;
  write(data: string) {
    this.written.push(data);
    return true;
  }
  destroy() {
    this.destroyed = true;
    this.emit("close");
  }
  send(line: unknown) {
    this.emit("data", Buffer.from(`${JSON.stringify(line)}\n`));
  }
}

function harness(overrides: Record<string, unknown> = {}) {
  const sockets: FakeSocket[] = [];
  const connect = () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  };
  const options = {
    piPane: "w1:p1",
    hudPane: "w1:p2",
    socket: "/tmp/herdr.sock",
    connect,
    retryMinMs: 10,
    retryMaxMs: 20,
    dedupeMs: 50,
    ...overrides,
  };
  let clock = 1000;
  const guard = createFocusGuard({ ...options, now: () => (clock += 10) });
  const open = () => {
    guard.start();
    const subscription = sockets[sockets.length - 1];
    subscription.emit("connect");
    subscription.send({ id: "sub", result: { type: "subscription_started" } });
    return subscription;
  };
  return { guard, sockets, open };
}

test("subscribes to the HUD focus events after start", () => {
  const h = harness();
  const socket = h.open();
  const request = JSON.parse(socket.written[0]);
  assert.equal(request.method, "events.subscribe");
  assert.deepEqual(request.params.subscriptions, [{ type: "pane.focused", pane_id: "w1:p2" }]);
  assert.equal(h.guard.active, true);
});

test("returns focus to Pi when the HUD receives it", () => {
  const h = harness();
  const socket = h.open();
  socket.send({ event: "pane_focused", data: { type: "pane_focused", pane_id: "w1:p2" } });
  const correction = h.sockets.find((candidate) => candidate !== socket)!;
  correction.emit("connect");
  const request = JSON.parse(correction.written[0]);
  assert.equal(request.method, "pane.focus");
  assert.deepEqual(request.params, { pane_id: "w1:p1" });
  assert.equal(h.guard.corrections, 1);
});

test("ignores focus changes for Pi and unrelated panes", () => {
  const h = harness();
  const socket = h.open();
  socket.send({ event: "pane_focused", data: { pane_id: "w1:p1" } });
  socket.send({ event: "pane_focused", data: { pane_id: "w1:p9" } });
  assert.equal(h.sockets.length, 1);
  assert.equal(h.guard.corrections, 0);
});

test("deduplicates rapid corrections but still corrects later clicks", () => {
  const h = harness({ dedupeMs: 15 });
  const socket = h.open();
  socket.send({ event: "pane_focused", data: { pane_id: "w1:p2" } });
  socket.send({ event: "pane_focused", data: { pane_id: "w1:p2" } });
  assert.equal(h.guard.corrections, 1);
  socket.send({ event: "pane_focused", data: { pane_id: "w1:p2" } });
  assert.equal(h.guard.corrections, 2);
});

test("resubscribes after the connection drops", async () => {
  const h = harness({ retryMinMs: 5, retryMaxMs: 5 });
  const socket = h.open();
  socket.destroy();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(h.sockets.length, 2);
  h.guard.stop();
});

test("stop closes the subscription and blocks corrections", async () => {
  const h = harness({ retryMinMs: 5, retryMaxMs: 5 });
  const socket = h.open();
  h.guard.stop();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(socket.destroyed, true);
  assert.equal(h.sockets.length, 1);
  assert.equal(h.guard.active, false);
});
