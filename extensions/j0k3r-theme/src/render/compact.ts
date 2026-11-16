import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { AMBER, CYAN, DIM, LIME, RED, electric } from "./borders.js";

/** Presentation-only conformance marker. Never changes schema, execution or result data. */
export const COMPACT_TOOL_RENDERING_VERSION = 1;
export const COMPACT_TOOL_RENDERING_KEY = "compactToolRenderingVersion";
/** Presentation-only opt-in flag indicating lines already include the 1-column left margin. */
export const COMPACT_LEFT_MARGIN_KEY = "compactLeftMargin";
export const COMPACT_LEFT_MARGIN_VALUE = 1;

/** Minimal structural renderer pair, independent of the installed Pi version's exact types. */
export interface CompactRenderers {
	renderShell?: "default" | "self";
	renderCall?: (args: any, theme: any, context: any) => Component;
	renderResult?: (result: any, options: any, theme: any, context: any) => Component;
	[COMPACT_LEFT_MARGIN_KEY]?: number;
}

export interface CompactOwner extends CompactRenderers {
	[COMPACT_TOOL_RENDERING_KEY]?: number;
}

/** True when a renderer definition or component already applies the 1-column left margin. */
export function hasLeftMargin(value: unknown): boolean {
	return Boolean(value && typeof value === "object" && (value as any)[COMPACT_LEFT_MARGIN_KEY] === COMPACT_LEFT_MARGIN_VALUE);
}

const ANSI_TOKEN_RE = /(\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~])/g;
const GRAPHEME_SEGMENTER = new Intl.Segmenter("en", { granularity: "grapheme" });

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

/**
 * True only at total width 2 when omitting the 1-column left margin is necessary to fit an
 * intact two-column grapheme on this generated line.
 */
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
	return ` ${fitLine(line, totalWidth - 1)}`;
}

/**
 * Wraps a component that does not already emit a 1-column left margin so every rendered line
 * starts with `" "` and lays out within `width - 1`, except at total width 2 where omitting the
 * margin is necessary to fit an intact two-column grapheme. Empty `[]` results stay `[]`,
 * `width <= 0` emits `[]`, and `width === 1` emits `[" "]` for non-empty blocks.
 */
export function wrapLeftMarginComponent(component: any): any {
	if (!component || typeof component.render !== "function" || hasLeftMargin(component)) return component;
	const wrapped: Record<string, any> = {
		[COMPACT_LEFT_MARGIN_KEY]: COMPACT_LEFT_MARGIN_VALUE,
		invalidate() {
			component.invalidate?.();
		},
		render(width: number): string[] {
			const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
			if (safeWidth <= 0) return [];
			if (safeWidth === 1) {
				const probe = component.render(2);
				return Array.isArray(probe) && probe.length > 0 ? [" "] : [];
			}
			const innerWidth = safeWidth - 1;
			const lines = component.render(innerWidth);
			if (!Array.isArray(lines) || lines.length === 0) return [];
			return lines.map((line) => formatMarginedLine(String(line), safeWidth));
		},
	};
	if (typeof component.handleMouse === "function") {
		wrapped.handleMouse = (event: any) => component.handleMouse(event);
	}
	if (typeof component.handleInput === "function") {
		wrapped.handleInput = (data: any) => component.handleInput(data);
	}
	if (typeof component.dispose === "function") {
		wrapped.dispose = () => component.dispose();
	}
	return wrapped;
}

/** True when an owner definition opted into the compact presentation contract. */
export function isCompactCompliant(value: unknown): boolean {
	const owner = value as CompactOwner | undefined;
	return owner?.[COMPACT_TOOL_RENDERING_KEY] === COMPACT_TOOL_RENDERING_VERSION;
}

/** True when a definition can be delegated to without entering Pi's default shell. */
export function isSelfRendered(value: CompactOwner | undefined): value is Required<Pick<CompactRenderers, "renderCall" | "renderResult">> & CompactOwner & { renderShell: "self" } {
	return (
		isCompactCompliant(value) &&
		value?.renderShell === "self" &&
		typeof value?.renderCall === "function" &&
		typeof value?.renderResult === "function"
	);
}

/** Text blocks of a tool result joined in order, exactly as the model receives them. */
export function resultText(result: any): string {
	if (!result?.content || !Array.isArray(result.content)) return "";
	return result.content
		.filter((block: any) => block?.type === "text" && typeof block.text === "string")
		.map((block: any) => block.text)
		.join("\n");
}

/** Number of lines in `text`, counted without allocating a split array. */
export function countLines(text: string): number {
	if (text.length === 0) return 0;
	let count = 1;
	for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) === 10) count++;
	return count;
}

