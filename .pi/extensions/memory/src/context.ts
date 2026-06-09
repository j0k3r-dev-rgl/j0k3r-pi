import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { readProjectMemoryConfig } from './config.js';
import type { ResolvedContext } from './types.js';
import { slug } from './utils.js';

function runGit(args: string[], cwd: string): string | undefined {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim(); }
  catch { return undefined; }
}

export function parseGitRemote(remote: string): { projectId: string; projectName: string } | undefined {
  const clean = remote.trim().replace(/\.git$/, '');
  let host = '', owner = '', repo = '';
  let m = clean.match(/^git@([^:]+):(.+)\/([^/]+)$/);
  if (m) [, host, owner, repo] = m;
  else {
    m = clean.match(/^https?:\/\/([^/]+)\/(.+)\/([^/]+)$/);
    if (m) [, host, owner, repo] = m;
  }
  if (!host || !owner || !repo) return undefined;
  return { projectId: `git:${host}/${owner}/${repo}`, projectName: repo };
}

export function resolveMemoryContext(cwd = process.cwd(), home = os.homedir(), env: NodeJS.ProcessEnv = process.env): ResolvedContext {
  const absCwd = path.resolve(cwd);
  const absHome = path.resolve(home);
  const config = readProjectMemoryConfig(absCwd, env);
  const warnings = [...config.warnings];

  if (absCwd === absHome) return { scope: 'general', project_id: null, project_name: null, source: 'home', cwd: absCwd, config, warnings };

  if (config.project_name) {
    return { scope: 'project', project_id: `project:${slug(config.project_name)}`, project_name: config.project_name, source: '.pi/memory.json', cwd: absCwd, config, warnings };
  }

  const gitRoot = runGit(['rev-parse', '--show-toplevel'], absCwd);
  if (gitRoot) {
    const remote = runGit(['config', '--get', 'remote.origin.url'], gitRoot);
    if (remote) {
      const parsed = parseGitRemote(remote);
      if (parsed) return { scope: 'project', project_id: parsed.projectId, project_name: parsed.projectName, source: 'git_remote', cwd: absCwd, git_root: gitRoot, config, warnings };
    }
    const name = path.basename(gitRoot);
    return { scope: 'project', project_id: `project:${slug(name)}`, project_name: name, source: 'git_root', cwd: absCwd, git_root: gitRoot, config, warnings };
  }

  const folder = path.basename(absCwd);
  return { scope: 'project', project_id: `project:${slug(folder)}`, project_name: folder, source: 'folder', cwd: absCwd, config, warnings };
}
