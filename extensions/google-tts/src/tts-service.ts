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

  private async getAccessToken(): Promise<string> {
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

  async synthesize(
    text: string,
    voiceName: string = "Kore",
    style: string = "cheerful and friendly",
    model: string = "gemini-3.8-flash-tts",
    location: string = "global"
  ): Promise<Buffer> {
    const creds = this.loadServiceAccount();
    const token = await this.getAccessToken();

    const url = `https://aiplatform.googleapis.com/v1/projects/${creds.project_id}/locations/${location}/publishers/google/models/${model}:generateContent`;

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text,
              speechMetadata: {
                style,
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            voice: voiceName,
          },
        },
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error en Vertex AI Gemini TTS (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;
    const part = data.candidates?.[0]?.content?.parts?.[0];
    const base64Audio = part?.inlineData?.data;

    if (!base64Audio) {
      throw new Error("El modelo de Gemini no devolvió audio en la respuesta.");
    }

    return Buffer.from(base64Audio, "base64");
  }
}
