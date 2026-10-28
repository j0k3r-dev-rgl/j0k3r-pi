import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Node's native TS runner needs source mapping; Pi performs it via jiti at runtime.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL?.startsWith(new URL("../", import.meta.url).href)) {
      const source = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
      if (existsSync(fileURLToPath(source))) return nextResolve(source.href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { default: register } = await import("../index.ts");
const { GoogleTTSService } = await import("../src/tts-service.ts");
const { AudioPlayer } = await import("../src/audio-player.ts");

const finalMessage = (text = "Esta es la respuesta final.") => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: 123 });

function setup(t: any, mode = "tui") {
  const hooks = new Map<string, Function>();
  const commands = new Map<string, any>();
  const renderers = new Map<string, Function>();
  const entries: any[] = [];
  const notices: string[] = [];
  const synthesis = t.mock.method(GoogleTTSService.prototype, "synthesize", async () => Buffer.from("audio"));
  const playback = t.mock.method(AudioPlayer.prototype, "play", async () => {});
  const stop = t.mock.method(AudioPlayer.prototype, "stop", () => {});
  const pause = t.mock.method(AudioPlayer.prototype, "pause", () => true);
  const resume = t.mock.method(AudioPlayer.prototype, "resume", () => true);
  const ctx: any = {
    mode, hasUI: mode === "tui", sessionManager: { getBranch: () => entries },
    ui: { notify: (text: string) => notices.push(text), setStatus() {} },
  };
  const pi: any = {
    on: (name: string, handler: Function) => hooks.set(name, handler),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    registerEntryRenderer: (name: string, renderer: Function) => renderers.set(name, renderer),
    appendEntry: (customType: string, data: any) => entries.push({ id: String(entries.length), type: "custom", customType, data }),
  };
  register(pi);
  async function emit(name: string, event: any = {}) { return hooks.get(name)?.(event, ctx); }
  async function finish(message = finalMessage()) {
    entries.push({ id: String(entries.length), type: "message", message });
    await emit("agent_end", { messages: [message] });
    await emit("agent_settled", { aborted: false });
  }
  const command = (args: string) => commands.get("tts").handler(args, ctx);
  const cards = () => entries.filter(e => e.customType === "google-tts-audio");
  const render = (index = 0) => renderers.get("google-tts-audio")!(cards()[index], {}, { fg: (_color: string, text: string) => text });
  return { hooks, entries, renderers, ctx, synthesis, playback, stop, pause, resume, notices, emit, finish, command, cards, render };
}

test("model command reports Flash by default and rejects unknown models without generation", async t => {
  const s = setup(t);
  await s.command("model");
  assert.match(s.notices.at(-1)!, /gemini-3\.8-flash-tts/);
  await s.command("model pro");
  assert.match(s.notices.at(-1)!, /flash\|lite/);
  await s.command("model");
  assert.match(s.notices.at(-1)!, /gemini-3\.8-flash-tts/);
  assert.equal(s.synthesis.mock.callCount(), 0);
  assert.equal(s.playback.mock.callCount(), 0);
});

test("model selection applies to new generations and preserves cached audio", async t => {
  const s = setup(t);
  await s.command("model lite");
  assert.match(s.notices.at(-1)!, /gemini-3\.8-flash-lite-tts/);
  await s.command("model");
  assert.match(s.notices.at(-1)!, /gemini-3\.8-flash-lite-tts/);
  assert.equal(s.synthesis.mock.callCount(), 0);
  await s.finish();
  await s.command("generate 1");
  assert.equal(s.synthesis.mock.calls[0].arguments[3], "gemini-3.8-flash-lite-tts");
  await s.command("model FLASH");
  await s.command("generate 1");
  await s.command("play 1");
  assert.equal(s.synthesis.mock.callCount(), 1, "model changes must not discard generated audio");
  assert.equal(s.playback.mock.callCount(), 1);
  await s.finish();
  await s.command("generate 2");
  assert.equal(s.synthesis.mock.calls[1].arguments[3], "gemini-3.8-flash-tts");
  await s.command("");
  assert.match(s.notices.at(-1)!, /tts model/);
  await s.command("off");
  await s.command("model lite");
  await s.command("generate 2");
  assert.equal(s.synthesis.mock.callCount(), 2, "selecting a model must not enable disabled TTS");
});

