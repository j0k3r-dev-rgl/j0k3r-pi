import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const SCHEMA_VERSION = 1;
export const PROJECT_SKILL_ROOTS = ['.pi/skills', '.agents/skills'] as const;
export const GLOBAL_SKILL_ROOTS = ['.pi/agent/skills', '.agents/skills'] as const;

export type SkillScope = 'project' | 'global';

export type RegistryContract = Record<string, unknown> & {
  category?: string;
  domains?: string[];
  triggers?: { paths?: string[]; keywords?: string[]; [key: string]: unknown };
  sdd_phases?: string[];
  related_skills?: string[];
  priority?: number;
};

export type SkillRegistryEntry = {
  name: string;
  description: string;
  scope: SkillScope;
  path: string;
  title?: string;
  metadata: Record<string, unknown>;
  registry_contract: RegistryContract;
  routing: {
    category: string | null;
    domains: string[];
    triggers: Record<string, unknown>;
    sdd_phases: string[];
    related_skills: string[];
    priority: number;
  };
};

export type SkillRegistry = {
  schema_version: number;
  generated_by: string;
  roots: Array<{ scope: SkillScope; path: string }>;
  skill_count: number;
  warnings: string[];
  skills: SkillRegistryEntry[];
  content_hash: string;
};

type GenerateOptions = { cwd?: string; homeDir?: string };

function slash(value: string): string {
  return value.split(path.sep).join('/');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try { return JSON.parse(trimmed) as string; } catch { return trimmed.slice(1, -1); }
  }
  return trimmed;
}

function parseFrontmatter(text: string): { data: Record<string, any>; body: string } {
  if (!text.startsWith('---\n')) return { data: {}, body: text };
  const end = text.indexOf('\n---', 4);
  if (end === -1) return { data: {}, body: text };
  const raw = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\r?\n/, '');
  const data: Record<string, any> = {};
  let currentMap: string | undefined;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const mapMatch = line.match(/^([A-Za-z0-9_-]+):\s*$/);
    if (mapMatch) {
      currentMap = mapMatch[1];
      data[currentMap] = {};
      continue;
    }
    const nested = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (nested && currentMap && data[currentMap] && typeof data[currentMap] === 'object') {
      data[currentMap][nested[1]] = stripQuotes(nested[2]);
      continue;
    }
    currentMap = undefined;
    const scalar = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (scalar) data[scalar[1]] = stripQuotes(scalar[2]);
  }
  return { data, body };
}

function extractTitle(body: string): string | undefined {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function extractRegistryContract(body: string, skillName: string, skillPath: string, warnings: string[]): RegistryContract {
  const heading = body.search(/^##\s+Registry Contract\s*$/mi);
  if (heading === -1) {
    warnings.push(`${skillName}: missing registry contract in ${skillPath}`);
    return {};
  }
  const afterHeading = body.slice(heading);
  const code = afterHeading.match(/```json\s*([\s\S]*?)```/i);
  if (!code) {
    warnings.push(`${skillName}: registry contract must contain a json code block in ${skillPath}`);
    return {};
  }
  try {
    const parsed = JSON.parse(code[1]) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as RegistryContract : {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`${skillName}: invalid registry contract json in ${skillPath}: ${message}`);
    return {};
  }
}

async function entriesOrUndefined(dir: string) {
  try { return await readdir(dir, { withFileTypes: true }); } catch { return undefined; }
}

async function findSkillFiles(root: string, { allowRootMarkdown = false } = {}): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await entriesOrUndefined(dir);
    if (!entries) return;
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && (entry.name === 'SKILL.md' || (allowRootMarkdown && dir === root && entry.name.endsWith('.md')))) found.push(full);
    }
  }
  await walk(root);
  return found;
}

function displayPath(filePath: string, cwd: string, homeDir: string, scope: SkillScope): string {
  const abs = path.resolve(filePath);
  if (scope === 'project') return slash(path.relative(cwd, abs));
  const relHome = path.relative(homeDir, abs);
  if (!relHome.startsWith('..') && !path.isAbsolute(relHome)) return `~/${slash(relHome)}`;
  return slash(abs);
}

async function parseSkill(filePath: string, input: { cwd: string; homeDir: string; scope: SkillScope; warnings: string[] }): Promise<SkillRegistryEntry> {
  const text = await readFile(filePath, 'utf8');
  const { data, body } = parseFrontmatter(text);
  const name = data.name || path.basename(filePath, path.extname(filePath));
  const skillPath = displayPath(filePath, input.cwd, input.homeDir, input.scope);
  const registryContract = extractRegistryContract(body, name, skillPath, input.warnings);
  const triggers = registryContract.triggers && typeof registryContract.triggers === 'object' && !Array.isArray(registryContract.triggers)
    ? registryContract.triggers as Record<string, unknown>
    : {};
  const priority = Number.isFinite(Number(registryContract.priority)) ? Number(registryContract.priority) : 0;
  return {
    name,
    description: data.description || '',
    scope: input.scope,
    path: skillPath,
    title: extractTitle(body),
    metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {},
    registry_contract: registryContract,
    routing: {
      category: typeof registryContract.category === 'string' ? registryContract.category : null,
      domains: isStringArray(registryContract.domains) ? registryContract.domains : [],
      triggers,
      sdd_phases: isStringArray(registryContract.sdd_phases) ? registryContract.sdd_phases : [],
      related_skills: isStringArray(registryContract.related_skills) ? registryContract.related_skills : [],
      priority,
    },
  };
}

