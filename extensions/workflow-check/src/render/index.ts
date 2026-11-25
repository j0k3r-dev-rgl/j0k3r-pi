import { homedir } from 'node:os';
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

export const compactToolRenderingVersion = 1 as const;
export const compactLeftMargin = 1 as const;
export const renderShell = 'self' as const;

const MUTED_FALLBACK = '\x1b[38;2;122;167;184m';
const FG_RESET = '\x1b[39m';
const SGR_RESET = '\x1b[0m';
const HAS_SGR_RE = /\x1b\[[0-9;]*m/;
const PURE_FG_SGR_RE = /^\x1b\[(?:3[0-7]|9[0-7]|38;[0-9;]+)m$/;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function fg(theme: any, color: string, text: string): string {
  try {
    return typeof theme?.fg === 'function' ? theme.fg(color, text) : text;
  } catch {
    return text;
  }
}

function styleMuted(theme: any, text: string): string {
  if (!text) return text;
  if (typeof theme?.fg === 'function') {
    try {
      const styled = theme.fg('muted', text);
      if (typeof styled === 'string' && styled !== text) {
        return styled;
      }
    } catch {
      // Fall back to arch-electric muted foreground
    }
  }
  return `${MUTED_FALLBACK}${text}${FG_RESET}`;
}

function mutePlainLine(theme: any, line: string): string {
  if (!line || HAS_SGR_RE.test(line)) return line;
  return styleMuted(theme, line);
}

function matchEscapeAt(str: string, index: number): string | undefined {
  if (str[index] !== '\x1b') return undefined;
  const next = str[index + 1];
  if (next === '[') {
    const m = str.slice(index).match(/^\x1b\[[0-?]*[ -/]*[@-~]/);
    return m?.[0];
  }
  if (next === ']' || next === '_') {
    const rest = str.slice(index + 2);
    const bel = rest.indexOf('\x07');
    const st = rest.indexOf('\x1b\\');
    if (bel !== -1 && (st === -1 || bel < st)) return str.slice(index, index + 2 + bel + 1);
    if (st !== -1) return str.slice(index, index + 2 + st + 2);
  }
  return undefined;
}

function wrapWidth2WithConditionalMargin(line: string): string[] {
  const normalized = line.replace(/\t/g, '   ');
  if (!normalized) return [' '];

  let sgr: string[] = [];
  let osc8 = '';
  const out: string[] = [];
  let i = 0;

  while (i < normalized.length) {
    const seq = matchEscapeAt(normalized, i);
    if (seq) {
      if (seq.startsWith('\x1b[') && seq.endsWith('m')) {
        const params = seq.slice(2, -1);
        if (params === '' || params.split(';').includes('0')) {
          sgr = [];
        } else if (params === '39' && sgr.every((entry) => PURE_FG_SGR_RE.test(entry))) {
          sgr = [];
        } else {
          sgr.push(seq);
        }
      } else if (seq.startsWith('\x1b]8;')) {
        const oscMatch = seq.match(/^\x1b\]8;[^;]*;([^\x07\x1b]*)(?:\x07|\x1b\\)$/);
        if (oscMatch) osc8 = oscMatch[1] ? seq : '';
      }
      i += seq.length;
      continue;
    }
    let end = i + 1;
    while (end < normalized.length && !matchEscapeAt(normalized, end)) end++;
    for (const { segment } of graphemeSegmenter.segment(normalized.slice(i, end))) {
      const w = visibleWidth(segment);
      if (w === 0) continue;
      const prefix = sgr.join('') + osc8;
      const suffix = (osc8 ? '\x1b]8;;\x07' : '') + (sgr.length > 0 ? SGR_RESET : '');
      if (w >= 2) {
        out.push(`${prefix}${segment}${suffix}`);
      } else {
        out.push(` ${prefix}${segment}${suffix}`);
      }
    }
    i = end;
  }

  return out.length > 0 ? out : [' '];
}

function wrapMarginedLine(line: string, safeWidth: number): string[] {
  if (safeWidth <= 0) return [];
  if (safeWidth === 1) return [' '];
  if (safeWidth === 2) return wrapWidth2WithConditionalMargin(line);
  const innerWidth = safeWidth - 1;
  const normalized = line.replace(/\t/g, '   ');
  if (normalized.length === 0) return [' '];
  const wrapped = wrapTextWithAnsi(normalized, innerWidth);
  return wrapped.map((piece) => {
    const safePiece = visibleWidth(piece) > innerWidth ? truncateToWidth(piece, innerWidth, '') : piece;
    return ` ${safePiece}`;
  });
}

function wrapMutedBody(text: string, theme: any, safeWidth: number): string[] {
  if (safeWidth <= 0) return [];
  if (safeWidth === 1) return [' '];
  const out: string[] = [];
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const styled = mutePlainLine(theme, rawLine);
    out.push(...wrapMarginedLine(styled, safeWidth));
  }
  return out;
}

function inlineText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function abbreviateHome(value: string): string {
  const home = homedir();
  if (!home || !value) return value;
  if (value === home) return '~';
  if (value.startsWith(`${home}/`) || value.startsWith(`${home}\\`)) {
    return `~${value.slice(home.length)}`;
  }
  return value;
}

function buildCallLabel(toolName: string | undefined, args: any, theme: any): string {
  const name = toolName ?? (args?.action ? 'workflow_record' : 'workflow_check');
  const target = inlineText(args?.phase ?? args?.action ?? '');
  const dir = typeof args?.change_dir === 'string' && args.change_dir.trim()
    ? inlineText(abbreviateHome(args.change_dir.trim()))
    : '';
  const parts = [fg(theme, 'toolTitle', name)];
  if (target) parts.push(fg(theme, 'muted', `[${target}]`));
  if (dir) parts.push(fg(theme, 'dim', dir));
  return parts.join(' ');
}

export function createWorkflowRenderCall(toolName?: string): NonNullable<ToolDefinition['renderCall']> {
  return (args, theme, context) => ({
    compactLeftMargin: 1 as const,
    invalidate() {},
    render(width: number): string[] {
      const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      try {
        if (safeWidth <= 0) return [];
        if (context?.state?.hasResult) return [];
        if (safeWidth === 1) return [' '];
        const header = `${buildCallLabel(toolName, args, theme)} ${fg(theme, 'dim', '───')} ${fg(theme, 'muted', 'pending…')}`;
        return wrapMarginedLine(header, safeWidth);
      } catch {
        if (safeWidth <= 0) return [];
        return wrapMarginedLine(toolName ?? 'workflow_check', safeWidth);
      }
    },
  } as any);
}

export function createWorkflowRenderResult(toolName?: string): NonNullable<ToolDefinition['renderResult']> {
  return (result, { expanded, isPartial } = { expanded: false, isPartial: false }, theme, context) => {
    try {
      if (context?.state) {
        context.state.hasResult = true;
      }
    } catch {
      // Ignore malformed context
    }

    return {
      compactLeftMargin: 1 as const,
      invalidate() {},
      render(width: number): string[] {
        const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
        try {
          if (safeWidth <= 0) return [];
          if (safeWidth === 1) return [' '];
          const args = context?.args ?? {};
          const label = buildCallLabel(toolName, args, theme);
          const sep = fg(theme, 'dim', '───');

          if (isPartial) {
            return wrapMarginedLine(`${label} ${sep} ${fg(theme, 'muted', 'Checking workflow…')}`, safeWidth);
          }

          const details = result?.details as {
            status?: string;
            phase?: string;
            action?: string;
            contract_count?: number;
            next_offset?: number;
            continuity_status?: string;
            record_count?: number;
            delta_count?: number;
            violation_count?: number;
            baseline_id?: string;
            file_count?: number;
            destination?: string;
          } | undefined;
          const blocks = Array.isArray(result?.content) ? result.content : [];
          const text = blocks
            .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
            .map((block: any) => block.text as string)
            .join('\n');

          const status = details?.status ?? (context?.isError || (result as any)?.isError ? 'ERROR' : 'EMPTY');
          const op = details?.phase ?? details?.action ?? args?.phase ?? args?.action ?? 'workflow';
          const contracts = details?.contract_count === undefined ? '' : ` · ${details.contract_count} contracts`;
          const more = details?.next_offset === undefined ? '' : ' · more diagnostic available';
          let detailSuffix = contracts;
          if (op === 'snapshot' && details?.continuity_status) {
            const countPart = details.record_count === undefined ? '' : ` · ${details.record_count} records`;
            detailSuffix = ` · ${details.continuity_status}${countPart}`;
          } else if (op === 'surface' && details?.delta_count !== undefined) {
            detailSuffix = ` · ${details.delta_count} deltas · ${details.violation_count ?? 0} violations`;
          } else if (op === 'baseline' && details?.baseline_id) {
            const filePart = details.file_count === undefined ? '' : ` · ${details.file_count} files`;
            detailSuffix = ` · ${details.baseline_id}${filePart}`;
          } else if (op === 'archive' && typeof details?.destination === 'string' && details.destination.trim()) {
            detailSuffix = ` · ${inlineText(abbreviateHome(details.destination.trim()))}`;
          }
          const summaryText = `${status} · ${op}${detailSuffix}${more}`;
          const color = status === 'PASS' || status === 'RECORDED' ? 'success' : 'error';
          const headerLines = wrapMarginedLine(`${label} ${sep} ${fg(theme, color, summaryText)}`, safeWidth);

          if (!expanded) {
            return headerLines;
          }

          return [...headerLines, ...wrapMutedBody(text || 'No diagnostic returned.', theme, safeWidth)];
        } catch {
          if (safeWidth <= 0) return [];
          return wrapMarginedLine(toolName ?? 'workflow_check', safeWidth);
        }
      },
    } as any;
  };
}

export const renderCall: NonNullable<ToolDefinition['renderCall']> = createWorkflowRenderCall();
export const renderResult: NonNullable<ToolDefinition['renderResult']> = createWorkflowRenderResult();

export function createWorkflowToolPresentation(toolName: 'workflow_check' | 'workflow_record') {
  return {
    compactToolRenderingVersion,
    compactLeftMargin,
    renderShell,
    renderCall: createWorkflowRenderCall(toolName),
    renderResult: createWorkflowRenderResult(toolName),
  };
}
