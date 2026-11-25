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
	{ id: "codegraph", name: "codegraph", description: "CodeGraph semantic exploration & index management" },
];

export interface ModalResult {
	action: "save" | "cancel";
	selected?: Record<string, boolean>;
}

interface ClickRange {
	y: number;
	x1: number;
	x2: number;
}

interface ModalLayout {
	lines: string[];
	/** Visual line spans (inclusive) owned by each extension item. */
	itemSpans: Array<{ itemIndex: number; startY: number; endY: number }>;
	save: ClickRange | undefined;
	cancel: ClickRange | undefined;
}

const ANSI_SGR = /\x1b\[[0-9;]*m/;

/**
 * Wrap ANSI-styled text to a visible width without clipping or ellipsis, closing and
 * reopening the active SGR state on every broken line.
 */
function wrapAnsi(text: string, width: number): string[] {
	if (width <= 0) return [];
	if (visibleWidth(text) <= width) return [text];
	const out: string[] = [];
	let current = "";
	let currentWidth = 0;
	let active = "";
	const flush = () => {
		out.push(active && !current.endsWith("\x1b[0m") ? `${current}\x1b[0m` : current);
		current = active;
		currentWidth = 0;
	};
	for (const part of text.split(/(\x1b\[[0-9;]*m)/)) {
		if (!part) continue;
		if (ANSI_SGR.test(part) && part.startsWith("\x1b[")) {
			current += part;
			active = part === "\x1b[0m" ? "" : `${active}${part}`;
			continue;
		}
		for (const grapheme of Array.from(part)) {
			const w = visibleWidth(grapheme);
			if (w > width) continue;
			if (currentWidth + w > width && currentWidth > 0) flush();
			current += grapheme;
			currentWidth += w;
		}
	}
	if (current !== active || out.length === 0) flush();
	return out.length > 0 ? out : [""];
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
	private layout: ModalLayout;

	constructor(cwd: string, theme: Theme, done: (result: ModalResult) => void) {
		this.cwd = cwd;
		this.theme = theme;
		this.done = done;
		this.loadCurrentState();
		this.layout = this.computeLayout(this.width);
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

		// Las filas se envuelven: cada item puede ocupar varias líneas visuales.
		const span = this.layout.itemSpans.find((candidate) => y >= candidate.startY && y <= candidate.endY);
		if (span) {
			this.selectedIndex = span.itemIndex;
			this.focusArea = "list";
			if (event.type === "click") {
				const current = SUPPORTED_EXTENSIONS[span.itemIndex];
				if (current) {
					this.checkedState[current.id] = !this.checkedState[current.id];
				}
			}
			return { handled: true, render: true };
		}

		const inRange = (range: ClickRange | undefined) =>
			range !== undefined && y === range.y && x >= range.x1 && x <= range.x2;

		if (inRange(this.layout.save)) {
			this.focusArea = "save";
			if (event.type === "click") {
				this.saveConfig();
			}
			return { handled: true, render: true };
		}
		if (inRange(this.layout.cancel)) {
			this.focusArea = "cancel";
			if (event.type === "click") {
				this.done({ action: "cancel" });
			}
			return { handled: true, render: true };
		}

		return { handled: true };
	}

	render(width: number): string[] {
		this.layout = this.computeLayout(width);
		return this.layout.lines;
	}

	private computeLayout(width: number): ModalLayout {
		const requested = Number.isFinite(width) ? Math.floor(width) : this.width;
		const w = Math.max(20, Math.min(this.width, requested));
		const th = this.theme;
		const innerW = w - 2;
		const lines: string[] = [];

		const pad = (s: string, len: number) => {
			const vis = visibleWidth(s);
			return s + " ".repeat(Math.max(0, len - vis));
		};

		const rowLines = (content: string) => {
			for (const segment of wrapAnsi(content, innerW)) {
				lines.push(th.fg("border", "│") + pad(segment, innerW) + th.fg("border", "│"));
			}
		};

		// Borde superior
		lines.push(th.fg("border", `┌${"─".repeat(innerW)}┐`));

		// Título y padding
		rowLines("");
		rowLines(`  ${th.fg("accent", "⚙  TOOLS & EXTENSIONS MANAGER")}`);
		rowLines(`  ${th.fg("dim", "Configura extensiones activas (.pi/extensions.json)")}`);
		rowLines("");

		// Lista de items: cada item puede envolver nombre y descripción en varias líneas.
		const itemSpans: ModalLayout["itemSpans"] = [];
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

			const startY = lines.length;
			rowLines(`${pointer}${checkbox} ${nameLabel}`);
			rowLines(`      ${th.fg("dim", item.description)}`);
			itemSpans.push({ itemIndex: i, startY, endY: lines.length - 1 });
		}

		rowLines("");
		rowLines(`  ${th.fg("border", "─".repeat(Math.max(0, innerW - 4)))}`);
		rowLines("");

		// Botones de acción (envueltos en anchos estrechos, con rangos de click por línea).
		const isSaveFocused = this.focusArea === "save";
		const isCancelFocused = this.focusArea === "cancel";

		const saveBtn = isSaveFocused
			? th.bold(th.fg("success", "[ Guardar (s) ]"))
			: th.fg("dim", "  Guardar (s)  ");

		const cancelBtn = isCancelFocused
			? th.bold(th.fg("error", "[ Cancelar (Esc) ]"))
			: th.fg("dim", "  Cancelar (Esc)  ");

		let save: ClickRange | undefined;
		let cancel: ClickRange | undefined;
		let buttonLine = "";
		let cursorX = 1;
		let buttonLineStart = lines.length;
		const place = (segment: string, id?: "save" | "cancel") => {
			const segW = visibleWidth(segment);
			if (cursorX + segW > 1 + innerW && buttonLine) {
				rowLines(buttonLine);
				buttonLineStart = lines.length;
				buttonLine = "";
				cursorX = 1;
			}
			if (id === "save") save = { y: buttonLineStart, x1: cursorX, x2: cursorX + segW - 1 };
			if (id === "cancel") cancel = { y: buttonLineStart, x1: cursorX, x2: cursorX + segW - 1 };
			buttonLine += segment;
			cursorX += segW;
		};
		place(" ".repeat(10));
		place(saveBtn, "save");
		place("      ");
		place(cancelBtn, "cancel");
		rowLines(buttonLine);

		// Atajos de ayuda al pie
		rowLines("");
		rowLines(`  ${th.fg("dim", "↑/↓/j/k: Mover • Espacio: Marcar • s: Guardar • q: Salir")}`);
		rowLines("");

		// Borde inferior
		lines.push(th.fg("border", `└${"─".repeat(innerW)}┘`));

		return { lines, itemSpans, save, cancel };
	}

	invalidate(): void {}
}
