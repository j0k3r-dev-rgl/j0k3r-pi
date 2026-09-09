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

const WIDE_BANNER = [
	"                 +",
	"                +@=",
	"               .@*@",
	"               ** #+",
	"              =@. -@.",
	"             .@+   **",
	"             *#    .@+                     #@*        ..      =*+            ..",
	"             @=     =@-                    *@+     .*@@@@+    +@*         =#@@@@#=",
	"           .#*@+     +#                           .@@=..#@*   +@*        .##=..=@@-",
	"           *#*@@+     #+               -******    *@+  -@@@-  +@*   .+*-        #@+   =**- +*#*.",
	"          +@.  =*.    -@-              -+++*@@    @@= .@##@+  +@*  =@@=        -@@-   =*@*@@*@@.",
	"         -@-           =@.                 .@@    @@- #@-*@*  +@* *@#-      -#@@#-     -@@*  #@",
	"        .@=             *#                 .@@    @@-*@- *@*  +@#@@+        .-=+@@=    -@@",
	"        **               #+                .@@    @@*@=  #@+  +@*+@@-           =@#    -@#",
	"       +@.    .+###+     .@-               .@@    *@@+  .@@-  +@* =@@=    -     =@@    -@#",
	"      -@-    .#*  .#*     =@.              .@@    .@@+.-#@+   +@*  -@@+  =@#=..=@@+   .=@#--",
	"     .@=     +#    .@=     *#              -@@     .*@@@@+    =@*   .#@*  =#@@@@#=    *@@@@@.",
	"     #*      @=     *#   =*+@+            .#@+        .                      ..",
	"    +@.      @.     =@    +#@#.        =+*@@=",
	"   =@-     -=@-     =@=-    =#+.       ##*=",
	"  .@=  -+#@#*=      .=*#@*+-  *#",
	"  #*=*@#+-               -+#@*-#*",
	" +@@*=.                     .+#@@=",
	"=#=.                           .=*.",
];

const COMPACT_BANNER = [
	"             =",
	"            .@=",
	"            +##",
	"           .@.#-",
	"           +* =*",
	"          .@.  #-",
	"          +*   =#                =@*      ..    .*=         ..",
	"          #=    #-               =@+    =@@@#.  .@+       +@@@@=",
	"         +*@-   =#                     -@*.-@*  .@+      .@+.-#@-",
	"        -@*@@.   #=            ****+   *@. =@@- .@+  .*+      =@+  =*+ +##-",
	"        #=  +=   -#            ++*@@   #@ .@*@= .@+ -@@-      *@-  =#@*@*@=",
	"       =#         *+              #@   @# *#=@+ -@+-@#.    .#@@=    +@@..@-",
	"       @-         .@-             #@   @#-@--@+ -@*@#       -=*@-   =@=",
	"      +*           =*             #@   #@@+ =@= -@+#@=         @#   =@-",
	"     -@.   -###-    #=            #@   *@#  +@- .@+ #@-   .    @#   +@-",
	"     *=    @= -@-   -#            #@   -@#.-@*  .@+ .#@- =@+.-*@+  .+@=-",
	"    =#    +*   +*    *+           ##    =@@@*.  .@+  .##. +@@@@+   *@@@@",
	"    @-    #-   .@  .#+@.         =@+      .                 ..",
	"   +*     @.    @   =#@+      -+#@+",
	"  -@.   .=@.    @=.   +#-     *#+-",
	"  #= .+#@*=     =*##+- =#",
	" =#=#@+-           .+##=*+",
	" @@*=                 -*@@.",
	"=*-                     .++",
];

function lerp(a: number, b: number, t: number): number {
	return Math.round(a + (b - a) * t);
}

