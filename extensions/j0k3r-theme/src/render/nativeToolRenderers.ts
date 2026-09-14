import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
	type Theme,
	type ToolRenderResultOptions,
	formatSize,
	getLanguageFromPath,
	highlightCode,
	renderDiff,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import {
	AMBER,
	CYAN,
	DIM,
	LIME,
	PINK,
	RED,
	VIOLET,
	electric,
	toolHint,
} from "./borders.js";
import {
	ToolCardCallComponent,
	ToolCardResultComponent,
	type ToolCardState,
	type ToolRenderContext,
} from "./ToolCard.js";

export function getReadBorderColor(state: ToolCardState): string {
	if (state.isError) {
		return RED;
	}
	return CYAN;
}

export function getEditBorderColor(state: ToolCardState): string {
	if (state.isError) {
		return RED;
	}
	return VIOLET;
}

export function getWriteBorderColor(state: ToolCardState): string {
	if (state.isError) {
		return RED;
	}
	return PINK;
}

export const getNonBashBorderColor = getReadBorderColor;

function extractText(result: AgentToolResult<any>): string {
	if (!result?.content || !Array.isArray(result.content)) return "";
	return result.content
		.filter((c: any) => c.type === "text" && typeof c.text === "string")
		.map((c: any) => c.text)
		.join("\n");
}

// ---------------------------------------------------------------------------
// Read Tool Renderer
// ---------------------------------------------------------------------------
export interface ReadArgs {
	path?: string;
	file_path?: string;
	offset?: number;
	limit?: number;
}

function formatReadTarget(args: ReadArgs): string {
	const p = args?.path ?? args?.file_path ?? "";
	if (args?.offset !== undefined || args?.limit !== undefined) {
		const start = args?.offset ?? 1;
		const end = args?.limit !== undefined ? start + args.limit - 1 : "";
		return `${p}:${start}${end ? `-${end}` : ""}`;
	}
	return p;
}

export const readRenderers = {
	renderCall(args: ReadArgs, _theme: Theme, context: ToolRenderContext<ToolCardState, ReadArgs>): Component {
		return new ToolCardCallComponent(
			"read",
			() => formatReadTarget(args),
			() => `${electric(CYAN, "●")} ${electric(DIM, "Reading file...")}`,
			getReadBorderColor,
			context.state,
		);
	},

	renderResult(
		result: AgentToolResult<any>,
		options: ToolRenderResultOptions,
		_theme: Theme,
		context: ToolRenderContext<ToolCardState, ReadArgs>,
	): Component {
		const state = context.state;
		state.hasResult = true;
		state.isError = context.isError;
		state.isPartial = options.isPartial;
		state.expanded = options.expanded;

		const filePath = context.args?.path ?? context.args?.file_path ?? "";
		const text = extractText(result);

		return new ToolCardResultComponent(
			() => {
				const lines: string[] = [];

				if (context.isError) {
					lines.push(electric(RED, text || "Error reading file"));
					return lines;
				}

				if (!options.expanded) {
					// Collapsed view: display file path and line count/bytes
					const allLines = text.split("\n");
					const lineCount = text.length > 0 ? allLines.length : 0;
					const byteCount = Buffer.byteLength(text, "utf-8");
					const hint = toolHint("to expand");
					lines.push(`${lineCount} lines, ${formatSize(byteCount)} · ${hint}`);
				} else {
					// Expanded view: full preview with syntax highlighting
					const lang = getLanguageFromPath(filePath);
					const codeLines = lang ? highlightCode(text, lang) : text.split("\n");
					lines.push(...codeLines);

					const truncation = result.details?.truncation;
					if (truncation?.truncated) {
						lines.push(
							electric(
								AMBER,
								`[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines]`,
							),
						);
					}
					lines.push(electric(DIM, toolHint("to collapse")));
				}

				return lines;
			},
			getReadBorderColor,
			state,
		);
	},
};

// ---------------------------------------------------------------------------
// Edit Tool Renderer
// ---------------------------------------------------------------------------
export interface EditArgs {
	path?: string;
	file_path?: string;
	edits?: Array<{ oldText: string; newText: string }>;
	oldText?: string;
	newText?: string;
}

