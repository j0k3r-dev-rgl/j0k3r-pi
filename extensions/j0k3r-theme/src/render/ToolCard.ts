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
	constructor(
		private readonly toolName: string,
		private readonly getAction: () => string | undefined,
		private readonly getPendingStatus: () => string,
		private readonly getBorderColor: (state: ToolCardState) => string,
		private readonly state: ToolCardState,
	) {}

	render(width: number): string[] {
		if (width <= 0) return [];
		const action = this.getAction();
		if (width < 24) {
			return [fit(`${this.toolName} ${action ?? ""}`.trim(), width)];
		}
		const innerWidth = Math.max(0, width - 2);
		const borderColor = this.getBorderColor(this.state);
		const topBorder = cardTopBorder(this.toolName, action, innerWidth, borderColor, borderColor);

		if (this.state.hasResult) {
			return [topBorder];
		}

		const statusLine = this.getPendingStatus();
		return [
			topBorder,
			boxLine(statusLine, innerWidth, borderColor),
			cardBottomBorder(innerWidth, borderColor),
		];
	}

	invalidate(): void {}
}

export class ToolCardResultComponent implements Component {
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
		const innerWidth = Math.max(0, width - 2);
		const borderColor = this.getBorderColor(this.state);
		const bodyLines = this.getBodyLines(width, innerWidth);
		const framed = frameContent(bodyLines, innerWidth, borderColor, this.wrap);
		const bottom = cardBottomBorder(innerWidth, borderColor);
		return [...framed, bottom];
	}

	invalidate(): void {}
}
