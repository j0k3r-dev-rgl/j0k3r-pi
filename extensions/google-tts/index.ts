import { getAgentDir, type ExtensionAPI, type ExtensionContext, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { defaultPreferences, getCredentialsPath, loadPreferences, savePreferences, type TTSPreferences } from "./src/config.js";
import { openSettings } from "./src/settings-modal.js";
import { GoogleTTSService } from "./src/tts-service.js";
import { AudioPlayer } from "./src/audio-player.js";
import { ManualAudio } from "./src/manual-audio.js";
import { registerAudioRenderer } from "./src/render.js";

export default function (pi: ExtensionAPI) {
  const preferencesFile = join(getAgentDir(), "google-tts", "settings.json");
  let preferences: TTSPreferences;
  let preferencesError = false;
  try { preferences = loadPreferences(preferencesFile); }
  catch { preferences = defaultPreferences(); preferencesError = true; }
  const config = preferences.config;
  const save = (next: TTSPreferences, ctx: ExtensionContext): boolean => {
    if (preferencesError) { ctx.ui.notify("Las preferencias de Google TTS no se pudieron leer; no se sobrescribirán.", "error"); return false; }
    try { savePreferences(preferencesFile, next); }
    catch (error) { ctx.ui.notify(error instanceof Error ? error.message : "No se pudieron guardar las preferencias de Google TTS.", "error"); return false; }
    Object.assign(config, next.config);
    preferences.autoRead = next.autoRead;
    preferences.devices = next.devices;
    preferences.output = next.output;
    return true;
  };
  const changeConfig = (patch: Partial<typeof config>, ctx: ExtensionContext) => save({ ...preferences, config: { ...config, ...patch } }, ctx);
  const ttsService = new GoogleTTSService(getCredentialsPath);
  const audioPlayer = new AudioPlayer();

  const audio = new ManualAudio(preferences, ttsService, audioPlayer);
  let uiContext: ExtensionContext | undefined;
  audio.onChange = () => uiContext?.ui.setStatus("google-tts", config.enabled ? (preferences.autoRead ? "TTS automático" : "TTS manual") : undefined);
  registerAudioRenderer(pi, audio);
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    uiContext = ctx;
    audio.attach(ctx);
    audio.onChange();
    if (preferencesError) ctx.ui.notify("Las preferencias de Google TTS no se pudieron leer; se usarán valores predeterminados sin sobrescribirlas.", "warning");
  });
  pi.on("agent_start", () => audio.stop());
  pi.on("session_shutdown", () => { audio.reset(); uiContext = undefined; });
  pi.on("agent_settled", (event, ctx) => {
    audio.collect(pi, ctx, event.aborted);
  });

  // Comando /tts para control dinámico
  pi.registerCommand("tts", {
    description: "Audio de respuestas y configuración de Gemini TTS (Vertex AI)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (ctx.mode !== "tui") return;
      uiContext = ctx;
      audio.attach(ctx);
      const parts = args.trim().split(/\s+/);
      const subCommand = parts[0]?.toLowerCase();
      const param = parts.slice(1).join(" ").trim();

      switch (subCommand) {
        case "config":
        case "settings": {
          const next = await openSettings(ctx, preferences, (options, signal) => ttsService.listVoices(options, signal));
          if (!next || !save(next, ctx)) return;
          if (!config.enabled) audio.disable();
          else audio.onChange();
          ctx.ui.notify("Preferencias de Google TTS guardadas.", "info");
          break;
        }

        case "on": {
          if (!changeConfig({ enabled: true }, ctx)) return;
          audio.onChange();
          ctx.ui.notify(`Gemini TTS Activado (Voz: ${config.voice}, Modelo: ${config.model})`, "info");
          break;
        }

        case "off": {
          if (!changeConfig({ enabled: false }, ctx)) return;
          audio.disable();
          ctx.ui.notify("Gemini TTS Desactivado", "info");
          break;
        }

        case "pause":
        case "resume":
        case "stop": {
          audio.playbackAction(subCommand, param);
          break;
        }

        case "model": {
          if (!param) {
            ctx.ui.notify(`Modelo TTS actual: ${config.model}\nUsa /tts model flash|lite para las próximas generaciones.`, "info");
            return;
          }
          const alias = param.toLowerCase();
          if (alias !== "flash" && alias !== "lite") {
            ctx.ui.notify("Modelo inválido. Uso: /tts model flash|lite", "warning");
            return;
          }
          if (!changeConfig({ model: alias === "flash" ? "gemini-3.8-flash-tts" : "gemini-3.8-flash-lite-tts" }, ctx)) return;
          ctx.ui.notify(`Modelo TTS cambiado a: ${config.model}. Se aplicará a las próximas generaciones; los audios existentes se conservan.`, "info");
          break;
        }

        case "voice": {
          if (!param) {
            ctx.ui.notify(`Voz actual: ${config.voice}. Consulta el catálogo en /tts config → Voz o usa /tts voice <nombre o ID>.`, "info");
            return;
          }
          if (!changeConfig({ voice: param }, ctx)) return;
          ctx.ui.notify(`Voz de Gemini cambiada a: ${config.voice}`, "info");
          break;
        }

        case "speed": {
          if (!param) {
            ctx.ui.notify(
              `Velocidad actual de reproducción: ${config.speed}x\nUsa '/tts speed <multiplicador>' (ej. 1.25, 1.35, 1.5) para ajustarla.`,
              "info"
            );
            return;
          }
          const raw = param.replace(/x$/i, "");
          const parsed = Number(raw);
          if (!/^(?:\d+)(?:\.\d+)?$/.test(raw) || !Number.isFinite(parsed) || parsed < 0.5 || parsed > 3.0) {
            ctx.ui.notify("Velocidad inválida. Debe ser un número entre 0.5 y 3.0 (ej. 1.25, 1.35, 1.5).", "warning");
            return;
          }
          if (!changeConfig({ speed: Number(parsed.toFixed(2)) }, ctx)) return;
          ctx.ui.notify(`Velocidad de reproducción cambiada a: ${config.speed}x`, "info");
          break;
        }

        case "style": {
          if (!param) {
            ctx.ui.notify(
              `Estilo actual: ${config.style}\nEjemplos: "cheerful and friendly", "conversational", "calm", "enthusiastic"`,
              "info"
            );
            return;
          }
          if (!changeConfig({ style: param }, ctx)) return;
          ctx.ui.notify(`Estilo de entonación cambiado a: "${config.style}"`, "info");
          break;
        }

        case "stream":
        case "play": {
          if (!config.enabled) {
            ctx.ui.notify("Activa TTS con /tts on.", "warning");
            return;
          }
          await audio.action(subCommand, param);
          break;
        }

        case "speak": {
          ctx.ui.notify("Usa Generar y escuchar en la respuesta o activa la lectura automática en /tts config.", "info");
          break;
        }

        default: {
          const status = config.enabled ? "ACTIVADO" : "DESACTIVADO";
          const playing = audioPlayer.isPaused() ? "(En pausa)" : audioPlayer.isPlaying() ? "(Reproduciendo ahora)" : "";
          let help = `Estado Gemini TTS: ${status} ${playing}\nModelo: ${config.model} (${config.location})\nVoz: ${config.voice} | Estilo: "${config.style}" | Velocidad: ${config.speed}x\nLectura automática: ${preferences.autoRead ? "sí" : "no"} | Salida: ${preferences.output ?? "entorno predeterminado"}\n\nComandos:\n`;
          help += `• /tts config         - Abrir configuración y dispositivos\n`;
          help += `• /tts on             - Activar TTS y sus controles\n`;
          help += `• /tts off            - Desactivar controles y detener audio\n`;
          help += `• /tts stream <n>     - Generar y escuchar progresivamente\n`;
          help += `• /tts play <n>       - Reproducir audio ya generado\n`;
          help += `• /tts pause [n]      - Pausar el audio sin perder la posición\n`;
          help += `• /tts resume [n]     - Continuar el audio pausado\n`;
          help += `• /tts stop [n]       - Detener audio y volver al inicio\n`;
          help += `• /tts model [flash|lite] - Consultar o cambiar el modelo TTS\n`;
          help += `• /tts speed [mult]   - Cambiar velocidad de lectura (ej. 1.25, 1.35, 1.5)\n`;
          help += `• /tts voice [nombre o ID] - Consultar o cambiar voz\n`;
          help += `• /tts style [estilo] - Cambiar tono de entonación`;
          ctx.ui.notify(help, "info");
          break;
        }
      }
    },
  });
}
