import type { DatabaseSync } from 'node:sqlite';
import type {
  CreateEntityInput,
  CreateMemoryEntityLinkInput,
  CreateMemoryInput,
  CreateRelationInput,
  Entity,
  Memory,
  MemoryEntityLink,
  Relation,
  ReplaceMemoryInput,
  SyntheticChunkInput,
} from '../types.ts';

export function createMemory(db: DatabaseSync, input: CreateMemoryInput): Memory {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const memory = db.prepare(`
      INSERT INTO memories (
        scope_key, title, content, type, topic_key, content_version,
        deleted_at, indexing_status, session_id, invoking_parent_session_id, invocation_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, NULL, 'pending', ?, ?, ?, datetime('now'), datetime('now'))
      RETURNING *;
    `).get(
      input.scopeKey,
      input.title,
      input.content,
      input.type,
      input.topicKey ?? null,
      input.sessionId,
      input.invokingParentSessionId ?? null,
      input.invocationId ?? null,
    ) as unknown as Memory;

    db.prepare(`
      INSERT INTO memory_fts (rowid, title, content)
      VALUES (?, ?, ?);
    `).run(memory.id, memory.title, memory.content);

    db.exec('COMMIT;');
    return memory;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function replaceMemory(db: DatabaseSync, id: number, input: ReplaceMemoryInput): Memory {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const existing = db.prepare('SELECT * FROM memories WHERE id = ? AND scope_key = ?;').get(id, input.scopeKey) as Memory | undefined;
    if (!existing) {
      throw new Error(`Memory ${id} not found in scope ${input.scopeKey}`);
    }

    // Remove from FTS if was active
    if (!existing.deleted_at) {
      db.prepare(`
        INSERT INTO memory_fts (memory_fts, rowid, title, content)
        VALUES ('delete', ?, ?, ?);
      `).run(existing.id, existing.title, existing.content);
    }

    // Clear old chunks and vectors
    const oldChunks = db.prepare('SELECT id FROM chunks WHERE memory_id = ?;').all(id) as Array<{ id: number }>;
    for (const c of oldChunks) {
      db.prepare('DELETE FROM memory_vectors WHERE rowid = ?;').run(BigInt(c.id));
    }
    db.prepare('DELETE FROM chunks WHERE memory_id = ?;').run(id);

    const updated = db.prepare(`
      UPDATE memories
      SET title = ?,
          content = ?,
          type = ?,
          topic_key = ?,
          content_version = content_version + 1,
          deleted_at = NULL,
          indexing_status = 'pending',
          session_id = ?,
          invoking_parent_session_id = ?,
          invocation_id = ?,
          updated_at = datetime('now')
      WHERE id = ?
      RETURNING *;
    `).get(
      input.title,
      input.content,
      input.type,
      input.topicKey ?? null,
      input.sessionId,
      input.invokingParentSessionId ?? null,
      input.invocationId ?? null,
      id,
    ) as unknown as Memory;

    db.prepare(`
      INSERT INTO memory_fts (rowid, title, content)
      VALUES (?, ?, ?);
    `).run(updated.id, updated.title, updated.content);

    db.exec('COMMIT;');
    return updated;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function softDeleteMemory(db: DatabaseSync, id: number, scopeKey: string): void {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const existing = db.prepare('SELECT * FROM memories WHERE id = ? AND scope_key = ?;').get(id, scopeKey) as Memory | undefined;
    if (!existing) {
      throw new Error(`Memory ${id} not found in scope ${scopeKey}`);
    }
    if (existing.deleted_at) {
      db.exec('COMMIT;');
      return;
    }

    // Remove from FTS
    db.prepare(`
      INSERT INTO memory_fts (memory_fts, rowid, title, content)
      VALUES ('delete', ?, ?, ?);
    `).run(existing.id, existing.title, existing.content);

    // Clear chunks and vectors
    const oldChunks = db.prepare('SELECT id FROM chunks WHERE memory_id = ?;').all(id) as Array<{ id: number }>;
    for (const c of oldChunks) {
      db.prepare('DELETE FROM memory_vectors WHERE rowid = ?;').run(BigInt(c.id));
    }
    db.prepare('DELETE FROM chunks WHERE memory_id = ?;').run(id);

    db.prepare(`
      UPDATE memories
      SET deleted_at = datetime('now'),
          indexing_status = 'pending',
          updated_at = datetime('now')
      WHERE id = ?;
    `).run(id);

    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function restoreMemory(db: DatabaseSync, id: number, scopeKey: string): Memory {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const existing = db.prepare('SELECT * FROM memories WHERE id = ? AND scope_key = ?;').get(id, scopeKey) as Memory | undefined;
    if (!existing) {
      throw new Error(`Memory ${id} not found in scope ${scopeKey}`);
    }
    if (!existing.deleted_at) {
      db.exec('COMMIT;');
      return existing;
    }

    const restored = db.prepare(`
      UPDATE memories
      SET deleted_at = NULL,
          updated_at = datetime('now')
      WHERE id = ?
      RETURNING *;
    `).get(id) as unknown as Memory;

    db.prepare(`
      INSERT INTO memory_fts (rowid, title, content)
      VALUES (?, ?, ?);
    `).run(restored.id, restored.title, restored.content);

    db.exec('COMMIT;');
    return restored;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function publishSyntheticVectors(
  db: DatabaseSync,
  memoryId: number,
  expectedVersion: number,
  chunks: SyntheticChunkInput[],
): void {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const memory = db.prepare('SELECT * FROM memories WHERE id = ?;').get(memoryId) as Memory | undefined;
    if (!memory) {
      throw new Error(`Memory ${memoryId} not found`);
    }
    if (memory.deleted_at !== null) {
      throw new Error(`Cannot publish vectors for deleted memory ${memoryId}`);
    }
    if (memory.content_version !== expectedVersion) {
      throw new Error(`Version mismatch for memory ${memoryId}: expected ${expectedVersion}, actual ${memory.content_version}`);
    }

    // Clear any existing chunks for this memory first
    const oldChunks = db.prepare('SELECT id FROM chunks WHERE memory_id = ?;').all(memoryId) as Array<{ id: number }>;
    for (const c of oldChunks) {
      db.prepare('DELETE FROM memory_vectors WHERE rowid = ?;').run(BigInt(c.id));
    }
    db.prepare('DELETE FROM chunks WHERE memory_id = ?;').run(memoryId);

    // Insert new chunks and vectors
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i];
      const chunkRow = db.prepare(`
        INSERT INTO chunks (
          memory_id, chunk_index, chunk_text, start_char, end_char,
          token_count, content_version, model_id, model_revision,
          dimensions, normalized, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'intfloat/e5-small-v2', 'v2', 384, 1, datetime('now'))
        RETURNING id;
      `).get(
        memoryId,
        i,
        ch.chunk_text,
        ch.start_char,
        ch.end_char,
        ch.token_count,
        expectedVersion,
      ) as { id: number };

      const floatArray = new Float32Array(ch.vector);
      const buffer = new Uint8Array(floatArray.buffer);

      db.prepare(`
        INSERT INTO memory_vectors (rowid, embedding, scope_key)
        VALUES (?, ?, ?);
      `).run(BigInt(chunkRow.id), buffer, memory.scope_key);
    }

    db.prepare(`
      UPDATE memories
      SET indexing_status = 'indexed',
          pending_reason = NULL,
          updated_at = datetime('now')
      WHERE id = ?;
    `).run(memoryId);

    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function createEntity(db: DatabaseSync, input: CreateEntityInput): Entity {
  const aliasesJson = JSON.stringify(input.aliases ?? []);
  db.prepare(`
    INSERT INTO entities (
      id, type, canonical_name, scope_key, display_name,
      aliases_json, memory_id, session_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'));
  `).run(
    input.id,
    input.type,
    input.canonicalName,
    input.scopeKey,
    input.displayName,
    aliasesJson,
    input.memoryId ?? null,
    input.sessionId,
  );

  return db.prepare('SELECT * FROM entities WHERE id = ?;').get(input.id) as unknown as Entity;
}

export function createRelation(db: DatabaseSync, input: CreateRelationInput): Relation {
  db.prepare(`
    INSERT INTO relations (
      id, source_entity_id, target_entity_id, relation_type,
      scope_key, session_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'));
  `).run(
    input.id,
    input.sourceEntityId,
    input.targetEntityId,
    input.relationType,
    input.scopeKey,
    input.sessionId,
  );

  return db.prepare('SELECT * FROM relations WHERE id = ?;').get(input.id) as unknown as Relation;
}

export function createMemoryEntityLink(db: DatabaseSync, input: CreateMemoryEntityLinkInput): MemoryEntityLink {
  db.prepare(`
    INSERT INTO memory_entity_links (
      id, memory_id, entity_id, scope_key, session_id, created_at
    ) VALUES (?, ?, ?, ?, ?, datetime('now'));
  `).run(
    input.id,
    input.memoryId,
    input.entityId,
    input.scopeKey,
    input.sessionId,
  );

  return db.prepare('SELECT * FROM memory_entity_links WHERE id = ?;').get(input.id) as unknown as MemoryEntityLink;
}
