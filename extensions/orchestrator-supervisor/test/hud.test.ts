import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerSupervisorHud } from '../src/hud.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('supervisor HUD binds its read-only snapshot to trusted TUI project/session and cleans up', t => {
  const dir = mkdtempSync(join(tmpdir(), 'supervisor-hud-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const handlers = new Map<string, Function>();
  let listener: Function;
  let removed = false;
  let reads = 0;
  const pi = {
    on: (name: string, handler: Function) => handlers.set(name, handler),
    events: { on: (_: string, handler: Function) => { listener = handler; return () => { removed = true; }; } },
  };
  registerSupervisorHud(pi, () => { reads++; return { enabled: false, running: false, uncertain: 0 }; });
  const ctx = { mode: 'tui', cwd: dir, isProjectTrusted: () => true, sessionManager: { getSessionId: () => 'one' } };
  handlers.get('session_start')!({}, ctx);
  const request = { cwd: '/other', sessionId: 'one', respond: () => {} };
  listener!(request);
  listener!({ ...request, cwd: '/repo', sessionId: 'two' });
  assert.equal(reads, 0);
  let snapshot: any;
  listener!({ cwd: dir, sessionId: 'one', respond: (value: any) => { snapshot = value; } });
  assert.equal(reads, 1);
  assert.ok(snapshot.lines.some((line: string) => line.includes('Umbral rotación: 90%')));
  assert.ok(snapshot.lines.includes('SUBAGENTES'));
  ctx.isProjectTrusted = () => false;
  listener!({ ...request, cwd: '/repo' });
  assert.equal(reads, 1);
  handlers.get('session_shutdown')!();
  assert.equal(removed, true);
});
