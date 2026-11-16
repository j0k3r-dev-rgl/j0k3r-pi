import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { encodeScope, resolveScope } from '../../src/identity.ts';
import { readHudMemories, registerHudMemories } from '../../src/hud.ts';

test('HUD memory read never creates storage, activates a session or accepts untrusted/global scope', t => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-hud-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'missing.db');
  const ctx = { mode: 'tui', cwd: dir, isProjectTrusted: () => true };
  assert.equal(readHudMemories(path, ctx).total, 0);
  assert.equal(existsSync(path), false);
  assert.throws(() => readHudMemories(path, { ...ctx, isProjectTrusted: () => false }));
  assert.throws(() => readHudMemories(path, { ...ctx, mode: 'rpc' }));
});

test('HUD E5 health is asynchronous, uses the existing client and aborts at shutdown', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-health-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const handlers = new Map<string, Function>();
  let read: Function;
  let removed = false;
  let signal: AbortSignal;
  let resolveHealth: (value: any) => void;
  const client = { health: (value: AbortSignal) => { signal = value; return new Promise(resolve => { resolveHealth = resolve; }); } };
  registerHudMemories({
    on: (name: string, handler: Function) => handlers.set(name, handler),
    events: { on: (_: string, handler: Function) => { read = handler; return () => { removed = true; }; } },
  }, join(dir, 'missing.db'), client as any);
  const ctx = { mode: 'tui', cwd: dir, isProjectTrusted: () => true, sessionManager: { getSessionId: () => 'one' } };
  handlers.get('session_start')!({}, ctx);
  let snapshot: any;
  const request = { cwd: dir, sessionId: 'one', respond: (value: any) => { snapshot = value; } };
  read!(request);
  assert.ok(snapshot.header.includes('E5: comprobando…'));
  resolveHealth!({ state: 'ready', model: 'intfloat/e5-small-v2' });
  await Promise.resolve();
  read!(request);
  assert.ok(snapshot.header.includes('E5: disponible · intfloat/e5-small-v2'));
  snapshot = undefined;
  read!({ ...request, sessionId: 'other' });
  assert.equal(snapshot, undefined);
  handlers.get('session_shutdown')!();
  assert.equal(signal!.aborted, true);
  assert.equal(removed, true);
});

test('HUD lists only ID and title for hundreds of active project memories', t => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-hud-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'memory.db');
  const ctx = { mode: 'tui', cwd: dir, isProjectTrusted: () => true };
  const key = encodeScope(resolveScope(dir));
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE memories(id INTEGER PRIMARY KEY, title TEXT, content TEXT, type TEXT, scope_key TEXT, deleted_at TEXT, updated_at TEXT, indexing_status TEXT)');
  const insert = db.prepare('INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (let i = 1; i <= 500; i++) insert.run(i, `Memory ${i}`, `Complete content ${i}\nlast line ${i}`, 'note', key, null, 'now', i === 1 ? 'pending' : i === 2 ? 'failed' : 'indexed');
  insert.run(501, 'foreign', 'secret', 'note', '["global"]', null, 'now', 'indexed');
  insert.run(502, 'deleted', 'gone', 'note', key, 'now', 'now', 'indexed');
  db.close();
  const value = readHudMemories(path, ctx);
  assert.equal(value.total, 500);
  assert.ok(value.header.some(line => line.includes('Indexadas: 498')));
  assert.ok(value.header.some(line => line.includes('Pendientes: 1')));
  assert.ok(value.header.some(line => line.includes('Con error: 1')));
  assert.equal(value.lines.length, 500);
  assert.ok(value.lines.includes('#1 · Memory 1'));
  assert.ok(value.lines.includes('#500 · Memory 500'));
  assert.ok(!value.lines.join('\n').includes('Complete content'));
  assert.ok(!value.lines.join('\n').includes('last line'));
  assert.ok(!value.lines.join('\n').includes('secret'));
  assert.ok(!value.lines.join('\n').includes('gone'));
});
