import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type BashToolDetails, type Theme, type ToolRenderResultOptions, formatSize } from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { AMBER, DIM, ORANGE, electric, formatDuration } from "./borders.js";
import {
	COMPACT_LEFT_MARGIN_KEY,
	COMPACT_LEFT_MARGIN_VALUE,
	COMPACT_TOOL_RENDERING_KEY,
	COMPACT_TOOL_RENDERING_VERSION,
	CompactToolRow,
	type CompactRowState,
	compactHeader,
	completedStatus,
	expandedLines,
	failedStatus,
	firstLine,
	mutedExpandedLines,
	resultText,
	runningStatus,
} from "./compact.js";

/** Display-only mirror of `DEFAULT_BASH_TIMEOUT_SECONDS` in `src/tools/index.ts`. */
const DISPLAY_DEFAULT_BASH_TIMEOUT_SECONDS = 120;

export interface BashArgs {
	command?: string;
	timeout?: number;
}

interface ShellState extends CompactRowState {
	startedAt?: number;
	endedAt?: number;
	interval?: ReturnType<typeof setInterval>;
	isError?: boolean;
}

/** Collapsed command text for non-bash shell tools (`PS>`): wrapped automatically by `CompactToolRow`. */
function commandText(command: string | undefined, prompt: string): string {
	const single = (command ?? "").replace(/\s+/g, " ").trim();
	if (!single) return `${electric(ORANGE, prompt)} ${electric(DIM, "...")}`;
	return `${electric(ORANGE, prompt)} ${electric(ORANGE, single)}`;
}

const GRAPHEME_SEGMENTER = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * Exact grapheme-boundary soft wrapper for a single bash command line: preserves all leading,
 * internal, and trailing spaces, tabs (expanded visually to 3 spaces matching pi-tui without
 * mutating command data), standalone CR characters, quotes, backslashes, and literal `\n`, with
 * zero trimming or synthetic continuation indentation. At total width 2, an intact 2-column
 * grapheme uses its own unmargined 2-column chunk rather than being deleted.
 */
function wrapExactCommandLine(rawLine: string, width: number, totalWidth = width + 1): string[] {
	const visual = rawLine.includes("\t") ? rawLine.replace(/\t/g, "   ") : rawLine;
	if (visual === "") return [""];
	if (visibleWidth(visual) <= width) return [visual];

	const allowWidth2Wide = totalWidth === 2;
	const out: string[] = [];
	let current = "";
	let currentWidth = 0;
	let chunkLimit = width;
	for (const { segment } of GRAPHEME_SEGMENTER.segment(visual)) {
		const gw = visibleWidth(segment);
		if (gw === 0) {
			current += segment;
			continue;
		}
		if (gw > width) {
			if (!allowWidth2Wide || gw > totalWidth) continue;
			if (currentWidth > 0) {
				out.push(current);
				current = "";
				currentWidth = 0;
			}
			chunkLimit = totalWidth;
			current += segment;
			currentWidth = gw;
			continue;
		}
		if (currentWidth + gw > chunkLimit && currentWidth > 0) {
			out.push(current);
			current = segment;
			currentWidth = gw;
			chunkLimit = width;
		} else {
			current += segment;
			currentWidth += gw;
		}
	}
	if (current !== "" || out.length === 0) out.push(current);
	return out;
}

/**
 * Full command block for `bash` (`$`): renders the authored command verbatim — preserving exact
 * leading/trailing spaces, tabs (visual display only), real newlines, standalone CR and CRLF
 * characters, consecutive blank lines, quotes, backslashes, and literal `\n` — in the existing
 * ORANGE foreground, soft-wrapping long lines ANSI-aware at `width` (or total width 2 for intact
 * wide graphemes) with no trimming, collapsing, or ellipsis.
 */
function commandLines(command: string | undefined, width: number, totalWidth = width + 1): string[] {
	if (width <= 0 || typeof command !== "string" || command.length === 0) return [];
	const lines: string[] = [];
	for (const rawLine of command.split("\n")) {
		for (const chunk of wrapExactCommandLine(rawLine, width, totalWidth)) {
			lines.push(chunk === "" ? "" : electric(ORANGE, chunk));
		}
	}
	return lines;
}

interface DisplayTimeout {
	seconds: number;
	isDefault: boolean;
}

function resolveDisplayTimeout(timeout: number | undefined, hasDefaultTimeout: boolean): DisplayTimeout | undefined {
	if (typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0) {
		return { seconds: timeout, isDefault: false };
	}
	if (hasDefaultTimeout) {
		return { seconds: DISPLAY_DEFAULT_BASH_TIMEOUT_SECONDS, isDefault: true };
	}
	return undefined;
}

function timeoutText(resolved: DisplayTimeout | undefined): string {
	if (!resolved) return electric(DIM, "no timeout");
	return electric(DIM, `timeout ${resolved.seconds}s${resolved.isDefault ? " (default)" : ""}`);
}

/**
 * Row clock for the shell tools only: long-running commands whose elapsed time is worth a redraw.
 * The interval is cleared as soon as the row settles, on error, and never when already settled.
 */
function maintainShellTimer(context: any, state: ShellState, isPartial: boolean): void {
	state.startedAt ??= Date.now();
	if (!isPartial || context.isError) {
		state.endedAt ??= Date.now();
		if (state.interval) {
			clearInterval(state.interval);
			state.interval = undefined;
		}
		return;
	}
	if (state.endedAt !== undefined || state.interval) return;
	state.interval = setInterval(() => context.invalidate(), 1000);
	state.interval.unref?.();
}

