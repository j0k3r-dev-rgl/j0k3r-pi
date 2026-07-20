import type { Db } from './db.js';
import type { ResolvedContext } from './types.js';
import { addMemory, getMemoryRaw, updateMemory, upsertProjectProfile } from './memory-store.js';

export type ProjectProfileSessionFacts = {
  session_id: string;
  summary?: string;
  learned?: string;
  decisions?: string[];
  validations?: string[];
  filesTouched?: string[];
  todos?: string[];
};

export const PROJECT_PROFILE_TEMPLATE = [
  'type: project_profile',
  'context: living summary of the current project for future agents.',
  'details:',
  '- stack:',
  '- architecture:',
  '- commands:',
  '- conventions:',
  '- active decisions:',
  '- risks:',
  '- current work:',
  '- important directories:',
  'implications: use this profile at startup and before non-trivial project work; update only with durable facts.',
  'source: session_summary',
].join('\n');

export function getCurrentProjectProfile(db: Db, context: ResolvedContext): any | undefined {
  if (context.scope !== 'project') return undefined;
  return db.prepare(`SELECT * FROM memories
    WHERE scope='project' AND project_id=? AND kind='project_profile' AND status='active'
    ORDER BY updated_at DESC
    LIMIT 1`).get(context.project_id) as any | undefined;
}

export function ensureProjectProfile(db: Db, context: ResolvedContext): { profile?: any; created: boolean } {
  if (context.scope !== 'project') return { created: false };
  const existing = getCurrentProjectProfile(db, context);
  if (existing) return { profile: existing, created: false };
  const created = addMemory(db, {
    scope: 'project',
    kind: 'project_profile',
    title: `${context.project_name} project profile`,
    summary: `living project profile for ${context.project_name}`,
    content: PROJECT_PROFILE_TEMPLATE,
    tags: ['project_profile', 'profile', 'context'],
    origin_type: 'session_summary',
    importance: 5,
  }, context).memory;
  return { profile: created, created: true };
}

export function updateProjectProfile(db: Db, context: ResolvedContext, content: string, tags?: string[]): any {
  if (context.scope !== 'project') throw new Error('project profile requires a project context');
  const existing = getCurrentProjectProfile(db, context);
  if (!existing) return addMemory(db, {
    scope: 'project',
    kind: 'project_profile',
    title: `${context.project_name} project profile`,
    summary: `living project profile for ${context.project_name}`,
    content,
    tags: tags ?? ['project_profile', 'profile', 'context'],
    origin_type: 'confirmed_by_user',
    importance: 5,
  }, context).memory;
  return upsertProjectProfile(db, {
    scope: 'project',
    kind: 'project_profile',
    content,
    tags: tags ?? JSON.parse(existing.tags || '[]'),
    importance: 5,
  }, context).memory;
}

function compactLine(text: string, max = 180): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, max);
}

function extractField(summary: string | undefined, label: string): string | undefined {
  if (!summary) return undefined;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = summary.match(new RegExp(`${escaped}:\\s*([^\\n]+)`, 'i'));
  return match?.[1] ? compactLine(match[1]) : undefined;
}

function durableSignals(facts: ProjectProfileSessionFacts): string[] {
  const lines: string[] = [];
  const changed = extractField(facts.summary, 'what changed');
  const openTodos = extractField(facts.summary, 'open todos');
  const learned = facts.learned?.split(/\r?\n/).find((line) => /^-\s+/.test(line.trim()));
  if (changed && !/^none\b|minor chat\b/.test(changed)) lines.push(`- current work: ${changed}`);
  for (const decision of facts.decisions ?? []) if (decision.trim()) lines.push(`- active decision: ${compactLine(decision)}`);
  for (const validation of facts.validations ?? []) if (validation.trim()) lines.push(`- validation: ${compactLine(validation)}`);
  for (const file of facts.filesTouched ?? []) if (file.trim()) lines.push(`- touched file: ${compactLine(file)}`);
  for (const todo of facts.todos ?? []) if (todo.trim()) lines.push(`- todo: ${compactLine(todo)}`);
  if (openTodos && !/^none\b/.test(openTodos)) lines.push(`- todo: ${openTodos}`);
  if (learned) lines.push(`- learning: ${compactLine(learned.replace(/^-\s*/, ''))}`);
  return [...new Set(lines)].slice(0, 12);
}

export function buildSemanticProjectProfilePrompt(currentProfile: string, facts: ProjectProfileSessionFacts): string {
  return [
    'update the project_profile for a software development memory system.',
    'write normal prose in english lowercase and keep the existing canonical structure, but preserve exact case for case-sensitive paths, commands, symbols, identifiers, versions, acronyms, and quoted literals.',
    'do not invent facts. only include durable project facts supported by the session facts.',
    'preserve useful existing profile content and merge new durable facts into the right sections.',
    'avoid temporary details, secrets, raw logs, and duplicate recent-session noise.',
    '',
    '<current_project_profile>',
    currentProfile,
    '</current_project_profile>',
    '',
    '<session_facts>',
    `session_id: ${facts.session_id}`,
    `summary: ${facts.summary ?? ''}`,
    `learned: ${facts.learned ?? ''}`,
    `decisions: ${(facts.decisions ?? []).join('; ')}`,
    `validations: ${(facts.validations ?? []).join('; ')}`,
    `files_touched: ${(facts.filesTouched ?? []).join('; ')}`,
    `todos: ${(facts.todos ?? []).join('; ')}`,
    '</session_facts>',
    '',
    'return only the updated project_profile content.',
  ].join('\n');
}

