import type { Component } from "@earendil-works/pi-tui";
import type {
	CodeGraphExploreDetails,
	CodeGraphImpactDetails,
	CodeGraphManageDetails,
	CodeGraphNodeDetails,
	CodeGraphStatusDetails,
	CodeGraphSyncDetails,
} from "../types.js";
import {
	AMBER,
	DIM,
	LIME,
	PINK,
	RED,
	type CodeGraphRowState,
	electric,
	formatMarginedLine,
	hasAnsi,
	rowLine,
	styleMuted,
	textLines,
} from "./theme.js";

/** Presentation-only marker: declares compact, unboxed, single-row compliance with 1-col margin. */
export const COMPACT_TOOL_RENDERING = { compactToolRenderingVersion: 1, compactLeftMargin: 1 } as const;

function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text)
		.join("\n");
}

export function getCodeGraphStatusColor(state: CodeGraphRowState): string {
	if (state.isError) return RED;
	if (state.isPartial) return DIM;
	return PINK;
}

function title(name: string): string {
	return electric(PINK, name);
}

function status(parts: Array<string | undefined>, color: string): string | undefined {
	const body = parts.filter((part): part is string => Boolean(part && part.trim())).join(" · ");
	return body ? electric(color, body) : undefined;
}

function metadata(parts: Array<string | undefined>): string | undefined {
	const body = parts.filter((part): part is string => Boolean(part && part.trim())).join(" · ");
	return body ? electric(DIM, body) : undefined;
}

/** A compact inline header that hides itself once the result row is painted. */
function inlineRow(getParts: () => Array<string | undefined>, state: CodeGraphRowState): Component & { compactLeftMargin: number } {
	return {
		compactLeftMargin: 1,
		invalidate() {},
		render(width: number): string[] {
			if (state.hasResult) return [];
			const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
			if (safeWidth <= 0) return [];
			if (safeWidth === 1) return [" "];
			return rowLine(getParts(), safeWidth - 1, safeWidth).map((line) => formatMarginedLine(line, safeWidth));
		},
	};
}

function expandedRow(
	getSummary: () => Array<string | undefined>,
	getBody: () => string[],
	state: CodeGraphRowState,
	theme?: any,
): Component & { compactLeftMargin: number } {
	state.hasResult = true;
	return {
		compactLeftMargin: 1,
		invalidate() {},
		render(width: number): string[] {
			const safeWidth = Number.isFinite(width) ? Math.floor(width) : 0;
			if (safeWidth <= 0) return [];
			if (safeWidth === 1) return [" "];
			const innerWidth = safeWidth - 1;
			const head = rowLine(getSummary(), innerWidth, safeWidth).map((line) => formatMarginedLine(line, safeWidth));
			if (!state.expanded) return head;
			const body: string[] = [];
			for (const line of getBody()) {
				if (line === "") {
					body.push(" ");
					continue;
				}
				const preStyled = hasAnsi(line);
				for (const wrapped of textLines(line, innerWidth, safeWidth)) {
					const styled = preStyled || wrapped === "" ? wrapped : styleMuted(theme, wrapped);
					body.push(formatMarginedLine(styled, safeWidth));
				}
			}
			return [...head, ...body];
		},
	};
}

function contentBody(result: any, fallback: string): string[] {
	const text = resultText(result);
	return text ? text.split("\n") : [fallback];
}

export function renderExploreCall(
	args: { query: string; path?: string; maxFiles?: number },
	_theme: any,
	context: any,
) {
	const state: CodeGraphRowState = (context.state ??= {});
	const target = `${args.query}${args.path ? ` in ${args.path}` : ""}`;
	return inlineRow(() => [title("codegraph_explore"), target, electric(DIM, "exploring…")], state);
}

