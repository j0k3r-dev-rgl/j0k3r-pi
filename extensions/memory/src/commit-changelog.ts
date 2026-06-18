import type { Db } from './db.js';
import type { MemoryRecord, ResolvedContext } from './types.js';
import { addMemory, getMemoryRaw } from './memory-store.js';
import { generateGenericId } from './ids.js';
import { jsonString, nowIso, parseJson, snippet } from './utils.js';

export type CommitChangelogRelation = 'derived_from' | 'supports' | 'related_to' | 'supersedes';
export type CommitChangelogRecordType = 'commit_record' | 'changelog_entry' | 'release_record';

export type CommitChangeType = 'fix' | 'feature' | 'chore' | 'docs' | 'refactor' | 'test' | 'sync' | 'other';
export type CommitReleaseImpact = 'major' | 'minor' | 'patch' | 'none';

export interface CommitRecordInput {
  scope?: 'general' | 'project' | 'global';
  repo: string;
  commit_hash: string;
  subject: string;
  branch?: string;
  author?: string;
  authored_at?: string;
  change_type?: CommitChangeType;
  release_impact?: CommitReleaseImpact;
  summary?: string;
  content?: string;
  functional_description?: string;
  changelog_bullets?: string[];
  areas?: string[];
  validation?: string[];
  risks?: string[];
  decisions?: string[];
  files_changed?: string[];
  diffstat?: Record<string, unknown> | string;
  source_session_id?: string;
  related_memory_ids?: string[];
  tags?: string[];
  confidence?: number;
  importance?: number;
  metadata_json?: Record<string, unknown>;
}

export interface ChangelogEntryInput {
  scope?: 'general' | 'project' | 'global';
  version: string;
  section: string;
  bullets: string[];
  release_tag?: string;
  release_date?: string;
  title?: string;
  summary?: string;
  content?: string;
  source_commit_ids?: string[];
  related_memory_ids?: string[];
  tags?: string[];
  confidence?: number;
  importance?: number;
  metadata_json?: Record<string, unknown>;
}

export interface LinkInput {
  from_memory_id: string;
  to_memory_id: string;
  relation_type: CommitChangelogRelation;
  metadata_json?: Record<string, unknown>;
}

export interface ReleaseCandidatesInput {
  scope?: 'general' | 'project' | 'global';
  project_mode?: 'current' | 'all' | 'selected';
  project_name?: string;
  repo?: string;
  branch?: string;
  change_type?: CommitChangeType;
  release_impact?: CommitReleaseImpact;
  since?: string;
  until?: string;
  limit?: number;
}

export interface ReleaseNotesPreviewInput extends ReleaseCandidatesInput {
  version?: string;
  release_tag?: string;
}

export interface ReleaseRecordInput {
  scope?: 'general' | 'project' | 'global';
  version: string;
  release_tag: string;
  release_date?: string;
  commit_ids: string[];
  title?: string;
  summary?: string;
  content?: string;
  tags?: string[];
  confidence?: number;
  importance?: number;
  metadata_json?: Record<string, unknown>;
}

export interface SearchInput {
  query?: string;
  record_types?: CommitChangelogRecordType[];
  scope?: 'general' | 'project' | 'global';
  project_mode?: 'current' | 'all' | 'selected';
  project_name?: string;
  repo?: string;
  commit_hash?: string;
  branch?: string;
  change_type?: CommitChangeType;
  release_impact?: CommitReleaseImpact;
  version?: string;
  release_tag?: string;
  section?: string;
  status?: 'active' | 'archived' | 'superseded';
  since?: string;
  until?: string;
  include_links?: boolean;
  include_related?: boolean;
  limit?: number;
}

