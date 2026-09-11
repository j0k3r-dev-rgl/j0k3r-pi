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

function interpolateColor(
	c1: [number, number, number],
	c2: [number, number, number],
	t: number,
): [number, number, number] {
	return [
		Math.round(c1[0] + (c2[0] - c1[0]) * t),
		Math.round(c1[1] + (c2[1] - c1[1]) * t),
		Math.round(c1[2] + (c2[2] - c1[2]) * t),
	];
}

const COLOR_STOPS: [number, number, number][] = [
	[0, 229, 255],   // Electric Cyan (#00e5ff)
	[23, 147, 209],  // Arch Blue (#1793d1)
	[155, 92, 255],  // Cyber Violet (#9b5cff)
	[255, 45, 247],  // Neon Pink (#ff2df7)
	[255, 184, 77],  // Electric Amber (#ffb84d)
	[102, 255, 102], // Neon Green (#66ff66)
];

const ARCH_ICON = "󰣇";

// Fast and snappy 12-frame color rotation with pulse (600ms total loop)
export function createArchWorkingFrames(totalFrames = 12): string[] {
	const frames: string[] = [];
	for (let i = 0; i < totalFrames; i++) {
		const colorProgress = i / totalFrames;
		const stopIndex = Math.floor(colorProgress * COLOR_STOPS.length);
		const nextStopIndex = (stopIndex + 1) % COLOR_STOPS.length;
		const stopT = colorProgress * COLOR_STOPS.length - stopIndex;
		const baseColor = interpolateColor(COLOR_STOPS[stopIndex], COLOR_STOPS[nextStopIndex], stopT);

		// Breathing / pulsation wave
		const wave = Math.sin(colorProgress * Math.PI * 2);
		const normWave = (wave + 1) / 2; // 0..1
		const brightness = 0.4 + 0.6 * Math.pow(normWave, 1.2);

		let r = Math.round(baseColor[0] * brightness);
		let g = Math.round(baseColor[1] * brightness);
		let b = Math.round(baseColor[2] * brightness);

		// Flash highlight at pulse peak
		if (normWave > 0.75) {
			const highlightT = ((normWave - 0.75) / 0.25) * 0.35;
			r = Math.min(255, Math.round(r * (1 - highlightT) + 255 * highlightT));
			g = Math.min(255, Math.round(g * (1 - highlightT) + 255 * highlightT));
			b = Math.min(255, Math.round(b * (1 - highlightT) + 255 * highlightT));
		}

		const bold = brightness > 0.5 ? "1;" : "";
		frames.push(`\x1b[${bold}38;2;${r};${g};${b}m${ARCH_ICON}${RESET}`);
	}
	return frames;
}

export const ARCH_WORKING_INDICATOR = {
	frames: createArchWorkingFrames(12),
	intervalMs: 50,
};

export class J0k3rThemeEditor extends CustomEditor {
	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
		super(tui, theme, keybindings, { embedWorkingStatus: true });
		this.borderColor = electricBorder;
	}

	override setWorkingStatusIndicator(indicator: any): void {
		if (indicator && typeof indicator.setIndicator === "function") {
			indicator.setIndicator(ARCH_WORKING_INDICATOR);
			indicator._hasArchIndicator = true;
		}
		super.setWorkingStatusIndicator(indicator);
	}

	protected override renderTopBorder(width: number, hiddenLineCount: number): string {
		const wsi = (this as any).workingStatusIndicator;
		if (!this.embedWorkingStatus || !wsi || width <= 0) {
			return super.renderTopBorder(width, hiddenLineCount);
		}

		if (typeof wsi.setIndicator === "function" && !wsi._hasArchIndicator) {
			wsi.setIndicator(ARCH_WORKING_INDICATOR);
			wsi._hasArchIndicator = true;
		}

		const currentIcon = wsi.frames?.[wsi.currentFrame] ?? wsi.getRenderedIndicator?.() ?? "";
		let status = wsi.renderInBorder(Math.max(1, width - 8));
		if (status && currentIcon) {
			// Append the matching animated Arch logo to the right of the status text
			status = `${status} ${currentIcon}`;
		}

		let statusWidth = visibleWidth(status);
		if (statusWidth === 0) return super.renderTopBorder(width, hiddenLineCount);

		const overflowLabel = hiddenLineCount > 0 ? ` ↑ ${hiddenLineCount} more ` : undefined;
		const overflowLabelWidth = overflowLabel ? visibleWidth(overflowLabel) : 0;
		const overflowStart = Math.floor((width - overflowLabelWidth) / 2);
		const canFitOverflow = () =>
			overflowLabel !== undefined && overflowLabelWidth + 2 <= width && overflowStart - (3 + statusWidth + 1) >= 1;

		if (overflowLabel && !canFitOverflow()) {
			status = wsi.renderSpinnerInBorder(width);
			if (status && currentIcon) {
				status = `${status} ${currentIcon}`;
			}
			statusWidth = visibleWidth(status);
		}

		if (canFitOverflow()) {
			const leftBlockWidth = 3 + statusWidth + 1;
			return (
				this.borderColor("── ") +
				status +
				this.borderColor(
					` ${"─".repeat(overflowStart - leftBlockWidth)}${overflowLabel}${"─".repeat(width - overflowStart - overflowLabelWidth)}`,
				)
			);
		}

		if (width >= statusWidth + 5) {
			return this.borderColor("── ") + status + this.borderColor(` ${"─".repeat(width - statusWidth - 4)}`);
		}

		status = wsi.renderSpinnerInBorder(width);
		if (status && currentIcon) {
			status = `${status} ${currentIcon}`;
		}
		statusWidth = visibleWidth(status);
		const prefixWidth = Math.min(3, Math.max(0, width - statusWidth));
		return (
			this.borderColor("─".repeat(prefixWidth)) +
			status +
			this.borderColor("─".repeat(Math.max(0, width - prefixWidth - statusWidth)))
		);
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		if (width <= 2) return super.render(width);

		const innerWidth = Math.max(1, width - 2);
		const lines = super.render(innerWidth);
		if (lines.length < 2) return lines;

		const border = electricBorder;

		return lines.map((line, index) => {
			if (index === 0) return boxedLine(line, innerWidth, "┌", "┐", border);
			if (index === lines.length - 1) return boxedLine(line, innerWidth, "└", "┘", border);

			return boxedLine(line, innerWidth, "│", "│", border);
		});
	}
}