export function buildProjectProfileUpdatePreview(currentProfile: string, nextProfile: string): string {
  const current = new Set(currentProfile.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  const next = new Set(nextProfile.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  const removed = [...current].filter((l) => !next.has(l)).map((l) => `- ${l}`);
  const added = [...next].filter((l) => !current.has(l)).map((l) => `+ ${l}`);
  return ['project profile update preview:', ...removed, ...added].join('\n');
}

export function shouldConfirmProjectProfileUpdate(currentProfile: string, nextProfile: string, opts: { maxAddedLines?: number; maxGrowthRatio?: number } = {}): boolean {
  const maxAddedLines = opts.maxAddedLines ?? 6;
  const maxGrowthRatio = opts.maxGrowthRatio ?? 0.5;
  const currentLines = currentProfile.split(/\r?\n/).filter((l) => l.trim()).length;
  const nextLines = nextProfile.split(/\r?\n/).filter((l) => l.trim()).length;
  const added = Math.max(0, nextLines - currentLines);
  const growth = currentProfile.length ? (nextProfile.length - currentProfile.length) / currentProfile.length : 1;
  return added > maxAddedLines || (added > 2 && growth > maxGrowthRatio);
}

export async function semanticUpdateProjectProfileFromSession(db: Db, context: ResolvedContext, facts: ProjectProfileSessionFacts, ctx: any): Promise<{ updated: boolean; reason: string; profile?: any } | null> {
  if (context.scope !== 'project' || !ctx?.model || !ctx?.modelRegistry?.getApiKeyAndHeaders) return null;
  const ensured = ensureProjectProfile(db, context);
  const profile = ensured.profile!;
  const metadata = JSON.parse(profile.metadata_json || '{}');
  const applied = Array.isArray(metadata.auto_profile_session_ids) ? metadata.auto_profile_session_ids as string[] : [];
  if (applied.includes(facts.session_id)) return { updated: false, reason: `session ${facts.session_id} already applied to project profile.`, profile };

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
  if (!auth?.ok || !auth.apiKey) return null;
  const moduleName = '@earendil-works/pi-ai';
  const { complete } = await import(moduleName) as any;
  const response = await complete(
    ctx.model,
    { messages: [{ role: 'user', content: [{ type: 'text', text: buildSemanticProjectProfilePrompt(profile.content, facts) }], timestamp: Date.now() }] },
    { apiKey: auth.apiKey, headers: auth.headers, maxTokens: 2048 },
  );
  const content = (response.content ?? [])
    .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
    .map((c: any) => c.text)
    .join('\n')
    .trim()
    .toLowerCase();
  if (!content || content === profile.content.trim().toLowerCase()) return null;
  if (shouldConfirmProjectProfileUpdate(profile.content, content) && ctx?.hasUI && ctx?.ui?.confirm) {
    const ok = await ctx.ui.confirm('Project profile update', `${buildProjectProfileUpdatePreview(profile.content, content)}\n\nApply this large semantic update?`);
    if (!ok) return { updated: false, reason: 'semantic project profile update rejected by user.', profile };
  }
  const updated = updateMemory(db, profile.id, { content, importance: 5 }, context);
  const nextMeta = {
    ...metadata,
    auto_profile_session_ids: [...applied, facts.session_id].slice(-50),
    auto_profile_updated_at: new Date().toISOString(),
    profile_update_source: 'semantic',
    profile_update_session_id: facts.session_id,
    profile_update_model: `${ctx?.model?.provider ?? 'unknown'}/${ctx?.model?.id ?? ctx?.model?.name ?? 'unknown'}`,
  };
  db.prepare('UPDATE memories SET metadata_json=? WHERE id=?').run(JSON.stringify(nextMeta), profile.id);
  return { updated: true, reason: ensured.created ? 'project profile created and semantically updated from session.' : 'project profile semantically updated from session.', profile: getMemoryRaw(db, profile.id) ?? updated };
}

export function autoUpdateProjectProfileFromSession(db: Db, context: ResolvedContext, facts: ProjectProfileSessionFacts): { updated: boolean; reason: string; profile?: any } {
  if (context.scope !== 'project') return { updated: false, reason: 'project profile auto-update requires project context.' };
  const signals = durableSignals(facts);
  if (!signals.length) return { updated: false, reason: 'no durable project profile facts found.' };

  const ensured = ensureProjectProfile(db, context);
  const profile = ensured.profile!;
  const metadata = JSON.parse(profile.metadata_json || '{}');
  const applied = Array.isArray(metadata.auto_profile_session_ids) ? metadata.auto_profile_session_ids as string[] : [];
  if (applied.includes(facts.session_id)) return { updated: false, reason: `session ${facts.session_id} already applied to project profile.`, profile };

  const block = [
    '',
    'recent session updates:',
    `- session: ${facts.session_id}`,
    ...signals,
  ].join('\n');
  const updated = updateMemory(db, profile.id, { content: `${profile.content.trim()}\n${block}`, importance: 5 }, context);
  const nextMeta = { ...metadata, auto_profile_session_ids: [...applied, facts.session_id].slice(-50), auto_profile_updated_at: new Date().toISOString(), profile_update_source: 'heuristic', profile_update_session_id: facts.session_id };
  db.prepare('UPDATE memories SET metadata_json=? WHERE id=?').run(JSON.stringify(nextMeta), profile.id);
  return { updated: true, reason: ensured.created ? 'project profile created and updated from session.' : 'project profile updated from session.', profile: getMemoryRaw(db, profile.id) ?? updated };
}

export function getMemoryByIdForProfile(db: Db, id: string): any | undefined {
  return getMemoryRaw(db, id);
}
