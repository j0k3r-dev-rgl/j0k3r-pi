import { keyHint, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	ARCH_ANIM_FRAMES,
	ARCH_BANNER_LINES,
	ARCH_BANNER_WIDTH,
	CAT_ANIM_FRAMES,
	CAT_BANNER_LINES,
	CAT_BANNER_WIDTH,
	MUSTACHE_ANIM_FRAMES,
	MUSTACHE_BANNER_LINES,
	MUSTACHE_BANNER_WIDTH,
	ONI_ANIM_FRAMES,
	ONI_BANNER_LINES,
	ONI_BANNER_WIDTH,
	type WelcomeBannerStyle,
} from "./banners.js";

export { type WelcomeBannerStyle } from "./banners.js";

export interface J0k3rThemeHeaderData {
	projectName: string;
	repoName?: string;
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
	private bannerVisible: boolean;
	private archLoopIndex = 0;
	private mustacheLoopIndex = 0;
	private catLoopIndex = 0;
	private oniLoopIndex = 0;

	constructor(
		private readonly theme: Theme,
		private data: J0k3rThemeHeaderData,
		expanded = false,
		bannerVisible = true,
		private bannerStyle: WelcomeBannerStyle = "default",
	) {
		this.expanded = expanded;
		this.bannerVisible = bannerVisible;
	}

	setBannerStyle(style: WelcomeBannerStyle): void {
		this.bannerStyle =
			style === "mustache" ? "mustache" : style === "cat" ? "cat" : style === "oni" ? "oni" : "default";
	}

	getBannerStyle(): WelcomeBannerStyle {
		return this.bannerStyle;
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
	}

	setData(data: J0k3rThemeHeaderData): void {
		this.data = data;
	}

	setBannerVisible(visible: boolean): void {
		this.bannerVisible = visible;
	}

	isBannerVisible(): boolean {
		return this.bannerVisible;
	}

	nextFrame(): void {
		this.nextArchFrame();
	}

	nextArchFrame(): void {
		this.archLoopIndex = (this.archLoopIndex + 1) % ARCH_ANIM_FRAMES.length;
	}

	setArchFrame(frameIndex: number): void {
		this.archLoopIndex = Math.max(0, Math.min(frameIndex, ARCH_ANIM_FRAMES.length - 1));
	}

	nextMustacheFrame(): void {
		this.mustacheLoopIndex = (this.mustacheLoopIndex + 1) % MUSTACHE_ANIM_FRAMES.length;
	}

	setMustacheFrame(frameIndex: number): void {
		this.mustacheLoopIndex = Math.max(0, Math.min(frameIndex, MUSTACHE_ANIM_FRAMES.length - 1));
	}

	nextCatFrame(): void {
		this.catLoopIndex = (this.catLoopIndex + 1) % CAT_ANIM_FRAMES.length;
	}

	setCatFrame(frameIndex: number): void {
		this.catLoopIndex = Math.max(0, Math.min(frameIndex, CAT_ANIM_FRAMES.length - 1));
	}

	nextOniFrame(): void {
		this.oniLoopIndex = (this.oniLoopIndex + 1) % ONI_ANIM_FRAMES.length;
	}

	setOniFrame(frameIndex: number): void {
		this.oniLoopIndex = Math.max(0, Math.min(frameIndex, ONI_ANIM_FRAMES.length - 1));
	}

