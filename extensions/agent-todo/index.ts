import { randomUUID } from 'node:crypto';

import { createAgentTodoProvider, cleanupAgentTodoProvider, publishAgentTodoProvider } from './src/provider.js';
import { reconstructAgentTodoProjection } from './src/session.js';
import { registerAgentTodoTool } from './src/tools.js';
import { syncAgentTodoWidget } from './src/widget.js';

export default function agentTodoExtension(pi: any): void {
  const runtime: {
    projection: { active_todo: any; current_todo: any };
    deps: {
      now: () => string;
      idGenerator: (kind: 'todo' | 'step', index: number) => string;
    };
    provider?: any;
    widgetCollapsed: boolean;
  } = {
    projection: { active_todo: null, current_todo: null },
    deps: {
      now: () => new Date().toISOString(),
      idGenerator: (kind: 'todo' | 'step', index: number) => kind === 'step'
        ? `${index + 1}`
        : `todo-${randomUUID()}`,
    },
    widgetCollapsed: true,
  };
  runtime.provider = createAgentTodoProvider(() => runtime.projection);

  publishAgentTodoProvider(runtime.provider, { pi });
  registerAgentTodoTool(pi, runtime);

  const rebuild = (ctx: any) => {
    runtime.projection = reconstructAgentTodoProjection(ctx?.sessionManager?.getBranch?.() ?? []);
    publishAgentTodoProvider(runtime.provider, { pi, ctx });
    syncAgentTodoWidget(ctx, runtime.projection, { collapsed: runtime.widgetCollapsed, shortcut: 'ctrl+space' });
  };

  pi.on?.('session_start', async (_event: unknown, ctx: any) => {
    rebuild(ctx);
  });

  pi.on?.('session_tree', async (_event: unknown, ctx: any) => {
    rebuild(ctx);
  });

  pi.registerShortcut?.('ctrl+space', {
    description: 'Toggle compact Agent Todo widget above the editor',
    handler: async (ctx: any) => {
      runtime.widgetCollapsed = !runtime.widgetCollapsed;
      syncAgentTodoWidget(ctx, runtime.projection, { collapsed: runtime.widgetCollapsed, shortcut: 'ctrl+space' });
      ctx?.ui?.notify?.(`Agent Todo widget ${runtime.widgetCollapsed ? 'collapsed' : 'expanded'}.`, 'info');
    },
  });

  pi.on?.('session_shutdown', async (_event: unknown, ctx: any) => {
    syncAgentTodoWidget(ctx, { active_todo: null, current_todo: null });
    cleanupAgentTodoProvider(runtime.provider, { pi, ctx });
  });
}
