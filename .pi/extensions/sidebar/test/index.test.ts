import { describe, expect, it, vi } from 'vitest';

import sidebarExtension from '../index.js';

function createHarness() {
  const registered: Record<string, any> = {};
  const handlers: Record<string, Array<(event: unknown, ctx: any) => unknown>> = {};
  const hide = vi.fn();
  const requestRender = vi.fn();
  const setHidden = vi.fn();
  const handle = { hide, setHidden };
  const components: any[] = [];
  const options: any[] = [];
  const custom = vi.fn((factory: any, customOptions: any) => {
    options.push(customOptions);
    const done = vi.fn();
    components.push(factory({ requestRender }, { fg: (_token: string, text: string) => text, bold: (text: string) => text }, {}, done));
    customOptions?.onHandle?.(handle);
    return new Promise<void>(() => undefined);
  });
  const pi = {
    registerCommand: vi.fn((name: string, def: any) => { registered[name] = def; }),
    on: vi.fn((event: string, handler: (event: unknown, ctx: any) => unknown) => {
      handlers[event] = [...(handlers[event] ?? []), handler];
    }),
  };
  const ctx = { hasUI: true, cwd: '/workspace/from-ctx', ui: { custom }, sessionManager: { getSessionId: () => 'session-123' } };
  sidebarExtension(pi);
  return { pi, registered, handlers, ctx, custom, hide, requestRender, handle, setHidden, components, options };
}

describe('sidebarExtension', () => {
  it('registers the /sidebar command and fails closed without ui support', async () => {
    const { pi, registered } = createHarness();
    expect(pi.registerCommand).toHaveBeenCalledWith('sidebar', expect.objectContaining({ description: expect.any(String), handler: expect.any(Function) }));

    await expect(registered.sidebar.handler('', {})).resolves.toBeUndefined();
    await expect(registered.sidebar.handler('', { ui: {} })).resolves.toBeUndefined();
  });

  it('opens a pi-hud-like non-capturing right overlay and returns promptly', async () => {
    const { registered, ctx, custom, options } = createHarness();

    const result = await Promise.race([
      registered.sidebar.handler('', ctx).then(() => 'resolved' as const),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 0)),
    ]);

    expect(result).toBe('resolved');
    expect(custom).toHaveBeenCalledTimes(1);
    expect(options[0]).toMatchObject({
      overlay: true,
      overlayOptions: expect.objectContaining({
        anchor: 'top-right',
        width: expect.any(Number),
        maxHeight: '100%',
        nonCapturing: true,
        margin: { top: 1, right: 1, bottom: 1 },
        visible: expect.any(Function),
      }),
    });
    expect(options[0].overlayOptions.visible(89, 40)).toBe(false);
    expect(options[0].overlayOptions.visible(90, 40)).toBe(true);
  });

  it('toggles the retained sidebar handle instead of opening duplicates', async () => {
    const { registered, ctx, custom, setHidden } = createHarness();

    await registered.sidebar.handler('', ctx);
    await registered.sidebar.handler('', ctx);

    expect(custom).toHaveBeenCalledTimes(1);
    expect(setHidden).toHaveBeenCalledTimes(1);
    expect(setHidden).toHaveBeenCalledWith(true);
  });

  it('auto-opens on session_start when ui is available', async () => {
    const { handlers, ctx, custom } = createHarness();

    await handlers.session_start[0]?.({ reason: 'start' }, ctx);

    expect(custom).toHaveBeenCalledTimes(1);
  });

  it('keeps normal typing non-closing but closes on q/escape when focused', async () => {
    const { registered, ctx, components, setHidden } = createHarness();

    await registered.sidebar.handler('', ctx);
    components[0].handleInput('a');
    expect(setHidden).not.toHaveBeenCalled();

    components[0].handleInput('q');
    expect(setHidden).toHaveBeenCalledTimes(1);
    expect(setHidden).toHaveBeenCalledWith(true);
  });

  it('requests renders through the TUI object like pi-hud, not through the overlay handle', async () => {
    const { registered, ctx, components, requestRender } = createHarness();

    await registered.sidebar.handler('', ctx);
    components[0].render(42);
    components[0].invalidate();

    expect(requestRender).toHaveBeenCalled();
  });
});