test("final responses never synthesize or play automatically", async t => {
  const s = setup(t);
  await s.finish();
  assert.equal(s.synthesis.mock.callCount(), 0);
  assert.equal(s.playback.mock.callCount(), 0);
  assert.equal(s.cards().length, 1);
  assert.match(s.render().render(80)[0], /Generar audio/);
});

test("generation and playback are separate explicit actions and cached per message", async t => {
  const s = setup(t);
  await s.finish();
  await s.command("play 1");
  assert.equal(s.playback.mock.callCount(), 0);
  await s.command("generate 1");
  assert.equal(s.synthesis.mock.callCount(), 1);
  assert.equal(s.playback.mock.callCount(), 0);
  assert.match(s.render().render(80)[0], /Reproducir/);
  await s.command("play 1");
  await s.command("play 1");
  await s.command("generate 1");
  assert.equal(s.playback.mock.callCount(), 2);
  assert.equal(s.synthesis.mock.callCount(), 1);
  await s.finish(finalMessage("Otra respuesta distinta."));
  await s.command("generate 2");
  assert.equal(s.synthesis.mock.callCount(), 2);
  assert.match(s.synthesis.mock.calls[1].arguments[0], /Otra respuesta/);
});

test("off disables every synthesis path including speak and existing controls", async t => {
  const s = setup(t);
  await s.finish();
  const component = s.render();
  await s.command("off");
  await s.command("generate 1");
  await s.command("play 1");
  await s.command("speak prueba");
  component.handleMouse({ type: "click", button: "left", x: 2, y: 0 });
  assert.deepEqual(component.render(80), []);
  await s.finish(finalMessage("Respuesta mientras está apagado."));
  assert.equal(s.synthesis.mock.callCount(), 0);
  assert.equal(s.playback.mock.callCount(), 0);
  assert.equal(s.cards().length, 1);
  await s.command("on");
  assert.match(component.render(80)[0], /Generar audio/);
});

test("non-TUI subagent/SDK modes neither create controls nor generate audio", async t => {
  const s = setup(t, "rpc");
  for (const mode of ["rpc", "json", "print"]) {
    s.ctx.mode = mode;
    await s.finish();
    await s.command("on");
    await s.command("speak prueba");
    await s.command("generate 1");
  }
  assert.equal(s.synthesis.mock.callCount(), 0);
  assert.equal(s.playback.mock.callCount(), 0);
  assert.equal(s.cards().length, 0);
});

test("tool calls, errors, aborted and empty responses do not get audio controls", async t => {
  const s = setup(t);
  for (const message of [
    { ...finalMessage(), stopReason: "toolUse" },
    { ...finalMessage(), stopReason: "error" },
    { ...finalMessage(), stopReason: "aborted" },
    { ...finalMessage(), content: [{ type: "toolCall", name: "read" }] },
    finalMessage("```ts\nconst x = 1;\n```"),
  ]) await s.finish(message as any);
  assert.equal(s.cards().length, 0);
});

test("controls appear only on settlement and are not duplicated", async t => {
  const s = setup(t);
  s.entries.push({ id: "m", type: "message", message: finalMessage() });
  await s.emit("agent_end", { messages: [finalMessage()] });
  assert.equal(s.cards().length, 0);
  await s.emit("agent_settled", { aborted: true });
  assert.equal(s.cards().length, 0);
  await s.emit("agent_settled", { aborted: false });
  await s.emit("agent_settled", { aborted: false });
  assert.equal(s.cards().length, 1);
});

