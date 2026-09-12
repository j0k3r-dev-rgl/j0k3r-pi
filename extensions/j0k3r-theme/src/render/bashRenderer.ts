import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
	type BashToolDetails,
	type Theme,
	type ToolRenderResultOptions,
	keyHint,
	truncateToVisualLines,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import {
	AMBER,
	CYAN,
	DIM,
	LIME,
	RED,
	electric,
	formatDuration,
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
	if (state.isPartial || !state.hasResult) {
		return CYAN;
	}
	return LIME;
}

export const bashRenderers = {
	renderCall(args: BashArgs, _theme: Theme, context: ToolRenderContext<ToolCardState, BashArgs>): Component {
		const state = context.state;
		if (context.executionStarted && state.startedAt === undefined) {
			state.startedAt = Date.now();
			state.endedAt = undefined;
		}

		return new ToolCardCallComponent(
			"bash",
			() => {
				const cmd = args?.command ?? "";
				const timeoutSuffix = args?.timeout ? ` (timeout ${args.timeout}s)` : "";
				return `${cmd}${timeoutSuffix}`.trim();
			},
			() => {
				const now = Date.now();
				const elapsed = state.startedAt ? formatDuration(now - state.startedAt) : "0.0s";
				return `${electric(AMBER, "●")} ${electric(DIM, `Running... (${elapsed})`)}`;
			},
			getBashBorderColor,
			state,
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

		if (state.startedAt !== undefined && options.isPartial && !state.interval) {
			state.interval = setInterval(() => context.invalidate(), 1000);
		}

		const output = extractText(result).trim();
		const hasErrorCode =
			output.includes("Command exited with code") ||
			output.includes("Command aborted") ||
			output.includes("Command timed out");
		state.isError = context.isError || hasErrorCode;

		if (!options.isPartial || state.isError) {
			state.endedAt ??= Date.now();
			if (state.interval) {
				clearInterval(state.interval);
				state.interval = undefined;
			}
		}

		return new ToolCardResultComponent(
			(_width: number, innerWidth: number) => {
				const contentWidth = Math.max(0, innerWidth - 2);
				const lines: string[] = [];

				const durationMs = (state.endedAt ?? Date.now()) - (state.startedAt ?? Date.now());
				const durationStr = formatDuration(durationMs);
				const timingLabel = options.isPartial ? "Elapsed" : "Took";

				if (!output) {
					lines.push(electric(DIM, `(no output) · ${timingLabel} ${durationStr}`));
					return lines;
				}

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

					lines.push(
						`${electric(DIM, `${timingLabel} ${durationStr}`)} · ${keyHint("app.tools.expand", "to collapse")}`,
					);
				} else {
					// Collapsed view: last BASH_PREVIEW_LINES lines with visual truncate
					const preview = truncateToVisualLines(output, BASH_PREVIEW_LINES, contentWidth);
					if (preview.skippedCount > 0) {
						lines.push(
							`${electric(DIM, `... (${preview.skippedCount} earlier lines,`)} ${keyHint("app.tools.expand", "to expand")}${electric(DIM, ")")}`,
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

					lines.push(
						`${electric(DIM, `${timingLabel} ${durationStr}`)} · ${keyHint("app.tools.expand", "to expand")}`,
					);
				}

				return lines;
			},
			getBashBorderColor,
			state,
			options.expanded, // wrap in expanded mode
		);
	},
};
