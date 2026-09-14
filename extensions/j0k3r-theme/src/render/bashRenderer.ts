import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
	type BashToolDetails,
	type Theme,
	type ToolRenderResultOptions,
	truncateToVisualLines,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	AMBER,
	DIM,
	ORANGE,
	RED,
	electric,
	formatDuration,
	toolHint,
} from "./borders.js";
import {
	ToolCardCallComponent,
	ToolCardResultComponent,
	type ToolCardState,
	type ToolRenderContext,
} from "./ToolCard.js";

const BASH_PREVIEW_LINES = 5;

export interface BashArgs {
	command?: string;
	timeout?: number;
}

function extractText(result: AgentToolResult<BashToolDetails | undefined>): string {
	if (!result?.content || !Array.isArray(result.content)) return "";
	return result.content
		.filter((c: any) => c.type === "text" && typeof c.text === "string")
		.map((c: any) => c.text)
		.join("\n");
}

export function getBashBorderColor(state: ToolCardState): string {
	if (state.isError) {
		return RED;
	}
	return ORANGE;
}

export function formatBashCommandLine(
	command: string | undefined,
	timeout: number | undefined,
	innerContentWidth: number,
): string[] {
	const rawCmd = command ?? "";
	if (!rawCmd.trim()) {
		return [electric(DIM, "$ ...")];
	}

	const timeoutSuffix = timeout ? electric(DIM, ` (timeout ${timeout}s)`) : "";
	const rawLines = rawCmd.split(/\r?\n/);
	const resultLines: string[] = [];

	for (let i = 0; i < rawLines.length; i++) {
		const isFirst = i === 0;
		const isLast = i === rawLines.length - 1;
		const lineContent = rawLines[i];
		const prefix = isFirst ? `${electric(ORANGE, "$")} ` : "  ";
		const suffix = isLast ? timeoutSuffix : "";
		const fullLine = `${prefix}${electric(ORANGE, lineContent)}${suffix}`;

		if (innerContentWidth > 0 && visibleWidth(fullLine) > innerContentWidth) {
			const wrapped = wrapTextWithAnsi(fullLine, innerContentWidth);
			resultLines.push(...wrapped);
		} else {
			resultLines.push(fullLine);
		}
	}

	return resultLines;
}

