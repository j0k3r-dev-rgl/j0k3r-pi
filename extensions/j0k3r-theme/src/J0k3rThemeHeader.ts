import { keyHint, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface J0k3rThemeHeaderData {
	projectName: string;
	branch?: string;
	skillNames: string[];
	extensionNames: string[];
}

const RESET = "\x1b[0m";
const CYAN = "\x1b[1;38;2;0;229;255m";
const BLUE = "\x1b[1;38;2;23;147;209m";
const PINK = "\x1b[1;38;2;255;45;247m";
const VIOLET = "\x1b[1;38;2;153;92;255m";
const LIME = "\x1b[1;38;2;102;255;102m";
const AMBER = "\x1b[1;38;2;255;184;77m";
const DIM = "\x1b[2m";

function electric(color: string, text: string): string {
	return `${color}${text}${RESET}`;
}

function fit(text: string, width: number): string {
	return truncateToWidth(text, Math.max(0, width), "");
}

function pad(text: string, width: number): string {
	const fitted = fit(text, width);
	return fitted + " ".repeat(Math.max(0, width - visibleWidth(fitted)));
}

function titledBorder(title: string, innerWidth: number): string {
	const titleText = ` ${title} `;
	const rest = Math.max(0, innerWidth - visibleWidth(titleText));
	const leftDash = Math.min(5, rest);
	const rightDash = Math.max(0, rest - leftDash);
	return `${electric(CYAN, "╭")}${electric(CYAN, "─".repeat(leftDash))}${electric(LIME, titleText)}${electric(CYAN, "─".repeat(rightDash))}${electric(CYAN, "╮")}`;
}

function bottomBorder(innerWidth: number): string {
	return `${electric(CYAN, "╰")}${electric(CYAN, "─".repeat(innerWidth))}${electric(CYAN, "╯")}`;
}

function boxLine(content: string, innerWidth: number): string {
	return `${electric(CYAN, "│")} ${pad(content, Math.max(0, innerWidth - 2))} ${electric(CYAN, "│")}`;
}

function metric(label: string, value: string | number, color: string): string {
	return `${electric(DIM, label)} ${electric(color, String(value))}`;
}

function compactList(items: string[]): string {
	return items.length > 0 ? items.join(", ") : "none";
}

function wrappedListLines(label: string, items: string[], width: number, labelColor: string, itemColor: string): string[] {
	const prefix = `${electric(labelColor, label)} ${electric(DIM, "→")} `;
	const values = items.length > 0 ? items : ["none"];
	const lines: string[] = [];
	let current = prefix;
	let currentVisibleWidth = visibleWidth(prefix);

	for (const value of values) {
		const chunk = electric(itemColor, value);
		const separator = current === prefix ? "" : electric(DIM, ", ");
		const nextVisibleWidth = currentVisibleWidth + visibleWidth(separator) + visibleWidth(chunk);
		if (current !== prefix && nextVisibleWidth > width) {
			lines.push(current);
			current = `${electric(DIM, "  ")} ${chunk}`;
			currentVisibleWidth = visibleWidth(current);
			continue;
		}

		current += `${separator}${chunk}`;
		currentVisibleWidth = nextVisibleWidth;
	}

	lines.push(current);
	return lines;
}

export class J0k3rThemeHeader implements Component {
	private expanded: boolean;

	constructor(
		private readonly theme: Theme,
		private data: J0k3rThemeHeaderData,
		expanded = false,
	) {
		this.expanded = expanded;
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
	}

	setData(data: J0k3rThemeHeaderData): void {
		this.data = data;
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		if (width < 24) return [fit(`j0k3r-pi ${this.data.projectName}`, width)];

		const innerWidth = Math.max(0, width - 2);
		const project = `${electric(BLUE, "Project")} ${electric(LIME, this.data.projectName)}`;
		const branch = this.data.branch ? ` ${electric(VIOLET, "|")} ${electric(BLUE, "branch")} ${electric(PINK, `- ${this.data.branch}`)}` : "";
		const summary = [
			metric("skills", this.data.skillNames.length, AMBER),
			metric("extensions", this.data.extensionNames.length, CYAN),
			this.expanded ? keyHint("app.tools.expand", "contract") : keyHint("app.tools.expand", "expand"),
		].join(electric(VIOLET, " · "));

		const lines = [
			titledBorder("welcome to j0k3r-pi", innerWidth),
			boxLine(`${project}${branch}`, innerWidth),
			boxLine(summary, innerWidth),
		];
		if (this.expanded) {
			const contentWidth = Math.max(0, innerWidth - 2);
			lines.push(...wrappedListLines("skills", this.data.skillNames, contentWidth, AMBER, LIME).map((line) => boxLine(line, innerWidth)));
			lines.push(...wrappedListLines("extensions", this.data.extensionNames, contentWidth, CYAN, BLUE).map((line) => boxLine(line, innerWidth)));
		}
		lines.push(bottomBorder(innerWidth));
		return lines;
	}

	invalidate(): void {}
}
