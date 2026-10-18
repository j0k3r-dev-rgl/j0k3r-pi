import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const SUPERVISOR_EXTENSION_NAME = 'orchestrator-supervisor';
export const SUPERVISOR_RELOAD_GUARD_CHANNEL = 'supervisor:reload-guard:v1';
export const MEMORY_CHECKPOINT_CHANNEL = 'memory:supervisor:checkpoint:v1';

// No hardcoded model list: candidates come from the live host registry plus discovered
// CLIProxyAPI account routes (see QuotaManager.setRegisteredModels / discoverCandidates).
export const CODEX_QUOTA_THRESHOLD = 95.0; // 95% policy threshold
export const CONTEXT_RESERVE_PERCENT = 90.0; // 90% hard reserve ceiling
export const COOLDOWN_DURATION_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_TRANSIENT_FAILURES = 3;
export const QUOTA_CACHE_TTL_MS = 60 * 1000; // 60 seconds

export function isExtensionEnabled(_name: string, _cwd: string): boolean {
  // Loading this standalone extension is the opt-in. Never rewrite host settings.
  return process.env.PI_SUPERVISOR_DISABLED !== '1';
}

export function resolveSupervisorDir(flowIdentity: string): string {
  const base = process.env.PI_SUPERVISOR_RUNTIME_DIR ||
    fileURLToPath(new URL('../.runtime/', import.meta.url));
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