function elapsedText(state: ShellState, isRunning: boolean, timeoutSeconds?: number): string {
	const start = state.startedAt ?? Date.now();
	const now = isRunning ? Date.now() : (state.endedAt ?? start);
	const elapsedMs = Math.max(0, now - start);
	const elapsed = formatDuration(elapsedMs);
	if (!isRunning) return `Took ${elapsed}`;
	if (timeoutSeconds !== undefined) {
		const remainingMs = Math.max(0, timeoutSeconds * 1000 - elapsedMs);
		return `Running... (${elapsed} elapsed · ${formatDuration(remainingMs)} remaining)`;
	}
	return `Running... (${elapsed} elapsed)`;
}

function isShellFailure(output: string, isError: boolean): boolean {
	return (
		isError ||
		output.includes("Command exited with code") ||
		output.includes("Command aborted") ||
		output.includes("Command timed out")
	);
}

function outputWarnings(result: AgentToolResult<BashToolDetails | undefined>): string[] {
	const warnings: string[] = [];
	const truncation = result?.details?.truncation;
	const fullOutputPath = result?.details?.fullOutputPath;
	if (fullOutputPath) warnings.push(`Full output: ${fullOutputPath}`);
	if (truncation?.truncated) {
		if (truncation.truncatedBy === "lines") {
			warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
		} else {
			warnings.push(`Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes)} limit)`);
		}
	}
	return warnings;
}

/**
 * bash (`$`) and powershell (`PS>`) share the one compact shell presentation. The bash execution
 * wrapper that applies the theme's default timeout lives in `src/tools/index.ts` and is untouched.
 */
export function createShellRenderers(prompt: string) {
	const multilineCommand = prompt === "$";
	const hasDefaultTimeout = prompt === "$";

	return {
		[COMPACT_TOOL_RENDERING_KEY]: COMPACT_TOOL_RENDERING_VERSION,
		[COMPACT_LEFT_MARGIN_KEY]: COMPACT_LEFT_MARGIN_VALUE,
		renderShell: "self" as const,

		renderCall(args: BashArgs, _theme: Theme, context: any): Component {
			const state: ShellState = context.state ?? {};
			maintainShellTimer(context, state, true);
			const resolvedTimeout = resolveDisplayTimeout(args?.timeout, hasDefaultTimeout);
			return new CompactToolRow(
				() =>
					compactHeader([
						multilineCommand
							? args?.command
								? electric(ORANGE, prompt)
								: `${electric(ORANGE, prompt)} ${electric(DIM, "...")}`
							: commandText(args?.command, prompt),
						timeoutText(resolvedTimeout),
						runningStatus(ORANGE, elapsedText(state, true, resolvedTimeout?.seconds)),
					]),
				{
					state,
					isCallSlot: true,
					body: multilineCommand ? (width, totalWidth) => commandLines(args?.command, width, totalWidth) : undefined,
				},
			);
		},

		renderResult(
			result: AgentToolResult<BashToolDetails | undefined>,
			options: ToolRenderResultOptions,
			theme: Theme,
			context: any,
		): Component {
			const state: ShellState = context.state ?? {};
			state.hasResult = true;
			const output = resultText(result);
			const trimmed = output.trim();
			const isCancelled = (result?.details as any)?.cancelled === true;
			state.isError = isShellFailure(trimmed, Boolean(context.isError) || isCancelled);
			maintainShellTimer(context, state, options.isPartial && !state.isError);
			const isRunning = options.isPartial && !state.isError && state.endedAt === undefined;
			const resolvedTimeout = resolveDisplayTimeout(context.args?.timeout, hasDefaultTimeout);

			return new CompactToolRow(
				() =>
					compactHeader([
						multilineCommand
							? context.args?.command
								? electric(ORANGE, prompt)
								: `${electric(ORANGE, prompt)} ${electric(DIM, "...")}`
							: commandText(context.args?.command, prompt),
						timeoutText(resolvedTimeout),
						state.isError
							? failedStatus(firstLine(trimmed) || (isCancelled ? "cancelled" : "failed"))
							: isRunning
								? runningStatus(ORANGE, elapsedText(state, true, resolvedTimeout?.seconds))
								: completedStatus(ORANGE, trimmed === "" ? `no output · ${elapsedText(state, false)}` : elapsedText(state, false)),
					]),
				{
					state,
					isCallSlot: false,
					body: (width, totalWidth) => {
						const cmd = multilineCommand ? commandLines(context.args?.command, width, totalWidth) : [];
						if (!options.expanded) return cmd;
						const lines =
							trimmed === ""
								? expandedLines("(no output)", width, totalWidth).map((line) => (line === "" ? "" : electric(DIM, line)))
								: mutedExpandedLines(output, width, totalWidth, theme);
						for (const warning of outputWarnings(result)) {
							for (const line of expandedLines(`[${warning}]`, width, totalWidth)) {
								lines.push(line === "" ? "" : electric(AMBER, line));
							}
						}
						return [...cmd, ...lines];
					},
				},
			);
		},
	};
}

export const bashRenderers = createShellRenderers("$");
export const powershellRenderers = createShellRenderers("PS>");