export function renderExploreResult(result: any, options: any, theme: any, context: any) {
	const state: CodeGraphRowState = (context.state ??= {});
	state.isError = Boolean(context.isError);
	state.isPartial = Boolean(options.isPartial);
	state.expanded = Boolean(options.expanded);

	const details = result.details as CodeGraphExploreDetails | undefined;

	return expandedRow(
		() => {
			if (state.isPartial) return [title("codegraph_explore"), electric(DIM, "exploring…")];
			if (state.isError) return [title("codegraph_explore"), status(["error"], RED)];
			if (details?.notIndexed) return [title("codegraph_explore"), electric(RED, "not indexed")];
			return [
				title("codegraph_explore"),
				details?.lowConfidence ? electric(AMBER, "low confidence") : status(["complete"], LIME),
				details?.truncated ? electric(DIM, "full output saved") : undefined,
			];
		},
		() => {
			if (state.isPartial) return [];
			const lines = contentBody(result, state.isError ? "CodeGraph failed." : "CodeGraph returned no output.");
			if (state.expanded) {
				const meta = metadata([
					details?.truncated && details?.fullOutputPath ? `full output: ${details.fullOutputPath}` : undefined,
				]);
				if (meta) lines.push(meta);
			}
			return lines;
		},
		state,
		theme,
	);
}

export function renderStatusCall(args: { path?: string }, _theme: any, context: any) {
	const state: CodeGraphRowState = (context.state ??= {});
	return inlineRow(
		() => [title("codegraph_status"), args.path || "current project", electric(DIM, "checking…")],
		state,
	);
}

export function renderStatusResult(result: any, options: any, theme: any, context: any) {
	const state: CodeGraphRowState = (context.state ??= {});
	state.isError = Boolean(context.isError);
	state.isPartial = Boolean(options.isPartial);
	state.expanded = Boolean(options.expanded);

	const details = result.details as CodeGraphStatusDetails | undefined;

	return expandedRow(
		() => {
			if (state.isPartial) return [title("codegraph_status"), electric(DIM, "checking…")];
			if (state.isError) return [title("codegraph_status"), status(["error"], RED)];
			const indexed = Boolean(details?.status?.initialized);
			return [
				title("codegraph_status"),
				electric(indexed ? LIME : RED, indexed ? "indexed" : "not indexed"),
				details?.status?.version ? electric(DIM, `v${details.status.version}`) : undefined,
			];
		},
		() => (state.isPartial ? [] : contentBody(result, "CodeGraph status unavailable.")),
		state,
		theme,
	);
}

export function renderManageCall(args: { action: string; path?: string }, _theme: any, context: any) {
	const state: CodeGraphRowState = (context.state ??= {});
	const target = `${args.action} ${args.path || "current project"}`;
	return inlineRow(() => [title("codegraph_manage"), target, electric(DIM, "running…")], state);
}

export function renderManageResult(result: any, options: any, theme: any, context: any) {
	const state: CodeGraphRowState = (context.state ??= {});
	state.isError = Boolean(context.isError);
	state.isPartial = Boolean(options.isPartial);
	state.expanded = Boolean(options.expanded);

	const details = result.details as CodeGraphManageDetails | undefined;
	const action = details?.action || "operation";

	return expandedRow(
		() => {
			if (state.isPartial) return [title("codegraph_manage"), action, electric(DIM, "running…")];
			if (state.isError) return [title("codegraph_manage"), action, status(["error"], RED)];
			if (details && !details.executed) {
				return [title("codegraph_manage"), action, electric(RED, "not executed")];
			}
			return [title("codegraph_manage"), action, status(["done"], LIME)];
		},
		() => (state.isPartial ? [] : contentBody(result, `CodeGraph ${action} returned no output.`)),
		state,
		theme,
	);
}

export function renderSyncCall(args: { path?: string }, _theme: any, context: any) {
	const state: CodeGraphRowState = (context.state ??= {});
	return inlineRow(
		() => [title("codegraph_sync"), args.path || "current project", electric(DIM, "syncing…")],
		state,
	);
}

