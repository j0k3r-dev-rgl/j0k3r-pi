import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export interface DiscoveredSubagent {
  name: string;
  scope: 'global' | 'project';
}

let host: { getAgentDir?: () => string; CONFIG_DIR_NAME?: string } | undefined;
try { host = await import('@earendil-works/pi-coding-agent'); } catch { /* standalone tests */ }

function resolveOptionalAgentDir(): string | undefined {
  const configured = host?.getAgentDir?.();
  if (configured) return resolve(configured);
  const env = process.env.PI_CODING_AGENT_DIR;
  if (!env) return undefined;
  return resolve(env === '~' ? homedir() : env.startsWith('~/') ? join(homedir(), env.slice(2)) : env);
}

function projectConfigDirName(): string {
  return host?.CONFIG_DIR_NAME || '.pi';
}

function extractFrontmatterName(content: string, fallbackName: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (match) {
    const nameMatch = match[1].match(/^name:\s*["']?([^"'\r\n]+)["']?\s*$/m);
    if (nameMatch?.[1]?.trim()) return nameMatch[1].trim().toLowerCase();
  }
  return fallbackName.trim().toLowerCase();
}

function readSubagentDir(dir: string, scope: 'global' | 'project', byName: Map<string, DiscoveredSubagent>): void {
  if (!existsSync(dir)) return;
  let files: string[];
  try {
    files = readdirSync(dir).filter(file => file.endsWith('.md')).sort();
  } catch {
    return;
  }
  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), 'utf8');
      const name = extractFrontmatterName(content, basename(file, '.md'));
      if (name) byName.set(name, { name, scope });
    } catch {
      // Skip unreadable definition files.
    }
  }
}

/**
 * Discovers subagent definitions in the same directory precedence as `extensions/subagents`
 * (`<agentDir>/agents`, `<agentDir>/subagents`, `<cwd>/.pi/agents`, `<cwd>/.pi/subagents`),
 * without introducing any cross-extension runtime dependency.
 */
export function discoverSubagents(cwd: string): DiscoveredSubagent[] {
  const byName = new Map<string, DiscoveredSubagent>();
  const agentDir = resolveOptionalAgentDir();
  if (agentDir) {
    readSubagentDir(join(agentDir, 'agents'), 'global', byName);
    readSubagentDir(join(agentDir, 'subagents'), 'global', byName);
  }
  const configDir = projectConfigDirName();
  readSubagentDir(join(cwd, configDir, 'agents'), 'project', byName);
  readSubagentDir(join(cwd, configDir, 'subagents'), 'project', byName);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
