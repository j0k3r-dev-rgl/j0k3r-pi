type Component = { invalidate(): void; render(width: number): string[] };

type MemoryRenderOptions = { expanded?: boolean; isPartial?: boolean };

function clip(text: string | undefined, limit: number): string {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > limit ? `${normalized.slice(0, Math.max(0, limit - 1))}…` : normalized;
}

function lineWidth(text: string): number { return [...text.replace(/\u001b\[[0-9;]*m/g, '')].length; }

function truncate(text: string, width: number): string {
  return lineWidth(text) <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
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

function inferLabel(result: any): string {
  const text = String(result?.content?.[0]?.text ?? '').toLowerCase();
  if (text.startsWith('found ')) return 'memory_search';
  if (text.startsWith('listed ')) return 'memory_list';
  if (text.startsWith('memory:')) return 'memory_get';
  if (text.startsWith('recalled ')) return 'memory_recall';
  if (text.startsWith('project profile')) return 'memory_project_profile';
  return 'memory';
}

export function renderMemoryToolResult(result: any, options: MemoryRenderOptions = {}, theme: any = {}): Component {
  const rows = rowsFromResult(result);
  const expanded = options.expanded === true;
  const accent = (text: string) => theme?.fg?.('accent', text) ?? text;
  const dim = (text: string) => theme?.fg?.('dim', text) ?? text;
  const title = (text: string) => theme?.fg?.('toolTitle', theme?.bold?.(text) ?? text) ?? text;
  return textComponent((_width) => {
    const noun = rows.length === 1 ? 'result' : 'results';
    const header = `${title('memory')} · ${rows.length} ${noun} · ${accent(inferLabel(result))}`;
    if (!rows.length) return [header, dim(String(result?.content?.[0]?.text ?? 'No memory results.'))];
    if (!expanded) return [header, ...rows.slice(0, 5).map(compactRow), dim('ctrl+o expand')];
    const lines: string[] = [header, dim('ctrl+o collapse')];
    for (const [index, row] of rows.slice(0, 20).entries()) {
      if (index > 0) lines.push('');
      lines.push(...expandedRow(row, index));
    }
    return lines;
  });
}
