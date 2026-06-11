import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

export function nowIso(): string { return new Date().toISOString(); }

export function slug(input: string | null | undefined, fallback = 'unknown'): string {
  const s = String(input ?? '').trim().toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return s || fallback;
}

export function jsonString(value: unknown): string | null {
  if (value == null) return null;
  return JSON.stringify(value);
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

export function sha256(text: string): string { return createHash('sha256').update(text).digest('hex'); }
export function randomHex(bytes = 8): string { return randomBytes(bytes).toString('hex'); }
export function uuidPart(): string { try { return randomUUID().replace(/-/g, '').slice(0, 16); } catch { return randomHex(8); } }
export function expandHome(p: string): string { return p.startsWith('~/') ? path.join(homedir(), p.slice(2)) : p; }

export function firstLine(text: string, max = 80): string {
  const line = text.trim().split(/\r?\n/)[0] ?? '';
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

export function snippet(text: string, max = 240): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}
