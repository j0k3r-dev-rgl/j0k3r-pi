import { keyHint, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
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

const ARCH_OUTER_POLY: [number, number][] = [
	[0.0, 1.3],
	[0.35, 0.3],
	[0.55, -0.35],
	[0.48, -0.42],
	[0.78, -0.52],
	[0.9, -0.85],
	[0.72, -1.0],
	[0.45, -0.92],
	[0.28, -0.55],
	[0.0, -0.15],
	[-0.28, -0.55],
	[-0.45, -0.92],
	[-0.72, -1.0],
	[-0.9, -0.85],
	[-0.75, -0.25],
	[-0.42, 0.15],
];

const ARCH_DEPTH = 0.28;

const ARCH_3D_W = 34;
const ARCH_3D_H = 20;
const TOTAL_3D_FRAMES = 60;

function pointInArch(x: number, y: number): boolean {
	if (y > 1.3 || y < -1.0) return false;
	let inside = false;
	const n = ARCH_OUTER_POLY.length;
	for (let i = 0; i < n; i++) {
		const [x1, y1] = ARCH_OUTER_POLY[i];
		const [x2, y2] = ARCH_OUTER_POLY[(i + 1) % n];
		if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1 + 1e-9) + x1) {
			inside = !inside;
		}
	}
	return inside;
}

function precomputeArchSamples(): [number, number][] {
	const samples: [number, number][] = [];
	for (let sy = 0; sy < 45; sy++) {
		const y = 1.3 - (sy / 44.0) * 2.3;
		for (let sx = 0; sx < 45; sx++) {
			const x = -0.95 + (sx / 44.0) * 1.9;
			if (pointInArch(x, y)) {
				samples.push([x, y]);
			}
		}
	}
	return samples;
}

const ARCH_SAMPLES = precomputeArchSamples();

function generateArch3DFrames(): string[][] {
	const frames: string[][] = [];
	const depth = 0.22;
	const tiltX = 0.22;
	const cosB = Math.cos(tiltX);
	const sinB = Math.sin(tiltX);

	// Distinguish 3D planes with distinct colors:
	const frontCh = "\x1b[1;38;2;0;240;255m@\x1b[0m"; // Front face: Electric Cyan
	const sideCh = "\x1b[1;38;2;23;147;235m#\x1b[0m";  // Side walls/bevel: Arch Blue
	const backCh = "\x1b[38;2;120;70;200m*\x1b[0m";   // Back face: Cyber Violet

	for (let f = 0; f < TOTAL_3D_FRAMES; f++) {
		const angleY = (f * (360 / TOTAL_3D_FRAMES) * Math.PI) / 180;
		const cosA = Math.cos(angleY);
		const sinA = Math.sin(angleY);

		const grid: string[][] = Array.from({ length: ARCH_3D_H }, () => Array(ARCH_3D_W).fill(" "));
		const zbuf: number[][] = Array.from({ length: ARCH_3D_H }, () => Array(ARCH_3D_W).fill(-999));

		function putPixel(x: number, y: number, z: number, ch: string) {
			const x1 = x * cosA + z * sinA;
			const z1 = -x * sinA + z * cosA;
			const y2 = y * cosB - z1 * sinB;
			const z2 = y * sinB + z1 * cosB;
			const dist = 3.2;
			const k = dist / (dist + z2);
			const sx = Math.floor(ARCH_3D_W / 2 + x1 * k * 15.0);
			const sy = Math.floor(ARCH_3D_H / 2 - y2 * k * 8.0);
			if (sx >= 0 && sx < ARCH_3D_W && sy >= 0 && sy < ARCH_3D_H) {
				if (z2 > zbuf[sy][sx]) {
					zbuf[sy][sx] = z2;
					grid[sy][sx] = ch;
				}
			}
		}

		// Front face plane (solid filled!)
		for (const [x, y] of ARCH_SAMPLES) {
			putPixel(x, y, depth, frontCh);
		}

		// Back face plane (solid filled!)
		for (const [x, y] of ARCH_SAMPLES) {
			putPixel(x, y, -depth, backCh);
		}

		// Lateral extruded perimeter walls (depth & bevel)
		const n = ARCH_OUTER_POLY.length;
		for (let i = 0; i < n; i++) {
			const [x1, y1] = ARCH_OUTER_POLY[i];
			const [x2, y2] = ARCH_OUTER_POLY[(i + 1) % n];
			const steps = Math.floor(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 30) + 1;
			for (let s = 0; s <= steps; s++) {
				const t = s / steps;
				const px = x1 + (x2 - x1) * t;
				const py = y1 + (y2 - y1) * t;
				for (let wStep = 0; wStep < 7; wStep++) {
					const pz = -depth + (2 * depth) * (wStep / 6.0);
					putPixel(px, py, pz, sideCh);
				}
			}
		}

		frames.push(grid.map((r) => r.join("")));
	}
	return frames;
}

