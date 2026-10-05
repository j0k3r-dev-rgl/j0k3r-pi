import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import * as sqliteVec from 'sqlite-vec';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('native sqlite-vec accepts integer bindings and filters project before KNN', () => {
  const db = new DatabaseSync(':memory:', { allowExtension: true });
  sqliteVec.load(db);
  db.enableLoadExtension(false);
  db.exec('CREATE VIRTUAL TABLE v USING vec0(embedding float[384] distance_metric=cosine, project text)');
  const a = new Float32Array(384); a[0] = 1;
  const b = new Float32Array(384); b[1] = 1;
  const insert = db.prepare('INSERT INTO v(rowid,embedding,project) VALUES (?,?,?)');
  insert.run(1n, new Uint8Array(a.buffer), 'other');
  insert.run(2n, new Uint8Array(b.buffer), 'current');
  const rows = db.prepare('SELECT rowid,distance FROM v WHERE embedding MATCH ? AND k=1 AND project=?')
    .all(new Uint8Array(a.buffer), 'current');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rowid, 2);
  assert.equal(rows[0].distance, 1);
  db.close();
});

test('active-only snapshot and best-chunk scoped retrieval with real SQLite', async () => {
  const { openStore, importActive, insertChunks, vectorSearch, lexicalSearch } = await import('./store.ts');
  const dir = mkdtempSync(join(tmpdir(),'memory-benchmark-'));
  let db: DatabaseSync | undefined;
  try {
    const sourcePath=join(dir,'source.db'),source=new DatabaseSync(sourcePath);
    source.exec(`CREATE TABLE observations(id INTEGER PRIMARY KEY,title TEXT,content TEXT,project TEXT,scope TEXT,type TEXT,topic_key TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
      INSERT INTO observations VALUES(1,'current','vector memory','current','project','pattern',NULL,NULL,NULL,NULL);
      INSERT INTO observations VALUES(2,'other','vector memory','other','project','pattern',NULL,NULL,NULL,NULL);
      INSERT INTO observations VALUES(3,'deleted','private removed text','current','project','pattern',NULL,NULL,NULL,'now');`);
    source.close();
    db = openStore(join(dir, 'benchmark.db'));
    const targetDb = db;
    importActive(sourcePath, targetDb);
    assert.equal(targetDb.prepare('SELECT COUNT(*) n FROM memories').get()!.n,2);
    assert.equal(targetDb.prepare('PRAGMA journal_mode').get()!.journal_mode,'wal');
    const vector=Array(384).fill(0);vector[0]=1;
    for(const row of targetDb.prepare('SELECT id,hash FROM memories').all()){
      const chunks=[0,1].map(index=>({chunk_index:index,text:'vector',start:0,end:6,token_count:4,embedding:vector}));
      insertChunks(targetDb,Number(row.id),chunks,String(row.hash));
    }
    assert.equal(vectorSearch(targetDb,vector,'current',10).length,1);
    assert.equal(vectorSearch(targetDb,vector,'current',10)[0].id,1);
    assert.equal(vectorSearch(targetDb,vector,null,10).length,2);
    assert.equal(lexicalSearch(targetDb,'vector memory','current').length,1);
    assert.equal(lexicalSearch(targetDb,'private removed',null).length,0);
    assert.throws(()=>insertChunks(targetDb,1,[],'wrong-hash'),/changed/);
    assert.equal(targetDb.prepare('SELECT COUNT(*) n FROM vectors').get()!.n,4);
  } finally {db?.close();rmSync(dir,{recursive:true,force:true});}
});
