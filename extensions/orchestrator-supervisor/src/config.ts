import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import type { ModelCandidate, ModelCandidateId } from './types.ts';

export const SUPERVISOR_EXTENSION_NAME = 'orchestrator-supervisor';
export const SUPERVISOR_RELOAD_GUARD_CHANNEL = 'supervisor:reload-guard:v1';
export const MEMORY_CHECKPOINT_CHANNEL = 'memory:supervisor:checkpoint:v1';

export const MODEL_CANDIDATES: ModelCandidate[] = [
  {
    id: 'cliproxyapi/main/gpt-6.1-sol',
    prefix: 'main',
    modelSlug: 'gpt-6.1-sol',
    provider: 'cliproxyapi',
    reasoningEffort: 'high',
    contextWindowCap: 272000,
  },
  {
    id: 'cliproxyapi/second/gpt-6.1-sol',
    prefix: 'second',
    modelSlug: 'gpt-6.1-sol',
    provider: 'cliproxyapi',
    reasoningEffort: 'high',
    contextWindowCap: 272000,
  },
  {
    id: 'cliproxyapi/j0k3r/gemini-3.8-flash-high',
    prefix: 'j0k3r',
    modelSlug: 'gemini-3.8-flash-high',
    provider: 'cliproxyapi',
    reasoningEffort: 'high',
    contextWindowCap: 370000,
  },
];

export const CODEX_QUOTA_THRESHOLD = 95.0; // 95% policy threshold
export const CONTEXT_RESERVE_PERCENT = 90.0; // 90% hard reserve ceiling
export const COOLDOWN_DURATION_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_TRANSIENT_FAILURES = 3;
export const QUOTA_CACHE_TTL_MS = 60 * 1000; // 60 seconds
export const QUOTA_POLL_INTERVAL_MS = 60 * 1000; // 60 seconds
export const ALL_UNAVAILABLE_BACKOFF_MIN_MS = 60 * 1000; // 60s
export const ALL_UNAVAILABLE_BACKOFF_MAX_MS = 300 * 1000; // 300s

export function isExtensionEnabled(name: string, cwd: string): boolean {
  try {
    const configPath = join(cwd, '.pi', 'extensions.json');
    if (!existsSync(configPath)) {
      return false;
    }
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Boolean(parsed && typeof parsed === 'object' && parsed[name] === true);
  } catch {
    return false;
  }
}

export function resolveSupervisorDir(flowIdentity: string): string {
  const base = process.env.PI_SUPERVISOR_RUNTIME_DIR || join(homedir(), '.pi', 'supervisor');
  return join(base, flowIdentity);
}

export function computeFlowIdentity(cwd: string, boundFlowKey?: string): string {
  let resolvedCwd: string;
  try {
    resolvedCwd = realpathSync(cwd);
  } catch {
    resolvedCwd = cwd;
  }
  const key = boundFlowKey && boundFlowKey.trim().length > 0 ? boundFlowKey.trim() : 'orchestrator';
  return createHash('sha256').update(`${resolvedCwd}:${key}`).digest('hex').slice(0, 16);
}
