import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const RESET = "\x1b[0m";
export const PINK = "\x1b[1;38;2;255;45;247m";
export const RED = "\x1b[1;38;2;255;77;109m";
export const LIME = "\x1b[1;38;2;102;255;102m";
export const AMBER = "\x1b[1;38;2;255;184;77m";
export const DIM = "\x1b[2m";
export const MUTED = "\x1b[38;2;122;167;184m";

/** Short inline row separator; not a card frame. */
export const ROW_SEPARATOR = " ─ ";

const ANSI_TOKEN_RE = /(\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~])/g;
const ANSI_ESCAPE_RE = /\x1b(?:\[|\])/;
const GRAPHEME_SEGMENTER = new Intl.Segmenter("en", { granularity: "grapheme" });

export function electric(color: string, text: string): string {
	return `${color}${text}${RESET}`;
}

export function hasAnsi(text: string): boolean {
	return ANSI_ESCAPE_RE.test(text);
}

export function styleMuted(theme: { fg?: (token: string, text: string) => string } | undefined, text: string): string {
	if (!text) return text;
	if (typeof theme?.fg === "function") {
		const styled = theme.fg("muted", text);
		if (typeof styled === "string" && styled !== text) return styled;
	}
	return `${MUTED}${text}${RESET}`;
}

function stripAnsiTokens(text: string): string {
	return text.replace(ANSI_TOKEN_RE, "");
}

function firstPrintingGraphemeWidth(plain: string): number {
	for (const { segment } of GRAPHEME_SEGMENTER.segment(plain)) {
		const w = visibleWidth(segment);
		if (w > 0) return w;
	}
	return 0;
}

export function needsWidth2MarginOmission(line: string, totalWidth: number): boolean {
	if (totalWidth !== 2) return false;
	const plain = stripAnsiTokens(line);
	if (plain === "") return false;
	return visibleWidth(plain) === 2 && firstPrintingGraphemeWidth(plain) === 2;
}

export function formatMarginedLine(line: string, totalWidth: number): string {
	if (totalWidth <= 0) return "";
	if (totalWidth === 1) return " ";
	if (needsWidth2MarginOmission(line, totalWidth)) return line;
	return ` ${line}`;
}

function wrapAnsiForWidth2(rawLine: string): string[] {
	if (rawLine === "") return [""];
	if (visibleWidth(rawLine) <= 1) return [rawLine];
	const out: string[] = [];
	let current = "";
	let currentWidth = 0;
	let chunkLimit = 1;
	let activeSgr = "";
	let pendingAnsi = "";

	const flush = () => {
		const terminated = activeSgr && !current.endsWith(RESET) ? `${current}${RESET}` : current;
		out.push(terminated);
		current = activeSgr;
		currentWidth = 0;
		chunkLimit = 1;
	};

	const applyPending = () => {
		if (!pendingAnsi) return;
		current += pendingAnsi;
		pendingAnsi = "";
	};

	for (const part of rawLine.split(ANSI_TOKEN_RE)) {
		if (!part) continue;
		if (part.startsWith("\x1b[")) {
			if (part === RESET || part === "\x1b[m") {
				if (pendingAnsi) {
					current += pendingAnsi;
					pendingAnsi = "";
				}
				current += part;
				activeSgr = "";
			} else {
				pendingAnsi += part;
				if (part.endsWith("m")) activeSgr += part;
			}
			continue;
		}
		if (part.startsWith("\x1b]")) {
			pendingAnsi += part;
			continue;
		}
		for (const { segment } of GRAPHEME_SEGMENTER.segment(part)) {
			const expanded = segment === "\t" ? [" ", " ", " "] : [segment];
			for (const piece of expanded) {
				const gw = visibleWidth(piece);
				if (gw === 0) {
					applyPending();
					current += piece;
					continue;
				}
				if (gw > 1 && gw <= 2) {
					if (currentWidth > 0) flush();
					applyPending();
					chunkLimit = 2;
					current += piece;
					currentWidth = gw;
					continue;
				}
				if (currentWidth > 0 && currentWidth + gw > chunkLimit) {
					flush();
				}
				applyPending();
				current += piece;
				currentWidth += gw;
			}
		}
	}
	if (pendingAnsi) {
		current += pendingAnsi;
		pendingAnsi = "";
	}
	if (current !== activeSgr || out.length === 0) {
		const terminated = activeSgr && !current.endsWith(RESET) ? `${current}${RESET}` : current;
		out.push(terminated);
	}
	return out;
}

export function fit(text: string, width: number): string {
	return truncateToWidth(text, Math.max(0, width), "");
}

export function visible(text: string): number {
	return visibleWidth(text);
}

/**
 * Compact inline header joining non-empty parts, wrapping automatically on
 * width overflow without ellipsis clipping. Returns no cells for non-positive width.
 */
export function rowLine(parts: Array<string | undefined | null>, width: number, totalWidth?: number): string[] {
	if (width <= 0) return [];
	const line = parts
		.filter((part): part is string => Boolean(part && part.trim()))
		.map((part) => part.replace(/[\r\n]+/g, " "))
		.join(ROW_SEPARATOR);
	if (!line) return [];
	return textLines(line, width, totalWidth);
}

/** Wrap content losslessly; blank lines are preserved as empty rows. */
export function textLines(text: string, width: number, totalWidth?: number): string[] {
	if (width <= 0) return [];
	const allowWidth2Wide = totalWidth === 2;
	const out: string[] = [];
	for (const raw of text.split(/\r?\n/)) {
		if (raw === "") {
			out.push("");
			continue;
		}
		if (visibleWidth(raw) <= width) {
			out.push(raw);
			continue;
		}
		if (allowWidth2Wide && width === 1) {
			out.push(...wrapAnsiForWidth2(raw));
			continue;
		}
		const segments = wrapTextWithAnsi(raw, width);
		if (segments.length === 0) out.push("");
		else out.push(...segments);
	}
	return out;
}

export interface CodeGraphRowState {
	hasResult?: boolean;
	isError?: boolean;
	isPartial?: boolean;
	expanded?: boolean;
}
