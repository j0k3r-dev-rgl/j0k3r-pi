import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import {
    findExactModel,
    invalidateCatalog,
    loadCatalog,
    type Catalog,
    type CatalogSource,
} from "./src/api.ts";
import { ModelPickerModal, type ModalTheme } from "./src/modal.ts";
import type { TUI } from "@earendil-works/pi-tui";

/**
 * `/model` — provider-scoped, collapsible model picker for Pi.
 *
 * Replaces the built-in `/model` selector with a floating overlay:
 * providers → families → models, with filtering, mouse support, and
 * assignment through `pi.setModel()`.
 */

let open = false;
let editorInstalled = false;

/**
 * Latest context seen from `session_start`. Editor-originated `/model` has no
 * ctx of its own, so we reuse this one. Typed as `ExtensionContext` because
 * that is what `session_start` provides; the picker only needs its UI, model,
 * and registry members.
 */
let liveCtx: ExtensionContext | null = null;

function asCatalogSource(ctx: { modelRegistry: any }): CatalogSource {
    return {
        getAvailable: () => ctx.modelRegistry.getAvailable(),
        getProviderAuthStatus: (provider: string) => ctx.modelRegistry.getProviderAuthStatus(provider),
        getProviderDisplayName: (provider: string) => ctx.modelRegistry.getProviderDisplayName(provider),
        refresh: async () => {
            await ctx.modelRegistry.refresh();
        },
    };
}

/**
 * Assigns the model to Pi and returns a user-facing error, or undefined on success.
 */
