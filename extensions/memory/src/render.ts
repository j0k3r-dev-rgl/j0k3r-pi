type Component = { invalidate(): void; render(width: number): string[] };

type MemoryRenderOptions = { expanded?: boolean; isPartial?: boolean };
type MemoryMessage = { customType?: string; content?: string | Array<{ type?: string; text?: string }> };

function clip(text: string | undefined, limit: number): string {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > limit ? `${normalized.slice(0, Math.max(0, limit - 1))}…` : normalized;
}

function lineWidth(text: string): number { return [...text.replace(/\u001b\[[0-9;]*m/g, '')].length; }

function truncate(text: string, width: number): string {
  return lineWidth(text) <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

function wrapPlainLine(text: string, width: number): string[] {
  if (!text || lineWidth(text) <= width) return [text];
  const remaining = [...text];
  const lines: string[] = [];
  while (remaining.length > width) {
    let breakAt = width;
    for (let index = width - 1; index > 0; index -= 1) {
      if (/\s/.test(remaining[index] ?? '')) {
        breakAt = index;
        break;
      }
    }
    lines.push(remaining.splice(0, breakAt).join(''));
    while (remaining.length && /\s/.test(remaining[0] ?? '')) remaining.shift();
  }
  lines.push(remaining.join(''));
  return lines;
}

function padToWidth(text: string, width: number): string {
  return `${text}${' '.repeat(Math.max(0, width - lineWidth(text)))}`;
}

function textComponent(linesForWidth: (width: number) => string[]): Component {
  return {
    invalidate() {},
    render(width: number) {
      const w = Math.max(40, width);
      return linesForWidth(w).map((line) => truncate(line, w));
    },
  };
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function rowsFromResult(result: any): any[] {
  const details = result?.details ?? {};
  if (Array.isArray(details.results)) return details.results;
  if (details.memory) return [details.memory];
  if (details.profile) return [details.profile];
  if (details.session) return [details.session];
  if (details.context) return [details.context];
  return [];
}

function rowKind(row: any): string {
  return row?.kind ?? row?.type ?? 'memory';
}

function rowTitle(row: any): string {
  return row?.title ?? row?.id ?? rowKind(row);
}

function rowScope(row: any): string {
  if (!row?.scope) return '';
  return `${row.scope}${row.project_name ? `/${row.project_name}` : ''}`;
}

function compactRow(row: any, index: number): string {
  const parts = [rowKind(row), rowScope(row), rowTitle(row)].filter(Boolean);
  const snippet = clip(row?.snippet ?? row?.summary ?? row?.content, 96);
  return `${index + 1}. ${parts.join(' · ')}${snippet ? ` — ${snippet}` : ''}`;
}

function expandedRow(row: any, index: number): string[] {
  const lines = [
    `${index + 1}. ${rowTitle(row)}`,
    row?.type ? `type: ${row.type}` : undefined,
    row?.scope ? `scope: ${rowScope(row)}` : undefined,
    row?.kind ? `kind: ${row.kind}` : undefined,
    row?.status ? `status: ${row.status}` : undefined,
    row?.importance !== undefined ? `importance: ${row.importance}` : undefined,
    row?.confidence !== undefined ? `confidence: ${row.confidence}` : undefined,
    row?.updated_at ? `updated: ${row.updated_at}` : undefined,
    clip(row?.snippet ?? row?.summary ?? row?.content, 600) || undefined,
  ].filter(Boolean) as string[];
  return lines;
}

function memoryTags(row: any): string[] {
  if (Array.isArray(row?.tags)) return row.tags.map(String);
  if (typeof row?.tags !== 'string' || !row.tags.trim()) return [];
  try {
    const parsed = JSON.parse(row.tags);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function fullMemoryLines(row: any): string[] {
  const tags = memoryTags(row);
  return [
    `id: ${row?.id ?? 'unknown'}`,
    row?.scope ? `scope: ${rowScope(row)}` : undefined,
    row?.kind ? `kind: ${row.kind}` : undefined,
    row?.status ? `status: ${row.status}` : undefined,
    row?.importance !== undefined ? `importance: ${row.importance}` : undefined,
    row?.confidence !== undefined ? `confidence: ${row.confidence}` : undefined,
    row?.updated_at ? `updated: ${row.updated_at}` : undefined,
    `tags: ${tags.join(', ') || 'none'}`,
    '',
    'content:',
    ...String(row?.content ?? '').split('\n'),
  ].filter((line) => line !== undefined) as string[];
}

function inferLabel(result: any): string {
  const text = String(result?.content?.[0]?.text ?? '').toLowerCase();
  if (text.startsWith('found ')) return 'memory_search';
  if (text.startsWith('listed ')) return 'memory_list';
  if (text.startsWith('memory:')) return 'memory_get';
  if (text.startsWith('recalled ')) return 'memory_recall';
  if (text.startsWith('project profile')) return 'memory_project_profile';
  return 'memory';
}

function messageText(message: MemoryMessage): string {
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.content)) return message.content.filter((part) => part?.type === 'text').map((part) => part.text ?? '').join('\n');
  return '';
}

function matchLine(text: string, pattern: RegExp): string {
  return text.match(pattern)?.[1]?.trim() ?? '';
}

function startupItems(text: string): string[] {
  const marker = 'Startup brain context (recent memories and session summaries):';
  const start = text.indexOf(marker);
  if (start < 0) return [];
  return text.slice(start + marker.length).split('\n').map((line) => line.trim()).filter((line) => line.startsWith('- ') && !line.startsWith('- No recent '));
}

function toolShellComponent(linesForWidth: (width: number) => string[], theme: any): Component {
  const bg = (text: string) => theme?.bg?.('toolSuccessBg', text) ?? text;
  return {
    invalidate() {},
    render(width: number) {
      const outer = Math.max(40, width);
      const inner = Math.max(1, outer - 2);
      const contentLines = linesForWidth(inner);
      return ['', ...contentLines, ''].map((line) => bg(` ${padToWidth(truncate(line, inner), inner)} `));
    },
  };
}

export function renderMemoryContextMessage(message: MemoryMessage, options: MemoryRenderOptions = {}, theme: any = {}): Component {
  const text = messageText(message);
  const expanded = options.expanded === true;
  const accent = (value: string) => theme?.fg?.('accent', value) ?? value;
  const dim = (value: string) => theme?.fg?.('dim', value) ?? value;
  const title = (value: string) => theme?.fg?.('toolTitle', theme?.bold?.(value) ?? value) ?? value;

  return toolShellComponent((width) => {
    const project = matchLine(text, /^Current memory project: (.+)\.$/m) || matchLine(text, /^Current memory scope: (.+)\.$/m) || 'unknown scope';
    const session = matchLine(text, /^Memory session:\s*(.+)$/m);
    const items = startupItems(text);
    const noun = items.length === 1 ? 'startup item' : 'startup items';
    const header = `${title('memory_context')} · ${accent(project)} · ${items.length} ${noun}`;

    if (expanded) {
      return [header, dim('ctrl+o collapse'), '', ...text.split('\n').flatMap((line) => wrapPlainLine(line, width))];
    }

    const lines = [
      header,
      dim('persistent brain · search/recall only when needed · save durable non-sensitive memory'),
    ];
    if (session) lines.push(dim(`session ${clip(session, 36)} · ctrl+o expand`));
    else lines.push(dim('ctrl+o expand'));
    for (const item of items.slice(0, 3)) lines.push(`• ${clip(item.replace(/^-\s*/, ''), 110)}`);
    return lines;
  }, theme);
}

export function renderMemoryToolResult(result: any, options: MemoryRenderOptions = {}, theme: any = {}): Component {
  const rows = rowsFromResult(result);
  const expanded = options.expanded === true;
  const accent = (text: string) => theme?.fg?.('accent', text) ?? text;
  const dim = (text: string) => theme?.fg?.('dim', text) ?? text;
  const title = (text: string) => theme?.fg?.('toolTitle', theme?.bold?.(text) ?? text) ?? text;
  return textComponent((width) => {
    const noun = rows.length === 1 ? 'result' : 'results';
    const label = inferLabel(result);
    const header = `${title('memory')} · ${rows.length} ${noun} · ${accent(label)}`;
    if (!rows.length) return [header, dim(String(result?.content?.[0]?.text ?? 'No memory results.'))];
    if (label === 'memory_project_profile') {
      const status = String(result?.content?.[0]?.text ?? '').split('\n')[0] || 'Project profile loaded.';
      if (!expanded) return [header, dim(status), dim('ctrl+o expand')];
      const profile = rows[0];
      const tags = Array.isArray(profile?.tags) ? profile.tags.join(', ') : '';
      return [
        header,
        dim('ctrl+o collapse'),
        '',
        `id: ${profile?.id ?? 'unknown'}`,
        profile?.updated_at ? `updated: ${profile.updated_at}` : '',
        `tags: ${tags || 'none'}`,
        '',
        'content:',
        ...String(profile?.content ?? '').split('\n'),
      ].flatMap((line) => wrapPlainLine(line, width));
    }
    if (label === 'memory_get') {
      const row = rows[0];
      if (!expanded) {
        const compact = [`1. ${row?.id ?? 'unknown'}`, row?.kind, row?.scope ? rowScope(row) : undefined, rowTitle(row)].filter(Boolean).join(' · ');
        return [header, compact, dim('ctrl+o expand')];
      }
      return [header, dim('ctrl+o collapse'), '', ...fullMemoryLines(row)].flatMap((line) => wrapPlainLine(line, width));
    }
    if (!expanded) return [header, ...rows.slice(0, 5).map(compactRow), dim('ctrl+o expand')];
    const lines: string[] = [header, dim('ctrl+o collapse')];
    for (const [index, row] of rows.slice(0, 20).entries()) {
      if (index > 0) lines.push('');
      lines.push(...expandedRow(row, index));
    }
    return lines;
  });
}
