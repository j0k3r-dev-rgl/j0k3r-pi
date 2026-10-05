import type { DatabaseSync } from 'node:sqlite';
import type {
  CreateEntityInput,
  CreateMemoryEntityLinkInput,
  CreateMemoryInput,
  CreateRelationInput,
  Entity,
  Memory,
  MemoryEntityLink,
  PublishChunkInput,
  PublishMetadata,
  Relation,
  ReplaceMemoryInput,
  SaveMemoryContext,
  SaveMemoryInput,
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

export function saveMemoryAtomic(
  db: DatabaseSync,
  scopeKey: string,
  input: SaveMemoryInput,
  context: SaveMemoryContext,
): Memory {
  db.exec('BEGIN IMMEDIATE;');
  try {
    let targetId: number | undefined;

    if (input.id !== undefined) {
      const existing = db.prepare('SELECT id, scope_key, topic_key, deleted_at FROM memories WHERE id = ?;').get(input.id) as {
        id: number;
        scope_key: string;
        topic_key: string | null;
        deleted_at: string | null;
      } | undefined;

      if (!existing || existing.scope_key !== scopeKey) {
        throw new Error(`target_not_found: Memory ${input.id} not found in scope ${scopeKey}`);
      }
      if (existing.deleted_at !== null) {
        throw new Error(`target_deleted: Memory ${input.id} is deleted and requires restore`);
      }
      if (input.topicKey) {
        const conflict = db.prepare('SELECT id FROM memories WHERE scope_key = ? AND topic_key = ? AND id != ?;').get(
          scopeKey,
          input.topicKey,
          input.id,
        ) as { id: number } | undefined;
        if (conflict) {
          throw new Error(`target_conflict: Topic key '${input.topicKey}' is already used by memory ${conflict.id}`);
        }
      }
      targetId = input.id;
    } else if (input.topicKey) {
      const existing = db.prepare('SELECT id, deleted_at FROM memories WHERE scope_key = ? AND topic_key = ?;').get(
        scopeKey,
        input.topicKey,
      ) as { id: number; deleted_at: string | null } | undefined;

      if (existing) {
        if (existing.deleted_at !== null) {
          throw new Error(`target_deleted: Memory with topic_key '${input.topicKey}' is deleted and requires restore`);
        }
        targetId = existing.id;
      }
    }

    let resultMemory: Memory;

    if (targetId !== undefined) {
      const existing = db.prepare('SELECT id, title, content, deleted_at FROM memories WHERE id = ? AND scope_key = ?;').get(targetId, scopeKey) as {
        id: number;
        title: string;
        content: string;
        deleted_at: string | null;
      } | undefined;

      if (!existing || existing.deleted_at !== null) {
        throw new Error(`target_deleted: Memory ${targetId} is deleted and requires restore`);
      }

      // Remove from FTS if was active
      db.prepare(`
        INSERT INTO memory_fts (memory_fts, rowid, title, content)
        VALUES ('delete', ?, ?, ?);
      `).run(existing.id, existing.title, existing.content);

      // Clear old chunks and vectors
      const oldChunks = db.prepare('SELECT id FROM chunks WHERE memory_id = ?;').all(targetId) as Array<{ id: number }>;
      for (const c of oldChunks) {
        db.prepare('DELETE FROM memory_vectors WHERE rowid = ?;').run(BigInt(c.id));
      }
      db.prepare('DELETE FROM chunks WHERE memory_id = ?;').run(targetId);

      const updated = db.prepare(`
        UPDATE memories
        SET title = ?,
            content = ?,
            type = ?,
            topic_key = ?,
            content_version = content_version + 1,
            deleted_at = NULL,
            indexing_status = 'pending',
            pending_reason = NULL,
            session_id = ?,
            invoking_parent_session_id = ?,
            invocation_id = ?,
            updated_at = datetime('now')
        WHERE id = ? AND scope_key = ? AND deleted_at IS NULL
        RETURNING *;
      `).get(
        input.title,
        input.content,
        input.type,
        input.topicKey ?? null,
        context.sessionId,
        context.invokingParentSessionId ?? null,
        context.invocationId ?? null,
        targetId,
        scopeKey,
      ) as unknown as Memory | undefined;

      if (!updated) {
        throw new Error(`target_deleted: Memory ${targetId} is deleted and requires restore`);
      }

      db.prepare(`
        INSERT INTO memory_fts (rowid, title, content)
        VALUES (?, ?, ?);
      `).run(updated.id, updated.title, updated.content);

      resultMemory = updated;
    } else {
      const created = db.prepare(`
        INSERT INTO memories (
          scope_key, title, content, type, topic_key, content_version,
          deleted_at, indexing_status, pending_reason, session_id, invoking_parent_session_id, invocation_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, NULL, 'pending', NULL, ?, ?, ?, datetime('now'), datetime('now'))
        RETURNING *;
      `).get(
        scopeKey,
        input.title,
        input.content,
        input.type,
        input.topicKey ?? null,
        context.sessionId,
        context.invokingParentSessionId ?? null,
        context.invocationId ?? null,
      ) as unknown as Memory;

      db.prepare(`
        INSERT INTO memory_fts (rowid, title, content)
        VALUES (?, ?, ?);
      `).run(created.id, created.title, created.content);

      resultMemory = created;
    }

    db.exec('COMMIT;');
    return resultMemory;
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

export function publishValidatedChunks(
  db: DatabaseSync,
  memoryId: number,
  expectedVersion: number,
  metadata: PublishMetadata,
  chunks: PublishChunkInput[],
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        RETURNING id;
      `).get(
        memoryId,
        ch.chunk_index ?? i,
        ch.chunk_text,
        ch.start_char,
        ch.end_char,
        ch.token_count,
        expectedVersion,
        metadata.model_id,
        metadata.model_revision,
        metadata.dimensions,
        metadata.normalized,
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

export function markPendingReason(
  db: DatabaseSync,
  memoryId: number,
  expectedVersion: number,
  reason: string,
): boolean {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const memory = db.prepare('SELECT id, content_version, deleted_at FROM memories WHERE id = ?;').get(memoryId) as { id: number; content_version: number; deleted_at: string | null } | undefined;
    if (!memory || memory.deleted_at !== null || memory.content_version !== expectedVersion) {
      db.exec('COMMIT;');
      return false;
    }
    db.prepare(`
      UPDATE memories
      SET indexing_status = 'pending',
          pending_reason = ?,
          updated_at = datetime('now')
      WHERE id = ? AND content_version = ?;
    `).run(reason, memoryId, expectedVersion);
    db.exec('COMMIT;');
    return true;
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
  publishValidatedChunks(
    db,
    memoryId,
    expectedVersion,
    {
      model_id: 'intfloat/e5-small-v2',
      model_revision: 'v2',
      dimensions: 384,
      normalized: 1,
    },
    chunks.map((ch, i) => ({
      chunk_index: i,
      chunk_text: ch.chunk_text,
      start_char: ch.start_char,
      end_char: ch.end_char,
      token_count: ch.token_count,
      vector: ch.vector,
    })),
  );
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