async function selectModel(pi: ExtensionAPI, model: Model<any>): Promise<string | undefined> {
    try {
        const ok = await pi.setModel(model);
        if (!ok) return `No hay credenciales configuradas para "${model.provider}". Usa /login ${model.provider}`;
        return undefined;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

async function openPicker(
    pi: ExtensionAPI,
    ctx: any,
    options: { query?: string } = {},
): Promise<void> {
    if (open) {
        ctx.ui.notify("/model ya está abierto", "info");
        return;
    }

    const source = asCatalogSource(ctx);

    // Non-interactive fallback: exact reference assigns directly, like built-in /model.
    if (options.query) {
        let catalog: Catalog;
        try {
            catalog = await loadCatalog({ source, scopedModels: ctx.scopedModels ?? [] });
        } catch {
            catalog = { providers: [], total: 0, scoped: false };
        }
        const models = catalog.providers.flatMap((provider) => provider.models);
        const found = findExactModel(options.query, models);
        if (found && "model" in found) {
            const message = await selectModel(pi, found.model);
            if (message) ctx.ui.notify(message, "error");
            else ctx.ui.notify(`Modelo: ${found.model.id}`, "info");
            return;
        }
        if (found?.ambiguous) {
            ctx.ui.notify(`"${options.query}" es ambiguo entre proveedores; se abre el selector.`, "warning");
        }
    }

    if (!ctx.hasUI || ctx.mode !== "tui") {
        ctx.ui.notify("/model necesita modo interactivo (TUI).", "warning");
        return;
    }

    open = true;
    invalidateCatalog();

    let modal: ModelPickerModal | null = null;
    try {
        await ctx.ui.custom(
            (tui: TUI, theme: unknown, _keybindings: unknown, done: () => void) => {
                // 55% of the terminal: the modal stays compact instead of
                // filling the screen, and the viewport matches what is visible.
                const maxHeight = Math.max(12, Math.floor((tui.terminal?.rows ?? 24) * 0.55));
                modal = new ModelPickerModal({
                    theme: theme as unknown as ModalTheme,
                    tui,
                    done,
                    load: (force) => loadCatalog({ source, scopedModels: ctx.scopedModels ?? [], force }, ctx.signal),
                    select: (model) => selectModel(pi, model),
                    currentModel: ctx.model,
                    initialQuery: options.query,
                    maxHeight,
                });
                return modal as never;
            },
            {
                overlay: true,
                overlayOptions: {
                    width: "78%",
                    minWidth: 64,
                    maxHeight: "55%",
                    anchor: "center",
                },
                onHandle: (handle: { focus?: () => void }) => handle?.focus?.(),
            } as never,
        );
    } finally {
        open = false;
        modal = null;
    }
}

/**
 * Wraps the editor so `/model` is intercepted before Pi's hardcoded handler.
 *
 * `onSubmit` is a plain property the app assigns *after* the factory runs, so
 * it cannot be trapped with an accessor. Instead we let the assignment land on
 * the instance and then swap in a wrapper that consults the picker first.
 */
class ModelCommandEditor extends CustomEditor {
    private baseSubmit: ((text: string) => void | Promise<void>) | undefined;
    private onCommand: (text: string) => boolean | Promise<boolean>;

    constructor(
        tui: TUI,
        theme: ConstructorParameters<typeof CustomEditor>[1],
        keybindings: ConstructorParameters<typeof CustomEditor>[2],
        onCommand: (text: string) => boolean | Promise<boolean>,
    ) {
        super(tui, theme, keybindings);
        this.onCommand = onCommand;
        this.installSubmitTrap();
    }

    /**
     * Installs an own `onSubmit` property that shadows the prototype field.
     *
     * The app assigns `onSubmit` twice (startup handler, then the runtime
     * handler). Each assignment is captured into `appSubmit` and re-exposed as
     * a wrapper that offers the text to the picker first, so later
     * reassignments stay trapped without re-installing anything.
     */
    private installSubmitTrap(): void {
        let appSubmit: ((text: string) => void | Promise<void>) | undefined;
        Object.defineProperty(this, "onSubmit", {
            configurable: true,
            enumerable: true,
            get: () => async (text: string) => {
                const handled = await this.onCommand(text);
                if (!handled) await appSubmit?.(text);
            },
            set: (handler: ((text: string) => void | Promise<void>) | undefined) => {
                appSubmit = handler;
            },
        });
    }
}

export default function j0k3rModelPicker(pi: ExtensionAPI) {
    const commands = ["model-select", "ms"];
    for (const name of commands) {
        pi.registerCommand(name, {
            description: "Selector de modelo por proveedor (panel flotante colapsable)",
            handler: async (args, ctx) => {
                const query = (args ?? "").trim();
                await openPicker(pi, ctx, { query: query || undefined });
            },
        });
    }

    // `/model-select` also wins over Pi's hardcoded `/model` handler: the
    // built-in branch only matches `/model`, so an extension command with a
    // distinct name reaches `session.prompt()` untouched.
    const handleCommand = async (text: string): Promise<boolean> => {
        const trimmed = text.trim();
        const matched = commands.find((name) => trimmed === `/${name}` || trimmed.startsWith(`/${name} `));
        if (!matched) return false;

        const query = trimmed.slice(matched.length + 1).trim();

        const ctx = liveCtx;
        if (!ctx) return false;

        try {
            ctx.ui.setEditorText("");
        } catch {
            /* editor may be unavailable in some modes */
        }
        await openPicker(pi, ctx, { query: query || undefined });
        return true;
    };

    pi.on("session_start", async (_event, ctx) => {
        liveCtx = ctx;

        if (ctx.mode !== "tui" || editorInstalled) return;
        editorInstalled = true;
        ctx.ui.setEditorComponent(
            (tui, theme, keybindings) =>
                new ModelCommandEditor(tui, theme, keybindings, handleCommand) as never,
        );
    });

    pi.on("session_shutdown", async (_event, ctx) => {
        if (editorInstalled) {
            editorInstalled = false;
            try {
                ctx.ui.setEditorComponent(undefined);
            } catch {
                /* best effort restore */
            }
        }
        invalidateCatalog();
        liveCtx = null;
    });
}
