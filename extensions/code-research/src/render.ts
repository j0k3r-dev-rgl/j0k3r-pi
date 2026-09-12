export type Component = { invalidate(): void; render(width: number): string[] };

export type CodeResearchRenderOptions = { expanded?: boolean; isPartial?: boolean };

export const RESET = '\x1b[0m';
export const CYAN = '\x1b[1;38;2;0;229;255m';
export const LIME = '\x1b[1;38;2;102;255;102m';
export const RED = '\x1b[1;38;2;255;77;109m';
export const DIM = '\x1b[2m';
export const BOLD = '\x1b[1m';

const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

export function visibleWidth(str: string): number {
  return stripAnsi(str).length;
}

export function truncateWithAnsi(str: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (visibleWidth(str) <= maxWidth) return str;

  let visible = 0;
  let result = '';
  const ansiTokenRegex = /^\x1b\[[0-9;]*[a-zA-Z]/;
  let i = 0;

  while (i < str.length && visible < maxWidth) {
    const match = str.slice(i).match(ansiTokenRegex);
    if (match) {
      result += match[0];
      i += match[0].length;
    } else {
      result += str[i];
      visible++;
      i++;
    }
  }

  result += RESET;
  return result;
}

export function fit(text: string, width: number): string {
  return truncateWithAnsi(text, Math.max(0, width));
}

export function pad(text: string, width: number): string {
  const fitted = fit(text, width);
  const vis = visibleWidth(fitted);
  return fitted + ' '.repeat(Math.max(0, width - vis));
}

export function boxLine(content: string, innerWidth: number, borderColor: string = CYAN): string {
  const innerContentWidth = Math.max(0, innerWidth - 2);
  return `${borderColor}│${RESET} ${pad(content, innerContentWidth)} ${borderColor}│${RESET}`;
}

export function cardTopBorder(
  toolName: string,
  actionOrTarget: string | undefined,
  innerWidth: number,
  borderColor: string = CYAN,
  titleColor: string = borderColor,
): string {
  const cleanAction = actionOrTarget ? actionOrTarget.replace(/[\r\n]+/g, ' ').trim() : undefined;
  let label = cleanAction ? `${toolName} [${cleanAction}]` : toolName;

  const maxTitleWidth = Math.max(4, innerWidth - 4);
  if (visibleWidth(label) + 2 > maxTitleWidth && cleanAction) {
    const maxActionWidth = Math.max(3, maxTitleWidth - visibleWidth(toolName) - 5);
    const truncatedAction = fit(cleanAction, maxActionWidth);
    label = `${toolName} [${truncatedAction}]`;
  }

  let titleText = ` ${label} `;
  if (visibleWidth(titleText) > innerWidth) {
    titleText = ` ${fit(label, Math.max(1, innerWidth - 2))} `;
  }

  const rest = Math.max(0, innerWidth - visibleWidth(titleText));
  const leftDash = Math.min(2, rest);
  const rightDash = Math.max(0, rest - leftDash);
  return `${borderColor}╭${'─'.repeat(leftDash)}${RESET}${titleColor}${titleText}${RESET}${borderColor}${'─'.repeat(rightDash)}╮${RESET}`;
}

export function cardBottomBorder(innerWidth: number, borderColor: string = CYAN): string {
  return `${borderColor}╰${'─'.repeat(Math.max(0, innerWidth))}╯${RESET}`;
}

export function frameContent(
  lines: string[],
  innerWidth: number,
  borderColor: string = CYAN,
): string[] {
  const framed: string[] = [];
  for (const rawLine of lines) {
    const subLines = rawLine.split(/\r?\n/);
    for (const sub of subLines) {
      framed.push(boxLine(sub, innerWidth, borderColor));
    }
  }
  return framed;
}

function clip(value: unknown, max = 160): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

function wrapLineToWidth(text: string, width: number): string[] {
  if (width <= 0) return [''];
  if (!text) return [''];
  if (visibleWidth(text) <= width) return [text];

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (visibleWidth(word) > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      let rem = word;
      while (visibleWidth(rem) > width) {
        const chunk = fit(rem, width);
        lines.push(chunk);
        const chunkStripped = stripAnsi(chunk);
        let remIdx = 0;
        let counted = 0;
        while (remIdx < rem.length && counted < chunkStripped.length) {
          const m = rem.slice(remIdx).match(/^\x1b\[[0-9;]*[a-zA-Z]/);
          if (m) {
            remIdx += m[0].length;
          } else {
            remIdx++;
            counted++;
          }
        }
        rem = rem.slice(remIdx);
        if (remIdx === 0) break;
      }
      if (rem) {
        current = rem;
      }
      continue;
    }

    if (!current) {
      current = word;
      continue;
    }

    const candidate = `${current} ${word}`;
    if (visibleWidth(candidate) <= width) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
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

function getKeyHint(theme: any, action: 'expand' | 'collapse'): string {
  const key = theme?.keybinding?.('app.tools.expand') ?? 'ctrl+o';
  return `${DIM}${key} ${action}${RESET}`;
}

function relativeFile(file: string | undefined): string {
  if (!file) return '<unknown>';
  const cwd = process.cwd().replace(/\\/g, '/');
  const normalized = String(file).replace(/\\/g, '/');
  return normalized.startsWith(`${cwd}/`) ? normalized.slice(cwd.length + 1) : normalized;
}

function querySummary(result: any): string | undefined {
  const details = result?.details ?? {};
  const query = details.query ?? details.symbol;
  const path = details.path;
  const relation = details.relation;
  const direction = details.direction;
  const language = details.language;
  const match = details.match;
  const parts = [
    relation ? `relation=${relation}` : undefined,
    direction ? `direction=${direction}` : undefined,
    query ? `query=${query}` : undefined,
    path ? `path=${path}` : undefined,
    language ? `lang=${language}` : undefined,
    match && match !== 'exact' ? `match=${match}${match === 'contains' ? ' (substring/noisy)' : ''}` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? `search ${parts.join(' · ')}` : undefined;
}

function compactFindSymbol(result: any, theme: any, toolName = 'find_symbol'): string[] {
  const found = Number(result?.details?.found ?? result?.details?.results?.length ?? result?.details?.items?.length ?? 0);
  const rows = Array.isArray(result?.details?.results) ? result.details.results : Array.isArray(result?.details?.items) ? result.details.items : [];
  const summary = result?.details?.summary;
  const countText = summary?.total ? `${found}/${summary.total}` : `${found}`;
  const lines = [`${titleFor(toolName, theme)} · ${countText} match(es)`];
  const search = querySummary(result);
  if (search) lines.push(search);
  lines.push(`mode ${result?.details?.source_mode ?? result?.details?.provenance?.source_mode ?? 'graph'} · graph ${result?.details?.graph_status ?? result?.details?.provenance?.graph_status ?? 'disabled'} · ${result?.details?.completeness ?? result?.details?.provenance?.completeness ?? 'unavailable'}`);
  for (const row of rows.slice(0, 5)) {
    const loc = `${relativeFile(row.file)}:${row.start_line ?? '?'}:${row.start_column ?? '?'}`;
    lines.push(`- ${row.symbol ?? '<unknown>'} (${row.kind ?? 'unknown'}) ${loc}`);
  }
  if (rows.length > 5) lines.push(dim(`… ${rows.length - 5} more`, theme));
  return lines;
}

function classificationCountsText(counts: any): string | undefined {
  if (!counts || typeof counts !== 'object') return undefined;
  const text = ['confirmed', 'probable', 'framework']
    .filter((key) => counts[key])
    .map((key) => `${key}=${counts[key]}`)
    .join(', ');
  return text ? `classification counts: ${text}` : undefined;
}

function classificationMetadataText(item: any): string {
  return [item?.classification ? `classification: ${item.classification}` : undefined, item?.reason ? `reason: ${item.reason}` : undefined].filter(Boolean).join('; ');
}

function compactFindReferences(result: any, theme: any, toolName = 'find_references'): string[] {
  const found = Number(result?.details?.found ?? result?.details?.results?.length ?? result?.details?.items?.length ?? 0);
  const rows = Array.isArray(result?.details?.results) ? result.details.results : Array.isArray(result?.details?.items) ? result.details.items : [];
  const summary = result?.details?.summary;
  const countText = summary?.total ? `${found}/${summary.total}` : `${found}`;
  const lines = [`${titleFor(toolName, theme)} · ${countText} reference(s)`];
  const search = querySummary(result);
  if (search) lines.push(search);
  const counts = classificationCountsText(summary?.classification_counts);
  if (counts) lines.push(counts);
  for (const row of rows.slice(0, 7)) {
    const loc = `${relativeFile(row.file)}:${row.line ?? '?'}:${row.column ?? '?'}`;
    const context = row.context_symbol ? ` in ${row.context_symbol}` : '';
    const metadata = classificationMetadataText(row);
    lines.push(`- ${row.reference_kind ?? 'reference'}${context} ${loc} · ${clip(row.source_line ?? row.called_as, 90)}${metadata ? ` · ${metadata}` : ''}`);
  }
  if (rows.length > 7) lines.push(dim(`… ${rows.length - 7} more`, theme));
  return lines;
}

function childSummary(child: any): string {
  const owner = child.class ? `${child.class}.` : '';
  const type = child.node_type ? ` · ${child.node_type}` : '';
  const loc = child.file ? ` · ${relativeFile(child.file)}:${child.line ?? '?'}` : '';
  const metadata = classificationMetadataText(child);
  return `- ${owner}${child.symbol ?? '<unknown>'}${type}${loc}${metadata ? ` · ${metadata}` : ''}`;
}

function compactChangeSurface(result: any, theme: any): string[] {
  const details = result?.details ?? {};
  const summary = details.summary ?? {};
  const count = (name: string) => {
    const section = summary[name] ?? details[name];
    if (!section) return `${name} 0/0`;
    return `${name} ${section.returned ?? section.items?.length ?? 0}/${section.total ?? section.items?.length ?? 0}`;
  };
  const lines = [`${titleFor('code_change_surface', theme)} · ${details.status ?? 'result'} · trust=${details.trust?.level ?? 'unknown'} · follow_up=${details.follow_up?.required ? 'yes' : 'no'}`];
  const search = querySummary(result);
  if (search) lines.push(search);
  lines.push([count('contract'), count('implementations'), count('callers'), count('likely_tests')].join(' · '));
  if (details.follow_up?.reason) lines.push(`follow_up: ${clip(details.follow_up.reason, 120)}`);
  return lines;
}

function compactCallTree(toolName: string, result: any, theme: any): string[] {
  const root = result?.details?.root;
  const stats = result?.details?.stats;
  if (!root) return [`${titleFor(toolName, theme)} · result`, clip(resultText(result), 220)];

  const owner = root.class ? `${root.class}.` : '';
  const lines = [
    `${titleFor(toolName, theme)} · ${owner}${root.symbol ?? '<unknown>'}`,
  ];
  const search = querySummary(result);
  if (search) lines.push(search);
  lines.push(
    stats ? `nodes ${stats.total_nodes ?? '?'} · app ${stats.application_nodes ?? '?'} · external ${stats.external_nodes ?? '?'} · depth ${stats.max_depth_reached ?? '?'}` : 'call tree result',
  );
  const counts = classificationCountsText(result?.details?.summary?.classification_counts);
  if (counts) lines.push(counts);

  const children = Array.isArray(root.children) ? root.children : Array.isArray(root.callers) ? root.callers : [];
  for (const child of children.slice(0, 5)) lines.push(childSummary(child));
  if (children.length > 5) lines.push(dim(`… ${children.length - 5} more`, theme));
  return lines;
}

function compactWorkspaceGraphStatus(result: any, theme: any): string[] {
  const details = result?.details ?? {};
  const status = details.status ?? 'unknown';
  if (status === 'disabled') {
    return [`${titleFor('workspace_graph_status', theme)} · disabled`];
  }
  if (status === 'missing') {
    return [`${titleFor('workspace_graph_status', theme)} · missing`];
  }
  const usable = details.graphUsableForQueries ? 'yes' : 'no';
  const shards = details.indexing?.shardCount ?? 0;
  const files = details.coverage?.indexedFiles ?? 0;
  const detected = details.coverage?.detectedProjects ?? 0;
  const indexed = details.coverage?.indexedProjects ?? 0;
  return [
    `${titleFor('workspace_graph_status', theme)} · ${status} · usable=${usable}`,
    `shards=${shards} · indexed_files=${files} · projects=${indexed}/${detected}`,
  ];
}

function compactResult(toolName: string, result: any, theme: any): string[] {
  if (toolName === 'find_symbol') return compactFindSymbol(result, theme);
  if (toolName === 'find_references') return compactFindReferences(result, theme);
  if (toolName === 'code_find') return result?.details?.relation === 'references' ? compactFindReferences(result, theme, toolName) : compactFindSymbol(result, theme, toolName);
  if (toolName === 'code_change_surface') return compactChangeSurface(result, theme);
  if (toolName === 'workspace_graph_status') return compactWorkspaceGraphStatus(result, theme);
  if (toolName === 'function_call_tree' || toolName === 'reverse_function_call_tree' || toolName === 'code_call_hierarchy') return compactCallTree(toolName, result, theme);
  return [`${titleFor(toolName, theme)} · result`, clip(resultText(result), 220)];
}

export function toolActionBadge(toolName: string, args: any): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  if (toolName === 'workspace_graph_status') {
    return 'status';
  }
  if (toolName === 'code_find' || toolName === 'find_symbol' || toolName === 'find_references') {
    const q = args.query ?? args.symbol;
    const rel = args.relation && args.relation !== 'declaration' ? ` relation=${args.relation}` : '';
    const lang = args.language && args.language !== 'auto' ? ` lang=${args.language}` : '';
    return q ? `${q}${rel}${lang}` : rel.trim() || undefined;
  }
  if (toolName === 'code_call_hierarchy' || toolName === 'function_call_tree' || toolName === 'reverse_function_call_tree') {
    const s = args.symbol;
    const dir = args.direction ? ` ${args.direction}` : '';
    return s ? `${s}${dir}` : undefined;
  }
  if (toolName === 'code_change_surface') {
    const q = args.query ?? args.symbol;
    return q ? `${q}` : undefined;
  }
  return args.query ?? args.symbol ?? undefined;
}

export function renderCodeResearchToolCall(
  toolName: string,
  args: any,
  _theme?: any,
  context?: any,
): Component {
  return {
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];
      const actionBadge = toolActionBadge(toolName, args);

      if (width < 24) {
        return [fit(actionBadge ? `${toolName} [${actionBadge}]` : toolName, width)];
      }

      const innerWidth = Math.max(0, width - 2);
      const state = context?.state;
      const isError = Boolean(context?.isError);
      const borderColor = state?.borderColor ?? (isError ? RED : CYAN);
      const topBorder = cardTopBorder(toolName, actionBadge, innerWidth, borderColor, borderColor);

      if (state?.hasResult) {
        return [topBorder];
      }

      const pendingDetail = actionBadge ? `Pending: ${actionBadge}` : 'Pending...';
      const pendingLine = `${CYAN}●${RESET} ${pendingDetail}`;

      return [
        topBorder,
        boxLine(pendingLine, innerWidth, borderColor),
        cardBottomBorder(innerWidth, borderColor),
      ];
    },
  };
}

export function renderCodeResearchToolResult(
  toolName: string,
  result: any,
  options: CodeResearchRenderOptions = {},
  theme: any = {},
  context?: any,
): Component {
  const isError = Boolean(context?.isError || result?.isError || result?.details?.status === 'failure' || result?.details?.error);
  const borderColor = isError ? RED : LIME;

  if (context?.state) {
    context.state.hasResult = true;
    context.state.borderColor = borderColor;
  }

  return {
    invalidate() {},
    render(width: number): string[] {
      if (width <= 0) return [];

      const isExpanded = options?.expanded === true;
      const keyHint = getKeyHint(theme, isExpanded ? 'collapse' : 'expand');
      const bodyLines: string[] = [];

      if (options?.isPartial) {
        bodyLines.push(`${toolName} · running…`);
      } else if (isError) {
        const errorMsg = (result?.details?.error?.message ?? result?.details?.error ?? resultText(result)) || 'tool failed';
        bodyLines.push(`${RED}Error: ${stripAnsi(String(errorMsg))}${RESET}`);
        bodyLines.push(keyHint);
      } else if (!isExpanded) {
        bodyLines.push(...compactResult(toolName, result, theme));
        bodyLines.push(keyHint);
      } else {
        const search = querySummary(result);
        bodyLines.push(`${titleFor(toolName, theme)} · expanded`);
        if (search) bodyLines.push(search);
        bodyLines.push(keyHint);
        bodyLines.push('');
        bodyLines.push(...resultText(result).split('\n'));
      }

      if (width < 24) {
        return bodyLines.map((line) => fit(stripAnsi(line), width));
      }

      const innerWidth = Math.max(0, width - 2);
      const innerContentWidth = Math.max(0, innerWidth - 2);
      const wrappedBodyLines: string[] = [];
      for (const rawLine of bodyLines) {
        for (const sub of rawLine.split(/\r?\n/)) {
          wrappedBodyLines.push(...wrapLineToWidth(sub, innerContentWidth));
        }
      }

      const framed = frameContent(wrappedBodyLines, innerWidth, borderColor);
      const bottomBorder = cardBottomBorder(innerWidth, borderColor);
      return [...framed, bottomBorder];
    },
  };
}
