import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';

const MEMORY_CYAN = '\x1b[38;2;135;206;250m';
const RESET = '\x1b[39m';
const cyan = (text: string) => `${MEMORY_CYAN}${text}${RESET}`;
const inline = (text: string) => text.replace(/\s+/g, ' ').trim();

type RenderState = { hasResult?: boolean; call?: string };

function fitLine(text: string, width: number): string {
  if (width <= 0) return '';
  return truncateToWidth(text, width, width >= 4 ? '…' : '');
}

function wrapColoredLines(text: string, width: number): string[] {
  if (width <= 0 || !text) return [];
  const out: string[] = [];
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const normalized = rawLine.replace(/\t/g, '   ');
    if (normalized.length === 0) {
      out.push('');
      continue;
    }
    const wrapped = wrapTextWithAnsi(cyan(normalized), width);
    for (const piece of wrapped) {
      out.push(visibleWidth(piece) > width ? truncateToWidth(piece, width, '') : piece);
    }
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
            return [` ${fitLine(cyan(`${call} ─── pending…`), safeWidth - 1)}`];
          } catch {
            if (safeWidth <= 0) return [];
            return safeWidth === 1 ? [' '] : [` ${fitLine(cyan(toolName), safeWidth - 1)}`];
          }
        },
      };
    },

    renderResult(
      result: { content: Array<{ type: string; text?: string }>; details?: any; isError?: boolean },
      options: { expanded?: boolean; isPartial?: boolean } = {},
      _theme: any,
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
                return wrapColoredLines(String(details.error), safeWidth - 1).map((line) => ` ${line}`);
              }
              if (safeWidth === 1) return [' '];
              return wrapColoredLines(text, safeWidth - 1).map((line) => ` ${line}`);
            }

            if (safeWidth === 1) return [' '];
            const state: RenderState | undefined = context?.state;
            const callLabel = state?.call ?? inline(`🧠 ${toolName} ${callArguments(toolName, context?.args)}`);
            const status = isPartial
              ? 'Executing…'
              : isError
                ? `✗ ${details.error || inline(text) || 'Operation failed'}`
                : `✓ ${resultSummary(toolName, details)}${details.has_more ? ' · more available' : ''}`;
            return [` ${fitLine(cyan(inline(`${callLabel} ─── ${status}`)), safeWidth - 1)}`];
          } catch {
            if (safeWidth <= 0) return [];
            return safeWidth === 1 ? [' '] : [` ${fitLine(cyan(toolName), safeWidth - 1)}`];
          }
        },
      };
    },
  };
}