async function collectSkillFiles(input: { cwd: string; homeDir: string }) {
  const roots = [
    ...PROJECT_SKILL_ROOTS.map((rel) => ({ scope: 'project' as const, root: path.join(input.cwd, rel), display: rel, allowRootMarkdown: rel === '.pi/skills' })),
    ...GLOBAL_SKILL_ROOTS.map((rel) => ({ scope: 'global' as const, root: path.join(input.homeDir, rel), display: `~/${rel}`, allowRootMarkdown: rel === '.pi/agent/skills' })),
  ];

  const files: Array<typeof roots[number] & { file: string }> = [];
  for (const root of roots) {
    for (const file of await findSkillFiles(root.root, { allowRootMarkdown: root.allowRootMarkdown })) files.push({ ...root, file });
  }
  return { roots, files };
}

export async function generateSkillRegistry(options: GenerateOptions = {}): Promise<SkillRegistry> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const warnings: string[] = [];
  const { roots, files } = await collectSkillFiles({ cwd, homeDir });
  const skills: SkillRegistryEntry[] = [];
  const seen = new Set<string>();

  files.sort((a, b) => displayPath(a.file, cwd, homeDir, a.scope).localeCompare(displayPath(b.file, cwd, homeDir, b.scope)));
  for (const item of files) {
    const skill = await parseSkill(item.file, { cwd, homeDir, scope: item.scope, warnings });
    if (seen.has(skill.name)) {
      warnings.push(`${skill.name}: duplicate skill name ignored from ${skill.path}`);
      continue;
    }
    seen.add(skill.name);
    skills.push(skill);
  }

  skills.sort((a, b) => (b.routing.priority - a.routing.priority) || a.name.localeCompare(b.name));
  const generatedRoots = roots.map((root) => ({ scope: root.scope, path: root.display }));
  const sortedWarnings = warnings.sort();
  const hashPayload = { schema_version: SCHEMA_VERSION, roots: generatedRoots, skills, warnings: sortedWarnings };
  const registry = {
    schema_version: SCHEMA_VERSION,
    generated_by: 'skill-registry-extension',
    roots: generatedRoots,
    skill_count: skills.length,
    warnings: sortedWarnings,
    skills,
    content_hash: sha256(stableJson(hashPayload)),
  } satisfies SkillRegistry;
  return registry;
}

export function renderSkillRegistryMarkdown(registry: SkillRegistry): string {
  const lines = [
    '# Skill Registry',
    '',
    '<!-- generated by skill-registry extension; do not edit by hand -->',
    '',
    `schema_version: ${registry.schema_version}`,
    `content_hash: ${registry.content_hash}`,
    `skill_count: ${registry.skill_count}`,
    '',
    '## Roots',
    '',
    ...registry.roots.map((root) => `- ${root.scope}: \`${root.path}\``),
    '',
  ];

  if (registry.warnings.length) lines.push('## Warnings', '', ...registry.warnings.map((warning) => `- ${warning}`), '');

  lines.push('## Skills', '');
  for (const skill of registry.skills) {
    const triggers = skill.routing.triggers ?? {};
    const paths = isStringArray(triggers.paths) ? triggers.paths : [];
    const keywords = isStringArray(triggers.keywords) ? triggers.keywords : [];
    lines.push(
      `### ${skill.name}`,
      '',
      `- path: \`${skill.path}\``,
      `- scope: ${skill.scope}`,
      `- priority: ${skill.routing.priority}`,
      `- category: ${skill.routing.category ?? 'n/a'}`,
      `- domains: ${skill.routing.domains.length ? skill.routing.domains.join(', ') : 'n/a'}`,
      `- sdd phases: ${skill.routing.sdd_phases.length ? skill.routing.sdd_phases.join(', ') : 'n/a'}`,
      `- description: ${skill.description || 'n/a'}`,
      `- path triggers: ${paths.length ? paths.map((item) => `\`${item}\``).join(', ') : 'n/a'}`,
      `- keyword triggers: ${keywords.length ? keywords.map((item) => `\`${item}\``).join(', ') : 'n/a'}`,
      `- related skills: ${skill.routing.related_skills.length ? skill.routing.related_skills.join(', ') : 'n/a'}`,
      '',
    );
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

async function writeIfChanged(filePath: string, content: string): Promise<boolean> {
  try {
    const current = await readFile(filePath, 'utf8');
    if (current === content) return false;
  } catch {}
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  return true;
}

export async function writeSkillRegistry(input: { cwd?: string; registry: SkillRegistry }): Promise<{ json_changed: boolean; markdown_changed: boolean }> {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const outDir = path.join(cwd, '.pi');
  const json_changed = await writeIfChanged(path.join(outDir, 'skill-registry.json'), `${JSON.stringify(input.registry, null, 2)}\n`);
  const markdown_changed = await writeIfChanged(path.join(outDir, 'skill-registry.md'), renderSkillRegistryMarkdown(input.registry));
  return { json_changed, markdown_changed };
}
