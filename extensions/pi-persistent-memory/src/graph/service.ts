import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Scope } from '../types.ts';
import { encodeScope, decodeScope } from '../identity.ts';
import {
  ENTITY_TYPES,
  RELATION_TYPES,
  type EntityType,
  type RelationType,
  type SaveEntityInput,
  type SaveEntityOptions,
  type SaveEntityResult,
  type SaveRelationInput,
  type SaveRelationOptions,
  type SaveRelationResult,
  type DeleteRelationInput,
  type DeleteRelationOptions,
  type DeleteRelationResult,
  type SaveAssociationInput,
  type SaveAssociationOptions,
  type SaveAssociationResult,
  type DeleteAssociationInput,
  type DeleteAssociationOptions,
  type DeleteAssociationResult,
  type GetEntityOptions,
  type EntityRecord,
  type ListEntitiesOptions,
  type ListEntitiesResult,
  type TraverseGraphOptions,
  type GraphNode,
  type GraphEdge,
  type GraphAssociation,
  type GraphLimits,
  type GraphTraverseEnvelope,
} from './types.ts';
import {
  canonicalizeName,
  canonicalizeDisplayName,
  canonicalizeAlias,
} from './canonical.ts';

const MAX_ENVELOPE_BYTES = 6144;

function sliceCodePoints(text: string, start: number, count: number): string {
  const codePoints = Array.from(text);
  return codePoints.slice(start, start + count).join('');
}

function truncateCodePoints(text: string, maxCodePoints: number): { text: string; truncated: boolean } {
  const codePoints = Array.from(text);
  if (codePoints.length <= maxCodePoints) {
    return { text, truncated: false };
  }
  return {
    text: codePoints.slice(0, maxCodePoints).join('') + '...',
    truncated: true,
  };
}

function enforceEnvelopeBudget<T extends { scope: Scope }>(result: T): T {
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') <= MAX_ENVELOPE_BYTES) {
    return result;
  }
  if (result.scope.kind === 'project' && result.scope.project) {
    result.scope = {
      kind: 'project',
      project: truncateCodePoints(result.scope.project, 80).text,
    };
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') <= MAX_ENVELOPE_BYTES) {
    return result;
  }
  for (const [k, v] of Object.entries(result as Record<string, any>)) {
    if (typeof v === 'string' && v.length > 80) {
      (result as any)[k] = truncateCodePoints(v, 80).text;
    }
  }
  return result;
}

function checkCancellation(options?: { signal?: AbortSignal; assertActive?: () => void }): void {
  options?.assertActive?.();
  if (options?.signal?.aborted) {
    const err = new Error('lease_cancelled: Operation was cancelled');
    err.name = 'AbortError';
    throw err;
  }
}

interface EntityRow {
  id: string;
  type: string;
  canonical_name: string;
  scope_key: string;
  display_name: string;
  aliases_json: string;
  memory_id: number | null;
  session_id: string;
  created_at: string;
  updated_at: string;
}

interface RelationRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
  scope_key: string;
  session_id: string;
  created_at: string;
}

interface AssociationRow {
  id: string;
  memory_id: number;
  entity_id: string;
  scope_key: string;
  session_id: string;
  created_at: string;
}