const COMMIT_HASH_RE = /^[a-f0-9]{7,64}$/i;
const ALLOWED_RELATIONS: CommitChangelogRelation[] = ['derived_from', 'supports', 'related_to', 'supersedes'];
const DEFAULT_RECORD_TYPES: CommitChangelogRecordType[] = ['commit_record', 'changelog_entry', 'release_record'];
const COMMIT_CHANGE_TYPES: CommitChangeType[] = ['fix', 'feature', 'chore', 'docs', 'refactor', 'test', 'sync', 'other'];
const COMMIT_RELEASE_IMPACTS: CommitReleaseImpact[] = ['major', 'minor', 'patch', 'none'];

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeOptionalText(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function normalizeStringList(values: unknown): string[] {
  return Array.isArray(values)
    ? values.map((value) => normalizeText(value)).filter(Boolean)
    : [];
}

function normalizeBulletIdentity(bullets: string[]): string {
  return bullets.map((bullet) => normalizeText(bullet)).filter(Boolean).join('\n');
}

function memoryMatchesProjectMode(record: MemoryRecord, input: SearchInput, context: ResolvedContext): boolean {
  const projectMode = input.project_mode ?? (context.scope === 'project' ? 'current' : 'all');
  if (input.scope && record.scope !== input.scope) return false;
  if (projectMode === 'all') return true;
  if (projectMode === 'selected') return record.scope !== 'project' || record.project_name === input.project_name;
  if (context.scope === 'project') return record.scope !== 'project' || record.project_id === context.project_id;
  return true;
}

function sameProjectBoundary(a: MemoryRecord, b: MemoryRecord): boolean {
  return a.scope === b.scope && a.project_id === b.project_id && a.project_name === b.project_name;
}

function desiredProjectFields(scope: CommitRecordInput['scope'] | ChangelogEntryInput['scope'] | undefined, context: ResolvedContext): { scope: 'general' | 'project' | 'global'; project_id: string | null; project_name: string | null } {
  const desiredScope = scope ?? context.scope;
  if (desiredScope !== 'project') return { scope: desiredScope, project_id: null, project_name: null };
  if (context.scope === 'project') return { scope: 'project', project_id: context.project_id, project_name: context.project_name };
  return { scope: 'general', project_id: null, project_name: null };
}

function requireMemory(db: Db, id: string, label: string): MemoryRecord {
  const record = getMemoryRaw(db, id);
  if (!record) throw new Error(`${label} not found: ${id}`);
  return record;
}

function requireRelatedMemories(db: Db, ids: string[] | undefined, ownerLabel: string): MemoryRecord[] {
  return (ids ?? []).map((id) => requireMemory(db, id, `${ownerLabel} related memory`));
}

function requireSourceCommits(db: Db, ids: string[] | undefined): MemoryRecord[] {
  return (ids ?? []).map((id) => {
    const record = requireMemory(db, id, 'source commit memory');
    if (record.kind !== 'commit_record') throw new Error(`source commit memory must have kind commit_record: ${id}`);
    return record;
  });
}

function requireReleaseCommits(db: Db, ids: string[] | undefined): MemoryRecord[] {
  if (!ids?.length) throw new Error('commit_ids must contain at least one commit_record memory id');
  return ids.map((id) => {
    const record = requireMemory(db, id, 'release commit memory');
    if (record.kind !== 'commit_record') throw new Error(`release commit memory must have kind commit_record: ${id}`);
    return record;
  });
}

function reservedMetadata(extra: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return undefined;
  const cleaned = Object.fromEntries(Object.entries(extra).filter(([key]) => !['commit', 'changelog', 'release', 'release_context', 'extra'].includes(key)));
  return Object.keys(cleaned).length ? cleaned : undefined;
}

function normalizeEnumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T | undefined {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return undefined;
  if ((allowed as readonly string[]).includes(normalized)) return normalized as T;
  throw new Error(`${label} must be one of: ${allowed.join(', ')}`);
}

function buildReleaseContextMetadata(input: CommitRecordInput): Record<string, unknown> | undefined {
  const releaseContext = {
    functional_description: normalizeOptionalText(input.functional_description),
    changelog_bullets: normalizeStringList(input.changelog_bullets),
    areas: normalizeStringList(input.areas),
    validation: normalizeStringList(input.validation),
    risks: normalizeStringList(input.risks),
    decisions: normalizeStringList(input.decisions),
  };
  const cleaned = Object.fromEntries(Object.entries(releaseContext).filter(([, value]) => Array.isArray(value) ? value.length > 0 : Boolean(value)));
  return Object.keys(cleaned).length ? cleaned : undefined;
}

function buildCommitMetadata(input: CommitRecordInput): Record<string, unknown> {
  const changeType = normalizeEnumValue(input.change_type, COMMIT_CHANGE_TYPES, 'change_type');
  const releaseImpact = normalizeEnumValue(input.release_impact, COMMIT_RELEASE_IMPACTS, 'release_impact')
    ?? (changeType === 'sync' ? 'none' : undefined);
  const releaseContext = buildReleaseContextMetadata(input);
  return {
    commit: {
      repo: normalizeText(input.repo),
      commit_hash: normalizeText(input.commit_hash),
      subject: normalizeText(input.subject),
      branch: normalizeOptionalText(input.branch),
      author: normalizeOptionalText(input.author),
      authored_at: normalizeOptionalText(input.authored_at),
      change_type: changeType,
      release_impact: releaseImpact,
      files_changed: normalizeStringList(input.files_changed),
      diffstat: input.diffstat,
      source_session_id: normalizeOptionalText(input.source_session_id),
    },
    ...(releaseContext ? { release_context: releaseContext } : {}),
    ...(reservedMetadata(input.metadata_json) ? { extra: reservedMetadata(input.metadata_json) } : {}),
  };
}

function buildChangelogMetadata(input: ChangelogEntryInput): Record<string, unknown> {
  return {
    changelog: {
      version: normalizeText(input.version),
      release_tag: normalizeOptionalText(input.release_tag),
      release_date: normalizeOptionalText(input.release_date),
      section: normalizeText(input.section),
      bullets: normalizeStringList(input.bullets),
      source_commit_ids: input.source_commit_ids ?? [],
    },
    ...(reservedMetadata(input.metadata_json) ? { extra: reservedMetadata(input.metadata_json) } : {}),
  };
}

function buildReleaseMetadata(input: ReleaseRecordInput): Record<string, unknown> {
  return {
    release: {
      version: normalizeText(input.version),
      release_tag: normalizeText(input.release_tag),
      release_date: normalizeOptionalText(input.release_date),
      commit_ids: input.commit_ids ?? [],
    },
    ...(reservedMetadata(input.metadata_json) ? { extra: reservedMetadata(input.metadata_json) } : {}),
  };
}

function buildCommitPayload(input: CommitRecordInput): { title: string; summary: string; content: string; tags: string[] } {
  const repo = normalizeText(input.repo);
  const hash = normalizeText(input.commit_hash);
  const subject = normalizeText(input.subject);
  const branch = normalizeOptionalText(input.branch);
  const changeType = normalizeEnumValue(input.change_type, COMMIT_CHANGE_TYPES, 'change_type');
  const releaseImpact = normalizeEnumValue(input.release_impact, COMMIT_RELEASE_IMPACTS, 'release_impact')
    ?? (changeType === 'sync' ? 'none' : undefined);
  const files = normalizeStringList(input.files_changed);
  const title = `${repo} ${hash} ${subject}`.trim();
  const summary = snippet([subject, branch ? `branch ${branch}` : '', changeType ? `change_type ${changeType}` : '', releaseImpact ? `release_impact ${releaseImpact}` : '', files.length ? `${files.length} files changed` : '', input.summary ? normalizeText(input.summary) : ''].filter(Boolean).join(' · '), 160);
  const content = [
    `repo: ${repo}`,
    `commit: ${hash}`,
    branch ? `branch: ${branch}` : '',
    `subject: ${subject}`,
    changeType ? `change_type: ${changeType}` : '',
    releaseImpact ? `release_impact: ${releaseImpact}` : '',
    input.author ? `author: ${normalizeText(input.author)}` : '',
    input.authored_at ? `authored_at: ${normalizeText(input.authored_at)}` : '',
    files.length ? `files_changed: ${files.join(', ')}` : '',
    input.functional_description ? `functional_description: ${normalizeText(input.functional_description)}` : '',
    normalizeStringList(input.changelog_bullets).length ? `changelog_bullets: ${normalizeStringList(input.changelog_bullets).join(' | ')}` : '',
    normalizeStringList(input.areas).length ? `areas: ${normalizeStringList(input.areas).join(', ')}` : '',
    normalizeStringList(input.validation).length ? `validation: ${normalizeStringList(input.validation).join(' | ')}` : '',
    normalizeStringList(input.risks).length ? `risks: ${normalizeStringList(input.risks).join(' | ')}` : '',
    normalizeStringList(input.decisions).length ? `decisions: ${normalizeStringList(input.decisions).join(' | ')}` : '',
    input.content ? normalizeText(input.content) : '',
  ].filter(Boolean).join('\n');
  const tags = Array.from(new Set([...(normalizeStringList(input.tags)), 'commit_record', repo, hash, ...(branch ? [branch] : []), ...(changeType ? [changeType] : []), ...(releaseImpact ? [releaseImpact] : []), ...normalizeStringList(input.areas)]));
  return { title, summary, content, tags };
}

function buildReleasePayload(input: ReleaseRecordInput): { title: string; summary: string; content: string; tags: string[] } {
  const version = normalizeText(input.version);
  const releaseTag = normalizeText(input.release_tag);
  const title = normalizeOptionalText(input.title) ?? `release ${version} ${releaseTag}`;
  const summary = snippet(normalizeOptionalText(input.summary) ?? `release ${version} tagged ${releaseTag} from ${input.commit_ids.length} commit(s)`, 160);
  const content = [
    `version: ${version}`,
    `release_tag: ${releaseTag}`,
    input.release_date ? `release_date: ${normalizeText(input.release_date)}` : '',
    `commit_ids: ${input.commit_ids.join(', ')}`,
    input.content ? normalizeText(input.content) : '',
  ].filter(Boolean).join('\n');
  const tags = Array.from(new Set([...(normalizeStringList(input.tags)), 'release_record', version, releaseTag]));
  return { title, summary, content, tags };
}

function buildChangelogPayload(input: ChangelogEntryInput): { title: string; summary: string; content: string; tags: string[]; bullets: string[] } {
  const version = normalizeText(input.version);
  const section = normalizeText(input.section);
  const bullets = normalizeStringList(input.bullets);
  const releaseTag = normalizeOptionalText(input.release_tag);
  const title = normalizeOptionalText(input.title) ?? `release ${version} ${section}`;
  const summary = snippet(normalizeOptionalText(input.summary) ?? bullets.join(' · '), 160);
  const content = [
    `version: ${version}`,
    releaseTag ? `release_tag: ${releaseTag}` : '',
    input.release_date ? `release_date: ${normalizeText(input.release_date)}` : '',
    `section: ${section}`,
    ...bullets.map((bullet) => `- ${bullet}`),
    input.content ? normalizeText(input.content) : '',
  ].filter(Boolean).join('\n');
  const tags = Array.from(new Set([...(normalizeStringList(input.tags)), 'changelog_entry', version, section, ...(releaseTag ? [releaseTag] : [])]));
  return { title, summary, content, tags, bullets };
}

function findActiveDuplicateCommit(db: Db, candidate: { scope: string; project_id: string | null; project_name: string | null; repo: string; commit_hash: string }): MemoryRecord | undefined {
  const rows = db.prepare('SELECT * FROM memories WHERE kind=? AND status=? AND scope=?').all('commit_record', 'active', candidate.scope) as unknown as MemoryRecord[];
  return rows.find((row) => {
    const meta = parseJson<{ commit?: Record<string, unknown> }>(row.metadata_json, {});
    return row.project_id === candidate.project_id
      && row.project_name === candidate.project_name
      && normalizeText(meta.commit?.repo) === candidate.repo
      && normalizeText(meta.commit?.commit_hash) === candidate.commit_hash;
  });
}

function findActiveDuplicateChangelog(db: Db, candidate: { scope: string; project_id: string | null; project_name: string | null; version: string; section: string; bullet_identity: string }): MemoryRecord | undefined {
  const rows = db.prepare('SELECT * FROM memories WHERE kind=? AND status=? AND scope=?').all('changelog_entry', 'active', candidate.scope) as unknown as MemoryRecord[];
  return rows.find((row) => {
    const meta = parseJson<{ changelog?: Record<string, unknown> }>(row.metadata_json, {});
    const bullets = normalizeStringList(meta.changelog?.bullets);
    return row.project_id === candidate.project_id
      && row.project_name === candidate.project_name
      && normalizeText(meta.changelog?.version) === candidate.version
      && normalizeText(meta.changelog?.section) === candidate.section
      && normalizeBulletIdentity(bullets) === candidate.bullet_identity;
  });
}

function compactMemory(record: MemoryRecord): Record<string, unknown> {
  const metadata = parseJson<Record<string, unknown>>(record.metadata_json, {});
  return {
    id: record.id,
    type: 'memory',
    scope: record.scope,
    project_name: record.project_name,
    kind: record.kind,
    title: record.title,
    snippet: snippet(record.summary || record.content || '', 240),
    status: record.status,
    metadata_summary: metadata.commit ?? metadata.changelog ?? metadata.release ?? metadata.extra ?? {},
    updated_at: record.updated_at,
  };
}

function compactLink(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    from_memory_id: row.from_memory_id,
    to_memory_id: row.to_memory_id,
    relation_type: row.relation_type,
    metadata_json: parseJson<Record<string, unknown>>(typeof row.metadata_json === 'string' ? row.metadata_json : null, {}),
  };
}

