import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { encodeScope, resolveScope } from './identity.ts';
import { E5Client } from './client/e5-client.ts';

/** UI-only, read-only snapshot; does not activate sessions, initialize storage or index. */
export function readHudMemories(dbPath: string, ctx: any) {
  if (ctx.mode !== 'tui' || !ctx.isProjectTrusted?.()) throw new Error('project_not_trusted');
  const scope = resolveScope(ctx.cwd, { isProjectTrusted: () => ctx.isProjectTrusted() });
  if (scope.kind !== 'project') throw new Error('project_scope_required');
  const scopeKey = encodeScope(scope);
  const header = [`Proyecto: ${scope.project}`, 'Memorias: 0', 'Indexadas: 0 · Pendientes: 0 · Con error: 0'];
  if (!existsSync(dbPath)) return { lines: ['Sin memorias del proyecto'], total: 0, header };
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 100;');
    const total = Number((db.prepare('SELECT COUNT(*) AS n FROM memories WHERE scope_key = ? AND deleted_at IS NULL').get(scopeKey) as any).n);
    const counts = db.prepare('SELECT indexing_status AS status, COUNT(*) AS n FROM memories WHERE scope_key = ? AND deleted_at IS NULL GROUP BY indexing_status').all(scopeKey) as { status: string; n: number }[];
    const count = (status: string) => counts.find(row => row.status === status)?.n ?? 0;
    header[1] = `Memorias: ${total}`;
    header[2] = `Indexadas: ${count('indexed')} · Pendientes: ${count('pending')} · Con error: ${count('failed')}`;
    const rows = db.prepare('SELECT id, title FROM memories WHERE scope_key = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC').all(scopeKey);
    return {
      lines: rows.length ? rows.map((row: any) => `#${row.id} · ${String(row.title).replace(/[\r\n\t]+/g, ' ')}`) : ['Sin memorias del proyecto'],
      total, header,
    };
  } finally { db.close(); }
}

export function registerHudMemories(pi: any, dbPath: string, client = new E5Client()) {
  let context: any;
  let timer: ReturnType<typeof setInterval> | undefined;
  let controller: AbortController | undefined;
  let pending = false;
  let service = 'E5: comprobando…';
  async function probe() {
    if (pending || !controller || !context?.isProjectTrusted?.()) return;
    pending = true;
    const generation = controller;
    try {
      const health = await client.health(generation.signal);
      if (generation.signal.aborted || controller !== generation) return;
      const labels = { ready: 'disponible', not_ready: 'no preparado', incompatible: 'incompatible', unavailable: 'no disponible' };
      service = `E5: ${labels[health.state]}${health.state === 'ready' ? ` · ${health.model}` : ''}`;
    } catch { if (!generation.signal.aborted) service = 'E5: no disponible'; }
    finally { pending = false; }
  }
  pi.on('session_start', (_event: any, ctx: any) => {
    context = ctx;
    if (timer) clearInterval(timer);
    controller?.abort();
    controller = new AbortController();
    service = 'E5: comprobando…';
    if (ctx.mode === 'tui' && ctx.isProjectTrusted?.()) {
      void probe();
      timer = setInterval(() => { void probe(); }, 30_000);
      timer.unref?.();
    }
  });
  const unsubscribe = pi.events.on('pihud:mem:read:v1', (request: any) => {
    if (!context || !request || context.cwd !== request.cwd ||
        request.sessionId !== context.sessionManager.getSessionId() || typeof request.respond !== 'function') return;
    try {
      const snapshot = readHudMemories(dbPath, context);
      request.respond({ ...snapshot, header: [...snapshot.header, service] });
    }
    catch { request.respond({ lines: [], error: 'Memorias no disponibles para este proyecto' }); }
  });
  pi.on('session_shutdown', () => {
    context = undefined;
    if (timer) clearInterval(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
    unsubscribe();
  });
}
