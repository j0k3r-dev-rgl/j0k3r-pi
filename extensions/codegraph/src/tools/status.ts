import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getStatus, resolveProjectPath } from "../core.js";
import { renderStatusCall, renderStatusResult } from "../render/index.js";
import type { CodeGraphStatusDetails } from "../types.js";

export function registerStatusTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "codegraph_status",
		label: "CodeGraph Status",
		description: "Read CodeGraph index status and statistics for a project. This tool is read-only and never creates, updates, unlocks, or removes an index.",
		promptSnippet: "Check whether a project's CodeGraph index exists and inspect its status",
		promptGuidelines: [
			"Use codegraph_status before CodeGraph exploration when index availability or freshness is unknown.",
			"A codegraph_status result never authorizes index mutation; request explicit user authorization before any codegraph_manage action.",
		],
		parameters: Type.Object({
			path: Type.Optional(Type.String({ minLength: 1, description: "Project path; defaults to Pi's current directory." })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const path = resolveProjectPath(ctx.cwd, params.path);
			onUpdate?.({ content: [{ type: "text", text: `Checking CodeGraph status in ${path}…` }], details: { path, status: { initialized: false, projectPath: path } } satisfies CodeGraphStatusDetails });
			const status = await getStatus(pi, path, signal);
			return {
				content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
				details: { path, status } satisfies CodeGraphStatusDetails,
			};
		},
		renderCall: renderStatusCall,
		renderResult: renderStatusResult,
		renderShell: "self",
	});
}