function insertLinkIfMissing(db: Db, from: MemoryRecord, to: MemoryRecord, relationType: CommitChangelogRelation, metadata: Record<string, unknown> = {}): { link: Record<string, unknown>; warning?: string } {
  if (!ALLOWED_RELATIONS.includes(relationType)) throw new Error(`unsupported relation_type: ${relationType}`);
  if (!sameProjectBoundary(from, to)) throw new Error(`cross-project links are not allowed: ${from.id} -> ${to.id}`);
  const existing = db.prepare('SELECT * FROM memory_links WHERE from_memory_id=? AND to_memory_id=? AND relation_type=?').get(from.id, to.id, relationType) as Record<string, unknown> | undefined;
  if (existing) return { link: compactLink(existing), warning: 'duplicate link; returned existing link' };
  const row = {
    id: generateGenericId('link'),
    from_memory_id: from.id,
    to_memory_id: to.id,
    relation_type: relationType,
    created_at: nowIso(),
    metadata_json: jsonString(metadata),
  };
  db.prepare('INSERT INTO memory_links(id,from_memory_id,to_memory_id,relation_type,created_at,metadata_json) VALUES(?,?,?,?,?,?)').run(
    row.id,
    row.from_memory_id,
    row.to_memory_id,
    row.relation_type,
    row.created_at,
    row.metadata_json,
  );
  return { link: compactLink(row) };
}

