import type {
	CodeGraphExploreDetails,
	CodeGraphManageDetails,
	CodeGraphStatusDetails,
	CodeGraphSyncDetails,
} from "../types.js";
import {
	CodeGraphCardCallComponent,
	CodeGraphCardResultComponent,
	type CodeGraphCardState,
	PINK,
	RED,
	toolHint,
} from "./theme.js";

function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text)
		.join("\n");
}

export function getCodeGraphBorderColor(state: CodeGraphCardState): string {
	if (state.isError) return RED;
	return PINK;
}

export function renderExploreCall(
	args: { query: string; path?: string; maxFiles?: number },
	_theme: any,
	context: any,
) {
	const state: CodeGraphCardState = (context.state ??= {});
	const target = `${args.query}${args.path ? ` in ${args.path}` : ""}`;
	return new CodeGraphCardCallComponent(
		"codegraph_explore",
		() => target,
		() => "● Exploring CodeGraph index…",
		getCodeGraphBorderColor,
		state,
	);
}

export function renderExploreResult(result: any, options: any, _theme: any, context: any) {
	const state: CodeGraphCardState = (context.state ??= {});
	state.hasResult = true;
	state.isError = Boolean(context.isError);
	state.isPartial = Boolean(options.isPartial);
	state.expanded = Boolean(options.expanded);

	const content = resultText(result);
	const details = result.details as CodeGraphExploreDetails | undefined;

	return new CodeGraphCardResultComponent(
		(_width, _innerWidth) => {
			const lines: string[] = [];
			if (options.isPartial) {
				lines.push("● Exploring CodeGraph index…");
				return lines;
			}
			if (context.isError) {
				lines.push(content || "CodeGraph failed.");
				return lines;
			}
			if (details?.notIndexed) {
				const hint = toolHint("to expand");
				if (!options.expanded) {
					lines.push(`⚠ CodeGraph: not indexed · ${hint}`);
				} else {
					lines.push(content || "CodeGraph index not found.");
					lines.push(toolHint("to collapse"));
				}
				return lines;
			}
			if (!options.expanded) {
				const suffix = details?.truncated ? " (full output saved)" : "";
				const hint = toolHint("to expand");
				if (details?.lowConfidence) {
					lines.push(`⚠ Low-confidence CodeGraph exploration${suffix} · ${hint}`);
				} else {
					lines.push(`✓ CodeGraph exploration complete${suffix} · ${hint}`);
				}
			} else {
				if (content) {
					lines.push(...content.split("\n"));
				} else {
					lines.push("CodeGraph returned no output.");
				}
				if (details?.truncated && details?.fullOutputPath) {
					lines.push(`[Full output saved to: ${details.fullOutputPath}]`);
				}
				lines.push(toolHint("to collapse"));
			}
			return lines;
		},
		getCodeGraphBorderColor,
		state,
		true,
	);
}

export function renderStatusCall(args: { path?: string }, _theme: any, context: any) {
	const state: CodeGraphCardState = (context.state ??= {});
	return new CodeGraphCardCallComponent(
		"codegraph_status",
		() => args.path || "current project",
		() => "● Checking CodeGraph status…",
		getCodeGraphBorderColor,
		state,
	);
}

export function renderStatusResult(result: any, options: any, _theme: any, context: any) {
	const state: CodeGraphCardState = (context.state ??= {});
	state.hasResult = true;
	state.isError = Boolean(context.isError);
	state.isPartial = Boolean(options.isPartial);
	state.expanded = Boolean(options.expanded);

	const content = resultText(result);
	const details = result.details as CodeGraphStatusDetails | undefined;

	return new CodeGraphCardResultComponent(
		(_width, _innerWidth) => {
			const lines: string[] = [];
			if (options.isPartial) {
				lines.push("● Checking CodeGraph status…");
				return lines;
			}
			if (context.isError) {
				lines.push(content || "CodeGraph status failed.");
				return lines;
			}
			if (!options.expanded) {
				const isIndexed = Boolean(details?.status?.initialized);
				const statusText = isIndexed ? "CodeGraph: indexed" : "CodeGraph: not indexed";
				const hint = toolHint("to expand");
				lines.push(`${statusText} · ${hint}`);
			} else {
				if (content) {
					lines.push(...content.split("\n"));
				}
				lines.push(toolHint("to collapse"));
			}
			return lines;
		},
		getCodeGraphBorderColor,
		state,
		true,
	);
}

