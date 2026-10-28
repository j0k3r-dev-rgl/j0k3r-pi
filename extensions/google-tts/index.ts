import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { defaultConfig, geminiVoices, getCredentialsPath, type TTSConfig } from "./src/config.js";
import { GoogleTTSService } from "./src/tts-service.js";
import { AudioPlayer } from "./src/audio-player.js";
import { ManualAudio } from "./src/manual-audio.js";
import { registerAudioRenderer } from "./src/render.js";

export default function (pi: ExtensionAPI) {
  const config: TTSConfig = { ...defaultConfig };
  const ttsService = new GoogleTTSService(getCredentialsPath);
  const audioPlayer = new AudioPlayer();

  const audio = new ManualAudio(config, ttsService, audioPlayer);
  let uiContext: ExtensionContext | undefined;
  audio.onChange = () => uiContext?.ui.setStatus("google-tts", config.enabled ? "TTS manual" : undefined);
  registerAudioRenderer(pi, audio);
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    uiContext = ctx;
    audio.attach(ctx);
    audio.onChange();
  });
  pi.on("agent_start", () => audio.stop());
  pi.on("session_shutdown", () => { audio.reset(); uiContext = undefined; });
  pi.on("agent_settled", (event, ctx) => {
    audio.collect(pi, ctx, event.aborted);
  });

  // Comando /tts para control dinámico
  pi.registerCommand("tts", {
    description: "Audio manual por respuesta del orquestador con Gemini (Vertex AI)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (ctx.mode !== "tui") return;
      uiContext = ctx;
      audio.attach(ctx);
      const parts = args.trim().split(/\s+/);
      const subCommand = parts[0]?.toLowerCase();
      const param = parts.slice(1).join(" ").trim();

      switch (subCommand) {
        case "on": {
          config.enabled = true;
          audio.onChange();
          ctx.ui.notify(`Gemini TTS Activado (Voz: ${config.voice}, Modelo: ${config.model})`, "info");
          break;
        }

        case "off": {
          config.enabled = false;
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
          config.model = alias === "flash" ? "gemini-3.8-flash-tts" : "gemini-3.8-flash-lite-tts";
          ctx.ui.notify(`Modelo TTS cambiado a: ${config.model}. Se aplicará a las próximas generaciones; los audios existentes se conservan.`, "info");
          break;
        }

        case "voice": {
          if (!param) {
            let msg = `Voz actual de Gemini: ${config.voice}\n\nVoces disponibles:\n`;
            for (const v of geminiVoices) {
              msg += `• ${v.name} (${v.gender}): ${v.desc}\n`;
            }
            msg += `\nUsa '/tts voice <nombre>' para cambiarla.`;
            ctx.ui.notify(msg, "info");
            return;
          }

          // Buscar coincidencia insensible a mayúsculas
          const match = geminiVoices.find((v) => v.name.toLowerCase() === param.toLowerCase());
          config.voice = match ? match.name : param;
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
          const parsed = parseFloat(param.replace("x", ""));
          if (isNaN(parsed) || parsed < 0.5 || parsed > 3.0) {
            ctx.ui.notify("Velocidad inválida. Debe ser un número entre 0.5 y 3.0 (ej. 1.25, 1.35, 1.5).", "warning");
            return;
          }
          config.speed = Number(parsed.toFixed(2));
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
          config.style = param;
          ctx.ui.notify(`Estilo de entonación cambiado a: "${config.style}"`, "info");
          break;
        }

        case "generate":
        case "play": {
          if (!config.enabled) {
            ctx.ui.notify("Activa TTS con /tts on.", "warning");
            return;
          }
          await audio.action(subCommand, param);
          break;
        }

        case "speak": {
          ctx.ui.notify("Usa Generar audio y después Reproducir en la respuesta. No se genera ni reproduce audio automáticamente.", "info");
          break;
        }

        default: {
          const status = config.enabled ? "ACTIVADO" : "DESACTIVADO";
          const playing = audioPlayer.isPaused() ? "(En pausa)" : audioPlayer.isPlaying() ? "(Reproduciendo ahora)" : "";
          let help = `Estado Gemini TTS: ${status} ${playing}\nModelo: ${config.model} (Vertex Global)\nVoz: ${config.voice} | Estilo: "${config.style}" | Velocidad: ${config.speed}x\n\nComandos:\n`;
          help += `• /tts on             - Activar controles de audio manual\n`;
          help += `• /tts off            - Desactivar controles y detener audio\n`;
          help += `• /tts generate <n>   - Generar audio de la respuesta n, sin reproducir\n`;
          help += `• /tts play <n>       - Reproducir audio ya generado\n`;
          help += `• /tts pause [n]      - Pausar el audio sin perder la posición\n`;
          help += `• /tts resume [n]     - Continuar el audio pausado\n`;
          help += `• /tts stop [n]       - Detener audio y volver al inicio\n`;
          help += `• /tts model [flash|lite] - Consultar o cambiar el modelo TTS\n`;
          help += `• /tts speed [mult]   - Cambiar velocidad de lectura (ej. 1.25, 1.35, 1.5)\n`;
          help += `• /tts voice [nombre] - Cambiar voz (Kore, Fenrir, Puck, Charon, Aoede)\n`;
          help += `• /tts style [estilo] - Cambiar tono de entonación`;
          ctx.ui.notify(help, "info");
          break;
        }
      }
    },
  });
}
