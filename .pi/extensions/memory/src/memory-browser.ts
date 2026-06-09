import type { Db } from './db.js';
import { snippet, parseJson } from './utils.js';

type BrowserTab = 'memories' | 'sessions';
export type BrowserFilters = { query?: string; kind?: string; scope?: string; status?: string; project?: string };
type BrowserItem = {
  type: BrowserTab;
  id: string;
  label: string;
  description: string;
  detail: string;
  updated: string;
};

function stripAnsi(s: string): string { return s.replace(/\x1b\[[0-9;]*m/g, ''); }
function truncate(text: string, width: number): string {
  const plain = stripAnsi(text);
  if (plain.length <= width) return text;
  return plain.slice(0, Math.max(0, width - 1)) + '…';
}
function pad(text: string, width: number): string { const plain = stripAnsi(text); return text + ' '.repeat(Math.max(0, width - plain.length)); }
function wrapPlain(text: string, width: number): string[] {
  if (!text) return [''];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
    while (current.length > width) {
      lines.push(current.slice(0, width));
      current = current.slice(width);
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}
function frame(lines: string[], width: number, theme: any): string[] {
  const w = Math.max(50, width);
  const inner = Math.max(10, w - 4);
  const border = (s: string) => theme.fg('borderAccent', s);
  const top = border(`╭${'─'.repeat(w - 2)}╮`);
  const bottom = border(`╰${'─'.repeat(w - 2)}╯`);
  return [
    top,
    ...lines.map((line) => `${border('│')} ${pad(truncate(line, inner), inner)} ${border('│')}`),
    bottom,
  ];
}

export function applyBrowserFilterCommand(current: BrowserFilters, command: string): BrowserFilters {
  const raw = command.trim();
  if (!raw || raw === 'clear' || raw === 'reset') return {};
  const next: BrowserFilters = { ...current };
  for (const part of raw.split(/\s+/)) {
    const [key, ...rest] = part.split('=');
    const value = rest.join('=').trim();
    if (!value) continue;
    if (['query', 'kind', 'scope', 'status', 'project'].includes(key)) (next as any)[key] = value.toLowerCase();
  }
  return next;
}

export function filterBrowserItems<T extends { label: string; description: string; detail: string }>(items: T[], filters: BrowserFilters): T[] {
  const q = filters.query?.trim().toLowerCase();
  return items.filter((item) => {
    const haystack = `${item.label}\n${item.description}\n${item.detail}`.toLowerCase();
    if (q && !haystack.includes(q)) return false;
    if (filters.kind && !haystack.includes(`kind: ${filters.kind.toLowerCase()}`) && !item.label.toLowerCase().startsWith(`${filters.kind.toLowerCase()} `)) return false;
    if (filters.scope && !haystack.includes(`scope: ${filters.scope.toLowerCase()}`) && !item.description.toLowerCase().includes(filters.scope.toLowerCase())) return false;
    if (filters.status && !haystack.includes(`status: ${filters.status.toLowerCase()}`) && !item.description.toLowerCase().includes(filters.status.toLowerCase())) return false;
    if (filters.project && !haystack.includes(filters.project.toLowerCase())) return false;
    return true;
  });
}

function loadMemories(db: Db, context: any): BrowserItem[] {
  const rows = db.prepare(`SELECT id, scope, project_name, kind, title, summary, content, tags, importance, confidence, status, sync_status, created_at, updated_at
    FROM memories
    WHERE scope IN ('global', 'general') OR (scope='project' AND project_id = ?)
    ORDER BY updated_at DESC
    LIMIT 200`).all(context.project_id ?? '__no_project__') as any[];
  return rows.map((m) => ({
    type: 'memories' as const,
    id: m.id,
    label: `${m.kind} · ${m.title ?? snippet(m.content, 80)}`,
    description: `${m.scope}${m.project_name ? `/${m.project_name}` : ''} · ${m.status} · importance ${m.importance}`,
    updated: m.updated_at,
    detail: [
      `id: ${m.id}`,
      `scope: ${m.scope}${m.project_name ? `/${m.project_name}` : ''}`,
      `kind: ${m.kind}`,
      `status: ${m.status}`,
      `sync: ${m.sync_status}`,
      `importance: ${m.importance}`,
      `confidence: ${m.confidence}`,
      `created: ${m.created_at}`,
      `updated: ${m.updated_at}`,
      `tags: ${(parseJson<string[]>(m.tags, [])).join(', ')}`,
      '',
      `summary: ${m.summary ?? ''}`,
      '',
      m.content ?? '',
    ].join('\n'),
  }));
}

function loadSessions(db: Db, context: any): BrowserItem[] {
  const rows = db.prepare(`SELECT s.id, s.scope, s.project_name, s.title, s.started_at, s.ended_at, s.summary, s.learned, s.status, s.metadata_json,
      (SELECT COUNT(*) FROM memory_session_prompts p WHERE p.session_id = s.id) AS prompt_count
    FROM memory_sessions s
    WHERE s.scope IN ('global', 'general') OR (s.scope='project' AND s.project_id = ?)
    ORDER BY s.started_at DESC
    LIMIT 200`).all(context.project_id ?? '__no_project__') as any[];
  return rows.map((s) => ({
    type: 'sessions' as const,
    id: s.id,
    label: `${s.title ?? s.id}`,
    description: `${s.scope}${s.project_name ? `/${s.project_name}` : ''} · prompts ${s.prompt_count} · ${s.ended_at ? 'closed' : 'open'}`,
    updated: s.ended_at ?? s.started_at,
    detail: [
      `id: ${s.id}`,
      `scope: ${s.scope}${s.project_name ? `/${s.project_name}` : ''}`,
      `status: ${s.status}`,
      `started: ${s.started_at}`,
      `ended: ${s.ended_at ?? 'open'}`,
      `prompts: ${s.prompt_count}`,
      `pi session: ${parseJson<any>(s.metadata_json, {}).pi_session_file ?? 'unknown'}`,
      '',
      'summary:',
      s.summary ?? 'no summary yet',
      '',
      'learned:',
      s.learned ?? 'no learnings yet',
    ].join('\n'),
  }));
}

export async function openMemoryBrowser(db: Db, ctx: any, context: any): Promise<void> {
  const memories = loadMemories(db, context);
  const sessions = loadSessions(db, context);
  const state = { tab: 'memories' as BrowserTab, selected: 0, offset: 0, detail: false, detailScroll: 0, filters: {} as BrowserFilters, filterMode: false, filterBuffer: '' };

  const items = () => filterBrowserItems(state.tab === 'memories' ? memories : sessions, state.filters);
  const clamp = () => {
    const max = Math.max(0, items().length - 1);
    state.selected = Math.max(0, Math.min(state.selected, max));
  };
  const switchTab = () => { state.tab = state.tab === 'memories' ? 'sessions' : 'memories'; state.selected = 0; state.offset = 0; state.detail = false; state.detailScroll = 0; };
  const scrollInfo = (offset: number, visible: number, total: number) => total <= visible ? 'all' : `${offset + 1}-${Math.min(total, offset + visible)}/${total}`;

  await ctx.ui.custom((_tui: any, theme: any, _kb: any, done: (value?: unknown) => void) => {
    const normal = (s: string) => theme.fg('text', s);
    const dim = (s: string) => theme.fg('dim', s);
    const accent = (s: string) => theme.fg('accent', s);
    const muted = (s: string) => theme.fg('muted', s);
    const selected = (s: string) => theme.bg('selectedBg', theme.fg('accent', s));

    const renderList = (width: number): string[] => {
      const w = Math.max(60, width);
      const inner = Math.max(10, w - 4);
      const visible = 12;
      clamp();
      if (state.selected < state.offset) state.offset = state.selected;
      if (state.selected >= state.offset + visible) state.offset = state.selected - visible + 1;
      const current = items();
      const tabLine = `${state.tab === 'memories' ? accent('[memories]') : normal(' memories ')} ${state.tab === 'sessions' ? accent('[sessions]') : normal(' sessions ')}`;
      const filterLine = state.filterMode
        ? accent(`filter> ${state.filterBuffer}`)
        : dim(`filters: ${Object.entries(state.filters).map(([k, v]) => `${k}=${v}`).join(' ') || 'none'}`);
      const lines = [
        accent(`pi memory browser · ${context.scope}${context.project_name ? `/${context.project_name}` : ''}`),
        dim('j/k move · l/enter open · h close · tab switch · : filter · c clear · q/esc close · g/G top/bottom'),
        tabLine,
        filterLine,
      ];
      if (!current.length) lines.push(dim(`no ${state.tab} found for current project/context`));
      for (let i = state.offset; i < Math.min(current.length, state.offset + visible); i++) {
        const item = current[i]!;
        const prefix = i === state.selected ? '› ' : '  ';
        const body = `${prefix}${item.label}  ${dim(item.description)}`;
        lines.push(i === state.selected ? selected(pad(truncate(body, inner), inner)) : truncate(body, inner));
      }
      while (lines.length < 4 + visible) lines.push('');
      lines.push(dim(`scroll ${scrollInfo(state.offset, visible, current.length)} · ${state.selected + 1}/${Math.max(current.length, 1)} · ${state.tab}`));
      return frame(lines, w, theme);
    };

    const renderDetail = (width: number): string[] => {
      const w = Math.max(60, width);
      const item = items()[state.selected];
      if (!item) return frame([accent('pi memory browser'), dim('no item'), dim('h/esc/q back')], w, theme);
      const inner = Math.max(10, w - 4);
      const raw = item.detail.split('\n');
      const wrapped = raw.flatMap((line) => wrapPlain(line, inner));
      const visible = 16;
      state.detailScroll = Math.max(0, Math.min(state.detailScroll, Math.max(0, wrapped.length - visible)));
      const lines = [
        accent(`${item.type}: ${item.label}`),
        dim('j/k scroll · h back · q/esc close · g/G top/bottom'),
        muted(''),
        ...wrapped.slice(state.detailScroll, state.detailScroll + visible).map((l) => normal(l)),
      ];
      while (lines.length < 3 + visible) lines.push('');
      lines.push(dim(`scroll ${scrollInfo(state.detailScroll, visible, wrapped.length)}`));
      return frame(lines, w, theme);
    };

    return {
      render: (width: number) => state.detail ? renderDetail(width) : renderList(width),
      invalidate: () => {},
      handleInput: (data: string) => {
        if (state.filterMode) {
          if (data === '\r' || data === '\n') { state.filters = applyBrowserFilterCommand(state.filters, state.filterBuffer); state.filterMode = false; state.filterBuffer = ''; state.selected = 0; state.offset = 0; _tui.requestRender(); return; }
          if (data === '\u001b') { state.filterMode = false; state.filterBuffer = ''; _tui.requestRender(); return; }
          if (data === '\u007f' || data === '\b') state.filterBuffer = state.filterBuffer.slice(0, -1);
          else if (data.length === 1 && data >= ' ') state.filterBuffer += data;
          _tui.requestRender();
          return;
        }
        if (data === 'q' || data === '\u001b') return state.detail ? done(undefined) : done(undefined);
        if (state.detail) {
          const rawLen = (items()[state.selected]?.detail.split('\n').flatMap((line: string) => wrapPlain(line, 72)).length ?? 0);
          if (data === 'j' || data === '\u001b[B') state.detailScroll++;
          else if (data === 'k' || data === '\u001b[A') state.detailScroll--;
          else if (data === 'g') state.detailScroll = 0;
          else if (data === 'G') state.detailScroll = rawLen;
          else if (data === 'h' || data === '\u001b[D') state.detail = false;
          state.detailScroll = Math.max(0, Math.min(state.detailScroll, rawLen));
          _tui.requestRender();
          return;
        }
        if (data === 'j' || data === '\u001b[B') state.selected++;
        else if (data === 'k' || data === '\u001b[A') state.selected--;
        else if (data === 'l' || data === '\u001b[C' || data === '\r' || data === '\n' || data === 'o') { state.detail = true; state.detailScroll = 0; }
        else if (data === 'h' || data === '\u001b[D') done(undefined);
        else if (data === '\t') switchTab();
        else if (data === ':') { state.filterMode = true; state.filterBuffer = ''; }
        else if (data === 'c') { state.filters = {}; state.selected = 0; state.offset = 0; }
        else if (data === 'g') { state.selected = 0; state.offset = 0; }
        else if (data === 'G') state.selected = items().length - 1;
        clamp();
        _tui.requestRender();
      },
    };
  }, { overlay: true, overlayOptions: { width: '82%', maxHeight: '85%', minWidth: 74 } });
}
