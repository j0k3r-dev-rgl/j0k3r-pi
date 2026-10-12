import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function getNtfyUrl(): string | undefined {
  if (process.env.PI_NTFY_URL) return process.env.PI_NTFY_URL.trim();
  if (process.env.NTFY_TOPIC_URL) return process.env.NTFY_TOPIC_URL.trim();

  const candidatePaths = [
    join(process.cwd(), '.env'),
    join(homedir(), '.pi', 'agent', '.env'),
  ];

  for (const envPath of candidatePaths) {
    try {
      if (existsSync(envPath)) {
        const content = readFileSync(envPath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
          const [key, ...vals] = trimmed.split('=');
          const val = vals.join('=').trim().replace(/^['"]|['"]$/g, '');
          if ((key.trim() === 'PI_NTFY_URL' || key.trim() === 'NTFY_TOPIC_URL') && val) {
            return val;
          }
        }
      }
    } catch {
      // Ignore reading error
    }
  }
  return undefined;
}

export interface SupervisorNotificationPayload {
  title: string;
  body: string;
  priority?: 'default' | 'high' | 'urgent';
  tags?: string;
}

export async function sendSupervisorNotification(payload: SupervisorNotificationPayload): Promise<void> {
  const url = getNtfyUrl();
  if (!url) return;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Title: payload.title,
        Priority: payload.priority || 'default',
        Tags: payload.tags || 'robot',
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: payload.body,
      signal: AbortSignal.timeout(3000),
    });
    await response.body?.cancel();
  } catch {
    // Best effort: network errors must never interrupt supervisor lifecycle.
  }
}
