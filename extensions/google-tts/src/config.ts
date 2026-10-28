import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parseEnv } from "node:util";

// Only this extension's local file is trusted, never the current project's .env.
const localEnvFile = new URL("../.env", import.meta.url);

export function getCredentialsPath(
  envFile: string | URL = localEnvFile,
  env: Record<string, string | undefined> = process.env,
): string {
  let value = env.GOOGLE_TTS_CREDENTIALS_PATH;
  if (value === undefined) {
    try {
      value = parseEnv(readFileSync(envFile, "utf8")).GOOGLE_TTS_CREDENTIALS_PATH;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("No se pudo leer el .env local de Google TTS.");
      }
    }
  }
  if (!value?.trim() || !isAbsolute(value)) {
    throw new Error("Configura GOOGLE_TTS_CREDENTIALS_PATH con una ruta absoluta en el .env local de Google TTS.");
  }
  return value;
}

export interface TTSConfig {
  enabled: boolean;
  model: string;
  location: string;
  voice: string;
  style: string;
  maxCharacters: number;
  speed: number;
}

export const defaultConfig: TTSConfig = {
  enabled: true,
  model: "gemini-3.8-flash-lite-tts",
  location: "global",
  voice: "Kore",
  style: "speaking rapidly, clear and concise, direct",
  maxCharacters: 3000,
  speed: 1.18,
};

export const geminiVoices = [
  { name: "Kore", gender: "Femenina", desc: "Cálida, expresiva y conversacional (Recomendada)" },
  { name: "Fenrir", gender: "Masculina", desc: "Tono relajado y natural" },
  { name: "Puck", gender: "Masculina", desc: "Enérgica, entusiasta y dinámica" },
  { name: "Charon", gender: "Masculina", desc: "Voz profunda, madura y pausada" },
  { name: "Aoede", gender: "Femenina", desc: "Clara, suave y amigable" },
];
