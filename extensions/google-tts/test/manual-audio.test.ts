import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Node's TS runner maps .js to source; map Pi's bundled TUI through the installed host.
const piPackage = process.env.PI_PACKAGE_DIR ?? resolve(process.execPath, "../../lib/node_modules/@earendil-works/pi-coding-agent");
const hostRequire = createRequire(join(realpathSync(piPackage), "dist/bundle/cli.js"));
const tuiUrl = pathToFileURL(hostRequire.resolve("@earendil-works/pi-tui")).href;
const agentUrl = pathToFileURL(join(realpathSync(piPackage), "dist/index.js")).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@earendil-works/pi-tui") return nextResolve(tuiUrl, context);
    if (specifier === "@earendil-works/pi-coding-agent") return nextResolve(agentUrl, context);
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
const { defaultPreferences } = await import("../src/config.ts");
const { SettingsModal } = await import("../src/settings-modal.ts");
const { CURSOR_MARKER, visibleWidth } = await import(tuiUrl);

const finalMessage = (text = "Esta es la respuesta final.") => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: 123 });

function setup(t: any, mode = "tui") {
  const hooks = new Map<string, Function>();
  const commands = new Map<string, any>();
  const renderers = new Map<string, Function>();
  const entries: any[] = [];
  const notices: string[] = [];
  const synthesis = t.mock.method(GoogleTTSService.prototype, "stream", async function* () { yield Buffer.from([1, 2]); });
  const streaming = t.mock.method(AudioPlayer.prototype, "playStream", async (chunks: AsyncIterable<Buffer>) => { for await (const _ of chunks) {} });
  const playback = t.mock.method(AudioPlayer.prototype, "play", async () => {});
  const stop = t.mock.method(AudioPlayer.prototype, "stop", () => {});
  const pause = t.mock.method(AudioPlayer.prototype, "pause", () => true);
  const resume = t.mock.method(AudioPlayer.prototype, "resume", () => true);
  const root = mkdtempSync(join(tmpdir(), "pi-tts-manual-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(() => { if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgentDir; });
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
  return { root, hooks, entries, renderers, ctx, synthesis, streaming, playback, stop, pause, resume, notices, emit, finish, command, cards, render };
}

test("model command reports Flash-Lite by default and rejects unknown models without generation", async t => {
  const s = setup(t);
  await s.command("model");
  assert.match(s.notices.at(-1)!, /gemini-3\.8-flash-lite-tts/);
  await s.command("model pro");
  assert.match(s.notices.at(-1)!, /flash\|lite/);
  await s.command("model");
  assert.match(s.notices.at(-1)!, /gemini-3\.8-flash-lite-tts/);
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
  await s.command("stream 1");
  assert.equal(s.synthesis.mock.calls[0].arguments[3], "gemini-3.8-flash-lite-tts");
  await s.command("model FLASH");
  await s.command("stream 1");
  await s.command("play 1");
  assert.equal(s.synthesis.mock.callCount(), 1, "model changes must not discard generated audio");
  assert.equal(s.playback.mock.callCount(), 1);
  await s.finish();
  await s.command("stream 2");
  assert.equal(s.synthesis.mock.calls[1].arguments[3], "gemini-3.8-flash-tts");
  await s.command("");
  assert.match(s.notices.at(-1)!, /tts model/);
  await s.command("off");
  await s.command("model lite");
  await s.command("stream 2");
  assert.equal(s.synthesis.mock.callCount(), 2, "selecting a model must not enable disabled TTS");
});

test("final responses never synthesize or play automatically", async t => {
  const s = setup(t);
  await s.finish();
  assert.equal(s.synthesis.mock.callCount(), 0);
  assert.equal(s.playback.mock.callCount(), 0);
  assert.equal(s.cards().length, 1);
  assert.match(s.render().render(80)[0], /Generar y escuchar/);
});

test("stream is the only generation command and initial button", async t => {
  const s = setup(t);
  await s.finish();
  const line = s.render().render(120)[0];
  assert.match(line, /Generar y escuchar/);
  assert.match(line, /\/tts stream 1/);
  assert.doesNotMatch(line, /Generar audio/);
  await s.command("generate 1");
  assert.equal(s.synthesis.mock.callCount(), 0);
  await s.command("");
  assert.doesNotMatch(s.notices.at(-1)!, /\/tts generate/);
});

test("stream playback starts before generation ends and caches complete PCM for replay", async t => {
  const s = setup(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let first!: () => void;
  const received = new Promise<void>(resolve => { first = resolve; });
  s.synthesis.mock.mockImplementation(async function* () {
    yield Buffer.from([1, 2]); await gate; yield Buffer.from([3, 4]);
  });
  const stream = s.synthesis;
  s.streaming.mock.mockImplementation(async (chunks: AsyncIterable<Buffer>) => {
    for await (const _chunk of chunks) first();
  });
  await s.finish();
  const pending = s.command("stream 1");
  await received;
  assert.match(s.render().render(120)[0], /Pausar/);
  release(); await pending;
  assert.match(s.render().render(120)[0], /Reproducir/);
  await s.command("play 1");
  const audio = s.playback.mock.calls[0].arguments[0] as Buffer;
  assert.equal(audio.toString("ascii", 0, 4), "RIFF");
  assert.deepEqual(audio.subarray(44), Buffer.from([1, 2, 3, 4]));
  assert.equal(stream.mock.callCount(), 1);
});

test("stop cancels an incomplete stream and discards its audio", async t => {
  const s = setup(t);
  let signal!: AbortSignal;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  s.synthesis.mock.mockImplementation(async function* (_text: string, _voice: string, _style: string, _model: string, _location: string, passedSignal: AbortSignal) {
    signal = passedSignal; yield Buffer.from([1, 2]);
    await new Promise<void>(resolve => { started(); signal.addEventListener("abort", () => resolve(), { once: true }); });
    signal.throwIfAborted();
  });
  s.streaming.mock.mockImplementation(async (chunks: AsyncIterable<Buffer>) => { for await (const _ of chunks) {} });
  await s.finish();
  const pending = s.command("stream 1");
  await ready; await s.command("stop 1"); await pending;
  assert.equal(signal.aborted, true);
  assert.match(s.render().render(120)[0], /Generar y escuchar/);
  await s.command("play 1");
  assert.equal(s.playback.mock.callCount(), 0);
});

test("streaming caches each response for repeat playback", async t => {
  const s = setup(t);
  await s.finish();
  await s.command("play 1");
  assert.equal(s.playback.mock.callCount(), 0);
  await s.command("stream 1");
  await s.command("play 1");
  await s.command("play 1");
  assert.equal(s.playback.mock.callCount(), 2);
  assert.equal(s.synthesis.mock.callCount(), 1);
  await s.finish(finalMessage("Otra respuesta distinta."));
  await s.command("stream 2");
  assert.equal(s.synthesis.mock.callCount(), 2);
});

test("off disables every synthesis path including speak and existing controls", async t => {
  const s = setup(t);
  await s.finish();
  const component = s.render();
  await s.command("off");
  await s.command("stream 1");
  await s.command("play 1");
  await s.command("speak prueba");
  component.handleMouse({ type: "click", button: "left", x: 2, y: 0 });
  assert.deepEqual(component.render(80), []);
  await s.finish(finalMessage("Respuesta mientras está apagado."));
  assert.equal(s.synthesis.mock.callCount(), 0);
  assert.equal(s.playback.mock.callCount(), 0);
  assert.equal(s.cards().length, 1);
  await s.command("on");
  assert.match(component.render(80)[0], /Generar y escuchar/);
});

test("non-TUI subagent/SDK modes neither create controls nor generate audio", async t => {
  const s = setup(t, "rpc");
  for (const mode of ["rpc", "json", "print"]) {
    s.ctx.mode = mode;
    await s.finish();
    await s.command("on");
    await s.command("speak prueba");
    await s.command("stream 1");
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

test("stream button starts synthesis and playback and supports retry after failure", async t => {
  const s = setup(t);
  s.synthesis.mock.mockImplementationOnce(async function* () { throw new Error("private provider details"); });
  await s.finish();
  const component = s.render();
  component.handleMouse({ type: "click", button: "left", x: 2, y: 0 });
  await new Promise(done => setImmediate(done));
  assert.match(component.render(80)[0], /Generar y escuchar/);
  assert.ok(s.notices.every(text => !text.includes("private")));
  component.handleMouse({ type: "click", button: "left", x: 2, y: 0 });
  await new Promise(done => setImmediate(done));
  assert.match(component.render(80)[0], /Reproducir/);
  for (const width of [0, 1, 5, 10, 80]) {
    component.invalidate();
    assert.ok(component.render(width).every((line: string) => Array.from(line).length <= width));
  }
});

test("playback failure notifies and allows replay without regenerating audio", async t => {
  const s = setup(t);
  s.playback.mock.mockImplementationOnce(async () => { throw new Error("write EPIPE"); });
  await s.finish();
  await s.command("stream 1");
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
  await s.command("stream 1");
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
  await s.command("stream 1");
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
  await s.command("stream 1");
  await s.finish(finalMessage("Segunda respuesta."));
  await s.command("stream 2");
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
  await s.command("stream 1");
  await s.finish(finalMessage("Segunda respuesta."));
  await s.command("stream 2");
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
  await s.command("stream 1");
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

test("auto-read generates only final settled responses when enabled and preserves manual mode", async t => {
  const s = setup(t);
  await s.finish();
  assert.equal(s.streaming.mock.callCount(), 0);
  assert.match(s.render().render(100)[0], /Generar y escuchar/);

  const { savePreferences, defaultConfig } = await import("../src/config.ts") as any;
  savePreferences(join(s.root, "google-tts", "settings.json"), { config: defaultConfig, autoRead: true, devices: [], output: null });
  // A fresh extension instance models a new Pi session.
  const hooks = new Map<string, Function>();
  const commands = new Map<string, any>();
  const renderers = new Map<string, Function>();
  const entries: any[] = [];
  const pi: any = { on: (n: string, h: Function) => hooks.set(n, h), registerCommand: (n: string, c: any) => commands.set(n, c), registerEntryRenderer: (n: string, r: Function) => renderers.set(n, r), appendEntry: (customType: string, data: any) => entries.push({ id: String(entries.length), type: "custom", customType, data }) };
  const ctx = { ...s.ctx, sessionManager: { getBranch: () => entries } };
  register(pi);
  hooks.get("session_start")!({}, ctx);
  entries.push({ id: "a", type: "message", message: finalMessage("Respuesta automática.") });
  hooks.get("agent_settled")!({ aborted: false }, ctx);
  await new Promise(done => setImmediate(done));
  assert.equal(s.streaming.mock.callCount(), 1);
  assert.equal(s.synthesis.mock.callCount(), 1);
  hooks.get("agent_settled")!({ aborted: false }, ctx);
  await new Promise(done => setImmediate(done));
  assert.equal(s.streaming.mock.callCount(), 1, "duplicate settlement must not replay");
  entries.push({ id: "b", type: "message", message: finalMessage("Respuesta abortada.") });
  hooks.get("agent_settled")!({ aborted: true }, ctx);
  await new Promise(done => setImmediate(done));
  assert.equal(s.streaming.mock.callCount(), 1);
  await commands.get("tts").handler("off", ctx);
  entries.push({ id: "c", type: "message", message: finalMessage("Respuesta con TTS apagado.") });
  hooks.get("agent_settled")!({ aborted: false }, ctx);
  await new Promise(done => setImmediate(done));
  assert.equal(s.streaming.mock.callCount(), 1);
});

test("voice catalog opens on demand, searches, navigates pages and saves the selected ID", async () => {
  const theme: any = { fg: (_name: string, text: string) => text, style: (text: string) => text };
  const tui: any = { terminal: { rows: 24 }, requestRender() {} };
  const calls: any[] = [];
  const listVoices = async (options: any, signal: AbortSignal) => {
    calls.push({ options, signal });
    if (options.search) return { voices: [{ id: "voice_spanish", displayName: "Spanish speaker", languageCode: "es-419", accent: "Argentina Spanish", description: "Natural" }] };
    if (options.pageToken) return { voices: [{ id: "voice_2", displayName: "Segunda voz", languageCode: "es-419", accent: "Argentina Spanish" }] };
    return { voices: [{ id: "voice_1", displayName: "Primera voz", languageCode: "es-419", accent: "Argentina Spanish", gender: "female" }], nextPageToken: "next" };
  };
  let result: any;
  const panel = new SettingsModal(tui, theme, defaultPreferences(), value => { result = value; }, listVoices);
  panel.focused = true;
  assert.equal(calls.length, 0, "opening settings alone must not query Google");
  const down = () => panel.handleInput("\u001b[B");
  const enter = () => panel.handleInput("\r");
  const rendered = () => panel.render(72).join("\n");
  const settle = () => new Promise(done => setImmediate(done));
  for (let i = 0; i < 3; i++) down(); enter(); // voice
  await settle();
  assert.equal(calls.length, 1);
  assert.match(rendered(), /Voces argentinas/);
  assert.match(rendered(), /Primera voz/);
  assert.match(rendered(), /Siguiente página/);
  for (let i = 0; i < 3; i++) down(); enter(); // next page
  await settle();
  assert.equal(calls[1].options.pageToken, "next");
  assert.match(rendered(), /Segunda voz/);
  assert.match(rendered(), /anterior/i);
  for (let i = 0; i < 3; i++) down(); enter(); // back to first page
  await settle();
  assert.equal(calls.at(-1).options.pageToken, undefined);
  assert.match(rendered(), /Primera voz/);
  // The first entry is search on the new page.
  enter();
  panel.handleInput("\u001b[200~Spanish\u001b[201~"); enter();
  await settle();
  assert.equal(calls.at(-1).options.search, "Spanish");
  assert.equal(calls.at(-1).options.pageToken, undefined);
  assert.match(rendered(), /Spanish speaker/);
  assert.match(rendered(), /es-419/);
  down(); down(); enter(); // select search result
  for (let i = 0; i < 6; i++) down(); enter(); // save main
  assert.equal(result.config.voice, "voice_spanish");
});

test("voice selector uses available height and keeps the selected item visible after resize", async () => {
  const theme: any = { fg: (_name: string, text: string) => text, style: (text: string) => text };
  const tui: any = { terminal: { rows: 24 }, requestRender() {} };
  const voices = Array.from({ length: 40 }, (_, i) => ({ id: `voice-${i + 1}`, displayName: `Voice ${i + 1}`, languageCode: "es-419" }));
  const panel = new SettingsModal(tui, theme, defaultPreferences(), () => {}, async () => ({ voices }));
  for (let i = 0; i < 3; i++) panel.handleInput("\u001b[B");
  panel.handleInput("\r");
  await new Promise(done => setImmediate(done));
  let lines = panel.render(72);
  assert.ok(lines.filter(line => /Voice \d/.test(line)).length >= 12, "a 24-row terminal should show more than nine choices");
  assert.ok(lines.length <= 22);
  assert.match(lines.join("\n"), /↑↓ navegar/);

  tui.terminal.rows = 40;
  lines = panel.render(72);
  assert.ok(lines.filter(line => /Voice \d/.test(line)).length >= 25, "a larger terminal should show more voices");
  assert.ok(lines.length <= 38);
  for (let i = 0; i < 22; i++) panel.handleInput("\u001b[B");
  assert.match(panel.render(72).join("\n"), /→.*Voice 21/);

  tui.terminal.rows = 12;
  lines = panel.render(72);
  assert.ok(lines.length <= 10);
  assert.ok(lines.every(line => visibleWidth(line) <= 72));
  assert.match(lines.join("\n"), /→.*Voice 21/);
  assert.match(lines.join("\n"), /↑↓ navegar/);
  assert.match(lines.at(-1)!, /╰/);
});

test("configured voice command opens catalog guidance without old hardcoded voices", async t => {
  const s = setup(t);
  await s.command("voice");
  assert.match(s.notices.at(-1)!, /\/tts config.*Voz/);
  assert.doesNotMatch(s.notices.at(-1)!, /Fenrir|Puck|Charon|Aoede/);
  await s.command("voice voice_custom123");
  const { loadPreferences } = await import("../src/config.ts");
  assert.equal(loadPreferences(join(s.root, "google-tts", "settings.json")).config.voice, "voice_custom123");
  assert.equal(s.synthesis.mock.callCount(), 0);
});

test("cancelling a loading voice catalog aborts the request and ignores its late result", async () => {
  const theme: any = { fg: (_name: string, text: string) => text, style: (text: string) => text };
  const tui: any = { terminal: { rows: 24 }, requestRender() {} };
  let signal!: AbortSignal;
  let finish!: (value: any) => void;
  const service = (_options: any, value: AbortSignal) => { signal = value; return new Promise(resolve => { finish = resolve; }); };
  const panel = new SettingsModal(tui, theme, defaultPreferences(), () => {}, service);
  for (let i = 0; i < 3; i++) panel.handleInput("\u001b[B");
  panel.handleInput("\r");
  assert.match(panel.render(72).join("\n"), /Cargando/i);
  panel.handleInput("\u001b");
  assert.equal(signal.aborted, true);
  finish({ voices: [{ id: "late", displayName: "late" }] });
  await new Promise(done => setImmediate(done));
  assert.match(panel.render(72).join("\n"), /Configuración/);
  assert.doesNotMatch(panel.render(72).join("\n"), /late/);
});

test("a failed catalog is retriable and still permits manual voice entry", async () => {
  const theme: any = { fg: (_name: string, text: string) => text, style: (text: string) => text };
  const tui: any = { terminal: { rows: 24 }, requestRender() {} };
  let calls = 0;
  const panel = new SettingsModal(tui, theme, defaultPreferences(), () => {}, async () => { calls++; throw new Error("provider-secret (HTTP 403)"); });
  for (let i = 0; i < 3; i++) panel.handleInput("\u001b[B");
  panel.handleInput("\r");
  await new Promise(done => setImmediate(done));
  let output = panel.render(72).join("\n");
  assert.match(output, /Reintentar/);
  assert.match(output, /403/);
  assert.doesNotMatch(output, /provider-secret/);
  panel.handleInput("\u001b[B"); panel.handleInput("\u001b[B"); panel.handleInput("\r");
  await new Promise(done => setImmediate(done));
  assert.equal(calls, 2);
  panel.handleInput("\u001b[B"); panel.handleInput("\r");
  panel.handleInput("\u0015");
  panel.handleInput("\u001b[200~my-custom-voice\u001b[201~");
  panel.handleInput("\r");
  output = panel.render(72).join("\n");
  assert.match(output, /my-custom-voice/);
});

test("search cancellation preserves the query and retry targets the failed page", async () => {
  const theme: any = { fg: (_name: string, text: string) => text, style: (text: string) => text };
  const tui: any = { terminal: { rows: 24 }, requestRender() {} };
  const calls: any[] = [];
  const panel = new SettingsModal(tui, theme, defaultPreferences(), () => {}, async options => {
    calls.push(options);
    if (options.pageToken) throw new Error("403");
    return { voices: [{ id: "one", displayName: "one" }], nextPageToken: "page2" };
  });
  for (let i = 0; i < 3; i++) panel.handleInput("\u001b[B");
  panel.handleInput("\r"); await new Promise(done => setImmediate(done));
  panel.handleInput("\r"); panel.handleInput("\u001b[200~speaker\u001b[201~"); panel.handleInput("\r");
  await new Promise(done => setImmediate(done));
  for (let i = 0; i < 3; i++) panel.handleInput("\u001b[B");
  panel.handleInput("\r"); await new Promise(done => setImmediate(done));
  assert.equal(calls.at(-1).pageToken, "page2");
  panel.handleInput("\u001b[B"); panel.handleInput("\u001b[B"); panel.handleInput("\r");
  await new Promise(done => setImmediate(done));
  assert.equal(calls.at(-1).pageToken, "page2");
  assert.equal(calls.at(-1).search, "speaker");
  panel.handleInput("\r"); panel.handleInput("\u001b");
  assert.match(panel.render(72).join("\n"), /speaker/);
});

test("voice catalog keeps a way to advance from an empty page", async () => {
  const theme: any = { fg: (_name: string, text: string) => text, style: (text: string) => text };
  const tui: any = { terminal: { rows: 24 }, requestRender() {} };
  const calls: any[] = [];
  const panel = new SettingsModal(tui, theme, defaultPreferences(), () => {}, async options => {
    calls.push(options);
    return options.pageToken ? { voices: [{ id: "next-voice", displayName: "Next voice" }] } : { voices: [], nextPageToken: "next" };
  });
  for (let i = 0; i < 3; i++) panel.handleInput("\u001b[B");
  panel.handleInput("\r"); await new Promise(done => setImmediate(done));
  assert.match(panel.render(72).join("\n"), /No hay voces argentinas en esta página/);
  assert.match(panel.render(72).join("\n"), /Siguiente página/);
  for (let i = 0; i < 3; i++) panel.handleInput("\u001b[B");
  panel.handleInput("\r"); await new Promise(done => setImmediate(done));
  assert.equal(calls.at(-1).pageToken, "next");
  assert.match(panel.render(72).join("\n"), /Next voice/);
});

test("settings overlay edits autoread and devices, validates input and saves without mutating the original", async () => {
  const previous = defaultPreferences();
  const theme: any = { fg: (_name: string, text: string) => text, style: (text: string, style: any) => style.bg ? `\u001b[48;2;${style.bg.r};${style.bg.g};${style.bg.b}m${text}\u001b[49m` : text };
  const tui: any = { terminal: { rows: 24 }, requestRender() {} };
  let result: any;
  const panel = new SettingsModal(tui, theme, previous, value => { result = value; });
  panel.focused = true;
  const down = () => panel.handleInput("\u001b[B");
  const enter = () => panel.handleInput("\r");
  const paste = (value: string) => panel.handleInput(`\u001b[200~${value}\u001b[201~`);
  const clear = () => panel.handleInput("\u0015");
  assert.ok(panel.render(50).every(line => visibleWidth(line) === 50));
  assert.ok(panel.render(50).every(line => line.includes("\u001b[48;2;0;0;0m")));
  for (const width of [0, 1, 3, 4, 8, 20, 72]) assert.ok(panel.render(width).every(line => visibleWidth(line) <= width));
  for (const rows of [8, 10, 12, 24]) {
    tui.terminal.rows = rows;
    const lines = panel.render(30);
    assert.ok(lines.length <= Math.min(Math.floor(rows * 0.95), rows - 2));
    assert.ok(lines.every(line => visibleWidth(line) <= 30));
  }
  tui.terminal.rows = 24;

  down(); enter(); // auto-read on
  for (let i = 0; i < 7; i++) down(); enter(); // output
  down(); enter(); // add device
  assert.ok(panel.render(30).some(line => line.includes(CURSOR_MARKER)), "focused input exposes IME cursor");
  paste("Portátil 🐈"); enter(); // name
  clear(); paste("65536"); enter();
  assert.match(panel.render(72).join("\n"), /inválido/i);
  clear(); paste("14714"); enter();
  down(); enter(); // select device details
  enter(); // use device
  down(); down(); enter(); // back to main
  down(); enter(); // save
  assert.ok(result, panel.render(72).join("\n"));
  assert.equal(result.autoRead, true);
  assert.deepEqual(result.devices, [{ name: "Portátil 🐈", port: 14714 }]);
  assert.equal(result.output, "Portátil 🐈");
  assert.deepEqual(previous, defaultPreferences(), "cancelable draft must not mutate live settings");

  let removed: any;
  const removePanel = new SettingsModal(tui, theme, result, value => { removed = value; });
  for (let i = 0; i < 8; i++) removePanel.handleInput("\u001b[B");
  removePanel.handleInput("\r"); // output
  removePanel.handleInput("\u001b[B"); removePanel.handleInput("\r"); // device
  for (let i = 0; i < 3; i++) removePanel.handleInput("\u001b[B");
  removePanel.handleInput("\r"); // remove
  removePanel.handleInput("\u001b"); // main
  removePanel.handleInput("\u001b[B"); removePanel.handleInput("\r"); // save
  assert.deepEqual(removed.devices, []);
  assert.equal(removed.output, null);

  let canceled: any = "pending";
  const cancelPanel = new SettingsModal(tui, theme, previous, value => { canceled = value; });
  cancelPanel.handleInput("\u001b[B"); cancelPanel.handleInput("\r");
  cancelPanel.handleInput("\u001b");
  assert.equal(canceled, undefined);
  assert.equal(previous.autoRead, false);
});

test("settings uses an overlay and changes the next streaming and replay output", async t => {
  const s = setup(t);
  const theme: any = { fg: (_name: string, text: string) => text, style: (text: string) => text };
  let overlay: any;
  s.ctx.ui.custom = async (factory: Function, options: any) => {
    overlay = options;
    const edited = defaultPreferences();
    edited.devices = [{ name: "PC", port: 14713 }, { name: "Móvil", port: 14714 }];
    edited.output = "Móvil";
    return edited;
  };
  await s.command("config");
  assert.equal(overlay.overlay, true);
  assert.equal(overlay.overlayOptions.anchor, "center");
  await s.finish();
  await s.command("stream 1");
  await s.command("play 1");
  assert.equal(s.streaming.mock.calls[0].arguments[2], 14714);
  assert.equal(s.playback.mock.calls[0].arguments[2], 14714);
  await s.command("speed 1.5");
  const { loadPreferences } = await import("../src/config.ts");
  const persisted = loadPreferences(join(s.root, "google-tts", "settings.json"));
  assert.equal(persisted.config.speed, 1.5);
  assert.equal(persisted.output, "Móvil");
});

test("saving a disabled panel stops active automatic speech", async t => {
  const s = setup(t);
  s.ctx.ui.custom = async () => ({ ...defaultPreferences(), autoRead: true });
  await s.command("config");
  let signal!: AbortSignal;
  let start!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  s.synthesis.mock.mockImplementation(async function* (_text: string, _voice: string, _style: string, _model: string, _location: string, passed: AbortSignal) {
    signal = passed; yield Buffer.from([1, 2]);
    await new Promise<void>(resolve => { start(); signal.addEventListener("abort", () => resolve(), { once: true }); });
    signal.throwIfAborted();
  });
  await s.finish(); await started;
  s.ctx.ui.custom = async () => ({ ...defaultPreferences(), config: { ...defaultPreferences().config, enabled: false }, autoRead: true });
  await s.command("config");
  assert.equal(signal.aborted, true);
  assert.deepEqual(s.render().render(100), []);
});

test("settings persist across extension instances and unreadable preferences are not overwritten", async t => {
  const s = setup(t);
  s.ctx.ui.custom = async () => ({ ...defaultPreferences(), autoRead: true, devices: [{ name: "PC", port: 14713 }], output: "PC" });
  await s.command("config");
  const hooks = new Map<string, Function>();
  const commands = new Map<string, any>();
  const pi: any = { on: (n: string, h: Function) => hooks.set(n, h), registerCommand: (n: string, c: any) => commands.set(n, c), registerEntryRenderer() {}, appendEntry() {} };
  register(pi);
  await commands.get("tts").handler("", s.ctx);
  assert.match(s.notices.at(-1)!, /Lectura automática: sí.*Salida: PC/);
  const { writeFileSync, readFileSync } = await import("node:fs");
  const file = join(s.root, "google-tts", "settings.json");
  writeFileSync(file, "{malformed");
  register(pi);
  hooks.get("session_start")!({}, s.ctx);
  await commands.get("tts").handler("off", s.ctx);
  assert.match(s.notices.at(-1)!, /no se sobrescribirán/);
  assert.equal(readFileSync(file, "utf8"), "{malformed");
});

test("auto-read is cancelled by a new prompt and never runs outside the TUI", async t => {
  const s = setup(t);
  const chosen = { ...defaultPreferences(), autoRead: true };
  s.ctx.ui.custom = async () => chosen;
  await s.command("config");
  let signal!: AbortSignal;
  let start!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  s.synthesis.mock.mockImplementation(async function* (_text: string, _voice: string, _style: string, _model: string, _location: string, passed: AbortSignal) {
    signal = passed; yield Buffer.from([1, 2]);
    await new Promise<void>(resolve => { start(); signal.addEventListener("abort", () => resolve(), { once: true }); });
    signal.throwIfAborted();
  });
  await s.finish(); await started;
  assert.match(s.render().render(100)[0], /Pausar/);
  await s.emit("agent_start");
  await new Promise(done => setImmediate(done));
  assert.equal(signal.aborted, true);
  assert.match(s.render().render(100)[0], /Generar y escuchar/);
  s.ctx.mode = "rpc";
  await s.finish(finalMessage("Respuesta de subagente."));
  assert.equal(s.synthesis.mock.callCount(), 1);
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