function linkRelatedMemories(db: Db, from: MemoryRecord, related: MemoryRecord[], sourceTool: 'memory_commit_record_add' | 'memory_changelog_entry_add'): void {
  for (const memory of related) insertLinkIfMissing(db, from, memory, 'related_to', { source_tool: sourceTool });
}

export function addCommitRecord(db: Db, input: CommitRecordInput, context: ResolvedContext): { memory: Record<string, unknown>; warning?: string } {
  const repo = normalizeText(input.repo);
  const commitHash = normalizeText(input.commit_hash);
  const subject = normalizeText(input.subject);
  if (!repo) throw new Error('repo is required');
  if (!subject) throw new Error('subject is required');
  if (!COMMIT_HASH_RE.test(commitHash)) throw new Error('commit_hash must be a 7-64 character hex string');

  const related = requireRelatedMemories(db, input.related_memory_ids, 'commit record');
  const fields = desiredProjectFields(input.scope, context);
  const duplicate = findActiveDuplicateCommit(db, {
    scope: fields.scope,
    project_id: fields.project_id,
    project_name: fields.project_name,
    repo,
    commit_hash: commitHash,
  });
  if (duplicate) return { memory: compactMemory(duplicate), warning: 'duplicate commit record; returned existing record' };

  const payload = buildCommitPayload(input);
  const created = addMemory(db, {
    scope: input.scope,
    kind: 'commit_record',
    title: payload.title,
    summary: payload.summary,
    content: payload.content,
    tags: payload.tags,
    confidence: input.confidence,
    importance: input.importance,
    metadata_json: buildCommitMetadata(input),
  }, context).memory;

  linkRelatedMemories(db, created, related, 'memory_commit_record_add');
  return { memory: compactMemory(created) };
}

