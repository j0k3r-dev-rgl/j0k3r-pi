import type { Db } from './db.js';
import { generateGenericId } from './ids.js';
import { nowIso } from './utils.js';

export type MemoryEntity = { entity_type: string; name: string; value?: string };

export function extractEntities(text: string): MemoryEntity[] {
  const entities: MemoryEntity[] = [];
  const seen = new Set<string>();
  const add = (entity_type: string, name: string, value?: string) => {
    const clean = name.trim().toLowerCase();
    if (!clean) return;
    const key = `${entity_type}:${clean}`;
    if (seen.has(key)) return;
    seen.add(key);
    entities.push({ entity_type, name: clean, value });
  };

  for (const match of text.matchAll(/(?:^|\s)((?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|json|md|sql|css|html|yml|yaml))/gi)) add('file', match[1]);
  for (const match of text.matchAll(/\b(npm|pnpm|yarn)\s+(test|run\s+\w+|typecheck|lint|build)\b/gi)) add('command', `${match[1]} ${match[2]}`.replace(/\s+/g, ' '));
  for (const match of text.matchAll(/\b(node|git)\s+([\w:./-]+)/gi)) add('command', `${match[1]} ${match[2]}`);
  return entities.slice(0, 24);
}

export function replaceMemoryEntities(db: Db, memoryId: string, text: string): void {
  db.prepare('DELETE FROM memory_entities WHERE memory_id=?').run(memoryId);
  const now = nowIso();
  for (const entity of extractEntities(text)) {
    db.prepare('INSERT INTO memory_entities(id,memory_id,entity_type,name,value,created_at) VALUES(?,?,?,?,?,?)')
      .run(generateGenericId('entity'), memoryId, entity.entity_type, entity.name, entity.value ?? null, now);
  }
}
