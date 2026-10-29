import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute } from "node:path";
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

export interface AudioDevice { name: string; port: number }
export interface TTSPreferences {
  config: TTSConfig;
  autoRead: boolean;
  devices: AudioDevice[];
  output: string | null;
}

export function defaultPreferences(): TTSPreferences {
  return { config: { ...defaultConfig }, autoRead: false, devices: [], output: null };
}

// Copy only the extension's public settings, never arbitrary JSON or credentials.
export function validatePreferences(value: unknown): TTSPreferences {
  const data = value as any;
  const cfg = data?.config;
  const text = (v: unknown, max: number) => typeof v === "string" && v.trim() === v && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f-\x9f]/.test(v);
  if (!cfg || typeof cfg.enabled !== "boolean" || typeof data.autoRead !== "boolean" ||
      !["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"].includes(cfg.model) ||
      !text(cfg.voice, 80) || !text(cfg.style, 1000) ||
      typeof cfg.location !== "string" || !/^[a-z][a-z0-9-]{0,62}$/.test(cfg.location) ||
      !Number.isInteger(cfg.maxCharacters) || cfg.maxCharacters < 1 || cfg.maxCharacters > 30000 ||
      typeof cfg.speed !== "number" || !Number.isFinite(cfg.speed) || cfg.speed < 0.5 || cfg.speed > 3 ||
      !Array.isArray(data.devices) || data.devices.length > 50) {
    throw new Error("Preferencias de Google TTS inválidas.");
  }
  const names = new Set<string>();
  const devices: AudioDevice[] = data.devices.map((device: any) => {
    if (!device || !text(device.name, 80) || !Number.isInteger(device.port) || device.port < 1 || device.port > 65535 || names.has(device.name.toLowerCase())) {
      throw new Error("Dispositivo inválido: usa un nombre único y un puerto entre 1 y 65535.");
    }
    names.add(device.name.toLowerCase());
    return { name: device.name, port: device.port };
  });
  if (data.output !== null && (typeof data.output !== "string" || !devices.some(device => device.name === data.output))) {
    throw new Error("La salida seleccionada no existe.");
  }
  return {
    config: { enabled: cfg.enabled, model: cfg.model, location: cfg.location, voice: cfg.voice, style: cfg.style, maxCharacters: cfg.maxCharacters, speed: cfg.speed },
    autoRead: data.autoRead,
    devices,
    output: data.output,
  };
}

export function loadPreferences(file: string): TTSPreferences {
  let contents: string;
  try { contents = readFileSync(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultPreferences();
    throw new Error("No se pudieron leer las preferencias de Google TTS.");
  }
  try { return validatePreferences(JSON.parse(contents)); }
  catch { throw new Error("Las preferencias de Google TTS son inválidas; no se sobrescribirán."); }
}

export function savePreferences(file: string, value: TTSPreferences): void {
  const clean = validatePreferences(value);
  const directory = dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(clean, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temp, file);
  } catch {
    try { unlinkSync(temp); } catch { /* no temporary file */ }
    throw new Error("No se pudieron guardar las preferencias de Google TTS.");
  }
}

export function selectedPort(preferences: TTSPreferences): number | undefined {
  return preferences.devices.find(device => device.name === preferences.output)?.port;
}