export function addChangelogEntry(db: Db, input: ChangelogEntryInput, context: ResolvedContext): { memory: Record<string, unknown>; warning?: string } {
  const version = normalizeText(input.version);
  const section = normalizeText(input.section);
  const bullets = normalizeStringList(input.bullets);
  if (!version) throw new Error('version is required');
  if (!section) throw new Error('section is required');
  if (!bullets.length) throw new Error('bullets must contain at least one non-empty entry');

  requireSourceCommits(db, input.source_commit_ids);
  const related = requireRelatedMemories(db, input.related_memory_ids, 'changelog entry');
  const fields = desiredProjectFields(input.scope, context);
  const duplicate = findActiveDuplicateChangelog(db, {
    scope: fields.scope,
    project_id: fields.project_id,
    project_name: fields.project_name,
    version,
    section,
    bullet_identity: normalizeBulletIdentity(bullets),
  });
  if (duplicate) return { memory: compactMemory(duplicate), warning: 'duplicate changelog entry; returned existing record' };

  const payload = buildChangelogPayload(input);
  const created = addMemory(db, {
    scope: input.scope,
    kind: 'changelog_entry',
    title: payload.title,
    summary: payload.summary,
    content: payload.content,
    tags: payload.tags,
    confidence: input.confidence,
    importance: input.importance,
    metadata_json: buildChangelogMetadata({ ...input, bullets: payload.bullets }),
  }, context).memory;

  linkRelatedMemories(db, created, related, 'memory_changelog_entry_add');
  return { memory: compactMemory(created) };
}

