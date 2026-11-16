import { afterEach, describe, expect, it, vi } from 'vitest';

import agentTodoExtension from '../index.js';
import { EventEmitter } from 'node:events';

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__PI_AGENT_TODO_PROVIDER__;
});

function createHarness() {
  const tools: any[] = [];
  const commands: Array<{ name: string; def: any }> = [];
  const handlers = new Map<string, Function>();
  const shortcuts: Array<{ key: string; def: any }> = [];
  const events = new EventEmitter();
  const pi: any = {
    events: {
      on(name: string, handler: (...args: any[]) => void) { events.on(name, handler); return () => events.off(name, handler); },
      emit: events.emit.bind(events),
    },
    registerTool: (tool: any) => tools.push(tool),
    registerCommand: (name: string, def: any) => commands.push({ name, def }),
    registerShortcut: (key: string, def: any) => shortcuts.push({ key, def }),
    on: (event: string, handler: Function) => handlers.set(event, handler),
  };
  agentTodoExtension(pi);
  return { pi, tools, commands, handlers, shortcuts, events };
}

describe('agentTodoExtension', () => {
  it('serves only the trusted current-session active title/steps and cleans up its bridge', async () => {
    const { events, tools, handlers } = createHarness();
    const ctx: any = {
      mode: 'tui', cwd: '/repo', isProjectTrusted: () => true,
      sessionManager: { getSessionId: () => 'one', getBranch: () => [] },
      ui: { setWidget: vi.fn() },
    };
    const read = (overrides = {}) => {
      const respond = vi.fn();
      events.emit('pihud:todo:read:v1', { cwd: '/repo', sessionId: 'one', respond, ...overrides });
      return respond;
    };
    await handlers.get('session_start')?.({}, ctx);
    expect(read()).toHaveBeenCalledWith({ lines: [] });
    await tools[0].execute('1', { action: 'create', title: 'Ship', body: 'PRIVATE BODY', steps: ['Tests', 'Code'] }, undefined, undefined, ctx);
    const reply = read();
    expect(reply).toHaveBeenCalledWith({ lines: [], todo: { title: 'Ship', steps: [{ text: 'Tests', status: 'open' }, { text: 'Code', status: 'open' }] } });
    expect(JSON.stringify(reply.mock.calls)).not.toContain('PRIVATE BODY');
    expect(read({ sessionId: 'other' })).not.toHaveBeenCalled();
    expect(read({ cwd: '/other' })).not.toHaveBeenCalled();
    ctx.isProjectTrusted = () => false;
    expect(read()).not.toHaveBeenCalled();
    ctx.isProjectTrusted = () => true;
    ctx.mode = 'rpc';
    expect(read()).not.toHaveBeenCalled();
    ctx.mode = 'tui';
    await tools[0].execute('2', { action: 'complete_all' }, undefined, undefined, ctx);
    expect(read()).toHaveBeenCalledWith({ lines: [] });
    await handlers.get('session_shutdown')?.({}, ctx);
    expect(events.listenerCount('pihud:todo:read:v1')).toBe(0);
    expect(events.listenerCount('pihud:presence:v1')).toBe(0);
  });

  it('hides on owned HUD presence through tool updates and restores the original collapse state', async () => {
    const { events, tools, handlers, shortcuts } = createHarness();
    const setWidget = vi.fn();
    const ctx: any = {
      mode: 'tui', cwd: '/repo', isProjectTrusted: () => true,
      sessionManager: { getSessionId: () => 'one', getBranch: () => [] },
      ui: { setWidget, notify: vi.fn() },
    };
    const presence = (visible: boolean, sessionId = 'one', cwd = '/repo') => events.emit('pihud:presence:v1', { cwd, sessionId, visible });
    await handlers.get('session_start')?.({}, ctx);
    await tools[0].execute('1', { action: 'create', title: 'Ship', steps: ['Tests', 'Code'] }, undefined, undefined, ctx);
    await shortcuts[0].def.handler(ctx);
    expect(setWidget.mock.calls.at(-1)?.[1].join('\n')).toContain('Tests');
    presence(true, 'other');
    presence(true, 'one', '/other');
    expect(setWidget.mock.calls.at(-1)?.[1]).toBeDefined();
    presence(true);
    expect(setWidget).toHaveBeenLastCalledWith('agent-todo', undefined);
    await tools[0].execute('2', { action: 'complete_step', step_id: '1' }, undefined, undefined, ctx);
    expect(setWidget).toHaveBeenLastCalledWith('agent-todo', undefined);
    await shortcuts[0].def.handler(ctx);
    expect(setWidget).toHaveBeenLastCalledWith('agent-todo', undefined);
    presence(false);
    expect(setWidget.mock.calls.at(-1)?.[1].join('\n')).toContain('ctrl+space to collapse');
    expect(setWidget.mock.calls.at(-1)?.[1].join('\n')).toContain('1/2');
    await shortcuts[0].def.handler(ctx);
    presence(true);
    presence(false);
    expect(setWidget.mock.calls.at(-1)?.[1].join('\n')).toContain('ctrl+space to expand');
    presence(true);
    ctx.sessionManager.getSessionId = () => 'two';
    await handlers.get('session_tree')?.({}, ctx);
    await tools[0].execute('3', { action: 'create', title: 'New branch' }, undefined, undefined, ctx);
    expect(setWidget.mock.calls.at(-1)?.[1]).toBeDefined();
    presence(true);
    expect(setWidget.mock.calls.at(-1)?.[1]).toBeDefined();
  });

  it('queries existing HUD presence on bind, without accepting delayed replies or untrusted presence', async () => {
    const { events, tools, handlers } = createHarness();
    let delayed: any;
    events.on('pihud:presence:read:v1', query => { delayed = query; query.respond(true); });
    const setWidget = vi.fn();
    const ctx: any = { mode: 'tui', cwd: '/repo', isProjectTrusted: () => true,
      sessionManager: { getSessionId: () => 'one', getBranch: () => [] }, ui: { setWidget } };
    await handlers.get('session_start')?.({}, ctx);
    await tools[0].execute('1', { action: 'create', title: 'Ship' }, undefined, undefined, ctx);
    expect(setWidget).toHaveBeenLastCalledWith('agent-todo', undefined);
    events.emit('pihud:presence:v1', { cwd: '/repo', sessionId: 'one', visible: false });
    delayed.respond(true);
    expect(setWidget.mock.calls.at(-1)?.[1]).toBeDefined();
    ctx.isProjectTrusted = () => false;
    events.emit('pihud:presence:v1', { cwd: '/repo', sessionId: 'one', visible: true });
    expect(setWidget.mock.calls.at(-1)?.[1]).toBeDefined();
  });

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
    expect(setWidget).toHaveBeenCalledWith('agent-todo', expect.arrayContaining([
      expect.stringContaining('0/1'),
      expect.stringContaining('complete'),
      expect.stringContaining('ctrl+space to expand'),
    ]));
    expect(setWidget.mock.calls.at(-1)?.[1]).toEqual(expect.not.arrayContaining(['[ ] 1. Write tests']));
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
    expect(setWidget).toHaveBeenLastCalledWith('agent-todo', expect.not.arrayContaining(['[ ] 1. Write tests']));
    expect(setWidget.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining([expect.stringContaining('ctrl+space to expand')]));

    await shortcuts[0].def.handler(ctx);
    expect(setWidget).toHaveBeenLastCalledWith('agent-todo', expect.arrayContaining([expect.stringContaining('Write tests')]));
    expect(setWidget.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining([expect.stringContaining('ctrl+space to collapse')]));
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
    expect(setWidget).toHaveBeenCalledWith('agent-todo', expect.arrayContaining([
      expect.stringContaining('0/2'),
      expect.stringContaining('complete'),
      expect.stringContaining('ctrl+space to expand'),
    ]));
  });
});
