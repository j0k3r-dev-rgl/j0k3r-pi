import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const RESET = "\x1b[0m";
export const PINK = "\x1b[1;38;2;255;45;247m";
export const RED = "\x1b[1;38;2;255;77;109m";
export const DIM = "\x1b[2m";

export function electric(color: string, text: string): string {
	return `${color}${text}${RESET}`;
}

export function toolHint(action: string): string {
	return `${electric(DIM, "Ctrl+O")} ${electric(DIM, action)}`;
}

export function fit(text: string, width: number): string {
	return truncateToWidth(text, Math.max(0, width), "");
}

export function pad(text: string, width: number): string {
	const vis = visibleWidth(text);
	if (vis <= width) {
		return text + " ".repeat(width - vis);
	}
	const fitted = fit(text, width);
	const visFitted = visibleWidth(fitted);
	return fitted + " ".repeat(Math.max(0, width - visFitted));
}

export function boxLine(content: string, innerWidth: number, borderColor: string = PINK): string {
	const innerContentWidth = Math.max(0, innerWidth - 2);
	return `${electric(borderColor, "│")} ${pad(content, innerContentWidth)} ${electric(borderColor, "│")}`;
}

export function cardTopBorder(
	toolName: string,
	actionOrTarget: string | undefined,
	innerWidth: number,
	borderColor: string = PINK,
	titleColor: string = PINK,
): string {
	const cleanAction = actionOrTarget ? actionOrTarget.replace(/[\r\n]+/g, " ").trim() : undefined;
	let label = cleanAction ? `${toolName} [${cleanAction}]` : toolName;

	const maxTitleWidth = Math.max(4, innerWidth - 4);
	if (visibleWidth(label) + 2 > maxTitleWidth && cleanAction) {
		const maxActionWidth = Math.max(3, maxTitleWidth - visibleWidth(toolName) - 5);
		const truncatedAction = fit(cleanAction, maxActionWidth);
		label = `${toolName} [${truncatedAction}]`;
	}

	let titleText = ` ${label} `;
	if (visibleWidth(titleText) > innerWidth) {
		titleText = ` ${fit(label, Math.max(1, innerWidth - 2))} `;
	}

	const rest = Math.max(0, innerWidth - visibleWidth(titleText));
	const leftDash = Math.min(2, rest);
	const rightDash = Math.max(0, rest - leftDash);
	return `${electric(borderColor, "╭")}${electric(borderColor, "─".repeat(leftDash))}${electric(titleColor, titleText)}${electric(borderColor, "─".repeat(rightDash))}${electric(borderColor, "╮")}`;
}

export function cardBottomBorder(innerWidth: number, borderColor: string = PINK): string {
	return `${electric(borderColor, "╰")}${electric(borderColor, "─".repeat(innerWidth))}${electric(borderColor, "╯")}`;
}

export function frameContent(
	lines: string[],
	innerWidth: number,
	borderColor: string = PINK,
	wrap = false,
): string[] {
	const innerContentWidth = Math.max(0, innerWidth - 2);
	const framed: string[] = [];
	for (const rawLine of lines) {
		const subLines = rawLine.split(/\r?\n/);
		for (const sub of subLines) {
			if (wrap && visibleWidth(sub) > innerContentWidth) {
				const wrapped = wrapTextWithAnsi(sub, innerContentWidth);
				for (const segment of wrapped) {
					framed.push(boxLine(segment, innerWidth, borderColor));
				}
			} else {
				framed.push(boxLine(sub, innerWidth, borderColor));
			}
		}
	}
	return framed;
}

export interface CodeGraphCardState {
	startedAt?: number;
	endedAt?: number;
	hasResult?: boolean;
	isPartial?: boolean;
	isError?: boolean;
	expanded?: boolean;
	borderColor?: string;
}

export class CodeGraphCardCallComponent implements Component {
	private readonly toolName: string;
	private readonly getAction: () => string | undefined;
	private readonly getPendingStatus: () => string;
	private readonly getBorderColor: (state: CodeGraphCardState) => string;
	private readonly state: CodeGraphCardState;
	private readonly getBodyLines?: (width: number, innerWidth: number) => string[];
	private cachedWidth?: number;
	private cachedBorderColor?: string;
	private cachedTopBorder?: string[];

	constructor(
		toolName: string,
		getAction: () => string | undefined,
		getPendingStatus: () => string,
		getBorderColor: (state: CodeGraphCardState) => string,
		state: CodeGraphCardState,
		getBodyLines?: (width: number, innerWidth: number) => string[],
	) {
		this.toolName = toolName;
		this.getAction = getAction;
		this.getPendingStatus = getPendingStatus;
		this.getBorderColor = getBorderColor;
		this.state = state;
		this.getBodyLines = getBodyLines;
	}

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

export class CodeGraphCardResultComponent implements Component {
	private readonly getBodyLines: (width: number, innerWidth: number) => string[];
	private readonly getBorderColor: (state: CodeGraphCardState) => string;
	private readonly state: CodeGraphCardState;
	private readonly wrap: boolean;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		getBodyLines: (width: number, innerWidth: number) => string[],
		getBorderColor: (state: CodeGraphCardState) => string,
		state: CodeGraphCardState,
		wrap = false,
	) {
		this.getBodyLines = getBodyLines;
		this.getBorderColor = getBorderColor;
		this.state = state;
		this.wrap = wrap;
	}

	render(width: number): string[] {
		if (width <= 0 || width < 24) {
			return [];
		}

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