test("click generates once, shows progress, then requires another click to play", async t => {
  const s = setup(t);
  let resolve!: (buffer: Buffer) => void;
  s.synthesis.mock.mockImplementation(() => new Promise<Buffer>(done => { resolve = done; }));
  await s.finish();
  const component = s.render();
  const click = { type: "click", button: "left", x: 2, y: 0 };
  component.handleMouse({ ...click, x: 30 });
  component.handleMouse({ ...click, button: "right" });
  assert.equal(s.synthesis.mock.callCount(), 0);
  component.handleMouse(click);
  assert.match(component.render(80)[0], /Generando/);
  component.handleMouse(click);
  assert.equal(s.synthesis.mock.callCount(), 1);
  resolve(Buffer.from("audio"));
  await new Promise(done => setImmediate(done));
  assert.match(component.render(80)[0], /Reproducir/);
  assert.equal(s.playback.mock.callCount(), 0);
  component.handleMouse(click);
  await new Promise(done => setImmediate(done));
  assert.equal(s.playback.mock.callCount(), 1);
  for (const width of [0, 1, 5, 10, 80]) {
    component.invalidate();
    assert.ok(component.render(width).every((line: string) => Array.from(line).length <= width));
  }
});

test("failed generation can be retried without exposing provider errors", async t => {
  const s = setup(t);
  s.synthesis.mock.mockImplementationOnce(async () => { throw new Error("private provider details"); });
  await s.finish();
  await s.command("generate 1");
  assert.match(s.render().render(80)[0], /Generar audio/);
  assert.ok(s.notices.every(text => !text.includes("private")));
  await s.command("generate 1");
  assert.match(s.render().render(80)[0], /Reproducir/);
});

test("disable/shutdown discards late synthesis results and never starts playback", async t => {
  const s = setup(t);
  let resolve!: (buffer: Buffer) => void;
  s.synthesis.mock.mockImplementation(() => new Promise<Buffer>(done => { resolve = done; }));
  await s.finish();
  const pending = s.command("generate 1");
  await s.command("off");
  resolve(Buffer.from("audio"));
  await pending;
  await s.command("on");
  assert.match(s.render().render(80)[0], /Generar audio/);
  const pending2 = s.command("generate 1");
  await s.emit("session_shutdown");
  resolve(Buffer.from("audio"));
  await pending2;
  assert.equal(s.playback.mock.callCount(), 0);
});

test("playback failure notifies and allows replay without regenerating audio", async t => {
  const s = setup(t);
  s.playback.mock.mockImplementationOnce(async () => { throw new Error("write EPIPE"); });
  await s.finish();
  await s.command("generate 1");
  await s.command("play 1");
  assert.ok(s.notices.some(text => text.includes("No se pudo reproducir")));
  assert.match(s.render().render(80)[0], /Reproducir/);
  await s.command("play 1");
  assert.equal(s.playback.mock.callCount(), 2);
  assert.equal(s.synthesis.mock.callCount(), 1);
});

test("new prompts stop playback but preserve per-message generated audio", async t => {
  const s = setup(t);
  let resolve!: () => void;
  s.playback.mock.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
  await s.finish();
  await s.command("generate 1");
  const pending = s.command("play 1");
  assert.match(s.render().render(80)[0], /Pausar/);
  await s.emit("agent_start");
  resolve();
  await pending;
  assert.match(s.render().render(80)[0], /Reproducir/);
  assert.equal(s.synthesis.mock.callCount(), 1);
});

