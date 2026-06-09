import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelRef, SubagentDefinition, SubagentModelProfile, SubagentModelProfiles, SubagentsConfig, ThinkingEffort } from './types.js';

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

function subagentsConfigPath(dir = agentDir()): string {
  return path.join(dir, 'subagents.json');
}

function readJson(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveNumber(value: any, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value: any, fallback: number): number {
  return Math.max(1, Math.floor(positiveNumber(value, fallback)));
}

export function parseModel(value: any): ModelRef | undefined {
  if (!value || value === 'default') return undefined;
  if (typeof value === 'string') {
    const parts = value.split('/');
    if (parts.length !== 2) return undefined;
    const [provider, id] = parts.map((part) => part.trim());
    return provider && id ? { provider, id } : undefined;
  }
  if (isPlainObject(value) && typeof value.provider === 'string' && typeof value.id === 'string') {
    const provider = value.provider.trim();
    const id = value.id.trim();
    return provider && id ? { provider, id } : undefined;
  }
  return undefined;
}

const THINKING_EFFORTS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);

export function parseEffort(value: any): ThinkingEffort | undefined {
  if (!value || value === 'default') return undefined;
  const effort = String(value).trim().toLowerCase();
  return THINKING_EFFORTS.has(effort) ? effort as ThinkingEffort : undefined;
}

function parseModelProfile(value: unknown): SubagentModelProfile | undefined {
  if (!isPlainObject(value)) return undefined;
  const profile: SubagentModelProfile = {};
  const model = parseModel(value.model);
  const effort = parseEffort(value.effort ?? value.thinking_level ?? value.thinkingLevel);
  if (model) profile.model = model;
  if (effort) profile.effort = effort;
  return Object.keys(profile).length ? profile : undefined;
}

function parseModelProfiles(value: unknown): SubagentModelProfiles {
  if (!isPlainObject(value)) return {};
  const profiles: SubagentModelProfiles = {};
  for (const [name, rawProfile] of Object.entries(value)) {
    const normalizedName = name.trim();
    if (!normalizedName) continue;
    const profile = parseModelProfile(rawProfile);
    if (profile) profiles[normalizedName] = profile;
  }
  return profiles;
}

function mergeModelProfiles(globalRaw: unknown, projectRaw: unknown): SubagentModelProfiles {
  const globalProfiles = parseModelProfiles(globalRaw);
  const projectProfiles = parseModelProfiles(projectRaw);
  const merged: SubagentModelProfiles = { ...globalProfiles };
  for (const [name, projectProfile] of Object.entries(projectProfiles)) {
    merged[name] = { ...(merged[name] ?? {}), ...projectProfile };
  }
  return merged;
}

function serializeModelRef(model: ModelRef): string {
  return `${model.provider}/${model.id}`;
}

function cleanProfile(profile: SubagentModelProfile): Record<string, string> | undefined {
  const cleaned: Record<string, string> = {};
  if (profile.model) cleaned.model = serializeModelRef(profile.model);
  if (profile.effort) cleaned.effort = profile.effort;
  return Object.keys(cleaned).length ? cleaned : undefined;
}

export function readSubagentsConfig(cwd: string): SubagentsConfig {
  const globalRaw = readJson(subagentsConfigPath());
  const projectRaw = readJson(path.join(cwd, '.pi', 'subagents.json'));
  const raw = { ...globalRaw, ...projectRaw };
  return {
    default_model: parseModel(raw.default_model),
    default_effort: parseEffort(raw.default_effort ?? raw.default_thinking_level ?? raw.thinkingLevel),
    model_profiles: mergeModelProfiles(globalRaw.model_profiles, projectRaw.model_profiles),
    timeout_ms: positiveInteger(raw.timeout_ms, DEFAULT_TIMEOUT_MS),
    stall_timeout_ms: positiveInteger(raw.stall_timeout_ms, DEFAULT_STALL_TIMEOUT_MS),
    max_concurrency: positiveInteger(raw.max_concurrency, DEFAULT_MAX_CONCURRENCY),
    default_tools: sanitizeTools(Array.isArray(raw.default_tools) ? raw.default_tools.map(String) : DEFAULT_TOOLS),
  };
}

export function saveGlobalSubagentModelProfile(input: { agentName: string; profile: SubagentModelProfile; agentDir?: string }): void {
  const file = subagentsConfigPath(input.agentDir);
  const root = readJson(file);
  const writableRoot: Record<string, unknown> = isPlainObject(root) ? { ...root } : {};
  const modelProfiles = isPlainObject(writableRoot.model_profiles) ? { ...writableRoot.model_profiles } : {};
  const agentName = input.agentName.trim().toLowerCase();
  const cleaned = cleanProfile(input.profile);
  if (agentName && cleaned) modelProfiles[agentName] = cleaned;
  if (Object.keys(modelProfiles).length) writableRoot.model_profiles = modelProfiles;
  else delete writableRoot.model_profiles;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(writableRoot, null, 2)}\n`, 'utf8');
}

export function resetGlobalSubagentModelProfileField(input: { agentName: string; field: 'model' | 'effort'; agentDir?: string }): void {
  const file = subagentsConfigPath(input.agentDir);
  const root = readJson(file);
  const writableRoot: Record<string, unknown> = isPlainObject(root) ? { ...root } : {};
  const modelProfiles = isPlainObject(writableRoot.model_profiles) ? { ...writableRoot.model_profiles } : {};
  const agentName = input.agentName.trim().toLowerCase();
  const existing = isPlainObject(modelProfiles[agentName]) ? { ...modelProfiles[agentName] } : {};
  delete existing[input.field];
  if (Object.keys(existing).length) modelProfiles[agentName] = existing;
  else delete modelProfiles[agentName];
  if (Object.keys(modelProfiles).length) writableRoot.model_profiles = modelProfiles;
  else delete writableRoot.model_profiles;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(writableRoot, null, 2)}\n`, 'utf8');
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
