import type { Component } from "@earendil-works/pi-tui";
import {
	CYAN,
	boxLine,
	cardBottomBorder,
	cardTopBorder,
	fit,
	frameContent,
} from "./borders.js";

export interface ToolCardState {
	startedAt?: number;
	endedAt?: number;
	interval?: ReturnType<typeof setInterval>;
	hasResult?: boolean;
	isPartial?: boolean;
	isError?: boolean;
	expanded?: boolean;
	borderColor?: string;
}

export interface ToolRenderContext<TState = ToolCardState, TArgs = any> {
	args: TArgs;
	toolCallId: string;
	invalidate: () => void;
	lastComponent: Component | undefined;
	state: TState;
	cwd: string;
	executionStarted: boolean;
	argsComplete: boolean;
	isPartial: boolean;
	expanded: boolean;
	showImages: boolean;
	isError: boolean;
}

export class ToolCardCallComponent implements Component {
	private cachedWidth?: number;
	private cachedBorderColor?: string;
	private cachedTopBorder?: string[];

	constructor(
		private readonly toolName: string,
		private readonly getAction: () => string | undefined,
		private readonly getPendingStatus: () => string,
		private readonly getBorderColor: (state: ToolCardState) => string,
		private readonly state: ToolCardState,
		private readonly getBodyLines?: (width: number, innerWidth: number) => string[],
	) {}

	render(width: number): string[] {
		if (width <= 0) return [];
		const action = this.getAction();
		if (width < 24) {
			return [fit(`${this.toolName} ${action ?? ""}`.trim(), width)];
		}
		const innerWidth = Math.max(0, width - 2);
		const borderColor = this.getBorderColor(this.state);

		if (this.state.hasResult) {
			if (
				this.cachedWidth === innerWidth &&
				this.cachedBorderColor === borderColor &&
				this.cachedTopBorder
			) {
				return this.cachedTopBorder;
			}
			const topBorder = cardTopBorder(this.toolName, action, innerWidth, borderColor, borderColor);
			this.cachedWidth = innerWidth;
			this.cachedBorderColor = borderColor;
			this.cachedTopBorder = [topBorder];
			return this.cachedTopBorder;
		}

		const topBorder = cardTopBorder(this.toolName, action, innerWidth, borderColor, borderColor);
		const bodyLines = this.getBodyLines ? this.getBodyLines(width, innerWidth) : [];
		const statusLine = this.getPendingStatus();
		const framed = frameContent([...bodyLines, statusLine], innerWidth, borderColor, true);

		return [
			topBorder,
			...framed,
			cardBottomBorder(innerWidth, borderColor),
		];
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedBorderColor = undefined;
		this.cachedTopBorder = undefined;
	}
}

export class ToolCardResultComponent implements Component {
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private readonly getBodyLines: (width: number, innerWidth: number) => string[],
		private readonly getBorderColor: (state: ToolCardState) => string,
		private readonly state: ToolCardState,
		private readonly wrap = false,
	) {}

	render(width: number): string[] {
		if (width <= 0 || width < 24) {
			return [];
		}

		// Si el resultado ya no es parcial (ejecución terminada), cachear las líneas por ancho
		if (!this.state.isPartial && this.cachedWidth === width && this.cachedLines !== undefined) {
			return this.cachedLines;
		}

		const innerWidth = Math.max(0, width - 2);
		const borderColor = this.getBorderColor(this.state);
		const bodyLines = this.getBodyLines(width, innerWidth);
		const framed = frameContent(bodyLines, innerWidth, borderColor, this.wrap);
		const bottom = cardBottomBorder(innerWidth, borderColor);
		const lines = [...framed, bottom];

		if (!this.state.isPartial) {
			this.cachedWidth = width;
			this.cachedLines = lines;
		}

		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}
