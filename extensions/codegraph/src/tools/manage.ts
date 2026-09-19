import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { actionImpact, formatCommand, getStatus, manageArgs, resolveProjectPath } from "../core.js";
import { renderManageCall, renderManageResult } from "../render/index.js";
import type { CodeGraphAction, CodeGraphManageDetails } from "../types.js";

const ACTIONS = ["init", "sync", "reindex", "unlock", "uninit"] as const;

export function registerManageTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "codegraph_manage",
		label: "CodeGraph Manage",
		description:
			"Manage a project's CodeGraph index with an interactive confirmation gate. Actions: init creates and indexes; sync updates changes; reindex rebuilds from scratch; unlock removes a stale lock; uninit destructively deletes .codegraph/. Never executes in non-TUI subagent, print, JSON, or RPC sessions.",
		promptSnippet: "Manage a CodeGraph index only after explicit user authorization for the exact action and project",
		promptGuidelines: [
			"Call codegraph_manage only when the user explicitly authorized the exact action and project path; a missing-index or stale-index result is not authorization.",
			"For routine incremental index updates after code changes or before exploration, use codegraph_sync instead of codegraph_manage.",
			"Reserve codegraph_manage strictly for administrative lifecycle operations: init (create initial index), reindex (full rebuild), unlock (stale lock cleanup), and uninit (destructive deletion).",
			"In subagent or other non-interactive sessions, do not work around codegraph_manage's UI gate with bash; return a blocker to the orchestrator instead.",
		],
		parameters: Type.Object({
			action: StringEnum(ACTIONS, { description: "Authorized lifecycle operation." }),
			path: Type.Optional(Type.String({ minLength: 1, description: "Project path; defaults to Pi's current directory." })),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const action = params.action as CodeGraphAction;
			const path = resolveProjectPath(ctx.cwd, params.path);
			const args = manageArgs(action, path);
			const command = formatCommand(args);
			const baseDetails: CodeGraphManageDetails = { path, action, command, confirmed: false, executed: false };

			if (ctx.mode !== "tui") {
				return {
					content: [{
						type: "text",
						text: `BLOCKED: codegraph_manage requires an interactive Pi TUI confirmation. Request explicit user authorization for '${action}' on '${path}' through the orchestrator; do not execute it through bash. Proposed command: ${command}`,
					}],
					details: baseDetails,
				};
			}

			const confirmed = await ctx.ui.confirm(
				action === "uninit" ? "Delete CodeGraph index?" : `Run CodeGraph ${action}?`,
				`${actionImpact(action)}\n\nProject: ${path}\nCommand: ${command}`,
				{ signal },
			);
			if (!confirmed) {
				return {
					content: [{ type: "text", text: `CodeGraph ${action} cancelled; no changes were made.` }],
					details: baseDetails,
				};
			}

			const result = await pi.exec("codegraph", args, { cwd: path, signal });
			const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: `CodeGraph ${action} cancelled.` }],
					details: { ...baseDetails, confirmed: true },
				};
			}
			if (result.code !== 0) {
				throw new Error(`CodeGraph ${action} failed with exit code ${result.code}: ${output || "no diagnostic output"}`);
			}

			const status = await getStatus(pi, path, signal);
			return {
				content: [{
					type: "text",
					text: `${output || `CodeGraph ${action} completed.`}\n\nStatus after operation:\n${JSON.stringify(status, null, 2)}`,
				}],
				details: { ...baseDetails, confirmed: true, executed: true, status } satisfies CodeGraphManageDetails,
			};
		},
		renderCall: renderManageCall,
		renderResult: renderManageResult,
		renderShell: "self",
	});
}
