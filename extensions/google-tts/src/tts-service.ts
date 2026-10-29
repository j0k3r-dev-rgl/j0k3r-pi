import * as fs from "node:fs";
import * as crypto from "node:crypto";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id: string;
}

export interface CatalogVoice {
  id: string;
  displayName: string;
  languageCode?: string;
  gender?: string;
  accent?: string;
  description?: string;
}
export interface VoicePage { voices: CatalogVoice[]; nextPageToken?: string }
export type VoiceCatalog = (options: { search?: string; pageToken?: string }, signal: AbortSignal) => Promise<VoicePage>;

// Google describes these fields as optional; absent or conflicting metadata is not evidence of an Argentine Spanish voice.
function isArgentineSpanish(languageCode: string, regionCode: string, accent: string): boolean {
  const language = languageCode.toLowerCase();
  const region = regionCode.toUpperCase();
  const normalizedAccent = accent.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const hasArgentineAccent = /^(?:argentin(?:a|e|ian|o)|argentina spanish|argentine spanish|argentinian spanish|espanol argentin[oa]|spanish \(argentina\)|spanish \(argentinian\))$/.test(normalizedAccent);
  if (!/^es(?:-|$)/.test(language) || (region && !["AR", "419", "001"].includes(region))) return false;
  const languageRegion = language.split("-").slice(1).find(part => /^[a-z]{2}$|^\d{3}$/.test(part));
  if (languageRegion && !["ar", "419", "001"].includes(languageRegion)) return false;
  return languageRegion === "ar" || region === "AR" || hasArgentineAccent;
}

export class GoogleTTSService {
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private credentialsPath: string | (() => string);

  constructor(credentialsPath: string | (() => string)) {
    this.credentialsPath = credentialsPath;
  }

  private loadServiceAccount(): ServiceAccountKey {
    const credentialsPath = typeof this.credentialsPath === "function" ? this.credentialsPath() : this.credentialsPath;
    let json: any;
    try {
      json = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
    } catch {
      throw new Error("No se pudo leer el JSON de credenciales de Google TTS. Comprueba el archivo y sus permisos.");
    }

    const creds = json?.service_account || json;
    const projectId = creds?.project_id || json?.project_id;
    if (![creds?.client_email, creds?.private_key, projectId].every(value => typeof value === "string" && value.trim())) {
      throw new Error("El JSON de credenciales debe contener client_email, private_key y project_id válidos.");
    }

    return {
      client_email: creds.client_email,
      private_key: creds.private_key,
      project_id: projectId,
    };
  }

