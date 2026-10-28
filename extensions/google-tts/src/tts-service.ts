import * as fs from "node:fs";
import * as crypto from "node:crypto";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id: string;
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
