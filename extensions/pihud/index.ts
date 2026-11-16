import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createController } from "./src/controller.ts";
import { createFocusGuard } from "./src/guard.ts";
import { registerLiveEvents } from "./src/events.ts";

const ACTIONS = ["open", "close"];

function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function pihud(pi: ExtensionAPI) {
  const pane = (process.env.HERDR_PANE_ID ?? "").trim();
  const socket = (process.env.HERDR_SOCKET_PATH ?? "").trim();
  if (process.env.HERDR_ENV !== "1" || !pane || !socket) return;

  const bin = (process.env.PIHUD_BIN ?? "").trim() || join(homedir(), ".local", "bin", "j0k3r-pi-hud");
  const autoOpen = process.env.PIHUD_AUTO === "1";
  const ratio = process.env.PIHUD_RATIO;

  const exec = async (args: string[], signal?: AbortSignal) => {
    const result = await pi.exec("herdr", args, { signal, timeout: 8000 });
    if (result.code !== 0) {
      const detail = `${result.stderr}\n${result.stdout}`.trim();
      throw new Error(detail || `herdr ${args.slice(0, 2).join(" ")} falló`);
    }
    const text = result.stdout.trim();
    if (text.length === 0) return {};
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  };

  const controller = createController({ pane, socket, bin, ratio, exec });
  const live = registerLiveEvents(pi, { pane, socket });
  let context: ExtensionContext | undefined;
  let guard: ReturnType<typeof createFocusGuard> | undefined;
  let guardPane = "";
  let warned = false;
  let visible = false;
  let presenceTimer: ReturnType<typeof setInterval> | undefined;
  let checkingPresence = false;
  function publishPresence(value: boolean) {
    visible = value;
    if (!context) return;
    pi.events.emit('pihud:presence:v1', { cwd: context.cwd, sessionId: context.sessionManager.getSessionId?.() ?? '', visible });
  }
  const offPresence = pi.events.on('pihud:presence:read:v1', (query: any) => {
    if (context && query?.cwd === context.cwd && query.sessionId === context.sessionManager.getSessionId?.() && typeof query.respond === 'function') query.respond(visible);
  });

  function notify(message: string, kind: "info" | "warning" | "error" = "info") {
    context?.ui.notify(message, kind);
  }

  function watch(hudPane: string) {
    if (guard && guardPane === hudPane) {
      publishPresence(true);
      return;
    }
    guard?.stop();
    guardPane = hudPane;
    warned = false;
    guard = createFocusGuard({
      piPane: pane,
      hudPane,
      socket,
      onError: (error) => {
        if (warned) return;
        warned = true;
        notify(`HUD: no pude devolver el foco a Pi (${failure(error)})`, "warning");
      },
    });
    guard.start();
    publishPresence(true);
    if (!presenceTimer) {
      presenceTimer = setInterval(async () => {
        if (checkingPresence) return;
        checkingPresence = true;
        try {
          if (!await controller.isOpen()) { unwatch(); publishPresence(false); }
        } catch { /* Transient transport failures do not prove the HUD closed. */ }
        finally { checkingPresence = false; }
      }, 2000);
      presenceTimer.unref?.();
    }
  }

  function unwatch() {
    if (presenceTimer) clearInterval(presenceTimer);
    presenceTimer = undefined;
    guard?.stop();
    guard = undefined;
    guardPane = "";
  }

  async function open(cwd: string): Promise<string> {
    const result = await controller.open(cwd);
    const state = await controller.status();
    if (state?.hudPane === "") {
      unwatch();
      publishPresence(false);
      return result;
    }
    if (state?.hudPane) watch(state.hudPane);
    return result;
  }

  pi.registerCommand("hud", {
    description: "Abrir o cerrar el HUD de j0k3r (uso: /hud open | /hud close)",
    getArgumentCompletions: (prefix: string) => {
      const matches = ACTIONS.filter((action) => action.startsWith(prefix));
      return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      context = ctx;
      const action = args.trim().toLowerCase();
      if (action === "" || action === "open") {
        try {
          const result = await open(ctx.cwd);
          notify(result === "opened" ? "HUD abierto · el foco queda en Pi" : "El HUD ya estaba abierto", "info");
        } catch (error) {
          notify(`HUD: ${failure(error)}`, "error");
        }
        return;
      }
      if (action === "close") {
        try {
          const result = await controller.close();
          unwatch();
          publishPresence(false);
          notify(result === "closed" ? "HUD cerrado" : "El HUD ya estaba cerrado", "info");
        } catch (error) {
          notify(`HUD: ${failure(error)}`, "error");
        }
        return;
      }
      notify("Uso: /hud open | /hud close", "warning");
    },
  });

  pi.on("session_start", async (event, ctx) => {
    if (ctx.mode !== "tui") return;
    context = ctx;
    try {
      const state = await controller.status();
      if (state?.hudPane) {
        await open(ctx.cwd);
        return;
      }
      if (!autoOpen) return;
      // A manual close lasts for this Pi runtime, not every future launch.
      if (state?.visible === false && event.reason !== "startup") return;
      await open(ctx.cwd);
    } catch (error) {
      notify(`HUD: ${failure(error)}`, "error");
    }
  });

  pi.on("session_shutdown", async (event) => {
    unwatch();
    publishPresence(false);
    offPresence();
    await live.flush();
    if (event.reason === "quit") await controller.close().catch(() => undefined);
  });
}
