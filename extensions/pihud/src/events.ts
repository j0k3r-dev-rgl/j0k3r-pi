import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createLiveWriter, summarizeArgs, type LiveState } from "./live.ts";
import { readMetrics, parseTokenSpeed } from "./metrics.ts";
import { readPanels, type Panels } from './panels.ts';

export function registerLiveEvents(pi: ExtensionAPI, options: { pane: string; socket: string }) {
  const live = createLiveWriter(options);
  let state: LiveState = "idle";
  let warned = false;
  let context: ExtensionContext | undefined;
  let tps: number | null = null;
  let hasPiSpeed = false;
  let last = { kind: "state", label: "listo", detail: "" };
  let lastStreamWrite = 0;
  let streamTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> = Promise.resolve();
  let panels: Panels | undefined;
  let panelTimer: ReturnType<typeof setInterval> | undefined;

  function updatePanels(ctx: ExtensionContext) {
    panels = readPanels(pi, ctx);
    return publish(ctx, last.kind, last.label, last.detail);
  }
  const unsubscribeSpeed = pi.events.on("j0k3r-theme:token-speed", (status) => {
    hasPiSpeed = true;
    tps = parseTokenSpeed(status);
    if (context) void streamUpdate(context);
  });

  async function publish(ctx: ExtensionContext, kind: string, label: string, detail = "", next?: LiveState) {
    if (ctx.mode !== "tui") return;
    if (streamTimer) clearTimeout(streamTimer);
    streamTimer = undefined;
    context = ctx;
    state = next ?? state;
    last = { kind, label, detail };
    try {
      pending = live.push(kind, label, detail, state, {
        sessionPath: ctx.sessionManager.getSessionFile() ?? "",
        sessionId: ctx.sessionManager.getSessionId?.() ?? '',
        panels,
        cwd: ctx.cwd,
        model: ctx.model?.id ?? "",
        provider: ctx.model?.provider ?? "",
        thinking: ctx.thinkingLevel,
        ...readMetrics(ctx),
        ...(hasPiSpeed ? { tps, tpsSource: "pi" as const } : {}),
      });
      await pending;
    } catch (error) {
      if (warned) return;
      warned = true;
      ctx.ui.notify(`HUD: no pude publicar el estado (${error instanceof Error ? error.message : String(error)})`, "warning");
    }
  }

  function streamUpdate(ctx: ExtensionContext) {
    const remaining = 100 - (Date.now() - lastStreamWrite);
    if (remaining <= 0) {
      lastStreamWrite = Date.now();
      return publish(ctx, last.kind, last.label, last.detail);
    }
    // Retain a trailing update even when no more stream events arrive.
    if (!streamTimer) {
      streamTimer = setTimeout(() => {
        streamTimer = undefined;
        lastStreamWrite = Date.now();
        void publish(ctx, last.kind, last.label, last.detail);
      }, remaining);
      streamTimer.unref?.();
    }
  }

  pi.on("session_start", (_event, ctx) => {
    if (panelTimer) clearInterval(panelTimer);
    panels = undefined;
    if (ctx.mode === 'tui') {
      panelTimer = setInterval(() => { void updatePanels(ctx); }, 700);
      panelTimer.unref?.();
    }
    return publish(ctx, "state", "listo", "", ctx.isIdle() ? "idle" : "working");
  });
  pi.on("agent_start", (_event, ctx) => publish(ctx, "state", "trabajando", "", "working"));
  pi.on("turn_start", (event, ctx) => publish(ctx, "turn", `turno ${event.turnIndex + 1}`, "", "working"));
  pi.on("tool_execution_start", (event, ctx) => publish(ctx, "tool", event.toolName, summarizeArgs(event.toolName, event.args), "working"));
  pi.on("tool_execution_end", (event, ctx) => publish(ctx, "tool", event.toolName, event.isError ? "error" : "ok", "working"));
  pi.on("message_update", (_event, ctx) => streamUpdate(ctx));
  pi.on("turn_end", (_event, ctx) => publish(ctx, last.kind, last.label, last.detail));
  pi.on("message_end", (event, ctx) => {
    const message = event.message as { role?: string; content?: unknown };
    if (message.role !== "assistant") return;
    const content = Array.isArray(message.content) ? message.content : [];
    const text = content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join(" ");
    return publish(ctx, "message", "respuesta", text);
  });
  pi.on("model_select", (event, ctx) => {
    if (panels) panels = { ...panels, main: { lines: [] } };
    return publish(ctx, "model", `${event.model.provider}/${event.model.id}`);
  });
  pi.on("thinking_level_select", (event, ctx) => publish(ctx, "thinking", event.level));
  pi.on("ui_prompt_start", (event, ctx) => publish(ctx, "prompt", event.title ?? event.kind, "", "waiting"));
  pi.on("ui_prompt_end", (_event, ctx) => publish(ctx, "state", ctx.isIdle() ? "listo" : "trabajando", "", ctx.isIdle() ? "idle" : "working"));
  pi.on("agent_settled", (_event, ctx) => publish(ctx, "state", "listo", "", "idle"));
  pi.on("session_tree", (_event, ctx) => {
    // Agent Todo reconstructs the new branch in its own lifecycle handler.
    // Do not publish the previous branch's checklist while awaiting the next read.
    if (panels) panels = { ...panels, todo: { lines: [] } };
    return publish(ctx, "state", "sesión actualizada");
  });
  pi.on("session_compact", (_event, ctx) => publish(ctx, "state", "contexto compactado"));
  return {
    async flush() {
      if (panelTimer) clearInterval(panelTimer);
      panelTimer = undefined;
      panels = undefined;
      unsubscribeSpeed();
      if (streamTimer) {
        clearTimeout(streamTimer);
        streamTimer = undefined;
        if (context) await publish(context, last.kind, last.label, last.detail);
      }
      context = undefined;
      await pending.catch(() => undefined);
      await live.flush();
    },
  };
}
