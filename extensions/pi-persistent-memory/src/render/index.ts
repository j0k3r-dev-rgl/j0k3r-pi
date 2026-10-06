import { Container, Text, TruncatedText } from '@earendil-works/pi-tui';
import { keyHint } from '@earendil-works/pi-coding-agent';

const MEMORY_CYAN = '\x1b[38;2;135;206;250m';
const RESET = '\x1b[39m';
const cyan = (text: string) => `${MEMORY_CYAN}${text}${RESET}`;
const inline = (text: string) => text.replace(/\s+/g, ' ').trim();

type RenderState = { header?: Container; call?: string };

function callArguments(toolName: string, args: any): string {
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
      return `#${args?.id ?? ''}`;
    case 'memory_context':
    case 'memory_deleted_list':
      return args?.global ? 'all projects' : 'current project';
    case 'memory_entity':
      return [args?.action ?? 'list', args?.name ? `"${args.name}"` : args?.id ?? ''].filter(Boolean).join(' ');
    case 'memory_relation':
      return [args?.action ?? 'save', args?.source && args?.target ? `${args.source} → ${args.target}` : args?.id ?? ''].filter(Boolean).join(' ');
    default:
      return '';
  }
}

function resultSummary(toolName: string, details: any): string {
  const id = details.id ? ` #${details.id}` : '';
  switch (toolName) {
    case 'memory_save':
      return details.action === 'reindex'
        ? `Reindexed ${details.processed ?? 0} (${details.succeeded ?? 0} ok, ${details.failed ?? 0} failed)`
        : `Saved${id} (${details.indexing_status === 'indexed' ? 'indexed' : 'pending indexing'})`;
    case 'memory_search':
      return `Found ${details.count ?? details.node_count ?? 0} result(s)`;
    case 'memory_get':
      return `Retrieved${id}`;
    case 'memory_context':
      return `Context loaded (${details.count ?? 0} items)`;
    case 'memory_delete':
      return `Deleted${id}`;
    case 'memory_restore':
      return `Restored${id} (reindex pending)`;
    case 'memory_deleted_list':
      return `Found ${details.count ?? 0} deleted record(s)`;
    case 'memory_entity':
      return `Entity completed${id}`;
    case 'memory_relation':
      return `Relation completed${id}`;
    default:
      return 'Completed';
  }
}

export function createToolRenderers(toolName: string) {
  return {
    // Own only the unframed presentation; Pi still owns expansion and mouse handling.
    renderShell: 'self' as const,

    renderCall(args: any, _theme: any, context?: any) {
      const header = new Container();
      if (context?.expanded) return header;
      const call = inline(`🧠 ${toolName} ${callArguments(toolName, args)}`);
      header.addChild(new TruncatedText(cyan(call), 0, 0));
      if (context?.state) {
        const state: RenderState = context.state;
        state.header = header;
        state.call = call;
      }
      return header;
    },

    renderResult(
      result: { content: Array<{ type: string; text?: string }>; details?: any },
      { expanded, isPartial }: { expanded: boolean; isPartial: boolean },
      _theme: any,
      context?: any,
    ) {
      const text = result?.content?.filter((block) => block.type === 'text')
        .map((block) => block.text ?? '').join('\n') ?? '';
      if (expanded) {
        // Content already includes continuation information; never add metadata or panels.
        return text ? new Text(cyan(text), 0, 0) : new Container();
      }

      const details = result?.details ?? {};
      const status = isPartial ? 'Executing…'
        : context?.isError ? `✗ ${details.error || text || 'Operation failed'}`
        : `✓ ${resultSummary(toolName, details)}${details.has_more ? ' · more available' : ''}`;
      const hint = keyHint('app.tools.expand', 'to expand');
      const state: RenderState | undefined = context?.state;
      const headerText = cyan(inline(`${state?.call ?? `🧠 ${toolName}`} · ${status} (${hint})`));
      if (state?.header) {
        state.header.clear();
        state.header.addChild(new TruncatedText(headerText, 0, 0));
        return new Container();
      }
      return new TruncatedText(headerText, 0, 0);
    },
  };
}
