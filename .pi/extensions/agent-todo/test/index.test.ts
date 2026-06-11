import { afterEach, describe, expect, it, vi } from 'vitest';

import agentTodoExtension from '../index.js';

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__PI_AGENT_TODO_PROVIDER__;
});

function createHarness() {
  const tools: any[] = [];
  const commands: Array<{ name: string; def: any }> = [];
  const handlers = new Map<string, Function>();
  const shortcuts: Array<{ key: string; def: any }> = [];
  const pi: any = {
    registerTool: (tool: any) => tools.push(tool),
    registerCommand: (name: string, def: any) => commands.push({ name, def }),
    registerShortcut: (key: string, def: any) => shortcuts.push({ key, def }),
    on: (event: string, handler: Function) => handlers.set(event, handler),
  };
  agentTodoExtension(pi);
  return { pi, tools, commands, handlers, shortcuts };
}

describe('agentTodoExtension', () => {
  it('registers lifecycle handlers, exposes the provider, and avoids manual commands', async () => {
    const { pi, tools, commands, handlers, shortcuts } = createHarness();

    expect(tools.map((tool) => tool.name)).toEqual(['agent_todo']);
    expect(commands).toEqual([]);
    expect(shortcuts.map((shortcut) => shortcut.key)).toEqual(['ctrl+space']);
    expect(handlers.has('session_start')).toBe(true);
    expect(handlers.has('session_tree')).toBe(true);
    expect(handlers.has('session_shutdown')).toBe(true);
    expect(pi.agentTodo).toBeDefined();
    expect((globalThis as Record<string, unknown>).__PI_AGENT_TODO_PROVIDER__).toBe(pi.agentTodo);

    const setWidget = vi.fn();
    const ctx: any = {
      ui: { setWidget },
      sessionManager: {
        getBranch: () => [
          {
            type: 'message',
            message: {
              role: 'toolResult',
              toolName: 'agent_todo',
              details: {
                agent_todo: {
                  version: 1,
                  action: 'create',
                  ok: true,
                  state: {
                    active_todo: {
                      id: 'todo-1',
                      title: 'Ship feature',
                      status: 'active',
                      steps: [{ id: 'step-1', text: 'Write tests', status: 'open' }],
                      created_at: '2026-06-10T00:00:00.000Z',
                      updated_at: '2026-06-10T00:00:00.000Z',
                    },
                    current_todo: null,
                  },
                },
              },
            },
          },
        ],
      },
    };

    await handlers.get('session_start')?.({}, ctx);
    expect(setWidget).toHaveBeenCalledWith('agent-todo', expect.any(Array));
    expect(ctx.agentTodo).toBe(pi.agentTodo);

    await handlers.get('session_shutdown')?.({}, ctx);
    expect(pi.agentTodo).toBeUndefined();
    expect((globalThis as Record<string, unknown>).__PI_AGENT_TODO_PROVIDER__).toBeUndefined();
  });

  it('toggles only the above-chat widget between expanded and collapsed', async () => {
    const { handlers, shortcuts } = createHarness();
    const setWidget = vi.fn();
    const ctx: any = {
      ui: { setWidget, notify: vi.fn() },
      sessionManager: {
        getBranch: () => [
          {
            type: 'message',
            message: {
              role: 'toolResult',
              toolName: 'agent_todo',
              details: {
                agent_todo: {
                  version: 1,
                  action: 'create',
                  ok: true,
                  state: {
                    active_todo: {
                      id: 'todo-1',
                      title: 'Ship feature',
                      status: 'active',
                      steps: [
                        { id: '1', text: 'Write tests', status: 'open' },
                        { id: '2', text: 'Implement', status: 'open' },
                      ],
                      created_at: '2026-06-10T00:00:00.000Z',
                      updated_at: '2026-06-10T00:00:00.000Z',
                    },
                    current_todo: null,
                  },
                },
              },
            },
          },
        ],
      },
    };

    await handlers.get('session_start')?.({}, ctx);
    expect(setWidget).toHaveBeenLastCalledWith('agent-todo', expect.arrayContaining(['[ ] 1. Write tests']));

    await shortcuts[0].def.handler(ctx);
    expect(setWidget).toHaveBeenLastCalledWith('agent-todo', expect.not.arrayContaining(['[ ] 1. Write tests']));
    expect(setWidget.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining(['\u001b[2mctrl+space to expand\u001b[22m']));
  });

  it('creates runtime numeric step ids while keeping todo ids unique', async () => {
    const { tools } = createHarness();
    const setWidget = vi.fn();

    const result = await tools[0].execute(
      '1',
      { action: 'create', title: 'Ship feature', steps: ['Write tests', 'Implement'] },
      undefined,
      undefined,
      { ui: { setWidget } },
    );

    expect(result.details.agent_todo.state.current_todo?.id).toMatch(/^todo-/);
    expect(result.details.agent_todo.state.current_todo?.steps.map((step: any) => step.id)).toEqual(['1', '2']);
    expect(setWidget).toHaveBeenCalledWith('agent-todo', expect.arrayContaining(['[ ] 1. Write tests', '[ ] 2. Implement']));
  });
});