function parseAliases(aliasesJson: string): string[] {
  try {
    const parsed = JSON.parse(aliasesJson);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {}
  return [];
}

export function saveEntity(
  db: DatabaseSync,
  input: SaveEntityInput,
  options: SaveEntityOptions,
): SaveEntityResult {
  checkCancellation(options);

  if (!input.type || !ENTITY_TYPES.includes(input.type)) {
    throw new Error(`invalid_input: Invalid entity type '${input.type}'`);
  }

  if (!input.scope || (input.scope.kind !== 'global' && input.scope.kind !== 'project')) {
    throw new Error('invalid_input: Invalid scope');
  }

  // Scope validation
  if (input.type === 'project' || input.type === 'file') {
    if (input.scope.kind !== 'project') {
      throw new Error(`invalid_input: ${input.type} entity must be project-scoped`);
    }
  }

  if (input.scope.kind === 'global') {
    if (input.type !== 'technology' && input.type !== 'concept' && input.type !== 'memory') {
      throw new Error(`invalid_input: Entity type '${input.type}' cannot be global`);
    }
    if (!options.explicitGlobalWrite) {
      throw new Error('scope_mismatch: Creating or updating global entity requires explicit global write authorization');
    }
  }

  if (input.type === 'memory') {
    if (input.memoryId === undefined || input.memoryId === null || !Number.isSafeInteger(input.memoryId) || input.memoryId <= 0) {
      throw new Error('invalid_input: Memory entity requires a positive integer memoryId');
    }
  } else {
    if (input.memoryId !== undefined && input.memoryId !== null) {
      throw new Error('invalid_input: memoryId is only allowed for type \'memory\'');
    }
  }

  const canonicalName = canonicalizeName(input.type, input.name, { memoryId: input.memoryId });
  const displayName = canonicalizeDisplayName(input.type, input.displayName ?? input.name, { memoryId: input.memoryId });

  let canonicalAliases: string[] | undefined;
  if (input.aliases !== undefined) {
    if (!Array.isArray(input.aliases)) {
      throw new Error('invalid_input: aliases must be an array of strings');
    }
    const set = new Set<string>();
    for (const raw of input.aliases) {
      if (typeof raw !== 'string') {
        throw new Error('invalid_input: each alias must be a string');
      }
      const cAlias = canonicalizeAlias(input.type, raw);
      if (cAlias === canonicalName) {
        throw new Error('alias_conflict: Alias cannot equal canonical name');
      }
      set.add(cAlias);
    }
    canonicalAliases = Array.from(set);
  }

  const scopeKey = encodeScope(input.scope);

  db.exec('BEGIN IMMEDIATE;');
  try {
    checkCancellation(options);

    // If type is memory, verify memory exists, is active, and matches scope
    if (input.type === 'memory') {
      const memRow = db.prepare('SELECT id, scope_key, deleted_at FROM memories WHERE id = ?;').get(input.memoryId as number) as {
        id: number;
        scope_key: string;
        deleted_at: string | null;
      } | undefined;

      if (!memRow) {
        throw new Error(`target_not_found: Referenced memory ${input.memoryId} does not exist`);
      }
      if (memRow.deleted_at !== null) {
        throw new Error(`target_deleted: Referenced memory ${input.memoryId} is soft-deleted`);
      }
      if (memRow.scope_key !== scopeKey) {
        throw new Error('scope_mismatch: Memory scope does not match entity scope');
      }
    }

    let targetId: string;

    if (input.id) {
      // Save with ID: verify row exists and belongs to same owner/type
      const existing = db.prepare('SELECT * FROM entities WHERE id = ?;').get(input.id) as EntityRow | undefined;
      if (!existing) {
        throw new Error(`target_not_found: Entity with id '${input.id}' not found`);
      }

      if (existing.type !== input.type) {
        throw new Error(`invalid_input: Cannot change entity type from '${existing.type}' to '${input.type}'`);
      }
      if (existing.scope_key !== scopeKey) {
        throw new Error(`scope_mismatch: Cannot change entity scope from '${existing.scope_key}' to '${scopeKey}'`);
      }
      if (input.type === 'memory' && existing.memory_id !== input.memoryId) {
        throw new Error('invalid_input: Cannot change memory reference of a memory entity');
      }

      // Check if canonical name collides with another row
      const otherSameCanonical = db.prepare(
        'SELECT id FROM entities WHERE type = ? AND scope_key = ? AND canonical_name = ? AND id != ?;'
      ).get(input.type, scopeKey, canonicalName, input.id) as { id: string } | undefined;
      if (otherSameCanonical) {
        throw new Error(`target_conflict: Canonical name matches entity '${otherSameCanonical.id}'`);
      }

      // Validate alias collisions with other rows in the same namespace
      const namespaceRows = db.prepare(
        'SELECT id, canonical_name, aliases_json FROM entities WHERE type = ? AND scope_key = ? AND id != ?;'
      ).all(input.type, scopeKey, input.id) as unknown as Array<{ id: string; canonical_name: string; aliases_json: string }>;

      // 1. New canonical name must not collide with other rows' aliases
      for (const row of namespaceRows) {
        const rowAliases = parseAliases(row.aliases_json);
        if (rowAliases.includes(canonicalName)) {
          throw new Error(`identity_conflict: Canonical name collides with alias of entity '${row.id}'`);
        }
      }

      // 2. New aliases must not collide with other rows' canonical names or aliases
      if (canonicalAliases !== undefined) {
        for (const alias of canonicalAliases) {
          for (const row of namespaceRows) {
            if (row.canonical_name === alias) {
              throw new Error(`alias_conflict: Alias '${alias}' shadows canonical name of entity '${row.id}'`);
            }
            const rowAliases = parseAliases(row.aliases_json);
            if (rowAliases.includes(alias)) {
              throw new Error(`alias_conflict: Alias '${alias}' collides with alias of entity '${row.id}'`);
            }
          }
        }
      }

      let aliasesJson = existing.aliases_json;
      if (canonicalAliases !== undefined) {
        aliasesJson = JSON.stringify(canonicalAliases);
      }

      db.prepare(`
        UPDATE entities
        SET canonical_name = ?,
            display_name = ?,
            aliases_json = ?,
            updated_at = datetime('now')
        WHERE id = ?;
      `).run(canonicalName, displayName, aliasesJson, input.id);

      targetId = input.id;
    } else {
      // Save without ID: upsert by canonical identity or unambiguous alias
      let existing = db.prepare(
        'SELECT * FROM entities WHERE type = ? AND scope_key = ? AND canonical_name = ?;'
      ).get(input.type, scopeKey, canonicalName) as EntityRow | undefined;

      if (!existing) {
        // Check if canonicalName matches an alias of an existing entity in (type, scope_key)
        const candidates = db.prepare(
          'SELECT * FROM entities WHERE type = ? AND scope_key = ?;'
        ).all(input.type, scopeKey) as unknown as EntityRow[];

        const aliasMatches = candidates.filter(r => parseAliases(r.aliases_json).includes(canonicalName));
        if (aliasMatches.length === 1) {
          existing = aliasMatches[0];
        } else if (aliasMatches.length > 1) {
          throw new Error('alias_conflict: Name matches aliases of multiple entities');
        }
      }

      if (existing) {
        // Upsert onto existing entity
        targetId = existing.id;

        // Check alias collisions against other rows
        const otherRows = db.prepare(
          'SELECT id, canonical_name, aliases_json FROM entities WHERE type = ? AND scope_key = ? AND id != ?;'
        ).all(input.type, scopeKey, targetId) as unknown as Array<{ id: string; canonical_name: string; aliases_json: string }>;

        if (canonicalAliases !== undefined) {
          for (const alias of canonicalAliases) {
            for (const row of otherRows) {
              if (row.canonical_name === alias) {
                throw new Error(`alias_conflict: Alias '${alias}' shadows canonical name of entity '${row.id}'`);
              }
              const rowAliases = parseAliases(row.aliases_json);
              if (rowAliases.includes(alias)) {
                throw new Error(`alias_conflict: Alias '${alias}' collides with alias of entity '${row.id}'`);
              }
            }
          }
        }

        let aliasesJson = existing.aliases_json;
        if (canonicalAliases !== undefined) {
          aliasesJson = JSON.stringify(canonicalAliases);
        }

        db.prepare(`
          UPDATE entities
          SET display_name = ?,
              aliases_json = ?,
              updated_at = datetime('now')
          WHERE id = ?;
        `).run(displayName, aliasesJson, targetId);
      } else {
        // Insert new entity
        // Validate alias collisions against existing rows
        const namespaceRows = db.prepare(
          'SELECT id, canonical_name, aliases_json FROM entities WHERE type = ? AND scope_key = ?;'
        ).all(input.type, scopeKey) as unknown as Array<{ id: string; canonical_name: string; aliases_json: string }>;

        for (const row of namespaceRows) {
          const rowAliases = parseAliases(row.aliases_json);
          if (rowAliases.includes(canonicalName)) {
            throw new Error(`identity_conflict: Canonical name collides with alias of entity '${row.id}'`);
          }
        }

        if (canonicalAliases !== undefined) {
          for (const alias of canonicalAliases) {
            for (const row of namespaceRows) {
              if (row.canonical_name === alias) {
                throw new Error(`alias_conflict: Alias '${alias}' shadows canonical name of entity '${row.id}'`);
              }
              const rowAliases = parseAliases(row.aliases_json);
              if (rowAliases.includes(alias)) {
                throw new Error(`alias_conflict: Alias '${alias}' collides with alias of entity '${row.id}'`);
              }
            }
          }
        }

        targetId = crypto.randomUUID();
        const aliasesJson = JSON.stringify(canonicalAliases ?? []);

        db.prepare(`
          INSERT INTO entities (
            id, type, canonical_name, scope_key, display_name,
            aliases_json, memory_id, session_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'));
        `).run(
          targetId,
          input.type,
          canonicalName,
          scopeKey,
          displayName,
          aliasesJson,
          input.memoryId ?? null,
          options.sessionId,
        );
      }
    }

    checkCancellation(options);
    db.exec('COMMIT;');

    const { text: safeCanonical, truncated: canTrunc } = truncateCodePoints(canonicalName, 80);
    const { text: safeDisplay, truncated: dispTrunc } = truncateCodePoints(displayName, 80);

    const result: SaveEntityResult = {
      status: 'ok',
      operation: 'save_entity',
      id: targetId,
      type: input.type,
      canonical_name: safeCanonical,
      display_name: safeDisplay,
      scope: input.scope,
      truncated: canTrunc || dispTrunc || undefined,
    };

    return enforceEnvelopeBudget(result);
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function getEntity(
  db: DatabaseSync,
  options: GetEntityOptions,
): EntityRecord | null {
  checkCancellation(options);

  if (!options.scope || (options.scope.kind !== 'global' && options.scope.kind !== 'project')) {
    throw new Error('invalid_input: Invalid scope');
  }

  let row: EntityRow | undefined;

  if (options.id) {
    row = db.prepare('SELECT * FROM entities WHERE id = ?;').get(options.id) as EntityRow | undefined;
  } else if (options.type && options.name) {
    const cName = canonicalizeName(options.type, options.name);
    const scopeKey = encodeScope(options.scope);

    // Look up by canonical name
    row = db.prepare(
      'SELECT * FROM entities WHERE type = ? AND scope_key = ? AND canonical_name = ?;'
    ).get(options.type, scopeKey, cName) as EntityRow | undefined;

    // If not found in project scope, look up in shared global nodes for technology/concept
    if (!row && options.scope.kind === 'project' && (options.type === 'technology' || options.type === 'concept')) {
      row = db.prepare(
        'SELECT * FROM entities WHERE type = ? AND scope_key = \'["global"]\' AND canonical_name = ?;'
      ).get(options.type, cName) as EntityRow | undefined;
    }

    // Look up by alias if still not found
    if (!row) {
      const candidates = db.prepare(
        'SELECT * FROM entities WHERE type = ? AND (scope_key = ? OR (scope_key = \'["global"]\' AND type IN (\'technology\', \'concept\')));'
      ).all(options.type, scopeKey) as unknown as EntityRow[];

      const matches = candidates.filter(r => parseAliases(r.aliases_json).includes(cName));
      if (matches.length === 1) {
        row = matches[0];
      }
    }
  }

  if (!row) {
    return null;
  }

  // Visibility check
  const entityScope = decodeScope(row.scope_key);
  if (!options.explicitGlobal) {
    if (options.scope.kind === 'project') {
      const currentProjectKey = encodeScope(options.scope);
      const isCurrentProject = row.scope_key === currentProjectKey;
      const isSharedGlobal = row.scope_key === '["global"]' && (row.type === 'technology' || row.type === 'concept');
      if (!isCurrentProject && !isSharedGlobal) {
        return null; // Invisible outside project scope
      }
    } else {
      if (row.scope_key !== '["global"]') {
        return null;
      }
    }
  }

  // Soft-deleted memory check
  let memorySummary: { title: string; excerpt: string } | undefined;
  if (row.type === 'memory' && row.memory_id) {
    const mem = db.prepare('SELECT id, title, content, deleted_at FROM memories WHERE id = ?;').get(row.memory_id) as {
      id: number;
      title: string;
      content: string;
      deleted_at: string | null;
    } | undefined;

    if (!mem || mem.deleted_at !== null) {
      return null; // Hidden in ordinary graph reads
    }

    const { text: safeTitle } = truncateCodePoints(mem.title, 80);
    const excerptSource = mem.content.trim().length > 0 ? mem.content : mem.title;
    const { text: safeExcerpt } = truncateCodePoints(excerptSource, 100);
    memorySummary = {
      title: safeTitle,
      excerpt: safeExcerpt,
    };
  }

  const { text: safeDisplay } = truncateCodePoints(row.display_name, 80);
  const { text: safeCanonical } = truncateCodePoints(row.canonical_name, 80);
  const allAliases = parseAliases(row.aliases_json);

  let record: EntityRecord = {
    id: row.id,
    type: row.type as EntityType,
    canonical_name: safeCanonical,
    display_name: safeDisplay,
    scope: entityScope,
    aliases: allAliases,
    memory_id: row.memory_id,
    memory_summary: memorySummary,
    created_at: row.created_at,
    updated_at: row.updated_at,
    session_id: row.session_id,
  };

  if (Buffer.byteLength(JSON.stringify(record), 'utf8') > MAX_ENVELOPE_BYTES) {
    record.aliases_truncated = true;
    record.total_aliases = allAliases.length;

    let low = 0;
    let high = allAliases.length;
    let bestSlice: string[] = [];
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = {
        ...record,
        aliases: allAliases.slice(0, mid),
      };
      if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= MAX_ENVELOPE_BYTES) {
        bestSlice = candidate.aliases;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    record.aliases = bestSlice;
  }

  if (Buffer.byteLength(JSON.stringify(record), 'utf8') > MAX_ENVELOPE_BYTES) {
    record.display_name = truncateCodePoints(row.display_name, 30).text;
    record.aliases = [];
    record.aliases_truncated = allAliases.length > 0 ? true : undefined;
    if (record.memory_summary) {
      record.memory_summary.title = truncateCodePoints(record.memory_summary.title, 30).text;
      record.memory_summary.excerpt = truncateCodePoints(record.memory_summary.excerpt, 30).text;
    }
  }

  if (Buffer.byteLength(JSON.stringify(record), 'utf8') > MAX_ENVELOPE_BYTES) {
    throw new Error('byte_limit_exceeded: Entity get response exceeds 6144 bytes budget');
  }

  return record;
}

interface EntityCursorData {
  op: 'entity_list';
  scope_key: string;
  explicit_global: boolean;
  type: string | null;
  dataset_fingerprint: string;
  after_id: string;
}

function encodeEntityCursor(data: EntityCursorData): string {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
}

function decodeEntityCursor(cursor: string): EntityCursorData {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (parsed.op === 'entity_list' && typeof parsed.after_id === 'string' && typeof parsed.dataset_fingerprint === 'string') {
      return parsed;
    }
  } catch {}
  throw new Error('invalid_cursor: Malformed entity list cursor');
}

function computeEntityDatasetFingerprint(
  db: DatabaseSync,
  scope: Scope,
  explicitGlobal: boolean,
  typeFilter?: EntityType,
): string {
  const scopeKey = encodeScope(scope);
  let sql = `
    SELECT e.id, e.updated_at
    FROM entities e
    LEFT JOIN memories m ON m.id = e.memory_id AND e.type = 'memory'
    WHERE (e.type != 'memory' OR (m.id IS NOT NULL AND m.deleted_at IS NULL))
  `;

  const params: any[] = [];
  if (!explicitGlobal) {
    if (scope.kind === 'project') {
      sql += ` AND (e.scope_key = ? OR (e.scope_key = '["global"]' AND e.type IN ('technology', 'concept')))`;
      params.push(scopeKey);
    } else {
      sql += ` AND e.scope_key = '["global"]'`;
    }
  }

  if (typeFilter) {
    sql += ` AND e.type = ?`;
    params.push(typeFilter);
  }

  sql += ` ORDER BY e.id ASC;`;

  const rows = db.prepare(sql).all(...params) as unknown as Array<{ id: string; updated_at: string }>;
  const hash = crypto.createHash('sha256');
  for (const r of rows) {
    hash.update(`${r.id}:${r.updated_at};`);
  }
  return hash.digest('hex');
}

export function listEntities(
  db: DatabaseSync,
  options: ListEntitiesOptions,
): ListEntitiesResult {
  checkCancellation(options);

  if (!options.scope || (options.scope.kind !== 'global' && options.scope.kind !== 'project')) {
    throw new Error('invalid_input: Invalid scope');
  }

  const explicitGlobal = !!options.explicitGlobal;
  const scopeKey = encodeScope(options.scope);
  const typeFilter = options.type;

  const datasetFingerprint = computeEntityDatasetFingerprint(db, options.scope, explicitGlobal, typeFilter);

  let afterId: string | null = null;
  if (options.cursor) {
    const cursorData = decodeEntityCursor(options.cursor);
    if (cursorData.scope_key !== scopeKey || cursorData.explicit_global !== explicitGlobal) {
      throw new Error('cursor_scope_mismatch: Cursor scope does not match list scope');
    }
    if (cursorData.type !== (typeFilter ?? null)) {
      throw new Error('cursor_scope_mismatch: Cursor type filter does not match current list filter');
    }
    if (cursorData.dataset_fingerprint !== datasetFingerprint) {
      throw new Error('cursor_expired: Dataset modified since cursor creation');
    }
    afterId = cursorData.after_id;
  }

  let sql = `
    SELECT e.*, m.title AS mem_title, m.content AS mem_content
    FROM entities e
    LEFT JOIN memories m ON m.id = e.memory_id AND e.type = 'memory'
    WHERE (e.type != 'memory' OR (m.id IS NOT NULL AND m.deleted_at IS NULL))
  `;

  const params: any[] = [];
  if (!explicitGlobal) {
    if (options.scope.kind === 'project') {
      sql += ` AND (e.scope_key = ? OR (e.scope_key = '["global"]' AND e.type IN ('technology', 'concept')))`;
      params.push(scopeKey);
    } else {
      sql += ` AND e.scope_key = '["global"]'`;
    }
  }

  if (typeFilter) {
    sql += ` AND e.type = ?`;
    params.push(typeFilter);
  }

  if (afterId) {
    sql += ` AND e.id > ?`;
    params.push(afterId);
  }

  sql += ` ORDER BY e.id ASC;`;

  const rows = db.prepare(sql).all(...params) as unknown as Array<EntityRow & { mem_title?: string; mem_content?: string }>;

  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const candidateSlice = rows.slice(0, limit);

  const scopeDisplay = {
    kind: options.scope.kind,
    project: options.scope.kind === 'project' ? options.scope.project : undefined,
    explicit_global: explicitGlobal,
  };

  const entities: EntityRecord[] = [];

  for (let i = 0; i < candidateSlice.length; i++) {
    const row = candidateSlice[i];
    let memorySummary: { title: string; excerpt: string } | undefined;

    if (row.type === 'memory' && row.mem_title) {
      const { text: safeTitle } = truncateCodePoints(row.mem_title, 80);
      const contentSource = row.mem_content && row.mem_content.trim().length > 0 ? row.mem_content : row.mem_title;
      const { text: safeExcerpt } = truncateCodePoints(contentSource, 100);
      memorySummary = {
        title: safeTitle,
        excerpt: safeExcerpt,
      };
    }

    const { text: safeDisplay } = truncateCodePoints(row.display_name, 80);
    const { text: safeCanonical } = truncateCodePoints(row.canonical_name, 80);
    const aliases = parseAliases(row.aliases_json);

    const record: EntityRecord = {
      id: row.id,
      type: row.type as EntityType,
      canonical_name: safeCanonical,
      display_name: safeDisplay,
      scope: decodeScope(row.scope_key),
      aliases,
      memory_id: row.memory_id,
      memory_summary: memorySummary,
      created_at: row.created_at,
      updated_at: row.updated_at,
      session_id: row.session_id,
    };

    // Test envelope size
    const prospectiveEntities = [...entities, record];
    const prospectiveHasMore = rows.length > prospectiveEntities.length;
    const prospectiveCursor = prospectiveHasMore
      ? encodeEntityCursor({
          op: 'entity_list',
          scope_key: scopeKey,
          explicit_global: explicitGlobal,
          type: typeFilter ?? null,
          dataset_fingerprint: datasetFingerprint,
          after_id: record.id,
        })
      : null;

    const trialEnvelope: ListEntitiesResult = {
      status: 'ok',
      scope: scopeDisplay,
      entities: prospectiveEntities,
      has_more: prospectiveHasMore,
      next_cursor: prospectiveCursor,
    };

    const envelopeByteLimit = options.maxEnvelopeBytes ?? MAX_ENVELOPE_BYTES;
    const isBudgetOk = (env: ListEntitiesResult) => {
      if (options.isWithinBudget) return options.isWithinBudget(env);
      return Buffer.byteLength(JSON.stringify(env), 'utf8') <= envelopeByteLimit;
    };

    if (isBudgetOk(trialEnvelope)) {
      entities.push(record);
    } else {
      // Try further abbreviation
      const miniRecord: EntityRecord = {
        ...record,
        display_name: truncateCodePoints(record.display_name, 30).text,
        aliases: record.aliases.slice(0, 3),
      };
      const miniEnvelope: ListEntitiesResult = {
        ...trialEnvelope,
        entities: [...entities, miniRecord],
      };
      if (isBudgetOk(miniEnvelope)) {
        entities.push(miniRecord);
      } else {
        break;
      }
    }
  }

  if (entities.length === 0 && candidateSlice.length > 0) {
    throw new Error('byte_limit_exceeded: Entity list response exceeds 6144 bytes budget');
  }

  const hasMore = rows.length > entities.length;
  const nextCursor = hasMore && entities.length > 0
    ? encodeEntityCursor({
        op: 'entity_list',
        scope_key: scopeKey,
        explicit_global: explicitGlobal,
        type: typeFilter ?? null,
        dataset_fingerprint: datasetFingerprint,
        after_id: entities[entities.length - 1].id,
      })
    : null;

  return {
    status: 'ok',
    scope: scopeDisplay,
    entities,
    has_more: hasMore,
    next_cursor: nextCursor,
  };
}

export function saveRelation(
  db: DatabaseSync,
  input: SaveRelationInput,
  options: SaveRelationOptions,
): SaveRelationResult {
  checkCancellation(options);

  if (!input.relationType || !RELATION_TYPES.includes(input.relationType)) {
    throw new Error(`invalid_input: Invalid relation type '${input.relationType}'`);
  }

  if (!input.sourceEntityId || typeof input.sourceEntityId !== 'string') {
    throw new Error('invalid_input: sourceEntityId must be a non-empty string');
  }
  if (!input.targetEntityId || typeof input.targetEntityId !== 'string') {
    throw new Error('invalid_input: targetEntityId must be a non-empty string');
  }

  if (!input.scope || (input.scope.kind !== 'global' && input.scope.kind !== 'project')) {
    throw new Error('invalid_input: Invalid scope');
  }

  if (input.scope.kind === 'global' && !options.explicitGlobalWrite) {
    throw new Error('scope_mismatch: Creating or updating global relation requires explicit global write authorization');
  }

  const relationScopeKey = encodeScope(input.scope);

  db.exec('BEGIN IMMEDIATE;');
  try {
    checkCancellation(options);

    // Fetch endpoints
    const source = db.prepare('SELECT * FROM entities WHERE id = ?;').get(input.sourceEntityId) as EntityRow | undefined;
    const target = db.prepare('SELECT * FROM entities WHERE id = ?;').get(input.targetEntityId) as EntityRow | undefined;

    if (!source) {
      throw new Error(`target_not_found: Source entity '${input.sourceEntityId}' does not exist`);
    }
    if (!target) {
      throw new Error(`target_not_found: Target entity '${input.targetEntityId}' does not exist`);
    }

    // Active memory check
    if (source.type === 'memory' && source.memory_id) {
      const mem = db.prepare('SELECT deleted_at FROM memories WHERE id = ?;').get(source.memory_id) as { deleted_at: string | null } | undefined;
      if (!mem || mem.deleted_at !== null) {
        throw new Error(`target_deleted: Source memory entity '${source.id}' references a deleted memory`);
      }
    }
    if (target.type === 'memory' && target.memory_id) {
      const mem = db.prepare('SELECT deleted_at FROM memories WHERE id = ?;').get(target.memory_id) as { deleted_at: string | null } | undefined;
      if (!mem || mem.deleted_at !== null) {
        throw new Error(`target_deleted: Target memory entity '${target.id}' references a deleted memory`);
      }
    }

    // Scope compatibility
    if (input.scope.kind === 'project') {
      const isEndpointAllowed = (e: EntityRow) => {
        if (e.scope_key === relationScopeKey) return true;
        if (e.scope_key === '["global"]' && (e.type === 'technology' || e.type === 'concept')) return true;
        return false;
      };

      if (!isEndpointAllowed(source)) {
        throw new Error(`scope_mismatch: Source endpoint '${source.id}' is outside project scope or invalid global kind '${source.type}'`);
      }
      if (!isEndpointAllowed(target)) {
        throw new Error(`scope_mismatch: Target endpoint '${target.id}' is outside project scope or invalid global kind '${target.type}'`);
      }
    } else {
      // Global relation: endpoints must be global
      if (source.scope_key !== '["global"]') {
        throw new Error(`scope_mismatch: Global relation cannot reference project-private source endpoint '${source.id}'`);
      }
      if (target.scope_key !== '["global"]') {
        throw new Error(`scope_mismatch: Global relation cannot reference project-private target endpoint '${target.id}'`);
      }
    }

    let resultId: string;
    let existed = false;

    if (input.id) {
      const existing = db.prepare('SELECT * FROM relations WHERE id = ?;').get(input.id) as RelationRow | undefined;
      if (!existing) {
        throw new Error(`target_not_found: Relation with id '${input.id}' not found`);
      }
      if (existing.scope_key !== relationScopeKey) {
        throw new Error(`scope_mismatch: Cannot change relation scope from '${existing.scope_key}' to '${relationScopeKey}'`);
      }

      // Check collision with another relation
      const otherSame = db.prepare(`
        SELECT id FROM relations
        WHERE source_entity_id = ? AND relation_type = ? AND target_entity_id = ? AND scope_key = ? AND id != ?;
      `).get(input.sourceEntityId, input.relationType, input.targetEntityId, relationScopeKey, input.id) as { id: string } | undefined;

      if (otherSame) {
        throw new Error(`relation_conflict: Identical relation already exists with id '${otherSame.id}'`);
      }

      db.prepare(`
        UPDATE relations
        SET source_entity_id = ?,
            target_entity_id = ?,
            relation_type = ?
        WHERE id = ?;
      `).run(input.sourceEntityId, input.targetEntityId, input.relationType, input.id);

      resultId = input.id;
    } else {
      // Save without ID: check natural key (source_entity_id, relation_type, target_entity_id, scope_key)
      const existing = db.prepare(`
        SELECT * FROM relations
        WHERE source_entity_id = ? AND relation_type = ? AND target_entity_id = ? AND scope_key = ?;
      `).get(input.sourceEntityId, input.relationType, input.targetEntityId, relationScopeKey) as RelationRow | undefined;

      if (existing) {
        resultId = existing.id;
        existed = true;
      } else {
        resultId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO relations (
            id, source_entity_id, target_entity_id, relation_type,
            scope_key, session_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'));
        `).run(
          resultId,
          input.sourceEntityId,
          input.targetEntityId,
          input.relationType,
          relationScopeKey,
          options.sessionId,
        );
      }
    }

    checkCancellation(options);
    db.exec('COMMIT;');

    const result: SaveRelationResult = {
      status: 'ok',
      operation: 'save_relation',
      id: resultId,
      source_entity_id: input.sourceEntityId,
      target_entity_id: input.targetEntityId,
      relation_type: input.relationType,
      scope: input.scope,
      existed,
    };

    return enforceEnvelopeBudget(result);
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function deleteRelation(
  db: DatabaseSync,
  input: DeleteRelationInput,
  options?: DeleteRelationOptions,
): DeleteRelationResult {
  checkCancellation(options);

  if (!input.id || typeof input.id !== 'string') {
    throw new Error('invalid_input: id must be a non-empty string');
  }

  const expectedScopeKey = encodeScope(input.scope);

  db.exec('BEGIN IMMEDIATE;');
  try {
    checkCancellation(options);

    const existing = db.prepare('SELECT * FROM relations WHERE id = ?;').get(input.id) as RelationRow | undefined;
    if (!existing) {
      throw new Error(`not_found: Relation '${input.id}' not found`);
    }

    if (existing.scope_key !== expectedScopeKey) {
      throw new Error(`scope_mismatch: Relation belongs to scope '${existing.scope_key}', not '${expectedScopeKey}'`);
    }

    db.prepare('DELETE FROM relations WHERE id = ?;').run(input.id);

    checkCancellation(options);
    db.exec('COMMIT;');

    const result: DeleteRelationResult = {
      status: 'ok',
      operation: 'delete_relation',
      id: input.id,
      scope: input.scope,
    };

    return enforceEnvelopeBudget(result);
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function saveAssociation(
  db: DatabaseSync,
  input: SaveAssociationInput,
  options: SaveAssociationOptions,
): SaveAssociationResult {
  checkCancellation(options);

  if (!input.memoryId || !Number.isSafeInteger(input.memoryId) || input.memoryId <= 0) {
    throw new Error('invalid_input: memoryId must be a positive integer');
  }
  if (!input.entityId || typeof input.entityId !== 'string') {
    throw new Error('invalid_input: entityId must be a non-empty string');
  }

  const scopeKey = encodeScope(input.scope);

  db.exec('BEGIN IMMEDIATE;');
  try {
    checkCancellation(options);

    // Verify memory exists, is active, and matches scope
    const mem = db.prepare('SELECT id, scope_key, deleted_at FROM memories WHERE id = ?;').get(input.memoryId) as {
      id: number;
      scope_key: string;
      deleted_at: string | null;
    } | undefined;

    if (!mem) {
      throw new Error(`not_found: Memory ${input.memoryId} not found`);
    }
    if (mem.deleted_at !== null) {
      throw new Error(`target_deleted: Memory ${input.memoryId} is soft-deleted`);
    }
    if (mem.scope_key !== scopeKey) {
      throw new Error('scope_mismatch: Memory scope does not match association scope');
    }

    // Verify entity exists and is scope-compatible
    const entity = db.prepare('SELECT * FROM entities WHERE id = ?;').get(input.entityId) as EntityRow | undefined;
    if (!entity) {
      throw new Error(`not_found: Entity '${input.entityId}' not found`);
    }

    if (input.scope.kind === 'project') {
      const allowed = entity.scope_key === scopeKey ||
        (entity.scope_key === '["global"]' && (entity.type === 'technology' || entity.type === 'concept'));
      if (!allowed) {
        throw new Error(`scope_mismatch: Entity '${entity.id}' is outside project scope or invalid global kind`);
      }
    } else {
      if (entity.scope_key !== '["global"]') {
        throw new Error(`scope_mismatch: Global association cannot link project-private entity '${entity.id}'`);
      }
    }

    // Check if link exists
    const existing = db.prepare(
      'SELECT * FROM memory_entity_links WHERE memory_id = ? AND entity_id = ?;'
    ).get(input.memoryId, input.entityId) as AssociationRow | undefined;

    let resultId: string;
    let existed = false;

    if (existing) {
      resultId = existing.id;
      existed = true;
    } else {
      resultId = input.id ?? crypto.randomUUID();
      db.prepare(`
        INSERT INTO memory_entity_links (
          id, memory_id, entity_id, scope_key, session_id, created_at
        ) VALUES (?, ?, ?, ?, ?, datetime('now'));
      `).run(resultId, input.memoryId, input.entityId, scopeKey, options.sessionId);
    }

    checkCancellation(options);
    db.exec('COMMIT;');

    const result: SaveAssociationResult = {
      status: 'ok',
      operation: 'save_association',
      id: resultId,
      memory_id: input.memoryId,
      entity_id: input.entityId,
      scope: input.scope,
      existed,
    };

    return enforceEnvelopeBudget(result);
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function deleteAssociation(
  db: DatabaseSync,
  input: DeleteAssociationInput,
  options?: DeleteAssociationOptions,
): DeleteAssociationResult {
  checkCancellation(options);

  const scopeKey = encodeScope(input.scope);

  db.exec('BEGIN IMMEDIATE;');
  try {
    checkCancellation(options);

    let existing: AssociationRow | undefined;
    if (input.id) {
      existing = db.prepare('SELECT * FROM memory_entity_links WHERE id = ?;').get(input.id) as AssociationRow | undefined;
    } else if (input.memoryId && input.entityId) {
      existing = db.prepare(
        'SELECT * FROM memory_entity_links WHERE memory_id = ? AND entity_id = ?;'
      ).get(input.memoryId, input.entityId) as AssociationRow | undefined;
    } else {
      throw new Error('invalid_input: Association id or (memoryId and entityId) is required');
    }

    if (!existing) {
      throw new Error('not_found: Association not found');
    }

    if (existing.scope_key !== scopeKey) {
      throw new Error(`scope_mismatch: Association belongs to scope '${existing.scope_key}', not '${scopeKey}'`);
    }

    db.prepare('DELETE FROM memory_entity_links WHERE id = ?;').run(existing.id);

    checkCancellation(options);
    db.exec('COMMIT;');

    const result: DeleteAssociationResult = {
      status: 'ok',
      operation: 'delete_association',
      id: existing.id,
      memory_id: existing.memory_id,
      entity_id: existing.entity_id,
      scope: input.scope,
    };

    return enforceEnvelopeBudget(result);
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function traverseGraph(
  db: DatabaseSync,
  options: TraverseGraphOptions,
): GraphTraverseEnvelope {
  checkCancellation(options);

  if (!options.rootEntityId || typeof options.rootEntityId !== 'string') {
    throw new Error('invalid_input: rootEntityId must be a non-empty string');
  }

  if (!options.scope || (options.scope.kind !== 'global' && options.scope.kind !== 'project')) {
    throw new Error('invalid_input: Invalid scope');
  }

  const explicitGlobal = !!options.explicitGlobal;
  const currentProjectKey = encodeScope(options.scope);

  // Validate root entity
  const rootRow = db.prepare('SELECT * FROM entities WHERE id = ?;').get(options.rootEntityId) as EntityRow | undefined;
  if (!rootRow) {
    throw new Error(`not_found: Root entity '${options.rootEntityId}' not found`);
  }

  // Root visibility
  if (!explicitGlobal) {
    if (options.scope.kind === 'project') {
      const isCurrentProject = rootRow.scope_key === currentProjectKey;
      const isSharedGlobal = rootRow.scope_key === '["global"]' && (rootRow.type === 'technology' || rootRow.type === 'concept');
      if (!isCurrentProject && !isSharedGlobal) {
        throw new Error(`scope_mismatch: Root entity '${rootRow.id}' is outside selected project scope`);
      }
    } else {
      if (rootRow.scope_key !== '["global"]') {
        throw new Error(`scope_mismatch: Root entity '${rootRow.id}' is outside global scope`);
      }
    }
  }

  // Root soft-delete check
  let rootMemorySummary: { title: string; excerpt: string } | undefined;
  if (rootRow.type === 'memory' && rootRow.memory_id) {
    const mem = db.prepare('SELECT title, content, deleted_at FROM memories WHERE id = ?;').get(rootRow.memory_id) as {
      title: string;
      content: string;
      deleted_at: string | null;
    } | undefined;
    if (!mem || mem.deleted_at !== null) {
      throw new Error(`not_found: Root memory entity '${rootRow.id}' references a deleted memory`);
    }
    const { text: safeTitle } = truncateCodePoints(mem.title, 80);
    const contentSource = mem.content.trim().length > 0 ? mem.content : mem.title;
    const { text: safeExcerpt } = truncateCodePoints(contentSource, 100);
    rootMemorySummary = {
      title: safeTitle,
      excerpt: safeExcerpt,
    };
  }

  const limitHops = Math.min(2, Math.max(1, options.maxHops ?? 2));
  const limitEntities = Math.min(20, Math.max(1, options.maxEntities ?? 20));

  const rootNode: GraphNode = {
    id: rootRow.id,
    type: rootRow.type as EntityType,
    canonical_name: rootRow.canonical_name,
    display_name: truncateCodePoints(rootRow.display_name, 80).text,
    scope: decodeScope(rootRow.scope_key),
    depth: 0,
    memory_summary: rootMemorySummary,
  };

  const visitedEntities = new Map<string, GraphNode>();
  visitedEntities.set(rootNode.id, rootNode);

  const visitedEdges = new Map<string, GraphEdge>();
  const queue: Array<{ entityId: string; depth: number }> = [{ entityId: rootNode.id, depth: 0 }];

  let depthLimitReached = false;
  let entityLimitReached = false;
  let byteLimitReached = false;

  // Scoped query for incident relations preventing foreign-node starvation
  // Keyset bounded pagination by r.id ASC with explicit LIMIT to prevent unbounded SQL reads
  let incidentSql: string;
  if (!explicitGlobal) {
    if (options.scope.kind === 'project') {
      incidentSql = `
        SELECT r.id, r.source_entity_id, r.target_entity_id, r.relation_type, r.scope_key
        FROM relations r
        JOIN entities s ON s.id = r.source_entity_id
        JOIN entities t ON t.id = r.target_entity_id
        LEFT JOIN memories sm ON sm.id = s.memory_id AND s.type = 'memory'
        LEFT JOIN memories tm ON tm.id = t.memory_id AND t.type = 'memory'
        WHERE r.scope_key = ?
          AND (r.source_entity_id = ? OR r.target_entity_id = ?)
          AND r.id > ?
          AND (s.scope_key = ? OR (s.scope_key = '["global"]' AND s.type IN ('technology', 'concept')))
          AND (t.scope_key = ? OR (t.scope_key = '["global"]' AND t.type IN ('technology', 'concept')))
          AND (s.type != 'memory' OR (sm.id IS NOT NULL AND sm.deleted_at IS NULL))
          AND (t.type != 'memory' OR (tm.id IS NOT NULL AND tm.deleted_at IS NULL))
        ORDER BY r.id ASC
        LIMIT ?;
      `;
    } else {
      incidentSql = `
        SELECT r.id, r.source_entity_id, r.target_entity_id, r.relation_type, r.scope_key
        FROM relations r
        JOIN entities s ON s.id = r.source_entity_id
        JOIN entities t ON t.id = r.target_entity_id
        LEFT JOIN memories sm ON sm.id = s.memory_id AND s.type = 'memory'
        LEFT JOIN memories tm ON tm.id = t.memory_id AND t.type = 'memory'
        WHERE r.scope_key = '["global"]'
          AND (r.source_entity_id = ? OR r.target_entity_id = ?)
          AND r.id > ?
          AND s.scope_key = '["global"]'
          AND t.scope_key = '["global"]'
          AND (s.type != 'memory' OR (sm.id IS NOT NULL AND sm.deleted_at IS NULL))
          AND (t.type != 'memory' OR (tm.id IS NOT NULL AND tm.deleted_at IS NULL))
        ORDER BY r.id ASC
        LIMIT ?;
      `;
    }
  } else {
    incidentSql = `
      SELECT r.id, r.source_entity_id, r.target_entity_id, r.relation_type, r.scope_key
      FROM relations r
      JOIN entities s ON s.id = r.source_entity_id
      JOIN entities t ON t.id = r.target_entity_id
      LEFT JOIN memories sm ON sm.id = s.memory_id AND s.type = 'memory'
      LEFT JOIN memories tm ON tm.id = t.memory_id AND t.type = 'memory'
      WHERE (r.source_entity_id = ? OR r.target_entity_id = ?)
        AND r.id > ?
        AND (s.type != 'memory' OR (sm.id IS NOT NULL AND sm.deleted_at IS NULL))
        AND (t.type != 'memory' OR (tm.id IS NOT NULL AND tm.deleted_at IS NULL))
      ORDER BY r.id ASC
      LIMIT ?;
    `;
  }

  const stmt = db.prepare(incidentSql);
  const assocStmt = db.prepare(`
    SELECT l.id, l.memory_id, l.entity_id, l.scope_key
    FROM memory_entity_links l
    JOIN memories m ON m.id = l.memory_id
    WHERE l.entity_id = ?
      AND m.deleted_at IS NULL
      AND (? = 1 OR l.scope_key = ?)
    ORDER BY l.id ASC;
  `);

  const associations: GraphAssociation[] = [];
  const envelopeByteLimit = options.maxEnvelopeBytes ?? MAX_ENVELOPE_BYTES;

  function isEnvelopeBudgetOk(trial: GraphTraverseEnvelope): boolean {
    if (options.isWithinBudget) {
      return options.isWithinBudget(trial);
    }
    return Buffer.byteLength(JSON.stringify(trial), 'utf8') <= envelopeByteLimit;
  }

  function computeEnvelopeBytes(
    root: GraphNode,
    nodes: GraphNode[],
    edges: GraphEdge[],
    assocs: GraphAssociation[],
    lims: GraphLimits,
  ): number {
    return Buffer.byteLength(
      JSON.stringify({
        status: 'ok',
        root,
        nodes,
        edges,
        associations: assocs,
        limits: lims,
      }),
      'utf8',
    );
  }

  function fetchAndAdmitAssociations(targetEntityId: string): void {
    const linkRows = assocStmt.all(
      targetEntityId,
      explicitGlobal ? 1 : 0,
      currentProjectKey,
    ) as unknown as AssociationRow[];

    for (const lr of linkRows) {
      const candAssoc: GraphAssociation = {
        id: lr.id,
        memory_id: lr.memory_id,
        entity_id: lr.entity_id,
        scope: decodeScope(lr.scope_key),
      };
      const trialAssocs = [...associations, candAssoc];
      const trialLimits: GraphLimits = {
        depth_limit: depthLimitReached,
        entity_limit: entityLimitReached,
        byte_limit: true,
        max_hops: limitHops,
        max_entities: limitEntities,
        has_more: true,
        guidance: 'Recommend a new focused root query',
      };
      const trialNodes = Array.from(visitedEntities.values());
      const trialEdges = Array.from(visitedEdges.values());
      const trialEnvelope: GraphTraverseEnvelope = {
        status: 'ok',
        root: rootNode,
        nodes: trialNodes,
        edges: trialEdges,
        associations: trialAssocs,
        limits: trialLimits,
      };
      if (isEnvelopeBudgetOk(trialEnvelope)) {
        associations.push(candAssoc);
      } else {
        byteLimitReached = true;
        break;
      }
    }
  }

  fetchAndAdmitAssociations(rootNode.id);

  while (queue.length > 0) {
    checkCancellation(options);
    if (byteLimitReached) break;

    const item = queue.shift()!;
    const { entityId, depth } = item;

    // Keyset page size: dynamically bounded to remaining entity capacity + 5 (capped at 25)
    const remainingEntities = limitEntities - visitedEntities.size;
    const pageSize = Math.max(1, Math.min(25, remainingEntities + 5));

    let lastSeenRelationId = '';
    let exhaustedRelationsForNode = false;

    while (!exhaustedRelationsForNode) {
      checkCancellation(options);
      if (byteLimitReached) break;

      let relations: RelationRow[];
      if (!explicitGlobal) {
        if (options.scope.kind === 'project') {
          relations = stmt.all(
            currentProjectKey,
            entityId,
            entityId,
            lastSeenRelationId,
            currentProjectKey,
            currentProjectKey,
            pageSize,
          ) as unknown as RelationRow[];
        } else {
          relations = stmt.all(entityId, entityId, lastSeenRelationId, pageSize) as unknown as RelationRow[];
        }
      } else {
        relations = stmt.all(entityId, entityId, lastSeenRelationId, pageSize) as unknown as RelationRow[];
      }

      if (relations.length === 0) {
        exhaustedRelationsForNode = true;
        break;
      }

      lastSeenRelationId = relations[relations.length - 1].id;
      if (relations.length < pageSize) {
        exhaustedRelationsForNode = true;
      }

      if (depth >= limitHops) {
        // At max depth, check if any incident relation points to an unvisited entity
        for (const rel of relations) {
          const neighborId = rel.source_entity_id === entityId ? rel.target_entity_id : rel.source_entity_id;
          if (!visitedEntities.has(neighborId)) {
            depthLimitReached = true;
            exhaustedRelationsForNode = true;
            break;
          }
        }
        continue;
      }

      for (const rel of relations) {
        checkCancellation(options);

        // Deduplicate: if edge is already admitted, skip
        if (visitedEdges.has(rel.id)) {
          continue;
        }

        const isOutgoing = rel.source_entity_id === entityId;
        const neighborId = isOutgoing ? rel.target_entity_id : rel.source_entity_id;

        if (visitedEntities.has(neighborId)) {
          // Both endpoints are already admitted (parallel edge, cycle, or self-link)
          const candEdge: GraphEdge = {
            id: rel.id,
            source: rel.source_entity_id,
            target: rel.target_entity_id,
            type: rel.relation_type as RelationType,
            scope: decodeScope(rel.scope_key),
            direction: isOutgoing ? 'outgoing' : 'incoming',
          };

          const trialLimits: GraphLimits = {
            depth_limit: depthLimitReached,
            entity_limit: entityLimitReached,
            byte_limit: true,
            max_hops: limitHops,
            max_entities: limitEntities,
            has_more: true,
            guidance: 'Recommend a new focused root query',
          };
          const trialNodes = Array.from(visitedEntities.values());
          const trialEdges = [...visitedEdges.values(), candEdge];
          const trialEnvelope: GraphTraverseEnvelope = {
            status: 'ok',
            root: rootNode,
            nodes: trialNodes,
            edges: trialEdges,
            associations,
            limits: trialLimits,
          };

          if (isEnvelopeBudgetOk(trialEnvelope)) {
            visitedEdges.set(candEdge.id, candEdge);
          } else {
            byteLimitReached = true;
            exhaustedRelationsForNode = true;
            break;
          }
          continue;
        }

        // Neighbor is unvisited. Check entity limit budget before admission!
        if (visitedEntities.size >= limitEntities) {
          entityLimitReached = true;
          // Do not admit neighbor or edge to unadmitted neighbor; stop scanning
          exhaustedRelationsForNode = true;
          break;
        }

        // Fetch neighbor entity
        const nRow = db.prepare('SELECT * FROM entities WHERE id = ?;').get(neighborId) as EntityRow | undefined;
        if (!nRow) continue; // Skip obsolete / foreign row

        let nMemSummary: { title: string; excerpt: string } | undefined;
        if (nRow.type === 'memory' && nRow.memory_id) {
          const m = db.prepare('SELECT title, content, deleted_at FROM memories WHERE id = ?;').get(nRow.memory_id) as {
            title: string;
            content: string;
            deleted_at: string | null;
          } | undefined;
          if (!m || m.deleted_at !== null) {
            continue;
          }
          nMemSummary = {
            title: truncateCodePoints(m.title, 80).text,
            excerpt: truncateCodePoints(m.content.trim().length > 0 ? m.content : m.title, 100).text,
          };
        }

        const candNeighborNode: GraphNode = {
          id: nRow.id,
          type: nRow.type as EntityType,
          canonical_name: nRow.canonical_name,
          display_name: truncateCodePoints(nRow.display_name, 80).text,
          scope: decodeScope(nRow.scope_key),
          depth: depth + 1,
          memory_summary: nMemSummary,
        };

        const candEdge: GraphEdge = {
          id: rel.id,
          source: rel.source_entity_id,
          target: rel.target_entity_id,
          type: rel.relation_type as RelationType,
          scope: decodeScope(rel.scope_key),
          direction: isOutgoing ? 'outgoing' : 'incoming',
        };

        if (options.isWithinBudget) {
          const trialNodes = [...visitedEntities.values(), candNeighborNode];
          const trialEdges = [...visitedEdges.values(), candEdge];
          const trialLimits: GraphLimits = {
            depth_limit: depthLimitReached,
            entity_limit: entityLimitReached,
            byte_limit: true,
            max_hops: limitHops,
            max_entities: limitEntities,
            has_more: true,
            guidance: 'Recommend a new focused root query',
          };
          const trialEnvelope: GraphTraverseEnvelope = {
            status: 'ok',
            root: rootNode,
            nodes: trialNodes,
            edges: trialEdges,
            associations,
            limits: trialLimits,
          };

          if (!options.isWithinBudget(trialEnvelope)) {
            byteLimitReached = true;
            exhaustedRelationsForNode = true;
            break;
          }
        }

        visitedEntities.set(candNeighborNode.id, candNeighborNode);
        visitedEdges.set(candEdge.id, candEdge);
        fetchAndAdmitAssociations(candNeighborNode.id);

        if (depth + 1 <= limitHops) {
          queue.push({ entityId: candNeighborNode.id, depth: depth + 1 });
        }

        if (visitedEntities.size >= limitEntities) {
          entityLimitReached = true;
          exhaustedRelationsForNode = true;
          break;
        }
      }
    }
  }

  // Build sorted results
  // Nodes: root first, then by depth ASC, then by id ASC
  const sortedNodes = Array.from(visitedEntities.values()).sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.id.localeCompare(b.id);
  });

  const sortedEdges = Array.from(visitedEdges.values())
    .filter(e => visitedEntities.has(e.source) && visitedEntities.has(e.target))
    .sort((a, b) => a.id.localeCompare(b.id));
  const sortedAssocs = associations.sort((a, b) => a.id.localeCompare(b.id));

  const hasMore = depthLimitReached || entityLimitReached || byteLimitReached;
  const limits: GraphLimits = {
    depth_limit: depthLimitReached,
    entity_limit: entityLimitReached,
    byte_limit: byteLimitReached,
    max_hops: limitHops,
    max_entities: limitEntities,
    has_more: hasMore,
    guidance: hasMore ? 'Recommend a new focused root query' : undefined,
  };

  const envelope: GraphTraverseEnvelope = {
    status: 'ok',
    root: rootNode,
    nodes: sortedNodes,
    edges: sortedEdges,
    associations: sortedAssocs,
    limits,
  };

  if (isEnvelopeBudgetOk(envelope)) {
    return envelope;
  }

  // Envelope exceeds budget: trim/abbreviate safely
  byteLimitReached = true;
  limits.byte_limit = true;
  limits.has_more = true;
  limits.guidance = 'Recommend a new focused root query';

  // Abbreviate nodes
  for (const node of sortedNodes) {
    node.display_name = truncateCodePoints(node.display_name, 25).text;
    node.canonical_name = truncateCodePoints(node.canonical_name, 25).text;
    if (node.memory_summary) {
      node.memory_summary.title = truncateCodePoints(node.memory_summary.title, 25).text;
      node.memory_summary.excerpt = truncateCodePoints(node.memory_summary.excerpt, 25).text;
    }
  }

  const abbreviatedTrial: GraphTraverseEnvelope = {
    status: 'ok',
    root: rootNode,
    nodes: sortedNodes,
    edges: sortedEdges,
    associations: sortedAssocs,
    limits,
  };
  if (isEnvelopeBudgetOk(abbreviatedTrial)) {
    return abbreviatedTrial;
  }

  let trimmedNodes = [...sortedNodes];
  while (trimmedNodes.length > 1) {
    const trial: GraphTraverseEnvelope = {
      status: 'ok',
      root: rootNode,
      nodes: trimmedNodes,
      edges: sortedEdges.filter(e => trimmedNodes.some(n => n.id === e.source) && trimmedNodes.some(n => n.id === e.target)),
      associations: sortedAssocs.filter(a => trimmedNodes.some(n => n.id === a.entity_id)),
      limits,
    };
    if (isEnvelopeBudgetOk(trial)) {
      return trial;
    }
    // Remove deepest node from the end
    trimmedNodes.pop();
  }

  // If even only root node is left
  const minimalTrial: GraphTraverseEnvelope = {
    status: 'ok',
    root: {
      ...rootNode,
      canonical_name: truncateCodePoints(rootNode.canonical_name, 20).text,
      display_name: truncateCodePoints(rootNode.display_name, 20).text,
      memory_summary: undefined,
    },
    nodes: [{
      ...rootNode,
      canonical_name: truncateCodePoints(rootNode.canonical_name, 20).text,
      display_name: truncateCodePoints(rootNode.display_name, 20).text,
      memory_summary: undefined,
    }],
    edges: [],
    associations: [],
    limits,
  };

  if (isEnvelopeBudgetOk(minimalTrial)) {
    return minimalTrial;
  }

  throw new Error('byte_limit_exceeded: Graph traversal response exceeds 6144 bytes budget; refine root query');
}
