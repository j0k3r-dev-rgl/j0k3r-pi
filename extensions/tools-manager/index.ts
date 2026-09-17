import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ToolsManagerModal, type ModalResult } from "./src/modal.js";

async function openToolsManager(ctx: ExtensionContext | ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("Tools Manager requiere el modo interactivo TUI de Pi", "warning");
		return;
	}

	const result = await ctx.ui.custom<ModalResult>(
		(_tui, theme, _keybindings, done) => new ToolsManagerModal(ctx.cwd, theme, done),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
			},
		},
	);

	if (result && result.action === "save") {
		const activeList = Object.entries(result.selected || {})
			.filter(([_, active]) => active)
			.map(([id]) => id);

		const summary = activeList.length > 0 ? activeList.join(", ") : "ninguna (modo limpio)";
		ctx.ui.notify(`Configuración guardada (${summary}). Recargando Pi...`, "info");

		// Si ctx tiene reload() directo (llamado desde comando /extension), lo ejecutamos
		if ("reload" in ctx && typeof (ctx as ExtensionCommandContext).reload === "function") {
			await (ctx as ExtensionCommandContext).reload();
		} else {
			// Si fue invocado desde shortcut alt+e (ExtensionContext), disparamos el comando puente
			pi.sendUserMessage("/tools-manager-reload", { expandPromptTemplates: true });
		}
	}
}

export default function toolsManagerExtension(pi: ExtensionAPI): void {
	// Comando puente interno para ejecutar reload con permisos de comando
	pi.registerCommand("tools-manager-reload", {
		description: "Recarga interna para Tools Manager",
		handler: async (_args, cmdCtx) => {
			await cmdCtx.reload();
		},
	});

	// Registrar comando principal /extension y alias /tools-manager
	pi.registerCommand("extension", {
		description: "Abrir selector interactivo de extensiones opt-in",
		handler: async (_args, ctx) => openToolsManager(ctx, pi),
	});

	pi.registerCommand("tools-manager", {
		description: "Abrir selector interactivo de extensiones opt-in",
		handler: async (_args, ctx) => openToolsManager(ctx, pi),
	});

	// Registrar atajo de teclado alt+e
	pi.registerShortcut("alt+e", {
		description: "Abrir selector interactivo de extensiones",
		handler: async (ctx) => openToolsManager(ctx, pi),
	});
}