test("per-message buttons pause, continue and stop without generating or restarting audio", async t => {
  const s = setup(t);
  let resolve!: () => void;
  s.playback.mock.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
  await s.finish();
  await s.command("generate 1");
  const pending = s.command("play 1");
  const component = s.render();
  const click = { type: "click", button: "left", x: 2, y: 0 };
  assert.match(component.render(100)[0], /\[ Pausar \].*\[ Detener \]/);
  component.handleMouse(click);
  assert.equal(s.pause.mock.callCount(), 1);
  assert.match(component.render(100)[0], /\[ Continuar \]/);
  component.handleMouse(click);
  assert.equal(s.resume.mock.callCount(), 1);
  assert.match(component.render(100)[0], /\[ Pausar \]/);
  const line = component.render(100)[0];
  component.handleMouse({ ...click, x: line.indexOf("Detener") + 1 });
  assert.match(component.render(100)[0], /Reproducir/);
  resolve();
  await pending;
  assert.equal(s.playback.mock.callCount(), 1);
  assert.equal(s.synthesis.mock.callCount(), 1);
});

test("pause/resume commands target only the active message and stop works while paused", async t => {
  const s = setup(t);
  let resolve!: () => void;
  s.playback.mock.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
  await s.finish();
  await s.command("generate 1");
  await s.finish(finalMessage("Segunda respuesta."));
  await s.command("generate 2");
  const pending = s.command("play 1");
  await s.command("pause 2");
  assert.equal(s.pause.mock.callCount(), 0);
  await s.command("pause 1");
  await s.command("pause 1");
  assert.equal(s.pause.mock.callCount(), 1);
  assert.match(s.render(0).render(100)[0], /Continuar/);
  await s.command("stop 2");
  assert.match(s.render(0).render(100)[0], /Continuar/);
  await s.command("resume 1");
  assert.equal(s.resume.mock.callCount(), 1);
  await s.command("pause");
  assert.match(s.render(0).render(100)[0], /Continuar/);
  await s.command("stop");
  assert.match(s.render(0).render(100)[0], /Reproducir/);
  resolve();
  await pending;
});

test("switching from paused audio keeps the new playback safe from old completion", async t => {
  const s = setup(t);
  const completions: (() => void)[] = [];
  s.playback.mock.mockImplementation(() => new Promise<void>(done => completions.push(done)));
  await s.finish();
  await s.command("generate 1");
  await s.finish(finalMessage("Segunda respuesta."));
  await s.command("generate 2");
  const first = s.command("play 1");
  await s.command("pause 1");
  const second = s.command("play 2");
  assert.match(s.render(0).render(100)[0], /Reproducir/);
  assert.match(s.render(1).render(100)[0], /Pausar/);
  await s.command("pause 2");
  completions[0]();
  await first;
  assert.match(s.render(1).render(100)[0], /Continuar/);
  await s.command("stop 2");
  completions[1]();
  await second;
  assert.equal(s.synthesis.mock.callCount(), 2);
});

test("off and new prompt stop a paused message; failed signals do not change the label", async t => {
  const s = setup(t);
  let resolve!: () => void;
  s.playback.mock.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
  await s.finish();
  await s.command("generate 1");
  let pending = s.command("play 1");
  s.pause.mock.mockImplementationOnce(() => false);
  await s.command("pause 1");
  assert.match(s.render().render(100)[0], /Pausar/);
  await s.command("pause 1");
  s.resume.mock.mockImplementationOnce(() => false);
  await s.command("resume 1");
  assert.match(s.render().render(100)[0], /Continuar/);
  await s.emit("agent_start");
  assert.match(s.render().render(100)[0], /Reproducir/);
  resolve();
  await pending;
  pending = s.command("play 1");
  await s.command("pause 1");
  await s.command("off");
  const pauseCount = s.pause.mock.callCount();
  await s.command("pause 1");
  await s.command("resume 1");
  assert.equal(s.pause.mock.callCount(), pauseCount);
  resolve();
  await pending;
  await s.command("on");
  assert.match(s.render().render(100)[0], /Reproducir/);
});

test("cards outside the active branch are inert", async t => {
  const s = setup(t);
  await s.finish();
  const component = s.render();
  s.entries.splice(0);
  component.handleMouse({ type: "click", button: "left", x: 2, y: 0 });
  assert.deepEqual(component.render(80), []);
  assert.equal(s.synthesis.mock.callCount(), 0);
});
