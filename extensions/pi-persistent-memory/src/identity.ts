import { homedir } from 'node:os';
import { resolve, join, basename } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { Scope } from './types.ts';

export function encodeScope(scope: Scope): string {
  if (scope.kind === 'global') {
    return '["global"]';
  }
  return JSON.stringify(['project', scope.project]);
}

export function decodeScope(raw: string): Scope {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      if (parsed[0] === 'global' && parsed.length === 1) {
        return { kind: 'global' };
      }
      if (parsed[0] === 'project' && typeof parsed[1] === 'string' && parsed[1].length > 0) {
        return { kind: 'project', project: parsed[1] };
      }
    }
  } catch {}
  throw new Error(`Invalid encoded scope: ${raw}`);
}

export function normalizeGitRemote(rawUrl: string): string {
  const url = rawUrl.trim();

  // Reject local file paths or file:// URLs
  if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../') || url.startsWith('file://')) {
    throw new Error(`unsupported_remote: Local or file remotes are unsupported: ${url}`);
  }

  // Reject query params or fragments
  if (url.includes('?') || url.includes('#')) {
    throw new Error(`unsupported_remote: URLs with query or fragment are unsupported: ${url}`);
  }

  // 1. Check SCP-like SSH: git@host:owner/repo.git
  const scpMatch = url.match(/^([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+):(.+)$/);
  if (scpMatch) {
    const host = scpMatch[2].toLowerCase();
    const repoPath = scpMatch[3].replace(/^\/+/, '').replace(/\.git$/, '');
    if (!repoPath) throw new Error(`unsupported_remote: Missing repository path in ${url}`);
    return `${host}/${repoPath}`;
  }

  // 2. Check SSH URL: ssh://git@host[:port]/owner/repo.git
  const sshMatch = url.match(/^ssh:\/\/([^@]+@)?([^\/:]+)(:(\d+))?\/(.+)$/);
  if (sshMatch) {
    const port = sshMatch[4];
    if (port && port !== '22') {
      throw new Error(`unsupported_remote: Non-standard SSH port ${port} is unsupported`);
    }
    const host = sshMatch[2].toLowerCase();
    const repoPath = sshMatch[5].replace(/^\/+/, '').replace(/\.git$/, '');
    if (!repoPath) throw new Error(`unsupported_remote: Missing repository path in ${url}`);
    return `${host}/${repoPath}`;
  }

  // 3. Check HTTPS: https://[creds@]host[:port]/path
  if (url.startsWith('https://')) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') {
        throw new Error(`unsupported_remote: Protocol ${u.protocol} unsupported`);
      }
      if (u.port && u.port !== '443') {
        throw new Error(`unsupported_remote: Non-standard HTTPS port ${u.port} is unsupported`);
      }
      const host = u.hostname.toLowerCase();
      const repoPath = u.pathname.replace(/^\/+/, '').replace(/\.git$/, '');
      if (!repoPath) throw new Error(`unsupported_remote: Missing repository path in ${url}`);
      return `${host}/${repoPath}`;
    } catch (err: any) {
      if (err.message.includes('unsupported_remote')) throw err;
      throw new Error(`unsupported_remote: Malformed HTTPS URL ${url}`);
    }
  }

  throw new Error(`unsupported_remote: Unrecognized remote URL format: ${url}`);
}

export function resolveScope(
  cwd: string,
  options?: { isProjectTrusted?: () => boolean },
): Scope {
  const resolvedCwd = resolve(cwd);
  const home = resolve(homedir());

  // Exact home directory resolves to global
  if (resolvedCwd === home) {
    return { kind: 'global' };
  }

  // Check trust
  const trusted = options?.isProjectTrusted ? options.isProjectTrusted() : true;
  if (!trusted) {
    throw new Error('project_not_trusted: Project folder is not trusted');
  }

  // Check .pi/memory.json
  const configPath = join(resolvedCwd, '.pi', 'memory.json');
  if (existsSync(configPath)) {
    let parsed: any;
    try {
      parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch {
      throw new Error(`invalid_memory_config: Failed to parse ${configPath}`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`invalid_memory_config: Config in ${configPath} must be a JSON object`);
    }

    if (typeof parsed.project_name !== 'string' || parsed.project_name.trim().length === 0) {
      throw new Error(`invalid_project_name: 'project_name' in ${configPath} must be a non-empty string`);
    }

    return { kind: 'project', project: parsed.project_name.trim() };
  }

  // Check git remotes
  try {
    const rawOutput = execFileSync('git', ['remote', '-v'], {
      cwd: resolvedCwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const lines = rawOutput.split('\n').filter((l) => l.trim().length > 0);
    const remotesMap = new Map<string, string>();

    for (const line of lines) {
      const match = line.match(/^([^\s]+)\s+([^\s]+)\s+\((fetch|push)\)$/);
      if (match) {
        const [, name, url, type] = match;
        // Prefer fetch URL or take first seen
        if (type === 'fetch' || !remotesMap.has(name)) {
          remotesMap.set(name, url);
        }
      }
    }

    if (remotesMap.size > 0) {
      const sortedNames = [...remotesMap.keys()].sort((a, b) => a.localeCompare(b));
      const chosenName = sortedNames[0];
      const chosenUrl = remotesMap.get(chosenName)!;
      const normalized = normalizeGitRemote(chosenUrl);
      return { kind: 'project', project: normalized };
    }
  } catch (err: any) {
    if (err?.message?.includes('unsupported_remote')) {
      throw err;
    }
    // git failed (not a git repo) or no remotes -> fall through to basename
  }

  return { kind: 'project', project: basename(resolvedCwd) };
}