export const editRenderers = {
	renderCall(args: EditArgs, _theme: Theme, context: ToolRenderContext<ToolCardState, EditArgs>): Component {
		const target = args?.path ?? args?.file_path ?? "";
		return new ToolCardCallComponent(
			"edit",
			() => target,
			() => `${electric(VIOLET, "●")} ${electric(DIM, "Applying edits...")}`,
			getEditBorderColor,
			context.state,
		);
	},

	renderResult(
		result: AgentToolResult<any>,
		options: ToolRenderResultOptions,
		_theme: Theme,
		context: ToolRenderContext<ToolCardState, EditArgs>,
	): Component {
		const state = context.state;
		state.hasResult = true;
		state.isError = context.isError;
		state.isPartial = options.isPartial;
		state.expanded = options.expanded;

		const target = context.args?.path ?? context.args?.file_path ?? "";
		const editsCount = context.args?.edits?.length ?? 1;
		const text = extractText(result);

		return new ToolCardResultComponent(
			() => {
				const lines: string[] = [];

				if (context.isError) {
					lines.push(electric(RED, text || "Failed to apply edit"));
					return lines;
				}

				if (!options.expanded) {
					// Collapsed view: display target path and edit chunk count
					const chunkStr = editsCount === 1 ? "1 edit chunk" : `${editsCount} edit chunks`;
					const hint = toolHint("to expand");
					lines.push(`${electric(LIME, "✓")} ${chunkStr} applied · ${hint}`);
				} else {
					// Expanded view: unified diff summary
					const diff = result.details?.diff;
					if (diff && typeof diff === "string") {
						const formattedDiff = renderDiff(diff, { filePath: target });
						lines.push(...formattedDiff.split("\n"));
					} else if (text) {
						lines.push(text);
					} else {
						lines.push(electric(DIM, "(no diff output)"));
					}
					lines.push(electric(DIM, toolHint("to collapse")));
				}

				return lines;
			},
			getEditBorderColor,
			state,
		);
	},
};

// ---------------------------------------------------------------------------
// Write Tool Renderer
// ---------------------------------------------------------------------------
export interface WriteArgs {
	path?: string;
	file_path?: string;
	content?: string;
}

export const writeRenderers = {
	renderCall(args: WriteArgs, _theme: Theme, context: ToolRenderContext<ToolCardState, WriteArgs>): Component {
		const target = args?.path ?? args?.file_path ?? "";
		const content = args?.content ?? "";
		const rawLines = content ? content.split(/\r?\n/) : [];
		const totalLines = rawLines.length;

		const getStatus = () => {
			if (context.state.hasResult) {
				return `${electric(PINK, "●")} ${electric(DIM, `File written (${totalLines} lines)`)}`;
			}
			if (context.argsComplete) {
				return `${electric(PINK, "●")} ${electric(DIM, `Saving file... (${totalLines} lines)`)}`;
			}
			if (totalLines > 0) {
				return `${electric(PINK, "●")} ${electric(DIM, `Writing... (${totalLines} lines)`)}`;
			}
			return `${electric(PINK, "●")} ${electric(DIM, "Writing file...")}`;
		};

		return new ToolCardCallComponent(
			"write",
			() => target,
			getStatus,
			getWriteBorderColor,
			context.state,
			(_width: number, innerWidth: number) => {
				if (!content) {
					return [];
				}
				const contentWidth = Math.max(0, innerWidth - 2);
				const lang = getLanguageFromPath(target);
				const highlighted = lang ? highlightCode(content, lang) : rawLines;
				const maxPreview = 10;
				const previewLines = highlighted.slice(-maxPreview);
				const lines: string[] = [];

				if (highlighted.length > maxPreview) {
					lines.push(electric(DIM, `... (${highlighted.length - maxPreview} earlier lines)`));
				}
				lines.push(...previewLines);
				lines.push(electric(DIM, "─".repeat(contentWidth)));
				return lines;
			},
		);
	},

	renderResult(
		result: AgentToolResult<any>,
		options: ToolRenderResultOptions,
		_theme: Theme,
		context: ToolRenderContext<ToolCardState, WriteArgs>,
	): Component {
		const state = context.state;
		state.hasResult = true;
		state.isError = context.isError;
		state.isPartial = options.isPartial;
		state.expanded = options.expanded;

		const target = context.args?.path ?? context.args?.file_path ?? "";
		const content = context.args?.content ?? "";
		const text = extractText(result);

		return new ToolCardResultComponent(
			() => {
				const lines: string[] = [];

				if (context.isError) {
					lines.push(electric(RED, text || "Error writing file"));
					return lines;
				}

				if (!options.expanded) {
					// Collapsed view: display target path and byte count written
					const byteCount = Buffer.byteLength(content, "utf-8");
					const lineCount = content.length > 0 ? content.split("\n").length : 0;
					const hint = toolHint("to expand");
					lines.push(`${electric(LIME, "✓")} Wrote ${formatSize(byteCount)} (${lineCount} lines) · ${hint}`);
				} else {
					// Expanded view: content preview
					const lang = getLanguageFromPath(target);
					const codeLines = lang ? highlightCode(content, lang) : content.split("\n");
					lines.push(...codeLines);
					lines.push(electric(DIM, toolHint("to collapse")));
				}

				return lines;
			},
			getWriteBorderColor,
			state,
		);
	},
};
