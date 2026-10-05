import { DatabaseSync } from 'node:sqlite';
import * as sqliteVec from 'sqlite-vec';
import { createHash } from 'node:crypto';

export function openStore(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { allowExtension: true });
  sqliteVec.load(db);
  db.enableLoadExtension(false);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memories(id INTEGER PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL,
      project TEXT NOT NULL,scope TEXT NOT NULL,type TEXT,topic_key TEXT,created_at TEXT,updated_at TEXT,
      hash TEXT NOT NULL,indexed_hash TEXT);
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(title,content,tokenize='unicode61');
    CREATE TABLE IF NOT EXISTS chunks(id INTEGER PRIMARY KEY,memory_id INTEGER NOT NULL REFERENCES memories(id),
      chunk_index INTEGER NOT NULL,text TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,tokens INTEGER NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS vectors USING vec0(embedding float[384] distance_metric=cosine,project TEXT);
  `);
  return db;
}

export function memoryHash(title: string, content: string): string {
  return createHash('sha256').update(title+'\n'+content).digest('hex');
}

export function importActive(sourcePath: string, db: DatabaseSync): Record<string, unknown> {
  if (db.prepare('SELECT COUNT(*) n FROM memories').get()!.n !== 0) {
    return { reusedSnapshot: true, active: db.prepare('SELECT COUNT(*) n FROM memories').get()!.n };
  }
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  source.exec('PRAGMA query_only=ON; BEGIN');
  try {
    const rows = source.prepare(`SELECT id,title,content,project,scope,type,topic_key,created_at,updated_at
      FROM observations WHERE deleted_at IS NULL ORDER BY id`).all();
    db.exec('BEGIN IMMEDIATE');
    try {
      const insert = db.prepare(`INSERT INTO memories(id,title,content,project,scope,type,topic_key,created_at,updated_at,hash)
        VALUES(?,?,?,?,?,?,?,?,?,?)`);
      const fts = db.prepare('INSERT INTO memories_fts(rowid,title,content) VALUES(?,?,?)');
      for (const row of rows) {
        const title = String(row.title ?? ''), content = String(row.content ?? '');
        insert.run(BigInt(row.id as number),title,content,String(row.project ?? ''),String(row.scope ?? ''),
          row.type as string|null,row.topic_key as string|null,row.created_at as string|null,row.updated_at as string|null,memoryHash(title,content));
        fts.run(BigInt(row.id as number),title,content);
      }
      const counts = source.prepare('SELECT COUNT(*) total,SUM(deleted_at IS NOT NULL) deleted FROM observations').get();
      const provenance = { capturedAt: new Date().toISOString(), source: sourcePath, active: rows.length,
        sourceCounts: counts, method:'read-only SQLite transaction, observations only; no prompts/session transcripts',
        languagePolicy:'preserve originals; English-model quality is not guaranteed on non-English memories; no silent translation',
        privacy:'local private evaluation store; never write corpus/text/vector arrays to repo or console' };
      db.prepare('INSERT INTO meta VALUES(?,?)').run('snapshot',JSON.stringify(provenance));
      db.exec('COMMIT');
      return provenance;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { source.exec('ROLLBACK'); source.close(); }
}

export function insertChunks(db: DatabaseSync, id: number, chunks: any[], expectedHash: string): void {
  const memory = db.prepare('SELECT project,hash FROM memories WHERE id=?').get(id);
  if (!memory || memory.hash !== expectedHash) throw new Error('Memory changed while embedding');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const old of db.prepare('SELECT id FROM chunks WHERE memory_id=?').all(id)) {
      db.prepare('DELETE FROM vectors WHERE rowid=?').run(BigInt(old.id as number));
    }
    db.prepare('DELETE FROM chunks WHERE memory_id=?').run(id);
    const insert = db.prepare('INSERT INTO chunks(memory_id,chunk_index,text,start,end,tokens) VALUES(?,?,?,?,?,?)');
    const vectorInsert = db.prepare('INSERT INTO vectors(rowid,embedding,project) VALUES(?,?,?)');
    for (const chunk of chunks) {
      const result = insert.run(id,chunk.chunk_index,chunk.text,chunk.start,chunk.end,chunk.token_count);
      vectorInsert.run(BigInt(result.lastInsertRowid),new Uint8Array(new Float32Array(chunk.embedding).buffer),String(memory.project));
    }
    db.prepare('UPDATE memories SET indexed_hash=? WHERE id=?').run(expectedHash,id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function vectorSearch(db: DatabaseSync, vector: number[], project: string|null, k=100): any[] {
  const input = new Uint8Array(new Float32Array(vector).buffer);
  const rows = project === null
    ? db.prepare('SELECT rowid,distance FROM vectors WHERE embedding MATCH ? AND k=? ORDER BY distance').all(input,BigInt(k))
    : db.prepare('SELECT rowid,distance FROM vectors WHERE embedding MATCH ? AND k=? AND project=? ORDER BY distance').all(input,BigInt(k),project);
  const lookup = db.prepare(`SELECT m.id,m.project,m.scope,m.updated_at,c.chunk_index FROM chunks c
    JOIN memories m ON m.id=c.memory_id WHERE c.id=?`);
  const best = new Map<number,any>();
  for (const row of rows) {
    const memory = lookup.get(row.rowid as number);
    if (memory && !best.has(memory.id as number)) best.set(memory.id as number,{...memory,score:1-Number(row.distance)});
  }
  return [...best.values()];
}

const STOP = new Set('a an the and or to of in on at for from with without is are was were be been do does did can could should would will must how what which why when where who my our your its it this that as by if then than about use using have has not no only all any recall retrieve previous prior before need want am i we agent editing changing implementing'.split(' '));
export function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[a-z0-9_]+/g) ?? [])].filter(t=>t.length>2&&!STOP.has(t));
}
export function lexicalSearch(db: DatabaseSync, query: string, project: string|null, k=100): any[] {
  const terms=queryTerms(query);
  if (!terms.length) return [];
  const expression=terms.map(t=>'"'+t+'"').join(' OR ');
  const rows = db.prepare(`SELECT m.id,m.project,m.scope,m.updated_at,bm25(memories_fts) rank,m.title,m.content
    FROM memories_fts JOIN memories m ON m.id=memories_fts.rowid
    WHERE memories_fts MATCH ? ${project === null?'':'AND m.project=?'} ORDER BY rank,m.id LIMIT ?`)
    .all(...(project === null?[expression,k]:[expression,project,k]));
  return rows.map(row=>{
    const tokens=new Set((String(row.title)+' '+String(row.content)).toLowerCase().match(/[a-z0-9_]+/g)??[]);
    const matched=terms.filter(t=>tokens.has(t)).length;
    return {id:row.id,project:row.project,scope:row.scope,updated_at:row.updated_at,rank:row.rank,matched,coverage:matched/terms.length};
  });
}
export function fuse(semantic: any[], lexical: any[], k=60): any[] {
  const scores=new Map<number,any>();
  for (const list of [semantic,lexical]) list.forEach((item,index)=>{
    const old=scores.get(item.id)??{...item,rrf:0}; old.rrf+=1/(k+index+1); scores.set(item.id,old);
  });
  return [...scores.values()].sort((a,b)=>b.rrf-a.rrf||a.id-b.id).slice(0,5);
}