const ARCH_3D_FRAMES = generateArch3DFrames();

const J0K3R_ASCII = [
	"    .@@@@.                                                            ",
	"    .@@@@.     .*@@@@+    +@*         =#@@@@#=                        ",
	"              .@@=..#@*   +@*        .##=..=@@-                       ",
	"    .@@@@.    *@+  -@@@-  +@*   .+*-        #@+   =**- +*#*.          ",
	"    .@@@@.    @@= .@##@+  +@*  =@@=        -@@-   =*@*@@*@@.          ",
	"    .@@@@.    @@- #@-*@*  +@* *@#-      -#@@#-     -@@*  #@           ",
	"    .@@@@.    @@-*@- *@*  +@#@@+        .-=+@@=    -@@                ",
	"    .@@@@.    @@*@=  #@+  +@*+@@-           =@#    -@#                ",
	"    .@@@@.    *@@+  .@@-  +@* =@@=    -     =@@    -@#                ",
	"    .@@@@.    .@@+.-#@+   +@*  -@@+  =@#=..=@@+   .=@#--             ",
	"    .@@@@.     .*@@@@+    =@*   .#@*  =#@@@@#=    *@@@@@.             ",
	".@@ .@@@@.                                                            ",
	"*@@..@@@@.                                                            ",
	" #@@@@@@.                                                             ",
	"  .*@@*.                                                              ",
];

function lerp(a: number, b: number, t: number): number {
	return Math.round(a + (b - a) * t);
}

function lerpColor(c1: [number, number, number], c2: [number, number, number], t: number): [number, number, number] {
	return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

function colorizeJ0k3rLines(): string[] {
	const palette: [number, number, number][] = [
		[0, 240, 255],   // Cyan
		[0, 255, 160],   // Mint
		[90, 255, 60],   // Lime
		[255, 190, 50],  // Amber
		[255, 45, 247],  // Pink
		[155, 92, 255],  // Violet
		[0, 240, 255],   // Cyan
	];
	const maxLen = 60;

	return J0K3R_ASCII.map((line) => {
		let colored = "";
		for (let x = 0; x < line.length; x++) {
			const ch = line[x];
			if (ch === " ") {
				colored += " ";
			} else {
				const t = Math.min(1.0, x / maxLen);
				const pos = t * (palette.length - 1);
				const idx = Math.min(Math.floor(pos), palette.length - 2);
				const subT = pos - idx;
				const [r, g, b] = lerpColor(palette[idx], palette[idx + 1], subT);
				colored += `\x1b[38;2;${r};${g};${b}m${ch}\x1b[0m`;
			}
		}
		return colored;
	});
}

const COLORED_J0K3R = colorizeJ0k3rLines();

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
	private frameIndex = 0;
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
		this.frameIndex = (this.frameIndex + 1) % TOTAL_3D_FRAMES;
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
				const archFrame = ARCH_3D_FRAMES[this.frameIndex];
				const canShowBoth = width >= 104;
				const canShowArchOnly = width >= 56;

				if (canShowBoth) {
					const gap = 6;
					const j0k3rWidth = 60;
					const totalW = ARCH_3D_W + gap + j0k3rWidth; // 34 + 6 + 60 = 100 cols
					const leftPad = Math.max(0, Math.floor((width - totalW) / 2));
					const padStr = " ".repeat(leftPad);
					lines.push("");
					lines.push("");
					lines.push("");
					lines.push("");
					for (let y = 0; y < ARCH_3D_H; y++) {
						const left = archFrame[y];
						const jy = y - 3;
						const right = jy >= 0 && jy < COLORED_J0K3R.length ? COLORED_J0K3R[jy] : "";
						lines.push(fit(`${padStr}${left}${" ".repeat(gap)}${right}`, width));
					}
				} else if (canShowArchOnly) {
					const leftPad = Math.max(0, Math.floor((width - ARCH_3D_W) / 2));
					const padStr = " ".repeat(leftPad);
					lines.push("");
					lines.push("");
					lines.push("");
					lines.push("");
					for (let y = 0; y < ARCH_3D_H; y++) {
						lines.push(fit(`${padStr}${archFrame[y]}`, width));
					}
				}
			}
		}

		return lines;
	}

	invalidate(): void {}
}
