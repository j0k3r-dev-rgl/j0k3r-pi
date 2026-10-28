import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TTSConfig } from "./config.js";
import type { GoogleTTSService } from "./tts-service.js";
import type { AudioPlayer } from "./audio-player.js";
import { cleanTextForSpeech } from "./text-cleaner.js";

export const AUDIO_ENTRY = "google-tts-audio";
export interface AudioEntry { messageId: string; number: number }
export type AudioAction = "stream" | "play" | "pause" | "resume" | "stop";
interface AudioState { text: string; status: "idle" | "ready" | "playing" | "paused"; audio?: Buffer }

export class ManualAudio {
  private states = new Map<string, AudioState>();
  private context?: ExtensionContext;
  private epoch = 0;
  private playbackEpoch = 0;
  private streamAbort?: AbortController;
  onChange = () => {};

  private config: TTSConfig;
  private service: GoogleTTSService;
  private player: AudioPlayer;
  constructor(config: TTSConfig, service: GoogleTTSService, player: AudioPlayer) {
    this.config = config;
    this.service = service;
    this.player = player;
  }

  attach(ctx: ExtensionContext) { if (ctx.mode === "tui") this.context = ctx; }
  available() { return this.context?.mode === "tui" && this.config.enabled; }
  private entries(): any[] { return this.context?.sessionManager.getBranch() ?? []; }
  private cards(): AudioEntry[] {
    return this.entries().filter(e => e.type === "custom" && e.customType === AUDIO_ENTRY).map(e => e.data);
  }
  private state(card: AudioEntry): AudioState | undefined {
    if (!this.cards().some(c => c.messageId === card.messageId)) return;
    let state = this.states.get(card.messageId);
    if (!state) {
      const entry = this.entries().find(e => e.id === card.messageId && e.type === "message");
      const text = finalText(entry?.message, this.config.maxCharacters);
      if (!text) return;
      state = { text, status: "idle" };
      this.states.set(card.messageId, state);
    }
    return state;
  }
  controls(card: AudioEntry): { label: string; action?: AudioAction }[] {
    if (!this.available()) return [];
    const state = this.state(card);
    if (!state) return [];
    switch (state.status) {
      case "idle": return [{ label: "Generar y escuchar", action: "stream" }];
      case "ready": return [{ label: "Reproducir", action: "play" }];
      case "playing": return [{ label: "Pausar", action: "pause" }, { label: "Detener", action: "stop" }];
      case "paused": return [{ label: "Continuar", action: "resume" }, { label: "Detener", action: "stop" }];
    }
  }
  label(card: AudioEntry): string {
    const controls = this.controls(card);
    if (!controls.length) return "";
    const buttons = controls.map(c => `[ ${c.label} ]`).join("  ");
    const commands = controls.filter(c => c.action).map(c => `/tts ${c.action} ${card.number}`).join(" · ");
    return buttons + (commands ? `  ${commands}` : "");
  }
  playbackAction(kind: "pause" | "resume" | "stop", number = "") {
    if (!this.available()) return;
    const active = this.cards().find(card => {
      const status = this.states.get(card.messageId)?.status;
      return (!number || String(card.number) === number) && (status === "playing" || status === "paused");
    });
    if (!active) return;
    const state = this.states.get(active.messageId)!;
    if (kind === "stop") { this.stop(); return; }
    if (kind === "pause" && state.status === "playing") {
      if (this.player.pause()) state.status = "paused";
      else this.context?.ui.notify("No se pudo pausar el audio.", "warning");
    }
    if (kind === "resume" && state.status === "paused") {
      if (this.player.resume()) state.status = "playing";
      else this.context?.ui.notify("No se pudo continuar el audio.", "warning");
    }
    this.onChange();
  }
  collect(pi: ExtensionAPI, ctx: ExtensionContext, aborted: boolean) {
    this.attach(ctx);
    if (ctx.mode !== "tui" || !this.available() || aborted) return;
    // Settlement excludes retries, queued work and intermediate tool turns.
    const last = this.entries().filter(e => e.type === "message" && e.message?.role === "assistant").at(-1);
    if (!last || !finalText(last.message, this.config.maxCharacters)) return;
    if (this.cards().some(c => c.messageId === last.id)) return;
    const number = Math.max(0, ...this.cards().map(c => c.number)) + 1;
    pi.appendEntry(AUDIO_ENTRY, { messageId: last.id, number } satisfies AudioEntry);
  }
  stop() {
    this.playbackEpoch++;
    this.streamAbort?.abort();
    this.streamAbort = undefined;
    this.player.stop();
    for (const state of this.states.values()) if (state.status === "playing" || state.status === "paused") state.status = state.audio ? "ready" : "idle";
    this.onChange();
  }
  disable() {
    this.epoch++;
    this.stop();
    this.onChange();
  }
  reset() { this.disable(); this.states.clear(); this.context = undefined; }