/**
 * Display-only home abbreviation: only a separator-bounded home prefix becomes `~`. Commands, URLs
 * and arguments that merely start with the same characters are left untouched.
 */
export function abbreviateHome(value: string, home: string = process.env.HOME ?? ""): string {
	if (!value || !home || home === "/") return value;
	if (value !== home && !value.startsWith(`${home}/`)) return value;
	return value === home ? "~" : `~${value.slice(home.length)}`;
}

function clip(text: string, max: number): string {
	if (max <= 0) return "";
	return visibleWidth(text) <= max ? text : truncateToWidth(text, max, "…");
}

/**
 * Narrow, safe argument summary: scalars only, capped entries and length, no nested structures.
 * Provider arguments may carry private payloads, so deeper values are never serialized here.
 */
export function summarizeArgs(args: unknown, maxEntries = 3, maxValue = 40): string {
	if (args === null || args === undefined) return "";
	if (typeof args !== "object") return typeof args === "string" ? clip(args, maxValue) : String(args);
	const entries: string[] = [];
	for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
		if (value === null || value === undefined) continue;
		if (typeof value === "string") {
			const text = value.replace(/\s+/g, " ").trim();
			if (text) entries.push(`${key}=${clip(abbreviateHome(text), maxValue)}`);
		} else if (typeof value === "number" || typeof value === "boolean") {
			entries.push(`${key}=${value}`);
		}
		if (entries.length === maxEntries) break;
	}
	return entries.join(" ");
}

/** Builds the single inline header: identity, separator, target, separator, status. */
export function compactHeader(parts: Array<string | undefined>): string {
	const present = parts.filter((part): part is string => Boolean(part));
	return present.join(` ${electric(DIM, "─")} `);
}

/** Fits one generated line to the width without slicing returned data silently. */
function fitLine(line: string, width: number): string {
	if (width <= 0) return "";
	return visibleWidth(line) <= width ? line : truncateToWidth(line, width, "");
}

function wrapAnsiForWidth2(rawLine: string): string[] {
	if (rawLine === "") return [""];
	if (visibleWidth(rawLine) <= 1) return [rawLine];
	const out: string[] = [];
	let current = "";
	let currentWidth = 0;
	let chunkLimit = 1;
	let activeSgr = "";

	const flush = () => {
		const terminated = activeSgr && !current.endsWith("\x1b[0m") ? `${current}\x1b[0m` : current;
		out.push(terminated);
		current = activeSgr;
		currentWidth = 0;
		chunkLimit = 1;
	};

	for (const part of rawLine.split(ANSI_TOKEN_RE)) {
		if (!part) continue;
		if (part.startsWith("\x1b[")) {
			current += part;
			activeSgr = part === "\x1b[0m" ? "" : `${activeSgr}${part}`;
			continue;
		}
		if (part.startsWith("\x1b]")) {
			current += part;
			continue;
		}
		for (const { segment } of GRAPHEME_SEGMENTER.segment(part)) {
			const gw = visibleWidth(segment);
			if (gw === 0) {
				current += segment;
				continue;
			}
			if (gw > 1 && gw <= 2) {
				if (currentWidth > 0) flush();
				chunkLimit = 2;
				current += segment;
				currentWidth = gw;
				continue;
			}
			if (currentWidth + gw > chunkLimit && currentWidth > 0) {
				flush();
			}
			current += segment;
			currentWidth += gw;
		}
	}
	if (current !== activeSgr || out.length === 0) {
		const terminated = activeSgr && !current.endsWith("\x1b[0m") ? `${current}\x1b[0m` : current;
		out.push(terminated);
	}
	return out;
}

/**
 * Expanded content: every returned line, wrapped to the width and never sliced. Blank lines are kept
 * because they carry meaning in returned output. When `totalWidth === 2`, intact 2-column graphemes
 * are preserved as unsplit chunks so the outer margin can be omitted solely for those lines.
 */
export function expandedLines(text: string, width: number, totalWidth?: number): string[] {
	if (width <= 0) return [];
	const allowWidth2Wide = totalWidth === 2;
	const lines: string[] = [];
	for (const rawLine of (text ?? "").replace(/\r/g, "").split("\n")) {
		if (rawLine === "" || visibleWidth(rawLine) <= width) {
			lines.push(rawLine);
			continue;
		}
		if (allowWidth2Wide) {
			lines.push(...wrapAnsiForWidth2(rawLine));
			continue;
		}
		const wrapped = wrapTextWithAnsi(rawLine, width);
		for (const segment of wrapped.length > 0 ? wrapped : [""]) {
			lines.push(visibleWidth(segment) > width ? truncateToWidth(segment, width, "") : segment);
		}
	}
	return lines;
}

