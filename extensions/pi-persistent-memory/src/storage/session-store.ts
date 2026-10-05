import type { DatabaseSync } from 'node:sqlite';
import type { Session } from '../types.ts';

export function activateSession(
  db: DatabaseSync,
  id: string,
  scopeKey: string,
  kind: 'normal' | 'child',
): Session {
  db.prepare(`
    INSERT INTO sessions (id, scope_key, kind, status, created_at, updated_at)
    VALUES (?, ?, ?, 'open', datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      status = 'open',
      scope_key = excluded.scope_key,
      updated_at = datetime('now');
  `).run(id, scopeKey, kind);

  const row = db.prepare('SELECT * FROM sessions WHERE id = ?;').get(id) as unknown as Session;
  return row;
}

export function closeSession(db: DatabaseSync, id: string): boolean {
  const result = db.prepare(`
    UPDATE sessions
    SET status = 'closed',
        closed_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ? AND status = 'open';
  `).run(id);

  return Number(result.changes) > 0;
}

export function getSession(db: DatabaseSync, id: string): Session | undefined {
  return db.prepare('SELECT * FROM sessions WHERE id = ?;').get(id) as unknown as Session | undefined;
}

export function countAssociatedKnowledge(db: DatabaseSync, sessionId: string): number {
  const query = `
    SELECT
      (SELECT COUNT(*) FROM memories WHERE session_id = ?) +
      (SELECT COUNT(*) FROM entities WHERE session_id = ?) +
      (SELECT COUNT(*) FROM relations WHERE session_id = ?) +
      (SELECT COUNT(*) FROM memory_entity_links WHERE session_id = ?) AS total;
  `;
  const result = db.prepare(query).get(sessionId, sessionId, sessionId, sessionId) as { total: number };
  return Number(result.total ?? 0);
}

export function cleanupTerminalChildSession(
  db: DatabaseSync,
  childSessionId: string,
): { retained: boolean } {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const existing = db.prepare('SELECT * FROM sessions WHERE id = ?;').get(childSessionId) as Session | undefined;
    if (!existing) {
      db.exec('COMMIT;');
      return { retained: false };
    }

    db.prepare(`
      UPDATE sessions
      SET status = 'closed',
          closed_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?;
    `).run(childSessionId);

    const count = countAssociatedKnowledge(db, childSessionId);
    if (count === 0) {
      db.prepare('DELETE FROM sessions WHERE id = ?;').run(childSessionId);
      db.exec('COMMIT;');
      return { retained: false };
    }

    db.exec('COMMIT;');
    return { retained: true };
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}
