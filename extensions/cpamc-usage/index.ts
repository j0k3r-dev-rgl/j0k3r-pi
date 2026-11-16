import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fetchUsage, renderTextReport } from "./src/api.ts";
import { createUsageCache } from "./src/cache.ts";
import { quotaHudAccounts } from './src/hud.ts';
import { UsageModal } from "./src/modal.ts";

/**
 * `/usage` — CLIProxyAPI subscriptions and quota limits for the human operator.
 *
 * The data is rendered through the UI only (floating overlay in TUI mode, a
 * notification otherwise). It is never injected into the session, so the model
 * never sees account emails, plans or quotas.
 */

export default function cpamcUsage(pi: ExtensionAPI) {
    const cache = createUsageCache(fetchUsage);
    let open = false;
    let context: any;
    pi.on('session_start', (_event, ctx) => {
        context = ctx;
        if (ctx.mode === 'tui') cache.start();
    });
    const unsubscribe = pi.events.on('pihud:quota:read:v1', (request: any) => {
        if (!context || context.mode !== 'tui' || !context.isProjectTrusted?.() || !request || request.cwd !== context.cwd ||
            request.sessionId !== context.sessionManager.getSessionId() || typeof request.respond !== 'function') return;
        const snapshot = cache.snapshot();
        request.respond({
            lines: [],
            accounts: snapshot.groups ? quotaHudAccounts(snapshot.groups) : [],
            updatedAt: snapshot.updatedAt,
            error: snapshot.error,
        });
    });
    pi.on('session_shutdown', () => { cache.stop(); context = undefined; unsubscribe(); });
    pi.registerCommand("usage", {
        description: "Show CLIProxyAPI subscriptions and quota limits in a floating panel (user-only: never sent to the model)",
        handler: async (args, ctx) => {
            const wantsText = (args ?? "").trim().toLowerCase().includes("--text");

            if (wantsText || !ctx.hasUI || ctx.mode !== "tui") {
                try {
                    const groups = await cache.load(false, ctx.signal);
                    if (ctx.hasUI) ctx.ui.notify(renderTextReport(groups), "info");
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    if (ctx.hasUI) ctx.ui.notify(`/usage failed: ${message}`, "error");
                    throw error;
                }
                return;
            }

            // Never stack panels: a second /usage while one is open is a no-op.
            if (open) {
                ctx.ui.notify("/usage ya está abierto", "info");
                return;
            }
            open = true;

            let modal: UsageModal | null = null;
            try {
                await ctx.ui.custom(
                    (tui, theme, _keybindings, done) => {
                        modal = new UsageModal({
                            theme: theme as never,
                            tui,
                            done,
                            load: (force) => cache.load(force, ctx.signal),
                        });
                        return modal as never;
                    },
                    {
                        overlay: true,
                        overlayOptions: {
                            width: "80%",
                            minWidth: 60,
                            maxHeight: "80%",
                            anchor: "center",
                        },
                        onHandle: (handle: { focus?: () => void }) => handle?.focus?.(),
                    } as never,
                );
            } finally {
                open = false;
                modal?.dispose();
            }
        },
    });
}