  private async getAccessToken(signal?: AbortSignal): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && this.tokenExpiresAt > now + 60) {
      return this.cachedToken;
    }

    const creds = this.loadServiceAccount();
    const header = { alg: "RS256", typ: "JWT" };
    const claim = {
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    };

    const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const payload = `${b64(header)}.${b64(claim)}`;

    const sign = crypto.createSign("RSA-SHA256");
    sign.update(payload);
    const signature = sign.sign(creds.private_key, "base64url");
    const jwt = `${payload}.${signature}`;

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
      signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error al autenticar con Google OAuth: ${res.status} ${errText}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = data.access_token;
    this.tokenExpiresAt = now + (data.expires_in || 3600);

    return this.cachedToken;
  }

  async listVoices(options: { search?: string; pageToken?: string }, signal: AbortSignal): Promise<VoicePage> {
    signal.throwIfAborted();
    const timeout = AbortSignal.timeout(15000);
    const requestSignal = AbortSignal.any([signal, timeout]);
    try {
      const { project_id: project } = this.loadServiceAccount();
      const token = await this.getAccessToken(requestSignal);
      signal.throwIfAborted();
      const url = new URL(`https://aiplatform.googleapis.com/v1beta1/projects/${encodeURIComponent(project)}/locations/global/voices`);
      url.searchParams.set("pageSize", "1000");
      // Vertex filters only by text; the observed catalog describes Argentine voices with "Argentin".
      url.searchParams.set("search", "Argentin");
      if (options.pageToken) url.searchParams.set("pageToken", options.pageToken);
      const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}` }, signal: requestSignal, redirect: "error" });
      if (!response.ok) throw new Error(`No se pudo consultar el catálogo de voces (HTTP ${response.status}).`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Respuesta inválida del catálogo de voces.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 1024 * 1024) throw new Error("Respuesta del catálogo de voces demasiado grande.");
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      signal.throwIfAborted();
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!data || typeof data !== "object" || (data.voices !== undefined && !Array.isArray(data.voices))) throw new Error("Respuesta inválida del catálogo de voces.");
      const clean = (value: unknown, limit = 300) => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").trim().slice(0, limit) : "";
      const voices: CatalogVoice[] = [];
      const search = options.search?.trim().toLowerCase();
      for (const item of data.voices ?? []) {
        const languageCode = clean(item?.languageCode ?? item?.language_code);
        const regionCode = clean(item?.regionCode ?? item?.region_code);
        const accent = clean(item?.accent);
        if (!isArgentineSpanish(languageCode, regionCode, accent)) continue;
        if (search && ![item?.displayName ?? item?.display_name, item?.description].some(value => clean(value).toLowerCase().includes(search))) continue;
        const id = item?.id;
        if (typeof id !== "string" || !id || id.length > 80 || id.trim() !== id || /[\x00-\x1f\x7f-\x9f]/.test(id)) throw new Error("Respuesta inválida del catálogo de voces.");
        voices.push({ id, displayName: clean(item?.displayName ?? item?.display_name) || id,
          languageCode, gender: clean(item?.gender), accent, description: clean(item?.description) });
      }
      const pageToken = data.nextPageToken ?? data.next_page_token;
      if (pageToken !== undefined && (typeof pageToken !== "string" || pageToken.length > 4096)) throw new Error("Respuesta inválida del catálogo de voces.");
      return { voices, ...(pageToken ? { nextPageToken: pageToken } : {}) };
    } catch (error) {
      signal.throwIfAborted();
      if (timeout.aborted) throw new Error("La consulta del catálogo de voces agotó el tiempo de espera.");
      if (error instanceof Error && /^No se pudo consultar el catálogo de voces \(HTTP \d+\)\.$/.test(error.message)) throw error;
      throw new Error("No se pudo consultar el catálogo de voces. Comprueba credenciales, permisos y conexión.");
    }
  }

  async *stream(text: string, voice: string, style: string, model: string, location: string, signal: AbortSignal): AsyncGenerator<Buffer> {
    const creds = this.loadServiceAccount();
    const token = await this.getAccessToken(signal);
    signal.throwIfAborted();
    const url = `https://aiplatform.googleapis.com/v1/projects/${creds.project_id}/locations/${location}/publishers/google/models/${model}:streamGenerateContent?alt=sse`;
    const res = await fetch(url, {
      method: "POST", signal,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text, speechMetadata: { style } }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { voice } } } }),
    });
    if (!res.ok || !res.body) throw new Error(`Error de streaming TTS (${res.status}).`);
    const decoder = new TextDecoder();
    let pending = "", found = false, finished = false;
    const reader = res.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        if (pending.length > 16 * 1024 * 1024) throw new Error("Evento SSE demasiado grande.");
        let boundary: RegExpExecArray | null;
        while ((boundary = /\r?\n\r?\n/.exec(pending))) {
          const event = pending.slice(0, boundary.index);
          pending = pending.slice(boundary.index + boundary[0].length);
          const data = event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
          if (!data || data === "[DONE]") continue;
          const json = JSON.parse(data);
          if (json.error) throw new Error("Error del proveedor TTS.");
          for (const candidate of json.candidates ?? []) {
            if (candidate.finishReason && candidate.finishReason !== "STOP") throw new Error("Generación TTS incompleta.");
            if (candidate.finishReason === "STOP") finished = true;
            for (const part of candidate.content?.parts ?? []) {
              if (part.inlineData?.data) { found = true; yield Buffer.from(part.inlineData.data, "base64"); }
            }
          }
        }
        if (done) break;
      }
      if (pending.trim() || !found || !finished) throw new Error("Stream TTS incompleto o sin audio.");
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }

}
