import type { Db } from './db.js';
import { nowIso } from './utils.js';
import { generateGenericId } from './ids.js';

export const SCHEMA_VERSION = 1;

export function migrate(db: Db): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS memory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('general','project','global')),
  project_id TEXT,
  project_name TEXT,
  kind TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  content TEXT NOT NULL,
  tags TEXT,
  source TEXT NOT NULL DEFAULT 'agent',
  origin_type TEXT DEFAULT 'inferred_by_agent',
  confidence REAL NOT NULL DEFAULT 1.0,
  importance INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','superseded')),
  version INTEGER NOT NULL DEFAULT 1,
  sync_status TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict')),
  cloud_sync_id TEXT,
  cloud_synced_at TEXT,
  cloud_revision TEXT,
  content_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_accessed_at TEXT,
  access_count INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT,
  CHECK ((scope IN ('general','global') AND project_id IS NULL AND project_name IS NULL) OR (scope='project' AND project_id IS NOT NULL AND project_name IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories(project_id);
CREATE INDEX IF NOT EXISTS idx_memories_project_name ON memories(project_name);
CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);
CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_sync_status ON memories(sync_status);
CREATE INDEX IF NOT EXISTS idx_memories_cloud_sync_id ON memories(cloud_sync_id);
CREATE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(content_hash);
CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at);

CREATE TABLE IF NOT EXISTS memory_sessions (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('general','project','global')),
  project_id TEXT,
  project_name TEXT,
  title TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  summary TEXT,
  learned TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived','superseded')),
  sync_status TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict')),
  cloud_sync_id TEXT,
  cloud_synced_at TEXT,
  cloud_revision TEXT,
  content_hash TEXT,
  metadata_json TEXT,
  CHECK ((scope IN ('general','global') AND project_id IS NULL AND project_name IS NULL) OR (scope='project' AND project_id IS NOT NULL AND project_name IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_memory_sessions_scope ON memory_sessions(scope);
CREATE INDEX IF NOT EXISTS idx_memory_sessions_project_id ON memory_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_memory_sessions_started_at ON memory_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_memory_sessions_status ON memory_sessions(status);

CREATE TABLE IF NOT EXISTS memory_session_prompts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES memory_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool','extension')),
  prompt TEXT NOT NULL,
  prompt_index INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict')),
  cloud_sync_id TEXT,
  cloud_synced_at TEXT,
  cloud_revision TEXT,
  content_hash TEXT,
  metadata_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_memory_session_prompts_session_id ON memory_session_prompts(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_session_prompts_role ON memory_session_prompts(role);

CREATE TABLE IF NOT EXISTS memory_links (
  id TEXT PRIMARY KEY,
  from_memory_id TEXT NOT NULL REFERENCES memories(id),
  to_memory_id TEXT NOT NULL REFERENCES memories(id),
  relation_type TEXT NOT NULL CHECK (relation_type IN ('supports','supersedes','contradicts','derived_from','related_to')),
  created_at TEXT NOT NULL,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS memory_entities (
  id TEXT PRIMARY KEY,
  memory_id TEXT REFERENCES memories(id),
  entity_type TEXT NOT NULL,
  name TEXT NOT NULL,
  value TEXT,
  created_at TEXT NOT NULL
);
`);
  createFts(db);
  rebuildFts(db);
  upsertMeta(db, 'schema_version', String(SCHEMA_VERSION));
  if (!getMeta(db, 'brain_id')) upsertMeta(db, 'brain_id', generateGenericId('brain'));
  if (!getMeta(db, 'created_at')) upsertMeta(db, 'created_at', nowIso());
  upsertMeta(db, 'updated_at', nowIso());
}

function rebuildFts(db: Db): void {
  try { db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')"); } catch {}
  try { db.exec("INSERT INTO memory_sessions_fts(memory_sessions_fts) VALUES('rebuild')"); } catch {}
  try { db.exec("INSERT INTO memory_session_prompts_fts(memory_session_prompts_fts) VALUES('rebuild')"); } catch {}
}

function createFts(db: Db): void {
  db.exec(`
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(title, summary, content, tags, kind, project_name, content='memories', content_rowid='rowid');
CREATE VIRTUAL TABLE IF NOT EXISTS memory_sessions_fts USING fts5(title, summary, learned, project_name, content='memory_sessions', content_rowid='rowid');
CREATE VIRTUAL TABLE IF NOT EXISTS memory_session_prompts_fts USING fts5(prompt, role, content='memory_session_prompts', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid,title,summary,content,tags,kind,project_name) VALUES (new.rowid,new.title,new.summary,new.content,new.tags,new.kind,new.project_name);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts,rowid,title,summary,content,tags,kind,project_name) VALUES('delete',old.rowid,old.title,old.summary,old.content,old.tags,old.kind,old.project_name);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts,rowid,title,summary,content,tags,kind,project_name) VALUES('delete',old.rowid,old.title,old.summary,old.content,old.tags,old.kind,old.project_name);
  INSERT INTO memories_fts(rowid,title,summary,content,tags,kind,project_name) VALUES (new.rowid,new.title,new.summary,new.content,new.tags,new.kind,new.project_name);
END;

CREATE TRIGGER IF NOT EXISTS memory_sessions_ai AFTER INSERT ON memory_sessions BEGIN
  INSERT INTO memory_sessions_fts(rowid,title,summary,learned,project_name) VALUES (new.rowid,new.title,new.summary,new.learned,new.project_name);
END;
CREATE TRIGGER IF NOT EXISTS memory_sessions_ad AFTER DELETE ON memory_sessions BEGIN
  INSERT INTO memory_sessions_fts(memory_sessions_fts,rowid,title,summary,learned,project_name) VALUES('delete',old.rowid,old.title,old.summary,old.learned,old.project_name);
END;
CREATE TRIGGER IF NOT EXISTS memory_sessions_au AFTER UPDATE ON memory_sessions BEGIN
  INSERT INTO memory_sessions_fts(memory_sessions_fts,rowid,title,summary,learned,project_name) VALUES('delete',old.rowid,old.title,old.summary,old.learned,old.project_name);
  INSERT INTO memory_sessions_fts(rowid,title,summary,learned,project_name) VALUES (new.rowid,new.title,new.summary,new.learned,new.project_name);
END;

CREATE TRIGGER IF NOT EXISTS memory_session_prompts_ai AFTER INSERT ON memory_session_prompts BEGIN
  INSERT INTO memory_session_prompts_fts(rowid,prompt,role) VALUES (new.rowid,new.prompt,new.role);
END;
CREATE TRIGGER IF NOT EXISTS memory_session_prompts_ad AFTER DELETE ON memory_session_prompts BEGIN
  INSERT INTO memory_session_prompts_fts(memory_session_prompts_fts,rowid,prompt,role) VALUES('delete',old.rowid,old.prompt,old.role);
END;
CREATE TRIGGER IF NOT EXISTS memory_session_prompts_au AFTER UPDATE ON memory_session_prompts BEGIN
  INSERT INTO memory_session_prompts_fts(memory_session_prompts_fts,rowid,prompt,role) VALUES('delete',old.rowid,old.prompt,old.role);
  INSERT INTO memory_session_prompts_fts(rowid,prompt,role) VALUES (new.rowid,new.prompt,new.role);
END;
`);
}

export function getMeta(db: Db, key: string): string | undefined {
  return db.prepare('SELECT value FROM memory_meta WHERE key=?').get(key)?.value as string | undefined;
}
export function upsertMeta(db: Db, key: string, value: string): void {
  db.prepare('INSERT INTO memory_meta(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').run(key, value, nowIso());
}
