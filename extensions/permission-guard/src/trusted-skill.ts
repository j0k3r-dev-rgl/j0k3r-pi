import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { isPathContainedByRoot } from './path-policy.js';
import type { PermissionRequest } from './types.js';

type Target = NonNullable<PermissionRequest['target']>;
type SkillRootMode = 'pi' | 'agents';

interface SkillRoot {
  root: string;
  mode: SkillRootMode;
}

function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}

function realpathIfPossible(path: string): string | undefined {
  try {
    return realpathSync.native(path);
  } catch {
    return undefined;
  }
}

function resolveAgentHome(env: Record<string, string | undefined>, homeDir: string): string {
  return resolve(env.PI_CODING_AGENT_DIR ?? join(homeDir, '.pi', 'agent'));
}

function findGitRepoRoot(startDir: string): string | undefined {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir || dir === parse(dir).root) return undefined;
    dir = parent;
  }
}

function collectAncestorAgentsSkillRoots(startDir: string): string[] {
  const roots: string[] = [];
  const gitRepoRoot = findGitRepoRoot(startDir);
  let dir = resolve(startDir);
  while (true) {
    roots.push(join(dir, '.agents', 'skills'));
    if (gitRepoRoot && dir === gitRepoRoot) break;
    const parent = dirname(dir);
    if (parent === dir || dir === parse(dir).root) break;
    dir = parent;
  }
  return roots;
}

function trustedSkillRoots(workspaceRoot: string): SkillRoot[] {
  const env = process.env;
  const home = env.HOME ?? homedir();
  const agentHome = resolveAgentHome(env, home);
  const userAgentsSkills = resolve(home, '.agents', 'skills');
  const roots: SkillRoot[] = [
    { root: join(agentHome, 'skills'), mode: 'pi' },
    { root: userAgentsSkills, mode: 'agents' },
    { root: join(resolve(workspaceRoot), '.pi', 'skills'), mode: 'pi' },
    ...collectAncestorAgentsSkillRoots(workspaceRoot)
      .filter((root) => resolve(root) !== userAgentsSkills)
      .map((root): SkillRoot => ({ root, mode: 'agents' })),
  ];

  const seen = new Set<string>();
  return roots.filter((entry) => {
    const key = `${entry.mode}:${resolve(entry.root)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isSafeSkillRelativePath(relativePath: string): boolean {
  const segments = toPosixPath(relativePath).split('/').filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every((segment) => segment !== 'node_modules' && !segment.startsWith('.'));
}

function isDiscoverableSkillFile(target: Target, root: SkillRoot): boolean {
  const rootPath = resolve(root.root);
  const targetPath = resolve(target.normalizedAbsolute);
  if (!target.exists || target.kind !== 'file') return false;
  if (!isPathContainedByRoot(targetPath, rootPath)) return false;

  const rootRealpath = realpathIfPossible(rootPath);
  if (!rootRealpath || !target.resolvedRealpath) return false;
  if (!isPathContainedByRoot(target.resolvedRealpath, rootRealpath)) return false;

  const relativePath = relative(rootPath, targetPath);
  if (!isSafeSkillRelativePath(relativePath)) return false;

  const fileName = basename(targetPath);
  if (fileName === 'SKILL.md') return true;
  return root.mode === 'pi' && dirname(targetPath) === rootPath && fileName.endsWith('.md');
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function hasIndentedMultilineValue(lines: string[], startIndex: number): boolean {
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\S[^:]*:\s*/.test(line)) return false;
    if (/^\s+\S/.test(line)) return true;
  }
  return false;
}

function frontmatterHasLoadableDescription(yaml: string): boolean {
  const lines = yaml.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^description\s*:\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const rawValue = match[1].trim();
    if (rawValue === '|' || rawValue === '>' || rawValue.startsWith('|') || rawValue.startsWith('>')) {
      return hasIndentedMultilineValue(lines, index);
    }
    return unquoteYamlScalar(rawValue).trim().length > 0;
  }
  return false;
}

function hasLoadableSkillFrontmatter(path: string): boolean {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return false;
  }

  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.startsWith('---')) return false;
  const endIndex = normalized.indexOf('\n---', 3);
  if (endIndex === -1) return false;
  return frontmatterHasLoadableDescription(normalized.slice(4, endIndex));
}

export function isTrustedSkillReadRequest(request: PermissionRequest): boolean {
  if (request.tool !== 'read' || request.action !== 'read' || !request.target) return false;
  if (isAbsolute(request.target.raw) && resolve(request.target.raw) !== request.target.normalizedAbsolute) return false;

  const root = trustedSkillRoots(request.target.workspaceRoot).find((candidate) => isDiscoverableSkillFile(request.target!, candidate));
  if (!root) return false;
  return hasLoadableSkillFrontmatter(request.target.normalizedAbsolute);
}