export interface CompactRowState {
	hasResult?: boolean;
}

/**
 * One compact inline row. Collapsed it is a single line; expanded it adds the lossless body. The call
 * slot renders nothing once a result exists, so a call/result pair never shows two rows. Pi owns
 * expansion state, click routing and key bindings; this component only lays out text.
 */
export class CompactToolRow implements Component {
	readonly [COMPACT_LEFT_MARGIN_KEY] = COMPACT_LEFT_MARGIN_VALUE;
	private cachedKey?: string;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private readonly header: () => string,
		private readonly options: {
			state?: CompactRowState;
			isCallSlot?: boolean;
			body?: (innerWidth: number, totalWidth: number) => string[];
		} = {},
	) {}

	render(width: number): string[] {
		const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
		if (safeWidth <= 0) return [];
		if (this.options.isCallSlot && this.options.state?.hasResult) return [];
		if (safeWidth === 1) return [" "];

		const innerWidth = safeWidth - 1;
		const header = this.header();
		const body = this.options.body?.(innerWidth, safeWidth) ?? [];
		const key = `${safeWidth}\u0000${header}\u0000${body.join("\u0001")}`;
		if (this.cachedLines && this.cachedKey === key && this.cachedWidth === safeWidth) return this.cachedLines;

		const lines = [formatMarginedLine(header, safeWidth), ...body.map((line) => formatMarginedLine(line, safeWidth))];
		this.cachedKey = key;
		this.cachedWidth = safeWidth;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedKey = undefined;
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

/** `✓`/`●`/`✗` status text matching the theme's existing foreground palette. */
export function completedStatus(color: string = LIME, detail?: string): string {
	return `${electric(color, "✓")} ${electric(DIM, detail ?? "completed")}`;
}

export function runningStatus(color: string, detail = "running"): string {
	return `${electric(color, "●")} ${electric(DIM, detail)}`;
}

export function failedStatus(detail?: string): string {
	return `${electric(RED, "✗")} ${electric(DIM, detail ?? "failed")}`;
}

/** First line of a failure message, for the collapsed row. */
export function firstLine(text: string): string {
	const line = text.split("\n").find((candidate) => candidate.trim() !== "") ?? "";
	return line.trim();
}

/**
 * Generic presentation used for unmarked, missing-slot, throwing, unknown/restored and dynamic tool
 * definitions. It never invokes the unmarked callbacks: only returned content and narrowly selected
 * scalar arguments are displayed.
 */
export function createFallbackRenderers(toolName: string): CompactRenderers & { [key: string]: unknown } {
	const identity = () => electric(CYAN, toolName);

	return {
		[COMPACT_TOOL_RENDERING_KEY]: COMPACT_TOOL_RENDERING_VERSION,
		[COMPACT_LEFT_MARGIN_KEY]: COMPACT_LEFT_MARGIN_VALUE,
		renderShell: "self",
		renderCall(args: any, _theme: any, context: any): Component {
			const state: CompactRowState = context.state ?? {};
			const summary = () => summarizeArgs(args);
			return new CompactToolRow(
				() => compactHeader([identity(), summary(), runningStatus(CYAN, context.argsComplete === false ? "receiving" : "running")]),
				{ state, isCallSlot: true },
			);
		},
		renderResult(result: any, options: any, _theme: any, context: any): Component {
			const state: CompactRowState = context.state ?? {};
			state.hasResult = true;
			const text = resultText(result);
			const isError = Boolean(context.isError);
			const lineCount = countLines(text);

			return new CompactToolRow(
				() =>
					compactHeader([
						identity(),
						summarizeArgs(context.args),
						isError
							? failedStatus(firstLine(text) || "failed")
							: options.isPartial
								? runningStatus(CYAN, lineCount > 0 ? `${lineCount} lines` : "running")
								: completedStatus(LIME, lineCount === 0 ? "no output" : `${lineCount} lines`),
					]),
				{
					state,
					isCallSlot: false,
					body: (width, totalWidth) => {
						if (!options.expanded || text.length === 0) return [];
						const lines = expandedLines(text, width, totalWidth);
						const continuation = result?.details?.nextCursor ?? result?.details?.continuation;
						if (typeof continuation === "string" && continuation !== "") {
							lines.push(electric(AMBER, `[continues: ${continuation}]`));
						}
						return lines;
					},
				},
			);
		},
	};
}
