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
import { AMBER, CYAN, DIM, LIME, PINK, VIOLET, electric } from "./borders.js";
import {
	COMPACT_LEFT_MARGIN_KEY,
	COMPACT_LEFT_MARGIN_VALUE,
	COMPACT_TOOL_RENDERING_KEY,
	COMPACT_TOOL_RENDERING_VERSION,
	CompactToolRow,
	type CompactRowState,
	abbreviateHome,
	compactHeader,
	completedStatus,
	countLines,
	expandedLines,
	failedStatus,
	firstLine,
	mutedExpandedLines,
	resultText,
	runningStatus,
} from "./compact.js";

interface NativeState extends CompactRowState {
	isError?: boolean;
}

function countOf(text: string, unit: string): string {
	const lines = countLines(text);
	return `${lines} ${unit}${lines === 1 ? "" : "s"}`;
}

/** Highlighted code as width-safe lines; muted plain text when no language is known for the path. */
function codeLines(text: string, path: string, width: number, totalWidth?: number, theme?: Theme): string[] {
	const language = path ? getLanguageFromPath(path) : undefined;
	if (!language) return mutedExpandedLines(text, width, totalWidth, theme);
	return expandedLines(highlightCode(text, language).join("\n"), width, totalWidth);
}

function diffLines(diff: string, path: string, width: number, totalWidth?: number): string[] {
	return expandedLines(renderDiff(diff, { filePath: path }).replace(/\n+$/, ""), width, totalWidth);
}

/** Collapsed failure body: the first line only. Expanded failures stay complete in muted foreground. */
function failureBody(text: string, width: number, totalWidth?: number, theme?: Theme): string[] {
	return mutedExpandedLines(text === "" ? "failed" : text, width, totalWidth, theme);
}

function dimNoticeLines(text: string, width: number, totalWidth?: number): string[] {
	return expandedLines(text, width, totalWidth).map((line) => (line === "" ? "" : electric(DIM, line)));
}

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------
export interface ReadArgs {
	path?: string;
	file_path?: string;
	offset?: number;
	limit?: number;
}

function readTarget(args: ReadArgs | undefined): string {
	const path = abbreviateHome(args?.path ?? args?.file_path ?? "");
	if (args?.offset === undefined && args?.limit === undefined) return path;
	const start = args?.offset ?? 1;
	const end = args?.limit !== undefined ? start + args.limit - 1 : undefined;
	return `${path}:${start}${end ? `-${end}` : ""}`;
}

export const readRenderers = {
	[COMPACT_TOOL_RENDERING_KEY]: COMPACT_TOOL_RENDERING_VERSION,
	[COMPACT_LEFT_MARGIN_KEY]: COMPACT_LEFT_MARGIN_VALUE,
	renderShell: "self" as const,

	renderCall(_args: ReadArgs, _theme: Theme, context: any): Component {
		const state: NativeState = context.state ?? {};
		return new CompactToolRow(
			() => compactHeader([electric(CYAN, "read"), electric(CYAN, readTarget(context.args)), runningStatus(CYAN, "reading")]),
			{ state, isCallSlot: true },
		);
	},

	renderResult(result: AgentToolResult<any>, options: ToolRenderResultOptions, theme: Theme, context: any): Component {
		const state: NativeState = context.state ?? {};
		state.hasResult = true;
		const text = resultText(result);
		const isError = Boolean(context.isError);

		return new CompactToolRow(
			() =>
				compactHeader([
					electric(CYAN, "read"),
					electric(CYAN, readTarget(context.args)),
					isError
						? failedStatus(firstLine(text) || "read failed")
						: options.isPartial
							? runningStatus(CYAN, countOf(text, "line"))
							: completedStatus(LIME, `${countOf(text, "line")} · ${formatSize(Buffer.byteLength(text, "utf-8"))}`),
				]),
			{
				state,
				isCallSlot: false,
				body: (width, totalWidth) => {
					if (!options.expanded) return [];
					if (isError) return failureBody(text, width, totalWidth, theme);
					const lines = codeLines(text, context.args?.path ?? context.args?.file_path ?? "", width, totalWidth, theme);
					const truncation = result?.details?.truncation;
					if (truncation?.truncated) {
						for (const line of expandedLines(`[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines]`, width, totalWidth)) {
							lines.push(line === "" ? "" : electric(AMBER, line));
						}
					}
					return lines;
				},
			},
		);
	},
};