function isCommitLinkedToRelease(db: Db, commitId: string): boolean {
  const rows = db.prepare("SELECT m.* FROM memory_links l JOIN memories m ON m.id=l.from_memory_id WHERE l.to_memory_id=? AND l.relation_type='derived_from' AND m.status='active'").all(commitId) as unknown as MemoryRecord[];
  return rows.some((row) => {
    if (row.kind === 'release_record') return true;
    if (row.kind !== 'changelog_entry') return false;
    const meta = parseJson<{ changelog?: Record<string, unknown> }>(row.metadata_json, {});
    return Boolean(normalizeOptionalText(meta.changelog?.release_tag));
  });
}

export function searchReleaseCandidates(db: Db, input: ReleaseCandidatesInput, context: ResolvedContext): { results: Array<Record<string, unknown>> } {
  const status = 'active';
  const rows = db.prepare('SELECT * FROM memories WHERE kind=? AND status=? ORDER BY updated_at DESC LIMIT ?').all(
    'commit_record',
    status,
    Math.max(1, Math.min(input.limit ?? 25, 100)),
  ) as unknown as MemoryRecord[];

  const searchInput: SearchInput = { ...input, record_types: ['commit_record'], status };
  const results = rows
    .filter((row) => memoryMatchesProjectMode(row, searchInput, context))
    .filter((row) => passesStructuredFilters(row, searchInput))
    .filter((row) => {
      const meta = parseJson<{ commit?: Record<string, unknown> }>(row.metadata_json, {});
      return ['major', 'minor', 'patch'].includes(normalizeText(meta.commit?.release_impact));
    })
    .filter((row) => !isCommitLinkedToRelease(db, row.id))
    .sort((a, b) => {
      const aMeta = parseJson<{ commit?: Record<string, unknown> }>(a.metadata_json, {});
      const bMeta = parseJson<{ commit?: Record<string, unknown> }>(b.metadata_json, {});
      const aDate = normalizeOptionalText(aMeta.commit?.authored_at) ?? normalizeText(a.updated_at);
      const bDate = normalizeOptionalText(bMeta.commit?.authored_at) ?? normalizeText(b.updated_at);
      return bDate.localeCompare(aDate);
    })
    .slice(0, input.limit ?? 25)
    .map((row) => ({ ...compactMemory(row), links: linksForMemory(db, row.id) }));

  return { results };
}

function previewSectionForChangeType(changeType: string): 'Added' | 'Changed' | 'Fixed' | 'Internal' {
  if (changeType === 'feature') return 'Added';
  if (changeType === 'fix') return 'Fixed';
  if (['docs', 'test', 'chore', 'refactor', 'sync'].includes(changeType)) return 'Internal';
  return 'Changed';
}

function sentenceCase(text: string): string {
  const trimmed = text.trim();
  return trimmed ? `${trimmed[0].toUpperCase()}${trimmed.slice(1)}` : trimmed;
}

