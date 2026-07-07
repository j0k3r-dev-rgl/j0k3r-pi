type Component = { invalidate(): void; render(width: number): string[] };

type CodeResearchRenderOptions = { expanded?: boolean; isPartial?: boolean };

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function lineWidth(text: string): number {
  return [...stripAnsi(text)].length;
}

function truncate(text: string, width: number): string {
  if (lineWidth(text) <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

function clip(value: unknown, max = 160): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

function wrapLine(text: string, width: number): string[] {
  if (!text) return [''];
  if (lineWidth(text) <= width) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    const candidate = `${current} ${word}`;
    if (lineWidth(candidate) <= width) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.flatMap((line) => {
    if (lineWidth(line) <= width) return [line];
    const chunks: string[] = [];
    for (let index = 0; index < line.length; index += width) chunks.push(line.slice(index, index + width));
    return chunks;
  });
}

function wrapLines(lines: string[], width: number): string[] {
  return lines.flatMap((line) => wrapLine(line, width));
}

function textComponent(linesForWidth: (width: number) => string[]): Component {
  return {
    invalidate() {},
    render(width: number) {
      const safeWidth = Math.max(40, width || 80);
      return linesForWidth(safeWidth).map((line) => truncate(line, safeWidth));
    },
  };
}

function resultText(result: any): string {
  return String(result?.content?.find?.((part: any) => part?.type === 'text')?.text ?? result?.content?.[0]?.text ?? '');
}

function titleFor(toolName: string, theme: any): string {
  const title = theme?.bold?.(toolName) ?? toolName;
  return theme?.fg?.('toolTitle', title) ?? title;
}

function dim(text: string, theme: any): string {
  return theme?.fg?.('dim', text) ?? text;
}

function relativeFile(file: string | undefined): string {
  if (!file) return '<unknown>';
  const cwd = process.cwd().replace(/\\/g, '/');
  const normalized = String(file).replace(/\\/g, '/');
  return normalized.startsWith(`${cwd}/`) ? normalized.slice(cwd.length + 1) : normalized;
}

function compactFindSymbol(result: any, theme: any): string[] {
  const found = Number(result?.details?.found ?? result?.details?.results?.length ?? 0);
  const rows = Array.isArray(result?.details?.results) ? result.details.results : [];
  const lines = [`${titleFor('find_symbol', theme)} · ${found} match(es)`, dim('ctrl+o expand', theme)];
  for (const row of rows.slice(0, 5)) {
    const loc = `${relativeFile(row.file)}:${row.start_line ?? '?'}:${row.start_column ?? '?'}`;
    lines.push(`- ${row.symbol ?? '<unknown>'} (${row.kind ?? 'unknown'}) ${loc}`);
  }
  if (rows.length > 5) lines.push(dim(`… ${rows.length - 5} more`, theme));
  return lines;
}

function compactFindReferences(result: any, theme: any): string[] {
  const found = Number(result?.details?.found ?? result?.details?.results?.length ?? 0);
  const rows = Array.isArray(result?.details?.results) ? result.details.results : [];
  const lines = [`${titleFor('find_references', theme)} · ${found} reference(s)`, dim('ctrl+o expand', theme)];
  for (const row of rows.slice(0, 7)) {
    const loc = `${relativeFile(row.file)}:${row.line ?? '?'}:${row.column ?? '?'}`;
    const context = row.context_symbol ? ` in ${row.context_symbol}` : '';
    lines.push(`- ${row.reference_kind ?? 'reference'}${context} ${loc} · ${clip(row.source_line ?? row.called_as, 90)}`);
  }
  if (rows.length > 7) lines.push(dim(`… ${rows.length - 7} more`, theme));
  return lines;
}

function childSummary(child: any): string {
  const owner = child.class ? `${child.class}.` : '';
  const type = child.node_type ? ` · ${child.node_type}` : '';
  const loc = child.file ? ` · ${relativeFile(child.file)}:${child.line ?? '?'}` : '';
  return `- ${owner}${child.symbol ?? '<unknown>'}${type}${loc}`;
}

function compactCallTree(toolName: string, result: any, theme: any): string[] {
  const root = result?.details?.root;
  const stats = result?.details?.stats;
  if (!root) return [`${titleFor(toolName, theme)} · result`, dim('ctrl+o expand', theme), clip(resultText(result), 220)];

  const owner = root.class ? `${root.class}.` : '';
  const lines = [
    `${titleFor(toolName, theme)} · ${owner}${root.symbol ?? '<unknown>'}`,
    stats ? `nodes ${stats.total_nodes ?? '?'} · app ${stats.application_nodes ?? '?'} · external ${stats.external_nodes ?? '?'} · depth ${stats.max_depth_reached ?? '?'}` : 'call tree result',
    dim('ctrl+o expand', theme),
  ];

  const children = Array.isArray(root.children) ? root.children : Array.isArray(root.callers) ? root.callers : [];
  for (const child of children.slice(0, 5)) lines.push(childSummary(child));
  if (children.length > 5) lines.push(dim(`… ${children.length - 5} more`, theme));
  return lines;
}

function compactResult(toolName: string, result: any, theme: any): string[] {
  if (toolName === 'find_symbol') return compactFindSymbol(result, theme);
  if (toolName === 'find_references') return compactFindReferences(result, theme);
  if (toolName === 'function_call_tree' || toolName === 'reverse_function_call_tree') return compactCallTree(toolName, result, theme);
  return [`${titleFor(toolName, theme)} · result`, dim('ctrl+o expand', theme), clip(resultText(result), 220)];
}

export function renderCodeResearchToolResult(toolName: string, result: any, options: CodeResearchRenderOptions = {}, theme: any = {}): Component {
  return textComponent((width) => {
    if (options.isPartial) return [`${toolName} · running…`];
    if (!options.expanded) return compactResult(toolName, result, theme);
    return wrapLines([
      `${titleFor(toolName, theme)} · expanded`,
      dim('ctrl+o collapse', theme),
      '',
      ...resultText(result).split('\n'),
    ], width);
  });
}
