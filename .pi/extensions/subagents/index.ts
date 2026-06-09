import { SubagentManager } from './src/manager.js';
import { registerSubagentTools } from './src/tools.js';
import { SubagentsHistoryPanel } from './src/ui.js';

function matchesKey(data: string, key: string): boolean {
  const keys: Record<string, string[]> = {
    escape: ['\u001b'],
    'ctrl+c': ['\u0003'],
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

function visibleWidth(text: string): number {
  return [...text.replace(/\u001b\[[0-9;]*m/g, '')].length;
}

function truncateToWidth(text: string, width: number): string {
  const chars = [...text];
  return chars.length > width ? chars.slice(0, Math.max(0, width - 1)).join('') + '…' : text;
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
    let refresh: NodeJS.Timeout | undefined;
    await ctx.ui.custom(
      (tui: any, theme: any, _keybindings: any, done: () => void) => {
        const close = () => {
          if (refresh) clearInterval(refresh);
          done();
        };
        const panel = new SubagentsHistoryPanel(
          () => manager.listSessionTasks(cwd).slice(0, 100),
          theme,
          close,
          matchesKey,
          visibleWidth,
          truncateToWidth,
        );
        refresh = setInterval(() => tui.requestRender?.(), 1000);
        return {
          render: (width: number) => panel.render(width),
          invalidate: () => panel.invalidate(),
          handleInput: (data: string) => { panel.handleInput(data); tui.requestRender?.(); },
        };
      },
      {
        overlay: true,
        overlayOptions: {
          width: '100%',
          minWidth: 40,
          maxHeight: '100%',
          anchor: 'center',
          margin: 0,
        },
      },
    );
  }

  pi.registerShortcut?.('ctrl+x', {
    description: 'Show subagent history panel',
    handler: showSubagentsPanel,
  });

  pi.registerCommand?.('subagents', {
    description: 'Show subagent history panel',
    handler: async (_args: string, ctx: any) => showSubagentsPanel(ctx),
  });

}