export function previewReleaseNotes(db: Db, input: ReleaseNotesPreviewInput, context: ResolvedContext): { text: string; sections: Record<string, string[]>; candidates: Array<Record<string, unknown>>; needs_context: Array<Record<string, unknown>> } {
  const { version: _version, release_tag: _releaseTag, ...candidateInput } = input;
  const candidates = searchReleaseCandidates(db, candidateInput, context).results;
  const sections: Record<string, string[]> = { Added: [], Changed: [], Fixed: [], Removed: [], Internal: [] };
  const needsContext: Array<Record<string, unknown>> = [];

  for (const candidate of candidates) {
    const id = String(candidate.id ?? '');
    const row = getMemoryRaw(db, id);
    if (!row) continue;
    const meta = parseJson<{ commit?: Record<string, unknown>; release_context?: Record<string, unknown> }>(row.metadata_json, {});
    const bullets = normalizeStringList(meta.release_context?.changelog_bullets).map(sentenceCase);
    if (!bullets.length) {
      needsContext.push(candidate);
      continue;
    }
    const section = previewSectionForChangeType(normalizeText(meta.commit?.change_type));
    sections[section].push(...bullets);
  }

  const heading = input.version ? `## ${input.version}${input.release_tag ? ` (${input.release_tag})` : ''}` : '## Release notes preview';
  const lines = [heading, ''];
  for (const section of ['Added', 'Changed', 'Fixed', 'Removed', 'Internal']) {
    const bullets = sections[section] ?? [];
    if (!bullets.length) continue;
    lines.push(`### ${section}`, ...bullets.map((bullet) => `- ${bullet}`), '');
  }
  if (needsContext.length) {
    lines.push('### Needs context', ...needsContext.map((item) => `- ${item.title ?? item.id}`), '');
  }
  return { text: lines.join('\n').trimEnd(), sections, candidates, needs_context: needsContext };
}

export function addReleaseRecord(db: Db, input: ReleaseRecordInput, context: ResolvedContext): { memory: Record<string, unknown>; links: Array<Record<string, unknown>>; warning?: string } {
  const version = normalizeText(input.version);
  const releaseTag = normalizeText(input.release_tag);
  if (!version) throw new Error('version is required');
  if (!releaseTag) throw new Error('release_tag is required');

  const commits = requireReleaseCommits(db, input.commit_ids);
  const fields = desiredProjectFields(input.scope, context);
  for (const commit of commits) {
    if (commit.scope !== fields.scope || commit.project_id !== fields.project_id || commit.project_name !== fields.project_name) {
      throw new Error(`release commit memory must be in the same project/scope: ${commit.id}`);
    }
  }

  const duplicate = (db.prepare("SELECT * FROM memories WHERE kind=? AND status=? AND scope=?").all('release_record', 'active', fields.scope) as unknown as MemoryRecord[])
    .find((row) => {
      const meta = parseJson<{ release?: Record<string, unknown> }>(row.metadata_json, {});
      return row.project_id === fields.project_id
        && row.project_name === fields.project_name
        && normalizeText(meta.release?.version) === version
        && normalizeText(meta.release?.release_tag) === releaseTag;
    });
  if (duplicate) return { memory: compactMemory(duplicate), links: linksForMemory(db, duplicate.id), warning: 'duplicate release record; returned existing record' };

  const payload = buildReleasePayload(input);
  const created = addMemory(db, {
    scope: input.scope,
    kind: 'release_record',
    title: payload.title,
    summary: payload.summary,
    content: payload.content,
    tags: payload.tags,
    confidence: input.confidence,
    importance: input.importance,
    metadata_json: buildReleaseMetadata(input),
  }, context).memory;
  const links = commits.map((commit) => insertLinkIfMissing(db, created, commit, 'derived_from', { source_tool: 'memory_release_record_add', release_tag: releaseTag }).link);
  return { memory: compactMemory(created), links };
}

export function addCommitChangelogLink(db: Db, input: LinkInput): { link: Record<string, unknown>; warning?: string } {
  const from = requireMemory(db, input.from_memory_id, 'from memory');
  const to = requireMemory(db, input.to_memory_id, 'to memory');
  return insertLinkIfMissing(db, from, to, input.relation_type, { ...(input.metadata_json ?? {}), source_tool: 'memory_commit_changelog_link' });
}

