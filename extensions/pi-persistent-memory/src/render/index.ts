import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';

const MEMORY_CYAN = '\x1b[38;2;135;206;250m';
const MUTED_FALLBACK = '\x1b[38;2;122;167;184m';
const FG_RESET = '\x1b[39m';
const SGR_RESET = '\x1b[0m';
const HAS_SGR_RE = /\x1b\[[0-9;]*m/;
const PURE_FG_SGR_RE = /^\x1b\[(?:3[0-7]|9[0-7]|38;[0-9;]+)m$/;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const cyan = (text: string) => `${MEMORY_CYAN}${text}${FG_RESET}`;
const inline = (text: string) => text.replace(/\s+/g, ' ').trim();

type RenderState = { hasResult?: boolean; call?: string };

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
  if (safeWidth <= 0 || !text) return [];
  if (safeWidth === 1) return [' '];
  const out: string[] = [];
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const styled = mutePlainLine(theme, rawLine);
    out.push(...wrapMarginedLine(styled, safeWidth));
  }
  return out;
}

function callArguments(toolName: string, args: any): string {
  if (!args || typeof args !== 'object') return '';
  switch (toolName) {
    case 'memory_save':
      if (args?.action === 'reindex') {
        return `reindex ${args.id ? `#${args.id}` : args.global ? 'all projects' : 'pending in scope'}`;
      }
      return [args?.title ? `"${args.title}"` : args?.topic_key ? `key:${args.topic_key}` : '',
        args?.type ? `[${args.type}]` : ''].filter(Boolean).join(' ');
    case 'memory_search':
      return args?.mode === 'graph' ? `graph ${args?.entity_id ?? ''}`
        : [args?.query ? `"${args.query}"` : '', args?.mode ? `[${args.mode}]` : ''].filter(Boolean).join(' ');
    case 'memory_get':
    case 'memory_delete':
    case 'memory_restore':
      return args?.id !== undefined ? `#${args.id}` : '';
    case 'memory_context':
    case 'memory_deleted_list':
      return args?.global ? 'all projects' : 'current project';
    case 'memory_entity':
      return [args?.action ?? 'list', args?.name ? `"${args.name}"` : args?.id ?? ''].filter(Boolean).join(' ');
    case 'memory_relation':
      return [args?.action ?? 'save', args?.source && args?.target ? `${args.source} → ${args.target}` : args?.id ?? ''].filter(Boolean).join(' ');
    case 'memory_history':
      return args?.action === 'get'
        ? `#${args?.id ?? ''}`
        : [args?.query ? `"${args.query}"` : 'recent', args?.session_id ? `session:${args.session_id}` : ''].filter(Boolean).join(' ');
    default:
      return '';
  }
}

function resultSummary(toolName: string, details: any): string {
  const id = details?.id ? ` #${details.id}` : '';
  switch (toolName) {
    case 'memory_save':
      return details?.action === 'reindex'
        ? `Reindexed ${details.processed ?? 0} (${details.succeeded ?? 0} ok, ${details.failed ?? 0} failed)`
        : `Saved${id} (${details?.indexing_status === 'indexed' ? 'indexed' : 'pending indexing'})`;
    case 'memory_search':
      return `Found ${details?.count ?? details?.node_count ?? 0} result(s)`;
    case 'memory_get':
      return `Retrieved${id}`;
    case 'memory_context':
      return `Context loaded (${details?.count ?? 0} items)`;
    case 'memory_delete':
      return `Deleted${id}`;
    case 'memory_restore':
      return `Restored${id} (reindex pending)`;
    case 'memory_deleted_list':
      return `Found ${details?.count ?? 0} deleted record(s)`;
    case 'memory_entity':
      return `Entity completed${id}`;
    case 'memory_relation':
      return `Relation completed${id}`;
    case 'memory_history':
      return details?.action === 'get'
        ? `Retrieved message #${details.id}`
        : `Found ${details?.count ?? 0} message(s)`;
    default:
      return 'Completed';
  }
}

export function createToolRenderers(toolName: string) {
  return {
    compactToolRenderingVersion: 1 as const,
    compactLeftMargin: 1 as const,
    renderShell: 'self' as const,

    renderCall(args: any, _theme: any, context?: any) {
      let call = `🧠 ${toolName}`;
      try {
        call = inline(`🧠 ${toolName} ${callArguments(toolName, args)}`);
        if (context?.state) {
          const state: RenderState = context.state;
          state.call = call;
        }
      } catch {
        call = `🧠 ${toolName}`;
      }
      return {
        compactLeftMargin: 1 as const,
        invalidate() {},
        render(width: number): string[] {
          const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
          try {
            if (safeWidth <= 0) return [];
            if (context?.state?.hasResult || context?.expanded) return [];
            if (safeWidth === 1) return [' '];
            return wrapMarginedLine(cyan(`${call} ─── pending…`), safeWidth);
          } catch {
            if (safeWidth <= 0) return [];
            return wrapMarginedLine(cyan(toolName), safeWidth);
          }
        },
      };
    },

    renderResult(
      result: { content: Array<{ type: string; text?: string }>; details?: any; isError?: boolean },
      options: { expanded?: boolean; isPartial?: boolean } = {},
      theme: any,
      context?: any,
    ) {
      try {
        if (context?.state) {
          const state: RenderState = context.state;
          state.hasResult = true;
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
            const expanded = Boolean(options?.expanded);
            const isPartial = Boolean(options?.isPartial);
            const blocks = Array.isArray(result?.content) ? result.content : [];
            const text = blocks
              .filter((block) => block?.type === 'text' && typeof block.text === 'string')
              .map((block) => block.text ?? '')
              .join('\n');
            const details = result?.details ?? {};
            const isError = Boolean(context?.isError || result?.isError);

            if (expanded && !isPartial) {
              if (!text) {
                if (!(isError && details?.error)) return [];
                if (safeWidth === 1) return [' '];
                return wrapMutedBody(String(details.error), theme, safeWidth);
              }
              if (safeWidth === 1) return [' '];
              return wrapMutedBody(text, theme, safeWidth);
            }

            if (safeWidth === 1) return [' '];
            const state: RenderState | undefined = context?.state;
            const callLabel = state?.call ?? inline(`🧠 ${toolName} ${callArguments(toolName, context?.args)}`);
            const status = isPartial
              ? 'Executing…'
              : isError
                ? `✗ ${details.error || inline(text) || 'Operation failed'}`
                : `✓ ${resultSummary(toolName, details)}${details.has_more ? ' · more available' : ''}`;
            return wrapMarginedLine(cyan(inline(`${callLabel} ─── ${status}`)), safeWidth);
          } catch {
            if (safeWidth <= 0) return [];
            return wrapMarginedLine(cyan(toolName), safeWidth);
          }
        },
      };
    },
  };
}
