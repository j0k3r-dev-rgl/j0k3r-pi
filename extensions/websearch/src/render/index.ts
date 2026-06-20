type Component = { invalidate(): void; render(width: number): string[] };

type WebsearchRenderOptions = { expanded?: boolean; isPartial?: boolean };
type Theme = { fg?: (name: string, text: string) => string; bold?: (text: string) => string };
type ToolContent = { type?: string; text?: string };

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function lineWidth(text: string): number {
  return [...stripAnsi(text)].length;
}

function truncate(text: string, width: number): string {
  return lineWidth(text) <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

function clip(text: unknown, limit: number): string {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > limit ? `${normalized.slice(0, Math.max(0, limit - 1))}…` : normalized;
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
      const w = Math.max(40, width);
      return linesForWidth(w).map((line) => truncate(line, w));
    },
  };
}

function resultText(result: any): string {
  const content = Array.isArray(result?.content) ? result.content as ToolContent[] : [];
  return content.filter((part) => part?.type === 'text').map((part) => part.text ?? '').join('\n');
}

function status(result: any): string {
  return result?.details?.status ?? (result?.isError ? 'failure' : 'success');
}

function data(result: any): any {
  return result?.details?.data ?? {};
}

function titleForData(value: any): string {
  return String(value?.title ?? value?.name ?? value?.tag ?? value?.id ?? value?.entity_id ?? value?.follow_up_ref ?? '').trim();
}

function urlForData(value: any): string {
  return String(value?.url ?? value?.html_url ?? value?.doi ?? value?.pdf_url ?? '').trim();
}

function itemLabel(item: any): string {
  const source = item?.source ? `[${item.source}${item.kind ? `/${item.kind}` : ''}] ` : '';
  const title = titleForData(item) || item?.followup_ref || item?.follow_up_ref || item?.id || 'result';
  const ref = item?.followup_tool && item?.followup_ref !== undefined ? ` → ${item.followup_tool}(${item.followup_ref})` : '';
  return `${source}${title}${ref}`;
}

function compactSearchData(toolName: string, value: any, theme: Theme): string[] {
  const title = (text: string) => theme?.fg?.('toolTitle', theme?.bold?.(text) ?? text) ?? text;
  const accent = (text: string) => theme?.fg?.('accent', text) ?? text;
  const dim = (text: string) => theme?.fg?.('dim', text) ?? text;
  const items = Array.isArray(value?.items) ? value.items : [];
  const errors = Array.isArray(value?.source_errors) ? value.source_errors : [];
  const query = value?.query ? ` · ${accent(String(value.query))}` : '';
  const source = value?.selected_source ? ` · ${String(value.selected_source)}` : '';
  const lines = [`${title(toolName)} · ${items.length} result${items.length === 1 ? '' : 's'}${source}${query}`];
  for (const item of items.slice(0, 5)) lines.push(`• ${clip(itemLabel(item), 150)}`);
  if (errors.length) lines.push(dim(`${errors.length} source error${errors.length === 1 ? '' : 's'} · ctrl+o expand`));
  else lines.push(dim('ctrl+o expand'));
  return lines;
}

function compactDetailData(toolName: string, value: any, result: any, theme: Theme): string[] {
  const title = (text: string) => theme?.fg?.('toolTitle', theme?.bold?.(text) ?? text) ?? text;
  const dim = (text: string) => theme?.fg?.('dim', text) ?? text;
  const main = titleForData(value) || resultText(result).split('\n').find(Boolean) || toolName;
  const url = urlForData(value);
  const counts = [
    Array.isArray(value?.comments) ? `${value.comments.length} comments` : undefined,
    Array.isArray(value?.review_comments) ? `${value.review_comments.length} review comments` : undefined,
    Array.isArray(value?.items) ? `${value.items.length} items` : undefined,
  ].filter(Boolean).join(' · ');
  const preview = clip(value?.summary ?? value?.snippet ?? value?.body ?? value?.abstract ?? value?.text ?? resultText(result), 220);
  return [
    `${title(toolName)} · ${status(result)}`,
    clip(main, 180),
    ...(url ? [dim(clip(url, 180))] : []),
    ...(counts ? [dim(counts)] : []),
    ...(preview && preview !== main ? [`preview: ${preview}`] : []),
    dim('ctrl+o expand'),
  ];
}

function compactResult(toolName: string, result: any, theme: Theme): string[] {
  if (status(result) === 'failure' || result?.isError) {
    const title = (text: string) => theme?.fg?.('toolTitle', theme?.bold?.(text) ?? text) ?? text;
    const error = result?.details?.error;
    return [`${title(toolName)} · error`, clip(error?.message ?? resultText(result), 240), 'ctrl+o expand'];
  }
  const value = data(result);
  if (Array.isArray(value?.items) || Array.isArray(value?.source_errors)) return compactSearchData(toolName, value, theme);
  return compactDetailData(toolName, value, result, theme);
}

export function renderWebsearchToolResult(toolName: string, result: any, options: WebsearchRenderOptions = {}, theme: Theme = {}): Component {
  return textComponent((width) => {
    if (options.isPartial) return [`${toolName} · running…`];
    if (!options.expanded) return compactResult(toolName, result, theme);
    const title = (text: string) => theme?.fg?.('toolTitle', theme?.bold?.(text) ?? text) ?? text;
    const dim = (text: string) => theme?.fg?.('dim', text) ?? text;
    return wrapLines([
      `${title(toolName)} · expanded`,
      dim('ctrl+o collapse'),
      '',
      ...resultText(result).split('\n'),
    ], width);
  });
}
