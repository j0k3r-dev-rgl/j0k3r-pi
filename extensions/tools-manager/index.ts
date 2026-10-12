import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ToolsManagerModal, type ModalResult } from "./src/modal.ts";

export function checkActiveSubagents(cwd: string): { hasActive: boolean; count: number } {
	try {
		const dbPath = process.env.PI_SUBAGENTS_HISTORY_DB_PATH ||
			(process.env.PI_SUBAGENTS_HISTORY_HOME ? join(process.env.PI_SUBAGENTS_HISTORY_HOME, "subagents-history.sqlite") :
			(process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, "pi", "subagents", "subagents-history.sqlite") :
			join(homedir(), ".local", "share", "pi", "subagents", "subagents-history.sqlite")));

		if (!existsSync(dbPath)) {
			return { hasActive: false, count: 0 };
		}

		const db = new DatabaseSync(dbPath, { readOnly: true });
		try {
			const rows = db.prepare(
				"SELECT count(*) as count FROM subagent_tasks WHERE cwd = ? AND status IN ('queued', 'running', 'stopping')"
			).all(cwd) as Array<{ count: number }>;
			const count = Number(rows[0]?.count ?? 0);
			return { hasActive: count > 0, count };
		} finally {
			db.close();
		}
	} catch {
		return { hasActive: false, count: 0 };
	}
}

export function shouldDeferReload(pi: any, cwd: string): { defer: boolean; reason?: string } {
	let deferResult: { defer: boolean; reason?: string } = { defer: false };

	if (pi?.events && typeof pi.events.emit === "function") {
		pi.events.emit("supervisor:reload-guard:v1", {
			cwd,
			defer: (reason: string) => {
				deferResult = { defer: true, reason };
			},
		});
	}

	if (deferResult.defer) {
		return deferResult;
	}

	const subagentsCheck = checkActiveSubagents(cwd);
	if (subagentsCheck.hasActive) {
		return {
			defer: true,
			reason: `Hay ${subagentsCheck.count} subagente(s) en ejecución`,
		};
	}

	return { defer: false };
}

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
		const deferCheck = shouldDeferReload(pi, ctx.cwd);

		if (deferCheck.defer) {
			ctx.ui.notify(
				`Configuración guardada (${summary}). Recarga pospuesta: ${deferCheck.reason ?? "tareas activas en curso"}.`,
				"info",
			);
			return;
		}

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
			const deferCheck = shouldDeferReload(pi, cmdCtx.cwd);
			if (deferCheck.defer) {
				cmdCtx.ui?.notify(
					`Recarga pospuesta: ${deferCheck.reason ?? "tareas activas en curso"}.`,
					"info",
				);
				return;
			}
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
