import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION } from '../config.ts';

export class SchemaVersionMismatchError extends Error {
  readonly actualVersion: number;
  readonly expectedVersion: number;

  constructor(actualVersion: number, expectedVersion: number) {
    super(`Database schema version mismatch: expected ${expectedVersion}, found ${actualVersion}. Manual migration or rebuilding is required.`);
    this.name = 'SchemaVersionMismatchError';
    this.actualVersion = actualVersion;
    this.expectedVersion = expectedVersion;
  }
}

export function initSchema(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        version INTEGER PRIMARY KEY,
        updated_at TEXT NOT NULL
      );
    `);

    const row = db.prepare('SELECT version FROM schema_meta LIMIT 1;').get() as { version?: number } | undefined;
    if (row && typeof row.version === 'number') {
      if (row.version !== SCHEMA_VERSION) {
        throw new SchemaVersionMismatchError(row.version, SCHEMA_VERSION);
      }
    } else {
      db.prepare(`
        INSERT INTO schema_meta (version, updated_at) VALUES (?, datetime('now'));
      `).run(SCHEMA_VERSION);
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        scope_key TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('normal', 'child')),
        status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope_key TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        topic_key TEXT,
        content_version INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        indexing_status TEXT NOT NULL DEFAULT 'pending' CHECK (indexing_status IN ('pending', 'indexed', 'failed')),
        pending_reason TEXT,
        session_id TEXT NOT NULL,
        invoking_parent_session_id TEXT,
        invocation_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_scope_topic ON memories(scope_key, topic_key);
      CREATE INDEX IF NOT EXISTS idx_memories_scope_status ON memories(scope_key, deleted_at, indexing_status);

      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        start_char INTEGER NOT NULL,
        end_char INTEGER NOT NULL,
        token_count INTEGER NOT NULL,
        content_version INTEGER NOT NULL,
        model_id TEXT NOT NULL,
        model_revision TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        normalized INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_memory_id ON chunks(memory_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors USING vec0(
        embedding float[384] distance_metric=cosine,
        +scope_key text
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        title,
        content,
        content='memories',
        content_rowid='id'
      );

      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        canonical_name TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]',
        memory_id INTEGER,
        session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(scope_key, type, canonical_name),
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE SET NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS relations (
        id TEXT PRIMARY KEY,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (source_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY (target_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS memory_entity_links (
        id TEXT PRIMARY KEY,
        memory_id INTEGER NOT NULL,
        entity_id TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(memory_id, entity_id),
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
    `);

    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}