export function renderManageCall(args: { action: string; path?: string }, _theme: any, context: any) {
	const state: CodeGraphCardState = (context.state ??= {});
	return new CodeGraphCardCallComponent(
		"codegraph_manage",
		() => `${args.action} ${args.path || "current project"}`,
		() => `● Running CodeGraph ${args.action}…`,
		getCodeGraphBorderColor,
		state,
	);
}

export function renderManageResult(result: any, options: any, _theme: any, context: any) {
	const state: CodeGraphCardState = (context.state ??= {});
	state.hasResult = true;
	state.isError = Boolean(context.isError);
	state.isPartial = Boolean(options.isPartial);
	state.expanded = Boolean(options.expanded);

	const content = resultText(result);
	const details = result.details as CodeGraphManageDetails | undefined;
	const action = details?.action || "operation";

	return new CodeGraphCardResultComponent(
		(_width, _innerWidth) => {
			const lines: string[] = [];
			if (options.isPartial) {
				lines.push(`● Running CodeGraph ${action}…`);
				return lines;
			}
			if (context.isError) {
				lines.push(content || `CodeGraph ${action} failed.`);
				return lines;
			}
			if (details && !details.executed) {
				if (!options.expanded) {
					const hint = toolHint("to expand");
					lines.push(`⚠ CodeGraph ${action}: not executed · ${hint}`);
				} else {
					lines.push(content);
					lines.push(toolHint("to collapse"));
				}
				return lines;
			}
			if (!options.expanded) {
				const hint = toolHint("to expand");
				lines.push(`✓ CodeGraph ${action} complete · ${hint}`);
			} else {
				if (content) {
					lines.push(...content.split("\n"));
				}
				lines.push(toolHint("to collapse"));
			}
			return lines;
		},
		getCodeGraphBorderColor,
		state,
		true,
	);
}

export function renderSyncCall(args: { path?: string }, _theme: any, context: any) {
	const state: CodeGraphCardState = (context.state ??= {});
	return new CodeGraphCardCallComponent(
		"codegraph_sync",
		() => args.path || "current project",
		() => "● Syncing CodeGraph index…",
		getCodeGraphBorderColor,
		state,
	);
}

export function renderSyncResult(result: any, options: any, _theme: any, context: any) {
	const state: CodeGraphCardState = (context.state ??= {});
	state.hasResult = true;
	state.isError = Boolean(context.isError);
	state.isPartial = Boolean(options.isPartial);
	state.expanded = Boolean(options.expanded);

	const content = resultText(result);
	const details = result.details as CodeGraphSyncDetails | undefined;

	return new CodeGraphCardResultComponent(
		(_width, _innerWidth) => {
			const lines: string[] = [];
			if (options.isPartial) {
				lines.push("● Syncing CodeGraph index…");
				return lines;
			}
			if (context.isError) {
				lines.push(content || "CodeGraph sync failed.");
				return lines;
			}
			if (details?.notIndexed) {
				const hint = toolHint("to expand");
				if (!options.expanded) {
					lines.push(`⚠ CodeGraph: not indexed · ${hint}`);
				} else {
					lines.push(content || "CodeGraph index not found.");
					lines.push(toolHint("to collapse"));
				}
				return lines;
			}
			if (details?.lockHeld) {
				const hint = toolHint("to expand");
				if (!options.expanded) {
					lines.push(`⚠ CodeGraph: index locked · ${hint}`);
				} else {
					lines.push(content || "CodeGraph index is locked by another process.");
					lines.push(toolHint("to collapse"));
				}
				return lines;
			}
			if (!options.expanded) {
				const cachedSuffix = details?.cached ? " (cached)" : "";
				const hint = toolHint("to expand");
				lines.push(`✓ CodeGraph sync complete${cachedSuffix} · ${hint}`);
			} else {
				if (content) {
					lines.push(...content.split("\n"));
				} else {
					lines.push("CodeGraph sync completed.");
				}
				if (details?.durationMs !== undefined) {
					lines.push(`Duration: ${details.durationMs}ms`);
				}
				lines.push(toolHint("to collapse"));
			}
			return lines;
		},
		getCodeGraphBorderColor,
		state,
		true,
	);
}
