import {
	CustomEditor,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

function fitLine(text: string, width: number): string {
	if (width <= 0) return "";
	const clipped = truncateToWidth(text, width, "");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

const ELECTRIC_BORDER = "\x1b[1;38;2;0;229;255m";
const RESET = "\x1b[0m";

function electricBorder(text: string): string {
	return `${ELECTRIC_BORDER}${text}${RESET}`;
}

function boxedLine(line: string, innerWidth: number, left: string, right: string, border: (text: string) => string): string {
	return `${border(left)}${fitLine(line, innerWidth)}${border(right)}`;
}

export class J0k3rThemeEditor extends CustomEditor {
	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
		// Match Pi's default editor behavior: native working status remains embedded
		// in the editor border, while this extension only changes the box shape.
		super(tui, theme, keybindings, { embedWorkingStatus: true });
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		if (width <= 2) return super.render(width);

		const innerWidth = Math.max(1, width - 2);
		// Render the native editor at the inner width first. Rendering at full width
		// and adding side borders afterwards clips the cursor/text by two columns.
		const lines = super.render(innerWidth);
		if (lines.length < 2) return lines;

		// Keep the terminal background transparent: only color the editor frame.
		const border = electricBorder;

		return lines.map((line, index) => {
			if (index === 0) return boxedLine(line, innerWidth, "┌", "┐", border);
			if (index === lines.length - 1) return boxedLine(line, innerWidth, "└", "┘", border);

			return boxedLine(line, innerWidth, "│", "│", border);
		});
	}
}
