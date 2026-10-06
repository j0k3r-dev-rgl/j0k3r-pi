import { Text } from '@earendil-works/pi-tui';
import { keyHint } from '@earendil-works/pi-coding-agent';

function formatCallSummary(toolName: string, args: any, theme: any): string {
  switch (toolName) {
    case 'memory_save': {
      if (args?.action === 'reindex') {
        const target = args?.id ? `id #${args.id}` : args?.global ? 'all projects' : 'pending in scope';
        return theme.fg('toolOutput', `reindex memory (${target})`);
      }
      const title = args?.title ? `"${args.title}"` : args?.topic_key ? `key:${args.topic_key}` : '';
      const typeStr = args?.type ? ` [${args.type}]` : '';
      return theme.fg('toolOutput', `save memory ${title}${typeStr}`);
    }
    case 'memory_search': {
      if (args?.mode === 'graph') {
        return theme.fg('toolOutput', `graph search entity: ${args?.entity_id ?? ''}`);
      }
      const q = args?.query ? `"${args.query}"` : '';
      const modeStr = args?.mode ? ` [${args.mode}]` : '';
      return theme.fg('toolOutput', `search memory ${q}${modeStr}`);
    }
    case 'memory_get':
      return theme.fg('toolOutput', `get memory #${args?.id ?? ''}`);
    case 'memory_context': {
      const scopeLabel = args?.global ? 'all projects' : 'current project';
      return theme.fg('toolOutput', `memory context (${scopeLabel})`);
    }
    case 'memory_delete':
      return theme.fg('toolOutput', `delete memory #${args?.id ?? ''}`);
    case 'memory_restore':
      return theme.fg('toolOutput', `restore memory #${args?.id ?? ''}`);
    case 'memory_deleted_list': {
      const scopeLabel = args?.global ? 'all projects' : 'current project';
      return theme.fg('toolOutput', `list deleted memories (${scopeLabel})`);
    }
    case 'memory_entity': {
      const act = args?.action ?? 'list';
      const name = args?.name ? ` "${args.name}"` : args?.id ? ` id:${args.id}` : '';
      return theme.fg('toolOutput', `entity ${act}${name}`);
    }
    case 'memory_relation': {
      const act = args?.action ?? 'save';
      const rel = args?.source && args?.target ? ` ${args.source} -> ${args.target}` : args?.id ? ` id:${args.id}` : '';
      return theme.fg('toolOutput', `relation ${act}${rel}`);
    }
    default:
      return theme.fg('toolOutput', `${toolName}`);
  }
}

function formatCollapsedResult(toolName: string, result: any, theme: any): string {
  const expandHint = keyHint('app.tools.expand', 'to expand');
  const details = result?.details ?? {};

  switch (toolName) {
    case 'memory_save': {
      if (details?.action === 'reindex') {
        const proc = details?.processed ?? 0;
        const succ = details?.succeeded ?? 0;
        const fail = details?.failed ?? 0;
        return `${theme.fg('success', '✓')} Reindexed ${proc} memories (${succ} ok, ${fail} failed) ${theme.fg('muted', `(${expandHint})`)}`;
      }
      const idStr = details?.id ? ` #${details.id}` : '';
      const statusStr = details?.indexing_status === 'indexed' ? 'indexed' : 'pending indexing';
      return `${theme.fg('success', '✓')} Saved memory${idStr} (${statusStr}) ${theme.fg('muted', `(${expandHint})`)}`;
    }
    case 'memory_search': {
      const count = details?.count ?? (details?.node_count !== undefined ? details.node_count : 0);
      const moreStr = details?.has_more ? ' (more available)' : '';
      return `${theme.fg('success', '✓')} Found ${count} result(s)${moreStr} ${theme.fg('muted', `(${expandHint})`)}`;
    }
    case 'memory_get': {
      const idStr = details?.id ? ` #${details.id}` : '';
      const moreStr = details?.has_more ? ' [page continuation available]' : '';
      return `${theme.fg('success', '✓')} Retrieved memory${idStr}${moreStr} ${theme.fg('muted', `(${expandHint})`)}`;
    }
    case 'memory_context': {
      const count = details?.count ?? 0;
      return `${theme.fg('success', '✓')} Context loaded (${count} items) ${theme.fg('muted', `(${expandHint})`)}`;
    }
    case 'memory_delete': {
      const idStr = details?.id ? ` #${details.id}` : '';
      return `${theme.fg('success', '✓')} Deleted memory${idStr} ${theme.fg('muted', `(${expandHint})`)}`;
    }
    case 'memory_restore': {
      const idStr = details?.id ? ` #${details.id}` : '';
      return `${theme.fg('success', '✓')} Restored memory${idStr} (reindex pending) ${theme.fg('muted', `(${expandHint})`)}`;
    }
    case 'memory_deleted_list': {
      const count = details?.count ?? 0;
      return `${theme.fg('success', '✓')} Found ${count} deleted record(s) ${theme.fg('muted', `(${expandHint})`)}`;
    }
    case 'memory_entity': {
      const idStr = details?.id ? ` id:${details.id}` : '';
      return `${theme.fg('success', '✓')} Entity operation completed${idStr} ${theme.fg('muted', `(${expandHint})`)}`;
    }
    case 'memory_relation': {
      const idStr = details?.id ? ` id:${details.id}` : '';
      return `${theme.fg('success', '✓')} Relation operation completed${idStr} ${theme.fg('muted', `(${expandHint})`)}`;
    }
    default:
      return `${theme.fg('success', '✓')} Completed ${theme.fg('muted', `(${expandHint})`)}`;
  }
}

export function createToolRenderers(toolName: string) {
  return {
    renderShell: 'default' as const,

    renderCall(args: any, theme: any, _context?: any) {
      const text = formatCallSummary(toolName, args, theme);
      return new Text(text, 0, 0);
    },

    renderResult(
      result: { content: Array<{ type: string; text?: string }>; details?: any },
      { expanded, isPartial }: { expanded: boolean; isPartial: boolean },
      theme: any,
      context?: any,
    ) {
      if (isPartial) {
        return new Text(theme.fg('muted', 'Executing memory operation...'), 0, 0);
      }

      if (context?.isError) {
        const errorMsg = result?.details?.error ?? result?.content?.[0]?.text ?? 'Operation failed';
        if (!expanded) {
          const expandHint = keyHint('app.tools.expand', 'to expand');
          return new Text(
            `${theme.fg('error', '✗')} ${theme.fg('error', errorMsg)} ${theme.fg('muted', `(${expandHint})`)}`,
            0,
            0,
          );
        }
        return new Text(theme.fg('error', `Error details:\n${errorMsg}`), 0, 0);
      }

      if (!expanded) {
        const collapsedLine = formatCollapsedResult(toolName, result, theme);
        return new Text(collapsedLine, 0, 0);
      }

      // Expanded: display all content returned in current page plus metadata
      const textOutput = result?.content
        ?.filter((c) => c.type === 'text' && c.text)
        ?.map((c) => c.text!)
        ?.join('\n') ?? '';

      if (!textOutput || textOutput.trim().length === 0) {
        return new Text(theme.fg('muted', '(No content)'), 0, 0);
      }

      let expandedText = textOutput;
      if (result?.details?.has_more) {
        expandedText += `\n\n${theme.fg('muted', `... (More data available. Use cursor: "${result.details.next_cursor}")`)}`;
      }

      return new Text(expandedText, 0, 0);
    },
  };
}
