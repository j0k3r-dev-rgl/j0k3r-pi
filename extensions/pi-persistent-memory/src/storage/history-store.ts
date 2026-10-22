import { DatabaseSync } from 'node:sqlite';

export interface UserMessageRecord {
  id: number;
  session_id: string;
  project_key: string;
  content: string;
  created_at: string;
}

export interface CreateUserMessageInput {
  sessionId: string;
  projectKey: string;
  content: string;
}

export interface SearchUserMessagesOptions {
  projectKey: string;
  sessionId?: string;
  query?: string;
  beforeId?: number;
  limit: number;
}

export function createUserMessage(
  db: DatabaseSync,
  input: CreateUserMessageInput,
): UserMessageRecord {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const record = db.prepare(`
      INSERT INTO user_messages (session_id, project_key, content, created_at)
      VALUES (?, ?, ?, datetime('now'))
      RETURNING *;
    `).get(input.sessionId, input.projectKey, input.content) as unknown as UserMessageRecord;

    db.prepare(`
      INSERT INTO user_messages_fts (rowid, content)
      VALUES (?, ?);
    `).run(record.id, record.content);

    db.exec('COMMIT;');
    return record;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function getUserMessage(
  db: DatabaseSync,
  id: number,
  projectKey: string,
): UserMessageRecord | null {
  const row = db.prepare(`
    SELECT * FROM user_messages
    WHERE id = ? AND project_key = ?;
  `).get(id, projectKey) as unknown as UserMessageRecord | undefined;

  return row ?? null;
}

export function buildHistoryFtsQuery(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const tokens = trimmed.match(/"[^"]*"|\S+/g);
  if (!tokens || tokens.length === 0) return null;

  const parts: string[] = [];
  for (const t of tokens) {
    if (t.startsWith('"') && t.endsWith('"')) {
      const inner = t.slice(1, -1).replace(/"/g, '""');
      if (inner.trim()) {
        parts.push(`"${inner}"`);
      }
    } else {
      const clean = t.replace(/"/g, '""');
      if (clean.trim()) {
        parts.push(`"${clean}"`);
      }
    }
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

export function searchUserMessages(
  db: DatabaseSync,
  options: SearchUserMessagesOptions,
): UserMessageRecord[] {
  const { projectKey, sessionId, query, beforeId, limit } = options;
  const ftsQuery = query ? buildHistoryFtsQuery(query) : null;

  if (ftsQuery) {
    const conditions = ['f.user_messages_fts MATCH ?', 'm.project_key = ?'];
    const params: (string | number)[] = [ftsQuery, projectKey];

    if (beforeId !== undefined) {
      conditions.push('m.id < ?');
      params.push(beforeId);
    }

    if (sessionId !== undefined) {
      conditions.push('m.session_id = ?');
      params.push(sessionId);
    }

    params.push(limit);

    const sql = `
      SELECT m.*
      FROM user_messages m
      JOIN user_messages_fts f ON m.id = f.rowid
      WHERE ${conditions.join(' AND ')}
      ORDER BY m.id DESC
      LIMIT ?;
    `;

    return db.prepare(sql).all(...params) as unknown as UserMessageRecord[];
  } else {
    const conditions = ['m.project_key = ?'];
    const params: (string | number)[] = [projectKey];

    if (beforeId !== undefined) {
      conditions.push('m.id < ?');
      params.push(beforeId);
    }

    if (sessionId !== undefined) {
      conditions.push('m.session_id = ?');
      params.push(sessionId);
    }

    params.push(limit);

    const sql = `
      SELECT m.*
      FROM user_messages m
      WHERE ${conditions.join(' AND ')}
      ORDER BY m.id DESC
      LIMIT ?;
    `;

    return db.prepare(sql).all(...params) as unknown as UserMessageRecord[];
  }
}
