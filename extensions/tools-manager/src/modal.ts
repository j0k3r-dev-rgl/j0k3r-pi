import type { Component, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, visibleWidth, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface ToolExtensionItem {
	id: string;
	name: string;
	description: string;
}

export const SUPPORTED_EXTENSIONS: ToolExtensionItem[] = [
	{ id: "browser-screenshot", name: "browser-screenshot", description: "Browser CDP, tabs & screenshots" },
	{ id: "youtube-research", name: "youtube-research", description: "YouTube search & transcripts" },
	{ id: "api-tools", name: "api-tools", description: "REST, GraphQL & Swagger tools" },
	{ id: "workspace-services", name: "workspace-services", description: "Service runner & process manager" },
	{ id: "utils", name: "utils", description: "System screenshot & audio tools" },
	{ id: "context7", name: "context7", description: "Context7 documentation & tools" },
	{ id: "websearch", name: "websearch", description: "Web search tools" },
	{ id: "pdf-review", name: "pdf-review", description: "PDF inspection & text review" },
	{ id: "engram", name: "engram", description: "Persistent memory & protocol (19 tools)" },
	{ id: "codegraph", name: "codegraph", description: "CodeGraph semantic exploration & index management" },
	{ id: "typesafe", name: "typesafe", description: "TypeSafe System One (Jev) semantic AI evaluation" },
];

export interface ModalResult {
	action: "save" | "cancel";
	selected?: Record<string, boolean>;
}

export class ToolsManagerModal implements Component {
	private readonly width = 62;
	private readonly cwd: string;
	private readonly theme: Theme;
	private readonly done: (result: ModalResult) => void;

	private selectedIndex = 0;
	// 0: Lista de extensiones, 1: Botón Guardar, 2: Botón Cancelar
	private focusArea: "list" | "save" | "cancel" = "list";

	private checkedState: Record<string, boolean> = {};

	constructor(cwd: string, theme: Theme, done: (result: ModalResult) => void) {
		this.cwd = cwd;
		this.theme = theme;
		this.done = done;
		this.loadCurrentState();
	}

	private loadCurrentState(): void {
		const configPath = join(this.cwd, ".pi", "extensions.json");
		if (existsSync(configPath)) {
			try {
				const content = JSON.parse(readFileSync(configPath, "utf8"));
				if (content && typeof content === "object") {
					for (const item of SUPPORTED_EXTENSIONS) {
						this.checkedState[item.id] = Boolean(content[item.id]);
					}
					return;
				}
			} catch {
				// Archivo corrupto o no parseable, inicializar en falso
			}
		}
		for (const item of SUPPORTED_EXTENSIONS) {
			this.checkedState[item.id] = false;
		}
	}

	public saveConfig(): void {
		const piDir = join(this.cwd, ".pi");
		const configPath = join(piDir, "extensions.json");

		try {
			if (!existsSync(piDir)) {
				mkdirSync(piDir, { recursive: true });
			}

			// Leemos la configuración existente por si tiene otras propiedades ajenas
			let currentConfig: Record<string, unknown> = {};
			if (existsSync(configPath)) {
				try {
					currentConfig = JSON.parse(readFileSync(configPath, "utf8")) || {};
				} catch {
					currentConfig = {};
				}
			}

			// Actualizamos solo las flags de nuestras extensiones conocidas
			for (const item of SUPPORTED_EXTENSIONS) {
				currentConfig[item.id] = Boolean(this.checkedState[item.id]);
			}

			writeFileSync(configPath, JSON.stringify(currentConfig, null, 2) + "\n", "utf8");
			this.done({ action: "save", selected: this.checkedState });
		} catch (err) {
			this.done({ action: "cancel" });
		}
	}

	handleInput(data: string): void {
		// Salir con 'q' o Escape
		if (data === "q" || matchesKey(data, "escape")) {
			this.done({ action: "cancel" });
			return;
		}

		// Guardado rápido con 's' o 'S'
		if (data === "s" || data === "S") {
			this.saveConfig();
			return;
		}

		// Alternar foco con Tab / Shift+Tab
		if (matchesKey(data, "tab")) {
			if (this.focusArea === "list") {
				this.focusArea = "save";
			} else if (this.focusArea === "save") {
				this.focusArea = "cancel";
			} else {
				this.focusArea = "list";
			}
			return;
		}

		if (matchesKey(data, "shift+tab") || matchesKey(data, "backtab")) {
			if (this.focusArea === "list") {
				this.focusArea = "cancel";
			} else if (this.focusArea === "cancel") {
				this.focusArea = "save";
			} else {
				this.focusArea = "list";
			}
			return;
		}

		// Manejo según el área en foco
		if (this.focusArea === "list") {
			// Navegación con flechas o estilo Vim (j / k)
			if (matchesKey(data, "up") || data === "k") {
				if (this.selectedIndex > 0) {
					this.selectedIndex--;
				}
				return;
			}

			if (matchesKey(data, "down") || data === "j") {
				if (this.selectedIndex < SUPPORTED_EXTENSIONS.length - 1) {
					this.selectedIndex++;
				} else {
					// Si baja más allá del último elemento, pasa a los botones
					this.focusArea = "save";
				}
				return;
			}

			// Marcar / desmarcar con Espacio o Enter
			if (matchesKey(data, "space") || matchesKey(data, "return")) {
				const current = SUPPORTED_EXTENSIONS[this.selectedIndex];
				if (current) {
					this.checkedState[current.id] = !this.checkedState[current.id];
				}
				return;
			}
		} else if (this.focusArea === "save") {
			if (matchesKey(data, "return")) {
				this.saveConfig();
				return;
			}
			if (matchesKey(data, "right") || matchesKey(data, "down") || data === "l" || data === "j") {
				this.focusArea = "cancel";
				return;
			}
			if (matchesKey(data, "up") || data === "k") {
				this.focusArea = "list";
				this.selectedIndex = SUPPORTED_EXTENSIONS.length - 1;
				return;
			}
		} else if (this.focusArea === "cancel") {
			if (matchesKey(data, "return")) {
				this.done({ action: "cancel" });
				return;
			}
			if (matchesKey(data, "left") || matchesKey(data, "up") || data === "h" || data === "k") {
				this.focusArea = "save";
				return;
			}
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		// Solo procesar clicks izquierdos o eventos de presión
		if (event.button !== "left") return undefined;
		if (event.type !== "press" && event.type !== "click") return undefined;

		const y = event.y;
		const x = event.x;

		// Filas de las extensiones (cada item ocupa 2 líneas: nombre en 5 + 2*i, desc en 6 + 2*i)
		const listEnd = 5 + SUPPORTED_EXTENSIONS.length * 2 - 1;
		if (y >= 5 && y <= listEnd) {
			const itemIndex = Math.floor((y - 5) / 2);
			if (itemIndex >= 0 && itemIndex < SUPPORTED_EXTENSIONS.length) {
				this.selectedIndex = itemIndex;
				this.focusArea = "list";
				if (event.type === "click") {
					const current = SUPPORTED_EXTENSIONS[itemIndex];
					if (current) {
						this.checkedState[current.id] = !this.checkedState[current.id];
					}
				}
				return { handled: true, render: true };
			}
		}

		// Fila de botones
		const buttonsRow = 5 + SUPPORTED_EXTENSIONS.length * 2 + 3;
		if (y === buttonsRow) {
			// El inner padding respecto a x=0 del componente tiene un borde de 1 char:
			// Botón Guardar: columnas aproximadas 8 a 28
			// Botón Cancelar: columnas aproximadas 30 a 54
			if (x >= 8 && x <= 28) {
				this.focusArea = "save";
				if (event.type === "click") {
					this.saveConfig();
				}
				return { handled: true, render: true };
			} else if (x >= 30 && x <= 54) {
				this.focusArea = "cancel";
				if (event.type === "click") {
					this.done({ action: "cancel" });
				}
				return { handled: true, render: true };
			}
		}

		return { handled: true };
	}

	render(_width: number): string[] {
		const w = this.width;
		const th = this.theme;
		const innerW = w - 2;
		const lines: string[] = [];

		const pad = (s: string, len: number) => {
			const vis = visibleWidth(s);
			return s + " ".repeat(Math.max(0, len - vis));
		};

		const row = (content: string) => {
			return th.fg("border", "│") + pad(content, innerW) + th.fg("border", "│");
		};

		// Borde superior
		lines.push(th.fg("border", `┌${"─".repeat(innerW)}┐`));

		// Título y padding
		lines.push(row(""));
		const title = `  ${th.fg("accent", "⚙  TOOLS & EXTENSIONS MANAGER")}`;
		lines.push(row(title));
		const subtitle = `  ${th.fg("dim", "Configura extensiones activas (.pi/extensions.json)")}`;
		lines.push(row(subtitle));
		lines.push(row(""));

		// Lista de items
		for (let i = 0; i < SUPPORTED_EXTENSIONS.length; i++) {
			const item = SUPPORTED_EXTENSIONS[i]!;
			const isFocused = this.focusArea === "list" && i === this.selectedIndex;
			const isChecked = Boolean(this.checkedState[item.id]);

			const pointer = isFocused ? th.fg("accent", "▶ ") : "  ";
			const checkbox = isChecked
				? th.fg("success", "[x]")
				: th.fg("dim", "[ ]");

			const nameLabel = isFocused
				? th.bold(th.fg("accent", item.name))
				: th.fg("text", item.name);

			const lineText = `${pointer}${checkbox} ${nameLabel}`;
			lines.push(row(lineText));

			// Sub-descripción del item
			const descText = `      ${th.fg("dim", item.description)}`;
			lines.push(row(descText));
		}

		lines.push(row(""));
		lines.push(row(`  ${th.fg("border", "─".repeat(innerW - 4))}`));
		lines.push(row(""));

		// Botones de acción
		const isSaveFocused = this.focusArea === "save";
		const isCancelFocused = this.focusArea === "cancel";

		const saveBtn = isSaveFocused
			? th.bold(th.fg("success", "[ Guardar (s) ]"))
			: th.fg("dim", "  Guardar (s)  ");

		const cancelBtn = isCancelFocused
			? th.bold(th.fg("error", "[ Cancelar (Esc) ]"))
			: th.fg("dim", "  Cancelar (Esc)  ");

		const buttonsRow = `          ${saveBtn}      ${cancelBtn}`;
		lines.push(row(buttonsRow));

		// Atajos de ayuda al pie
		lines.push(row(""));
		const hints = `  ${th.fg("dim", "↑/↓/j/k: Mover • Espacio: Marcar • s: Guardar • q: Salir")}`;
		lines.push(row(hints));
		lines.push(row(""));

		// Borde inferior
		lines.push(th.fg("border", `└${"─".repeat(innerW)}┘`));

		return lines;
	}

	invalidate(): void {}
}
