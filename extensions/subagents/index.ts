import { SubagentManager } from './src/manager.js';
import { registerSubagentTools } from './src/tools.js';
import { runSubagentModelsCommand } from './src/model-profiles-ui.js';
import { SubagentsHistoryPanel } from './src/ui.js';

function matchesKey(data: string, key: string): boolean {
  const keys: Record<string, string[]> = {
    escape: ['\u001b'],
    'ctrl+c': ['\u0003'],
    'ctrl+o': ['\u000f'],
    q: ['q', 'Q'],
    up: ['\u001b[A'],
    down: ['\u001b[B'],
    right: ['\u001b[C'],
    left: ['\u001b[D'],
    pageUp: ['\u001b[5~'],
    pageDown: ['\u001b[6~'],
    home: ['\u001b[H', '\u001b[1~', '\u001bOH'],
    end: ['\u001b[F', '\u001b[4~', '\u001bOF'],
  };
  return keys[key]?.includes(data) ?? data === key;
}

export function createSubagentsPanelKeyMatcher(keybindings?: { matches?: (data: string, keybinding: string) => boolean }) {
  return (data: string, key: string): boolean => {
    if (key === 'ctrl+o' && keybindings?.matches?.(data, 'app.tools.expand')) return true;
    return matchesKey(data, key);
  };
}

function visibleWidth(text: string): number {
  return [...text.replace(/\u001b\][^\u001b\u0007]*(?:\u001b\\|\u0007)|\u001b\[[0-?]*[ -/]*[@-~]/g, '')].length;
}

function truncateToWidth(text: string, width: number): string {
  const chars = [...text];
  return chars.length > width ? chars.slice(0, Math.max(0, width - 1)).join('') + '…' : text;
}

function currentSessionId(ctx: any): string | undefined {
  const direct = ctx?.sessionManager?.getSessionId?.() ?? ctx?.sessionId;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const file = ctx?.sessionManager?.getSessionFile?.();
  return typeof file === 'string' && file.length > 0 ? file : undefined;
}

function setMouseTracking(tui: any, enabled: boolean): void {
  const write = tui?.terminal?.write?.bind(tui.terminal);
  if (typeof write !== 'function') return;
  write(enabled ? '\u001b[?1000h\u001b[?1006h' : '\u001b[?1006l\u001b[?1000l');
}

function toolFromRegistry(registry: any, name: string): unknown {
  if (!registry) return undefined;
  if (typeof registry.get === 'function') return registry.get(name);
  if (Array.isArray(registry)) return registry.find((tool) => tool?.name === name);
  if (typeof registry === 'object') return registry[name];
  return undefined;
}

export function resolveRegisteredToolDefinition(ctx: any, pi: any, name: string): unknown {
  return ctx?.pi?.getToolDefinition?.(name)
    ?? pi?.getToolDefinition?.(name)
    ?? ctx?.getToolDefinition?.(name)
    ?? toolFromRegistry(ctx?.pi?.tools, name)
    ?? toolFromRegistry(pi?.tools, name)
    ?? toolFromRegistry(ctx?.tools, name);
}

function completionMessage(task: any): string {
  const result = task.result ?? task.error ?? task.output_preview ?? '(no result captured)';
  return [
    `Subagent ${task.agent} ${task.status}: ${task.id}`,
    '',
    'Read only this final response from the subagent. Do not reread the full execution transcript unless the user explicitly asks for debugging details.',
    '',
    '## response sent to the orchestrator',
    '',
    result,
  ].join('\n');
}

export default function subagentsExtension(pi: any): void {
  const manager = new SubagentManager(undefined, undefined, (task) => {
    pi.sendMessage?.({
      customType: 'subagent-completion',
      content: completionMessage(task),
      display: true,
      details: {
        task_id: task.id,
        agent: task.agent,
        status: task.status,
        result: task.result,
        error: task.error,
      },
    }, {
      triggerTurn: true,
      deliverAs: 'followUp',
    });
  });
  registerSubagentTools(pi, manager);

  async function showSubagentsPanel(ctx: any) {
    const cwd = ctx?.cwd ?? process.cwd();
    const sessionId = currentSessionId(ctx);
    let refresh: NodeJS.Timeout | undefined;
    await ctx.ui.custom(
      (tui: any, theme: any, _keybindings: any, done: () => void) => {
        setMouseTracking(tui, true);
        const close = () => {
          if (refresh) clearInterval(refresh);
          setMouseTracking(tui, false);
          done();
        };
        const panel = new SubagentsHistoryPanel(
          () => manager.listSessionTasks(cwd, sessionId).slice(0, 100),
          theme,
          close,
          createSubagentsPanelKeyMatcher(_keybindings),
          visibleWidth,
          truncateToWidth,
          {
            theme,
            tui,
            cwd,
            visibleWidth,
            truncateToWidth,
            getToolDefinition: (name: string) => resolveRegisteredToolDefinition(ctx, pi, name),
            getMessageRenderer: (customType: string) => ctx?.pi?.getMessageRenderer?.(customType) ?? ctx?.pi?.customMessageRenderers?.get?.(customType) ?? ctx?.customMessageRenderers?.get?.(customType),
            showImages: ctx?.showImages,
            imageWidthCells: ctx?.imageWidthCells,
          },
          () => Math.max(12, process.stdout.rows || 42),
          (id: string) => manager.getTask(id, cwd),
        );
        refresh = setInterval(() => tui.requestRender?.(), 1000);
        return {
          render: (width: number) => panel.render(width),
          invalidate: () => panel.invalidate(),
          handleInput: (data: string) => { panel.handleInput(data); tui.requestRender?.(); },
        };
      },
      undefined,
    );
  }

  pi.registerShortcut?.('ctrl+x', {
    description: 'Show subagent history panel',
    handler: showSubagentsPanel,
  });

  pi.registerCommand?.('subagents', {
    description: 'Show subagent history panel',
    handler: async (_args: string, ctx: any) => showSubagentsPanel({ ...ctx, pi }),
  });

  pi.registerCommand?.('subagent-models', {
    description: 'Configure subagent and SDD phase model profiles',
    handler: async (_args: string, ctx: any) => runSubagentModelsCommand({ ...ctx, pi }),
  });

}