function lerpColor(c1: [number, number, number], c2: [number, number, number], t: number): [number, number, number] {
	return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

function getGradientColor(x: number, y: number, isWide: boolean): string {
	const splitX = isWide ? 42 : 33;
	const maxX = isWide ? 96 : 75;
	const maxY = 24;

	if (x < splitX) {
		// Arch logo: Electric Cyan (#00f0ff) -> Arch Blue (#1793d1) -> Neon Cyan (#00e5ff)
		const t = Math.max(0, Math.min(1, x / (splitX - 1)));
		const apexX = isWide ? 17 : 13;
		const apexDist = Math.abs(x - apexX) / (isWide ? 20 : 15);
		const base =
			t < 0.5
				? lerpColor([0, 240, 255], [23, 147, 235], t * 2)
				: lerpColor([23, 147, 235], [0, 230, 255], (t - 0.5) * 2);

		// High-voltage glow on apex & upper ridge
		const glow = Math.max(0, 1.0 - apexDist) * (1.0 - y / maxY) * 0.35;
		const r = Math.min(255, Math.round(base[0] + (255 - base[0]) * glow));
		const g = Math.min(255, Math.round(base[1] + (255 - base[1]) * glow));
		const b = Math.min(255, Math.round(base[2] + (255 - base[2]) * glow));
		return `\x1b[38;2;${r};${g};${b}m`;
	}

	// j0k3r text: Electric Cyber Spectrum (Cyan -> Mint -> Neon Green -> Acid Lime -> Cyber Amber -> Neon Pink -> Violet -> Cyan)
	const t = Math.max(0, Math.min(1, (x - splitX) / (maxX - splitX)));
	const palette: [number, number, number][] = [
		[0, 240, 255],   // Electric Cyan
		[0, 255, 160],   // Neon Mint
		[90, 255, 60],   // Electric Lime
		[255, 190, 50],  // Cyber Amber
		[255, 45, 247],  // Cyberpunk Pink
		[155, 92, 255],  // Electric Violet
		[0, 240, 255],   // Return to Cyan
	];
	const pos = t * (palette.length - 1);
	const idx = Math.min(Math.floor(pos), palette.length - 2);
	const subT = pos - idx;
	const base = lerpColor(palette[idx], palette[idx + 1], subT);

	// Subtle vertical intensity
	const vPulse = 0.15 * (1.0 - y / maxY);
	const r = Math.min(255, Math.round(base[0] * (1.0 + vPulse)));
	const g = Math.min(255, Math.round(base[1] * (1.0 + vPulse)));
	const b = Math.min(255, Math.round(base[2] * (1.0 + vPulse)));
	return `\x1b[38;2;${r};${g};${b}m`;
}

function colorizeBanner(lines: readonly string[], isWide: boolean): string[] {
	return lines.map((line, y) => {
		let colored = "";
		for (let x = 0; x < line.length; x++) {
			const ch = line[x];
			if (ch === " ") {
				colored += " ";
			} else {
				colored += `${getGradientColor(x, y, isWide)}${ch}`;
			}
		}
		return `${colored}\x1b[0m`;
	});
}

const COLORED_WIDE_BANNER = colorizeBanner(WIDE_BANNER, true);
const COLORED_COMPACT_BANNER = colorizeBanner(COMPACT_BANNER, false);

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

	constructor(
		private readonly theme: Theme,
		private data: J0k3rThemeHeaderData,
		expanded = false,
		bannerVisible = true,
	) {
		this.expanded = expanded;
		this.bannerVisible = bannerVisible;
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

		if (this.bannerVisible) {
			const useWide = width >= 100;
			const banner = useWide ? COLORED_WIDE_BANNER : COLORED_COMPACT_BANNER;
			const bannerWidth = useWide ? 96 : 75;

			if (width >= bannerWidth + 2) {
				const leftPad = Math.max(0, Math.floor((width - bannerWidth) / 2));
				const padStr = " ".repeat(leftPad);
				lines.push("");
				for (const bannerLine of banner) {
					lines.push(`${padStr}${bannerLine}`);
				}
			}
		}

		return lines;
	}

	invalidate(): void {}
}