  async action(kind: AudioAction, number: string) {
    if (!this.available()) return;
    if (kind === "pause" || kind === "resume" || kind === "stop") {
      this.playbackAction(kind, number);
      return;
    }
    const card = this.cards().find(c => String(c.number) === number);
    const state = card && this.state(card);
    if (!state) { this.context?.ui.notify("Respuesta no encontrada. Usa el número junto al botón de audio.", "warning"); return; }
    const epoch = this.epoch;
    if (state.status === "playing") return;
    if (state.status === "paused") {
      if (kind === "play") this.playbackAction("resume", number);
      return;
    }
    if (kind === "stream") {
      if (state.audio) return;
      this.stop();
      const playbackEpoch = this.playbackEpoch;
      const controller = new AbortController();
      this.streamAbort = controller;
      state.status = "playing";
      this.onChange();
      const chunks: Buffer[] = [];
      let size = 0;
      const service = this.service;
      const config = this.config;
      const self = this;
      let complete = false;
      const source = (async function* () {
        for await (const chunk of service.stream(state.text, config.voice, config.style, config.model, config.location, controller.signal)) {
          if (!self.cards().some(c => c.messageId === card!.messageId)) { controller.abort(); throw new Error("Rama cambiada."); }
          size += chunk.length;
          if (size > 16 * 1024 * 1024) throw new Error("Audio demasiado largo.");
          chunks.push(chunk);
          yield chunk;
        }
        controller.signal.throwIfAborted();
        state.audio = pcmWav(Buffer.concat(chunks));
        complete = true;
      })();
      try { await this.player.playStream(source, config.speed); }
      catch {
        controller.abort();
        if (epoch === this.epoch && playbackEpoch === this.playbackEpoch) this.context?.ui.notify("No se pudo generar o reproducir el audio en streaming.", "error");
      } finally {
        controller.abort();
        if (this.streamAbort === controller) this.streamAbort = undefined;
        if (epoch === this.epoch && playbackEpoch === this.playbackEpoch) state.status = complete ? "ready" : "idle";
        this.onChange();
      }
      return;
    }
    if (!state.audio) { this.context?.ui.notify("Primero pulsa Generar y escuchar.", "warning"); return; }
    this.stop();
    const playbackEpoch = this.playbackEpoch;
    state.status = "playing";
    this.onChange();
    try { await this.player.play(state.audio, this.config.speed); }
    catch { if (epoch === this.epoch) this.context?.ui.notify("No se pudo reproducir el audio. Comprueba ffplay.", "error"); }
    finally {
      if (epoch === this.epoch && playbackEpoch === this.playbackEpoch) state.status = "ready";
      this.onChange();
    }
  }
  async activate(card: AudioEntry, action?: AudioAction) {
    const control = this.controls(card).find(c => action ? c.action === action : c.action);
    if (control?.action) await this.action(control.action, String(card.number));
  }
}

function pcmWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function finalText(message: any, maxCharacters: number): string {
  if (message?.role !== "assistant" || (message.stopReason && message.stopReason !== "stop")) return "";
  if (Array.isArray(message.content) && message.content.some((p: any) => p.type === "toolCall")) return "";
  const raw = typeof message.content === "string" ? message.content :
    (message.content ?? []).filter((p: any) => p.type === "text" && typeof p.text === "string").map((p: any) => p.text).join("\n");
  const text = cleanTextForSpeech(raw, maxCharacters);
  return text.trim().length >= 3 ? text : "";
}
