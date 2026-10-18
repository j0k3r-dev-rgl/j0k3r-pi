import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { computeFlowIdentity, resolveSupervisorDir } from './config.ts';
import { withExclusiveFileLock, writeJsonAtomic } from './atomic-json.ts';

export type ConfigurationScope = 'project' | 'global';
export type ConfigurationKind = 'supervisor' | 'subagents';
export interface ConfigurationLocation {
  scope: ConfigurationScope | 'legacy' | 'unavailable';
  path: string;
}
export interface ConfigurationScopeControl<T> {
  location: ConfigurationLocation;
  select: (scope: ConfigurationScope) => { config: T; location: ConfigurationLocation; error?: string };
}

// The extension host supplies this public module. Standalone node tests intentionally do
// not require Pi; only an explicit Pi environment override is usable without its API.
let host: { getAgentDir?: () => string; CONFIG_DIR_NAME?: string } | undefined;
try { host = await import('@earendil-works/pi-coding-agent'); } catch { /* no host in standalone tests */ }

function agentDirectory(): string {
  const configured = host?.getAgentDir?.();
  if (configured) return resolve(configured);
  const env = process.env.PI_CODING_AGENT_DIR;
  if (!env) throw new Error('Global supervisor configuration unavailable: Pi did not provide its agent directory');
  return resolve(env === '~' ? homedir() : env.startsWith('~/') ? join(homedir(), env.slice(2)) : env);
}

const projectDirectoryName = (): string => host?.CONFIG_DIR_NAME || '.pi';
function exists(path: string): boolean {
  try { statSync(path); return true; } catch (error: any) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

/** Preferences may follow a repository root; runtime/session identities must not. */
export function resolveConfigurationProjectRoot(cwd: string): string {
  const start = realpathSync(cwd);
  let current = start;
  let nearestPi: string | undefined;
  for (;;) {
    if (exists(join(current, '.git'))) return current; // directory or worktree .git file
    if (!nearestPi && exists(join(current, projectDirectoryName()))) nearestPi = current;
    const parent = dirname(current);
    if (parent === current) return nearestPi ?? start;
    current = parent;
  }
}

function selectionPath(cwd: string, kind: ConfigurationKind, flowKey?: string): string {
  return join(resolveSupervisorDir(computeFlowIdentity(resolveConfigurationProjectRoot(cwd), flowKey)), `${kind}-scope.json`);
}

function readSelection(path: string): ConfigurationScope | undefined {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch (error: any) {
    if (error.code === 'ENOENT') return undefined;
    throw new Error(`Failed to read configuration scope: ${error.message}`);
  }
  let value: any;
  try { value = JSON.parse(text); } catch { throw new Error('Malformed configuration scope: invalid JSON'); }
  if (!value || Array.isArray(value) || value.version !== 1 || !['project', 'global'].includes(value.scope)) {
    throw new Error('Malformed configuration scope: expected version 1 and project or global scope');
  }
  return value.scope;
}

function scopedPath(cwd: string, kind: ConfigurationKind, scope: ConfigurationScope): string {
  const base = scope === 'global' ? agentDirectory() : join(resolveConfigurationProjectRoot(cwd), projectDirectoryName());
  return join(base, 'orchestrator-supervisor', `${kind}.json`);
}

export function resolveConfigurationLocation(cwd: string, kind: ConfigurationKind, flowKey?: string): ConfigurationLocation {
  const scope = readSelection(selectionPath(cwd, kind, flowKey));
  if (scope) return { scope, path: scopedPath(cwd, kind, scope) };
  return { scope: 'legacy', path: join(resolveSupervisorDir(computeFlowIdentity(cwd, flowKey)), `${kind}.json`) };
}

/** Serialize writes with scope selection, then let the caller lock the selected document. */
export function withConfigurationLocation<T>(cwd: string, kind: ConfigurationKind, flowKey: string | undefined, action: (location: ConfigurationLocation) => T): T {
  return withExclusiveFileLock(selectionPath(cwd, kind, flowKey), 'configuration scope', () => action(resolveConfigurationLocation(cwd, kind, flowKey)));
}

/** Validate the destination before committing the choice. Never copy/overwrite preferences. */
export function selectConfigurationScope<T>(cwd: string, kind: ConfigurationKind, scope: ConfigurationScope, read: (path: string) => T, flowKey?: string): { value: T; location: ConfigurationLocation } {
  if (scope !== 'project' && scope !== 'global') throw new Error('Invalid configuration scope: expected project or global');
  const path = selectionPath(cwd, kind, flowKey);
  return withExclusiveFileLock(path, 'configuration scope', () => {
    readSelection(path); // An unusable selection must never be silently repaired.
    const location = { scope, path: scopedPath(cwd, kind, scope) };
    return withExclusiveFileLock(location.path, `${kind} configuration`, () => {
      const value = read(location.path);
      writeJsonAtomic(path, { version: 1, scope }, 'configuration scope');
      return { value, location };
    });
  });
}