export function renderSyncResult(result: any, options: any, theme: any, context: any) {
	const state: CodeGraphRowState = (context.state ??= {});
	state.isError = Boolean(context.isError);
	state.isPartial = Boolean(options.isPartial);
	state.expanded = Boolean(options.expanded);

	const details = result.details as CodeGraphSyncDetails | undefined;

	return expandedRow(
		() => {
			if (state.isPartial) return [title("codegraph_sync"), electric(DIM, "syncing…")];
			if (state.isError) return [title("codegraph_sync"), status(["error"], RED)];
			if (details?.notIndexed) return [title("codegraph_sync"), electric(RED, "not indexed")];
			if (details?.lockHeld) return [title("codegraph_sync"), electric(AMBER, "index locked")];
			return [
				title("codegraph_sync"),
				status(["synced"], LIME),
				details?.cached ? electric(DIM, "cached") : undefined,
				typeof details?.durationMs === "number" ? electric(DIM, `${details.durationMs}ms`) : undefined,
			];
		},
		() => (state.isPartial ? [] : contentBody(result, "CodeGraph sync completed.")),
		state,
		theme,
	);
}

export function renderNodeCall(
	args: { name: string; path?: string; file?: string },
	_theme: any,
	context: any,
) {
	const state: CodeGraphRowState = (context.state ??= {});
	const target = `${args.name}${args.file ? ` (${args.file})` : ""}${args.path ? ` in ${args.path}` : ""}`;
	return inlineRow(() => [title("codegraph_node"), target, electric(DIM, "inspecting…")], state);
}

export function renderNodeResult(result: any, options: any, theme: any, context: any) {
	const state: CodeGraphRowState = (context.state ??= {});
	state.isError = Boolean(context.isError);
	state.isPartial = Boolean(options.isPartial);
	state.expanded = Boolean(options.expanded);

	const details = result.details as CodeGraphNodeDetails | undefined;

	return expandedRow(
		() => {
			if (state.isPartial) return [title("codegraph_node"), electric(DIM, "inspecting…")];
			if (state.isError) return [title("codegraph_node"), status(["error"], RED)];
			if (details?.notIndexed) return [title("codegraph_node"), electric(RED, "not indexed")];
			return [
				title("codegraph_node"),
				status(["complete"], LIME),
				details?.truncated ? electric(DIM, "full output saved") : undefined,
			];
		},
		() => (state.isPartial ? [] : contentBody(result, "CodeGraph returned no output.")),
		state,
		theme,
	);
}

export function renderImpactCall(
	args: { symbol: string; path?: string; depth?: number },
	_theme: any,
	context: any,
) {
	const state: CodeGraphRowState = (context.state ??= {});
	const target = `${args.symbol}${args.depth ? ` (depth ${args.depth})` : ""}${args.path ? ` in ${args.path}` : ""}`;
	return inlineRow(() => [title("codegraph_impact"), target, electric(DIM, "analyzing…")], state);
}

export function renderImpactResult(result: any, options: any, theme: any, context: any) {
	const state: CodeGraphRowState = (context.state ??= {});
	state.isError = Boolean(context.isError);
	state.isPartial = Boolean(options.isPartial);
	state.expanded = Boolean(options.expanded);

	const details = result.details as CodeGraphImpactDetails | undefined;

	return expandedRow(
		() => {
			if (state.isPartial) return [title("codegraph_impact"), electric(DIM, "analyzing…")];
			if (state.isError) return [title("codegraph_impact"), status(["error"], RED)];
			if (details?.notIndexed) return [title("codegraph_impact"), electric(RED, "not indexed")];
			return [
				title("codegraph_impact"),
				status(["complete"], LIME),
				details?.truncated ? electric(DIM, "full output saved") : undefined,
			];
		},
		() => (state.isPartial ? [] : contentBody(result, "CodeGraph returned no output.")),
		state,
		theme,
	);
}
