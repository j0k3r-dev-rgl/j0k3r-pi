import { DEFAULT_MIN_TERMINAL_WIDTH, DEFAULT_OVERLAY_WIDTH } from './src/config.js';
import { SidebarController } from './src/controller.js';

function currentSessionId(ctx: any): string | undefined {
  const direct = ctx?.sessionManager?.getSessionId?.() ?? ctx?.sessionId;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const file = ctx?.sessionManager?.getSessionFile?.();
  return typeof file === 'string' && file.length > 0 ? file : undefined;
}

function sidebarContext(ctx: any, pi: any) {
  return {
    cwd: ctx?.sessionManager?.getCwd?.() ?? ctx?.cwd ?? process.cwd(),
    sessionId: currentSessionId(ctx),
    ctx,
    pi,
    now: () => new Date(),
  };
}

function canUseCustomUi(ctx: any): boolean {
  return Boolean(ctx?.ui && typeof ctx.ui.custom === 'function' && ctx?.hasUI !== false);
}

export default function sidebarExtension(pi: any): void {
  let overlayHandle: any = null;
  let controller: SidebarController | null = null;
  let sidebarTui: any = null;
  let opening = false;
  let hidden = false;
  let generation = 0;

  const cleanup = (currentGeneration: number, nextController: SidebarController, handle?: any) => {
    if (currentGeneration !== generation) return;
    opening = false;
    if (controller === nextController) controller = null;
    if (!hidden) nextController.close();
    if (overlayHandle === handle) overlayHandle = null;
    sidebarTui = null;
    hidden = false;
  };

  const hideSidebar = () => {
    if (overlayHandle?.setHidden) {
      overlayHandle.setHidden(true);
      return;
    }
    overlayHandle?.hide?.();
  };

  const showSidebar = (ctx: any) => {
    if (!canUseCustomUi(ctx)) return;
    if (overlayHandle) {
      if (hidden) overlayHandle.setHidden?.(false);
      return;
    }
    if (opening) return;

    const currentGeneration = ++generation;
    opening = true;
    const nextController = new SidebarController({
      context: sidebarContext(ctx, pi),
      requestRender: () => sidebarTui?.requestRender?.(),
    });
    controller = nextController;

    try {
      const overlayPromise = ctx.ui.custom(
        (tui: any, theme: any) => {
          sidebarTui = tui;
          nextController.start();
          return {
            render: (width: number) => nextController.render(width, {
              fg: (token: string, text: string) => theme?.fg?.(token, text) ?? text,
              bold: (text: string) => theme?.bold?.(text) ?? text,
            }),
            invalidate: () => {
              nextController.invalidate();
              sidebarTui?.requestRender?.();
            },
            handleInput: (data: string) => {
              if (data === '\u001b' || data === 'q' || data === 'Q') hideSidebar();
            },
          };
        },
        {
          overlay: true,
          overlayOptions: {
            anchor: 'top-right',
            width: DEFAULT_OVERLAY_WIDTH,
            maxHeight: '100%',
            margin: { top: 1, right: 1, bottom: 1 },
            visible: (termWidth: number) => termWidth >= DEFAULT_MIN_TERMINAL_WIDTH,
            nonCapturing: true,
          },
          onHandle: (handle: any) => {
            if (currentGeneration !== generation) {
              handle?.hide?.();
              return;
            }
            overlayHandle = handle;
            opening = false;
            hidden = false;
            if (typeof handle?.setHidden === 'function' && !handle.__sidebarPatched) {
              const original = handle.setHidden.bind(handle);
              handle.setHidden = (nextHidden: boolean) => {
                hidden = Boolean(nextHidden);
                nextController.setHidden(hidden);
                return original(nextHidden);
              };
              handle.__sidebarPatched = true;
            }
          },
        },
      );

      void Promise.resolve(overlayPromise)
        .catch(() => undefined)
        .finally(() => cleanup(currentGeneration, nextController, overlayHandle));
    } catch {
      cleanup(currentGeneration, nextController);
    }
  };

  const toggleSidebar = (ctx: any) => {
    if (overlayHandle) {
      if (hidden) overlayHandle.setHidden?.(false);
      else hideSidebar();
      return;
    }
    if (!opening) showSidebar(ctx);
  };

  pi.on?.('session_start', (_event: unknown, ctx: any) => {
    if (!overlayHandle && !opening) showSidebar(ctx);
  });

  pi.registerCommand('sidebar', {
    description: 'Toggle the persistent sidebar HUD',
    handler: async (_args: string, ctx: any) => {
      toggleSidebar(ctx);
    },
  });
}