function passesTextQuery(record: MemoryRecord, query: string | undefined): boolean {
  const normalized = normalizeOptionalText(query);
  if (!normalized) return true;
  const haystack = [record.title, record.summary, record.content, record.tags, record.kind, record.project_name].map((value) => normalizeText(value)).join('\n');
  return normalized.split(/\s+/).every((term) => haystack.includes(term));
}

function passesStructuredFilters(record: MemoryRecord, input: SearchInput): boolean {
  const metadata = parseJson<{ commit?: Record<string, unknown>; changelog?: Record<string, unknown> }>(record.metadata_json, {});
  const commit = metadata.commit ?? {};
  const changelog = metadata.changelog ?? {};
  if (input.repo && normalizeText(commit.repo) !== normalizeText(input.repo)) return false;
  if (input.commit_hash && normalizeText(commit.commit_hash) !== normalizeText(input.commit_hash)) return false;
  if (input.branch && normalizeText(commit.branch) !== normalizeText(input.branch)) return false;
  if (input.change_type && normalizeText(commit.change_type) !== normalizeText(input.change_type)) return false;
  if (input.release_impact && normalizeText(commit.release_impact) !== normalizeText(input.release_impact)) return false;
  if (input.version && normalizeText(changelog.version) !== normalizeText(input.version)) return false;
  if (input.release_tag && normalizeText(changelog.release_tag) !== normalizeText(input.release_tag)) return false;
  if (input.section && normalizeText(changelog.section) !== normalizeText(input.section)) return false;
  if (input.since || input.until) {
    const candidateDate = normalizeOptionalText(commit.authored_at) ?? normalizeOptionalText(changelog.release_date) ?? normalizeText(record.created_at);
    if (input.since && candidateDate < normalizeText(input.since)) return false;
    if (input.until && candidateDate > normalizeText(input.until)) return false;
  }
  return true;
}

function linksForMemory(db: Db, memoryId: string): Array<Record<string, unknown>> {
  const rows = db.prepare('SELECT * FROM memory_links WHERE from_memory_id=? OR to_memory_id=? ORDER BY created_at ASC').all(memoryId, memoryId) as Array<Record<string, unknown>>;
  return rows.map(compactLink);
}

function relatedForMemory(db: Db, memoryId: string): Array<Record<string, unknown>> {
  const visited = new Set<string>([memoryId]);
  const queue: Array<{ id: string; depth: number }> = [{ id: memoryId, depth: 0 }];
  const relatedIds = new Set<string>();

  while (queue.length) {
    const current = queue.shift()!;
    if (current.depth >= 2) continue;
    for (const link of linksForMemory(db, current.id)) {
      const nextId = link.from_memory_id === current.id ? link.to_memory_id : link.from_memory_id;
      if (typeof nextId !== 'string' || visited.has(nextId)) continue;
      visited.add(nextId);
      relatedIds.add(nextId);
      queue.push({ id: nextId, depth: current.depth + 1 });
    }
  }

  return Array.from(relatedIds)
    .map((id) => getMemoryRaw(db, id))
    .filter((row): row is MemoryRecord => Boolean(row))
    .map((row) => ({ ...compactMemory(row), links: linksForMemory(db, row.id) }));
}

export function searchCommitChangelog(db: Db, input: SearchInput, context: ResolvedContext): { results: Array<Record<string, unknown>> } {
  const recordTypes = input.record_types?.length ? input.record_types : DEFAULT_RECORD_TYPES;
  const status = input.status ?? 'active';
  const rows = db.prepare(`SELECT * FROM memories WHERE kind IN (${recordTypes.map(() => '?').join(',')}) AND status=? ORDER BY updated_at DESC LIMIT ?`).all(
    ...recordTypes,
    status,
    Math.max(1, Math.min(input.limit ?? 10, 100)),
  ) as unknown as MemoryRecord[];

  const results = rows
    .filter((row) => memoryMatchesProjectMode(row, input, context))
    .filter((row) => passesTextQuery(row, input.query))
    .filter((row) => passesStructuredFilters(row, input))
    .slice(0, input.limit ?? 10)
    .map((row) => ({
      ...compactMemory(row),
      ...(input.include_links ? { links: linksForMemory(db, row.id) } : {}),
      ...(input.include_related ? { related: relatedForMemory(db, row.id) } : {}),
    }));

  return { results };
}