	dispose(): void {
		this.bannerVisible = false;
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		const appTitle =
			this.bannerStyle === "mustache"
				? "mostachi-pi"
				: this.bannerStyle === "cat"
					? "michi-pi"
					: this.bannerStyle === "oni"
						? "oni-pi"
						: "j0k3r-pi";
		if (width < 24) return [fit(`${appTitle} ${this.data.repoName || this.data.projectName}`, width)];

		const innerWidth = Math.max(0, width - 2);

		const segments: string[] = [];
		const hasDistinctProject = !this.data.repoName || this.data.projectName !== this.data.repoName;
		if (hasDistinctProject) {
			segments.push(`${electric(BLUE, "Project")} ${electric(LIME, this.data.projectName)}`);
		}
		if (this.data.repoName) {
			segments.push(`${electric(BLUE, "repo")} ${electric(CYAN, `- ${this.data.repoName}`)}`);
		}
		if (this.data.branch) {
			segments.push(`${electric(BLUE, "branch")} ${electric(PINK, `- ${this.data.branch}`)}`);
		}
		const projectLine = segments.join(` ${electric(VIOLET, "|")} `);

		const summary = [
			metric("skills", this.data.skillNames.length, AMBER),
			metric("extensions", this.data.extensionNames.length, CYAN),
			this.expanded ? keyHint("app.tools.expand", "contract") : keyHint("app.tools.expand", "expand"),
		].join(electric(VIOLET, " · "));

		const welcomeTitle =
			this.bannerStyle === "mustache"
				? "welcome to mostachi-pi"
				: this.bannerStyle === "cat"
					? "welcome to michi-pi"
					: this.bannerStyle === "oni"
						? "welcome to oni-pi"
						: "welcome to j0k3r-pi";
		const lines = [
			titledBorder(welcomeTitle, innerWidth),
			boxLine(projectLine, innerWidth),
			boxLine(summary, innerWidth),
		];
		if (this.expanded) {
			const contentWidth = Math.max(0, innerWidth - 2);
			lines.push(...wrappedListLines("skills", this.data.skillNames, contentWidth, AMBER, LIME).map((line) => boxLine(line, innerWidth)));
			lines.push(...wrappedListLines("extensions", this.data.extensionNames, contentWidth, CYAN, BLUE).map((line) => boxLine(line, innerWidth)));
		}
		lines.push(bottomBorder(innerWidth));

		if (this.bannerVisible) {
			if (this.bannerStyle === "mustache") {
				if (width >= 68) {
					lines.push("");
					lines.push("");
					const leftPad = Math.max(0, Math.floor((width - MUSTACHE_BANNER_WIDTH) / 2));
					const padStr = " ".repeat(leftPad);
					const bannerArt = MUSTACHE_ANIM_FRAMES[this.mustacheLoopIndex] ?? MUSTACHE_BANNER_LINES;
					for (const line of bannerArt) {
						lines.push(fit(`${padStr}${line}`, width));
					}
				}
			} else if (this.bannerStyle === "cat") {
				if (width >= 68) {
					lines.push("");
					lines.push("");
					const leftPad = Math.max(0, Math.floor((width - CAT_BANNER_WIDTH) / 2));
					const padStr = " ".repeat(leftPad);
					const bannerArt = CAT_ANIM_FRAMES[this.catLoopIndex] ?? CAT_BANNER_LINES;
					for (const line of bannerArt) {
						lines.push(fit(`${padStr}${line}`, width));
					}
				}
			} else if (this.bannerStyle === "oni") {
				if (width >= 68) {
					lines.push("");
					lines.push("");
					const leftPad = Math.max(0, Math.floor((width - ONI_BANNER_WIDTH) / 2));
					const padStr = " ".repeat(leftPad);
					const bannerArt = ONI_BANNER_LINES;
					for (const line of bannerArt) {
						lines.push(fit(`${padStr}${line}`, width));
					}
				}
			} else {
				if (width >= 68) {
					lines.push("");
					lines.push("");
					const leftPad = Math.max(0, Math.floor((width - ARCH_BANNER_WIDTH) / 2));
					const padStr = " ".repeat(leftPad);
					const bannerArt = ARCH_ANIM_FRAMES[this.archLoopIndex] ?? ARCH_BANNER_LINES;
					for (const line of bannerArt) {
						lines.push(fit(`${padStr}${line}`, width));
					}
				}
			}
		}

		return lines;
	}

	invalidate(): void {}
}
