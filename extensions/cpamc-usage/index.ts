import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fetchUsage, renderTextReport, type ProviderGroup } from "./src/api.ts";
import { UsageModal } from "./src/modal.ts";

/**
 * `/usage` — CLIProxyAPI subscriptions and quota limits for the human operator.
 *
 * The data is rendered through the UI only (floating overlay in TUI mode, a
 * notification otherwise). It is never injected into the session, so the model
 * never sees account emails, plans or quotas.
 */

type Cache = {
    groups: ProviderGroup[];
    fetchedAt: number;
};

let cache: Cache | null = null;
let open = false;

/** Data is fetched when the modal opens and reused while it stays open. */
async function loadUsage(force: boolean, signal?: AbortSignal): Promise<ProviderGroup[]> {
    if (!force && cache) return cache.groups;
    const groups = await fetchUsage(signal);
    cache = { groups, fetchedAt: Date.now() };
    return groups;
}

export default function cpamcUsage(pi: ExtensionAPI) {
    pi.registerCommand("usage", {
        description: "Show CLIProxyAPI subscriptions and quota limits in a floating panel (user-only: never sent to the model)",
        handler: async (args, ctx) => {
            const wantsText = (args ?? "").trim().toLowerCase().includes("--text");

            if (wantsText || !ctx.hasUI || ctx.mode !== "tui") {
                try {
                    const groups = await loadUsage(true, ctx.signal);
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

            // Opening the modal always refreshes: the cache only avoids refetching
            // while the user navigates between providers and accounts.
            cache = null;

            let modal: UsageModal | null = null;
            try {
                await ctx.ui.custom(
                    (tui, theme, _keybindings, done) => {
                        modal = new UsageModal({
                            theme: theme as never,
                            tui,
                            done,
                            load: (force) => loadUsage(force, ctx.signal),
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
