import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelRef, SubagentDefinition, SubagentsConfig, ThinkingEffort } from './types.js';

const DEFAULT_TOOLS = ['read', 'memory_context', 'memory_search', 'memory_recall', 'memory_get'];
const DEFAULT_MAX_CONCURRENCY = 5;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_STALL_TIMEOUT_MS = 2 * 60 * 1000;
const BLOCKED_SUBAGENT_TOOLS = new Set([
  'subagent_run',
  'subagent_list_agents',
  'subagent_status',
  'subagent_result',
  'subagent_list_tasks',
  'subagent_cancel',
]);

function sanitizeTools(tools: string[]): string[] {
  return tools.map(String).filter((tool) => !BLOCKED_SUBAGENT_TOOLS.has(tool) && !tool.startsWith('subagent_'));
}

function parseScalar(value: string): any {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^['"]|['"]$/g, '');
}

export function parseFrontmatter(text: string): { data: Record<string, any>; body: string } {
  if (!text.startsWith('---\n')) return { data: {}, body: text };
  const end = text.indexOf('\n---', 4);
  if (end === -1) return { data: {}, body: text };
  const raw = text.slice(4, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, '');
  const data: Record<string, any> = {};
  let currentKey: string | undefined;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const list = line.match(/^\s*-\s+(.+)$/);
    if (list && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(parseScalar(list[1]));
      continue;
    }
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    currentKey = m[1];
    const value = m[2];
    if (!value) data[currentKey] = [];
    else data[currentKey] = parseScalar(value);
  }
  return { data, body };
}

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
}

function readJson(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function positiveNumber(value: any, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value: any, fallback: number): number {
  return Math.max(1, Math.floor(positiveNumber(value, fallback)));
}

function parseModel(value: any): ModelRef | undefined {
  if (!value || value === 'default') return undefined;
  if (typeof value === 'string') {
    const [provider, id] = value.split('/');
    return provider && id ? { provider, id } : undefined;
  }
  if (typeof value === 'object' && typeof value.provider === 'string' && typeof value.id === 'string') return { provider: value.provider, id: value.id };
  return undefined;
}

const THINKING_EFFORTS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);

function parseEffort(value: any): ThinkingEffort | undefined {
  if (!value || value === 'default') return undefined;
  const effort = String(value).trim().toLowerCase();
  return THINKING_EFFORTS.has(effort) ? effort as ThinkingEffort : undefined;
}

export function readSubagentsConfig(cwd: string): SubagentsConfig {
  const globalRaw = readJson(path.join(agentDir(), 'subagents.json'));
  const projectRaw = readJson(path.join(cwd, '.pi', 'subagents.json'));
  const raw = { ...globalRaw, ...projectRaw };
  return {
    default_model: parseModel(raw.default_model),
    default_effort: parseEffort(raw.default_effort ?? raw.default_thinking_level ?? raw.thinkingLevel),
    timeout_ms: positiveInteger(raw.timeout_ms, DEFAULT_TIMEOUT_MS),
    stall_timeout_ms: positiveInteger(raw.stall_timeout_ms, DEFAULT_STALL_TIMEOUT_MS),
    max_concurrency: positiveInteger(raw.max_concurrency, DEFAULT_MAX_CONCURRENCY),
    default_tools: sanitizeTools(Array.isArray(raw.default_tools) ? raw.default_tools.map(String) : DEFAULT_TOOLS),
  };
}

function loadSubagentsFromDir(dir: string): SubagentDefinition[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) => {
      const filePath = path.join(dir, file);
      const { data, body } = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
      const name = String(data.name || path.basename(file, '.md')).trim().toLowerCase();
      const description = String(data.description || `${name} subagent`).trim();
      const tools = sanitizeTools(Array.isArray(data.tools) ? data.tools.map(String) : DEFAULT_TOOLS);
      return { name, description, filePath, instructions: body.trim(), model: parseModel(data.model), effort: parseEffort(data.effort ?? data.thinking_level ?? data.thinkingLevel), tools };
    });
}

export function loadSubagents(cwd: string): SubagentDefinition[] {
  const byName = new Map<string, SubagentDefinition>();
  for (const agent of loadSubagentsFromDir(path.join(agentDir(), 'subagents'))) byName.set(agent.name, agent);
  for (const agent of loadSubagentsFromDir(path.join(cwd, '.pi', 'subagents'))) byName.set(agent.name, agent);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getSubagent(cwd: string, name: string): SubagentDefinition | undefined {
  return loadSubagents(cwd).find((a) => a.name === name.toLowerCase());
}