// ---------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------
export interface EditArgs {
	path?: string;
	file_path?: string;
	edits?: Array<{ oldText: string; newText: string }>;
	oldText?: string;
	newText?: string;
}

const editTarget = (args: EditArgs | undefined): string => abbreviateHome(args?.path ?? args?.file_path ?? "");
const editChunks = (args: EditArgs | undefined): number => args?.edits?.length ?? 1;

export const editRenderers = {
	[COMPACT_TOOL_RENDERING_KEY]: COMPACT_TOOL_RENDERING_VERSION,
	[COMPACT_LEFT_MARGIN_KEY]: COMPACT_LEFT_MARGIN_VALUE,
	renderShell: "self" as const,

	renderCall(_args: EditArgs, _theme: Theme, context: any): Component {
		const state: NativeState = context.state ?? {};
		return new CompactToolRow(
			() => compactHeader([electric(VIOLET, "edit"), electric(VIOLET, editTarget(context.args)), runningStatus(VIOLET, "applying")]),
			{ state, isCallSlot: true },
		);
	},

	renderResult(result: AgentToolResult<any>, options: ToolRenderResultOptions, theme: Theme, context: any): Component {
		const state: NativeState = context.state ?? {};
		state.hasResult = true;
		const text = resultText(result);
		const isError = Boolean(context.isError);
		const chunks = editChunks(context.args);

		return new CompactToolRow(
			() =>
				compactHeader([
					electric(VIOLET, "edit"),
					electric(VIOLET, editTarget(context.args)),
					isError
						? failedStatus(firstLine(text) || "edit failed")
						: options.isPartial
							? runningStatus(VIOLET, "applying")
							: completedStatus(LIME, `${chunks} edit${chunks === 1 ? "" : "s"} · ${text === "" ? "done" : "applied"}`),
				]),
			{
				state,
				isCallSlot: false,
				body: (width, totalWidth) => {
					if (!options.expanded) return [];
					if (isError) return failureBody(text, width, totalWidth, theme);
					const diff = result?.details?.diff;
					if (typeof diff === "string" && diff !== "") return diffLines(diff, editTarget(context.args), width, totalWidth);
					return text ? mutedExpandedLines(text, width, totalWidth, theme) : dimNoticeLines("(no diff output)", width, totalWidth);
				},
			},
		);
	},
};

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------
export interface WriteArgs {
	path?: string;
	file_path?: string;
	content?: string;
}

const writeTarget = (args: WriteArgs | undefined): string => abbreviateHome(args?.path ?? args?.file_path ?? "");

export const writeRenderers = {
	[COMPACT_TOOL_RENDERING_KEY]: COMPACT_TOOL_RENDERING_VERSION,
	[COMPACT_LEFT_MARGIN_KEY]: COMPACT_LEFT_MARGIN_VALUE,
	renderShell: "self" as const,

	renderCall(_args: WriteArgs, _theme: Theme, context: any): Component {
		const state: NativeState = context.state ?? {};
		const content: string = context.args?.content ?? "";
		const status = () => {
			if (context.argsComplete === false && content === "") return runningStatus(PINK, "receiving");
			const lines = countLines(content);
			return runningStatus(PINK, lines > 0 ? `writing ${lines} line${lines === 1 ? "" : "s"}` : "writing");
		};
		return new CompactToolRow(
			() => compactHeader([electric(PINK, "write"), electric(PINK, writeTarget(context.args)), status()]),
			{ state, isCallSlot: true },
		);
	},

	renderResult(result: AgentToolResult<any>, options: ToolRenderResultOptions, theme: Theme, context: any): Component {
		const state: NativeState = context.state ?? {};
		state.hasResult = true;
		const text = resultText(result);
		const isError = Boolean(context.isError);
		const content: string = context.args?.content ?? "";

		return new CompactToolRow(
			() =>
				compactHeader([
					electric(PINK, "write"),
					electric(PINK, writeTarget(context.args)),
					isError
						? failedStatus(firstLine(text) || "write failed")
						: options.isPartial
							? runningStatus(PINK, "writing")
							: completedStatus(LIME, `${formatSize(Buffer.byteLength(content, "utf-8"))} · ${countOf(content, "line")}`),
				]),
			{
				state,
				isCallSlot: false,
				body: (width, totalWidth) => {
					if (!options.expanded) return [];
					if (isError) return failureBody(text, width, totalWidth, theme);
					const lines = content !== "" ? codeLines(content, writeTarget(context.args), width, totalWidth, theme) : [];
					if (text !== "") {
						lines.push(...mutedExpandedLines(text, width, totalWidth, theme));
					}
					return lines.length > 0 ? lines : dimNoticeLines("(empty file)", width, totalWidth);
				},
			},
		);
	},
};