export const bashRenderers = {
	renderCall(args: BashArgs, _theme: Theme, context: ToolRenderContext<ToolCardState, BashArgs>): Component {
		const state = context.state;
		if (state.startedAt === undefined) {
			state.startedAt = Date.now();
		}

		// Si ya finalizó la ejecución, nos aseguramos de que ningún timer siga vivo
		if (state.hasResult || state.endedAt !== undefined) {
			if (state.interval) {
				clearInterval(state.interval);
				state.interval = undefined;
			}
		} else if (context.executionStarted && !state.interval) {
			state.interval = setInterval(() => context.invalidate(), 1000);
			state.interval.unref?.();
		}

		return new ToolCardCallComponent(
			"bash",
			() => undefined,
			() => {
				const end = state.endedAt ?? Date.now();
				const start = state.startedAt ?? end;
				const elapsed = formatDuration(Math.max(0, end - start));
				if (state.hasResult || state.endedAt !== undefined) {
					return `${electric(ORANGE, "●")} ${electric(DIM, `Completed (${elapsed})`)}`;
				}
				return `${electric(ORANGE, "●")} ${electric(DIM, `Running... (${elapsed})`)}`;
			},
			getBashBorderColor,
			state,
			(_width: number, innerWidth: number) => {
				const contentWidth = Math.max(0, innerWidth - 2);
				const effectiveTimeout = args?.timeout ?? 120;
				return formatBashCommandLine(args?.command, effectiveTimeout, contentWidth);
			},
		);
	},

	renderResult(
		result: AgentToolResult<BashToolDetails | undefined>,
		options: ToolRenderResultOptions,
		_theme: Theme,
		context: ToolRenderContext<ToolCardState, BashArgs>,
	): Component {
		const state = context.state;
		state.hasResult = true;
		state.isPartial = options.isPartial;
		state.expanded = options.expanded;
		state.startedAt ??= Date.now();

		const output = extractText(result).trim();
		const hasErrorCode =
			output.includes("Command exited with code") ||
			output.includes("Command aborted") ||
			output.includes("Command timed out");
		state.isError = context.isError || hasErrorCode;

		// Si terminó la ejecución o hubo error, congelar el tiempo y detener timer
		if (!options.isPartial || state.isError) {
			state.endedAt ??= Date.now();
			if (state.interval) {
				clearInterval(state.interval);
				state.interval = undefined;
			}
		} else if (!state.interval && state.endedAt === undefined) {
			state.interval = setInterval(() => context.invalidate(), 1000);
			state.interval.unref?.();
		}

		return new ToolCardResultComponent(
			(_width: number, innerWidth: number) => {
				const contentWidth = Math.max(0, innerWidth - 2);
				const lines: string[] = [];

				const effectiveTimeout = context.args?.timeout ?? 120;
				const cmdLines = formatBashCommandLine(context.args?.command, effectiveTimeout, contentWidth);
				lines.push(...cmdLines);

				const start = state.startedAt ?? Date.now();
				const end = state.endedAt ?? (options.isPartial ? Date.now() : start);
				const durationMs = Math.max(0, end - start);
				const durationStr = formatDuration(durationMs);
				const timingLabel = options.isPartial && state.endedAt === undefined ? "Elapsed" : "Took";

				const isRunning = options.isPartial && state.endedAt === undefined;

				if (!output) {
					if (isRunning) {
						lines.push(`${electric(ORANGE, "●")} ${electric(DIM, `Running... (${durationStr})`)}`);
					} else {
						lines.push(electric(DIM, `(no output) · Took ${durationStr}`));
					}
					return lines;
				}

				// Línea divisoria tenue entre el comando y el resultado
				lines.push(electric(DIM, "─".repeat(contentWidth)));

				const truncation = result.details?.truncation;
				const fullOutputPath = result.details?.fullOutputPath;

				if (options.expanded) {
					// Expanded view: full output
					lines.push(...output.split("\n"));

					if (truncation?.truncated || fullOutputPath) {
						const warnings: string[] = [];
						if (fullOutputPath) warnings.push(`Full output: ${fullOutputPath}`);
						if (truncation?.truncated) {
							if (truncation.truncatedBy === "lines") {
								warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
							} else {
								warnings.push(`Truncated: ${truncation.outputLines} lines shown`);
							}
						}
						lines.push(electric(AMBER, `[${warnings.join(". ")}]`));
					}

					const statusLine = isRunning
						? `${electric(ORANGE, "●")} ${electric(DIM, `Running... (${durationStr})`)} · ${toolHint("to collapse")}`
						: `${electric(DIM, `Took ${durationStr}`)} · ${toolHint("to collapse")}`;
					lines.push(statusLine);
				} else {
					// Collapsed view: last BASH_PREVIEW_LINES lines with visual truncate
					const preview = truncateToVisualLines(output, BASH_PREVIEW_LINES, contentWidth);
					if (preview.skippedCount > 0) {
						lines.push(
							`${electric(DIM, `... (${preview.skippedCount} earlier lines,`)} ${toolHint("to expand")}${electric(DIM, ")")}`,
						);
					}
					lines.push(...preview.visualLines);

					if (truncation?.truncated || fullOutputPath) {
						const warnings: string[] = [];
						if (truncation?.truncated) {
							warnings.push(`Truncated (${truncation.outputLines}/${truncation.totalLines} lines)`);
						}
						if (warnings.length > 0) {
							lines.push(electric(AMBER, `[${warnings.join(". ")}]`));
						}
					}

					const statusLine = isRunning
						? `${electric(ORANGE, "●")} ${electric(DIM, `Running... (${durationStr})`)} · ${toolHint("to expand")}`
						: `${electric(DIM, `Took ${durationStr}`)} · ${toolHint("to expand")}`;
					lines.push(statusLine);
				}

				return lines;
			},
			getBashBorderColor,
			state,
			options.expanded, // wrap in expanded mode
		);
	},
};