// ---------------------------------------------------------------------------
// grep, find, ls
//
// Pi keeps executing these tools; only their presentation is replaced so built-in renderers (which
// generate expansion hints) never reach the transcript.
// ---------------------------------------------------------------------------
interface SearchArgs {
	pattern?: string;
	path?: string;
	glob?: string;
	limit?: number;
}

/**
 * Target summary for the search-style built-ins. `ls` shows its directory; `grep`/`find` show their
 * pattern and the searched directory. Empty optional segments are omitted so no stray separator is
 * emitted.
 */
function searchTarget(tool: string, args: SearchArgs | undefined): string {
	const glob = args?.glob ? ` (${args.glob})` : "";
	const limit = args?.limit !== undefined ? ` limit ${args.limit}` : "";
	if (tool === "ls") {
		const where = abbreviateHome(args?.path ?? "") || ".";
		const extra = `${glob}${limit}`.trim();
		return compactHeader([electric(CYAN, where), extra ? electric(DIM, extra) : undefined]);
	}
	const where = abbreviateHome(args?.path ?? "") || ".";
	return compactHeader([electric(CYAN, `/${args?.pattern ?? ""}/`), electric(DIM, `in ${where}${glob}${limit}`)]);
}

function searchWarnings(details: any, limitKey: string, limitLabel: string): string[] {
	const warnings: string[] = [];
	if (limitKey && details?.[limitKey]) warnings.push(`${details[limitKey]} ${limitLabel} limit`);
	if (details?.truncation?.truncated) warnings.push(`${formatSize(details.truncation.maxBytes)} limit`);
	if (details?.linesTruncated) warnings.push("some lines truncated");
	return warnings;
}

function createSearchRenderers(tool: string, limitKey: string, limitLabel: string, emptyLabel: string) {
	return {
		[COMPACT_TOOL_RENDERING_KEY]: COMPACT_TOOL_RENDERING_VERSION,
		[COMPACT_LEFT_MARGIN_KEY]: COMPACT_LEFT_MARGIN_VALUE,
		renderShell: "self" as const,

		renderCall(_args: SearchArgs, _theme: Theme, context: any): Component {
			const state: NativeState = context.state ?? {};
			return new CompactToolRow(
				() => compactHeader([electric(CYAN, tool), searchTarget(tool, context.args), runningStatus(CYAN, "running")]),
				{ state, isCallSlot: true },
			);
		},

		renderResult(result: AgentToolResult<any>, options: ToolRenderResultOptions, theme: Theme, context: any): Component {
			const state: NativeState = context.state ?? {};
			state.hasResult = true;
			const text = resultText(result);
			const trimmed = text.trim();
			const isError = Boolean(context.isError);

			return new CompactToolRow(
				() =>
					compactHeader([
						electric(CYAN, tool),
						searchTarget(tool, context.args),
						isError
							? failedStatus(firstLine(trimmed) || `${tool} failed`)
							: options.isPartial
								? runningStatus(CYAN, countOf(trimmed, "line"))
								: completedStatus(LIME, trimmed === "" ? emptyLabel : countOf(trimmed, "line")),
					]),
				{
					state,
					isCallSlot: false,
					body: (width, totalWidth) => {
						if (!options.expanded) return [];
						const body =
							trimmed === ""
								? dimNoticeLines("(no output)", width, totalWidth)
								: mutedExpandedLines(text, width, totalWidth, theme);
						for (const warning of searchWarnings(result?.details, limitKey, limitLabel)) {
							for (const line of expandedLines(`[Truncated: ${warning}]`, width, totalWidth)) {
								body.push(line === "" ? "" : electric(AMBER, line));
							}
						}
						return body;
					},
				},
			);
		},
	};
}

export const grepRenderers = createSearchRenderers("grep", "matchLimitReached", "matches", "no matches");
export const findRenderers = createSearchRenderers("find", "resultLimitReached", "results", "no results");
export const lsRenderers = createSearchRenderers("ls", "entryLimitReached", "entries", "empty");
