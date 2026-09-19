import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { NOT_INDEXED_MESSAGE, resolveProjectPath } from "../core.js";
import { renderSyncCall, renderSyncResult } from "../render/index.js";
import type { CodeGraphSyncDetails } from "../types.js";

type SyncResultPayload = {
	content: Array<{ type: "text"; text: string }>;
	details: CodeGraphSyncDetails;
};

const inFlight = new Map<string, Promise<SyncResultPayload>>();
const recentSyncs = new Map<string, { timestamp: number; payload: SyncResultPayload }>();
const DEBOUNCE_MS = 5000;

export function _resetSyncState(): void {
	inFlight.clear();
	recentSyncs.clear();
}

export function registerSyncTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "codegraph_sync",
		label: "CodeGraph Sync",
		description:
			"Synchronize and refresh the CodeGraph index incrementally with changes since last indexed. Safe, non-destructive, and unattended; requires no TUI confirmation gate.",
		promptSnippet: "Synchronize the CodeGraph index incrementally after modifying files or before starting code exploration",
		promptGuidelines: [
			"Call codegraph_sync before starting code exploration or research workflows when the CodeGraph index may be stale.",
			"Call codegraph_sync after modifying project files (such as after 02-apply) to refresh the CodeGraph index.",
			"codegraph_sync is safe, non-destructive, and requires no TUI confirmation; use it whenever index freshness is needed.",
		],
		parameters: Type.Object({
			path: Type.Optional(Type.String({ minLength: 1, description: "Project path; defaults to Pi's current directory." })),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolveProjectPath(ctx.cwd, params.path);

			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "CodeGraph sync cancelled." }],
					details: { path, executed: false },
				};
			}

			// Check in-flight promise coalescing
			const existing = inFlight.get(path);
			if (existing) {
				return await existing;
			}

			// Check recent sync debounce cache
			const recent = recentSyncs.get(path);
			if (recent && Date.now() - recent.timestamp < DEBOUNCE_MS) {
				return {
					content: recent.payload.content,
					details: { ...recent.payload.details, cached: true },
				};
			}

			const executionPromise = (async (): Promise<SyncResultPayload> => {
				const startTime = Date.now();
				try {
					const result = await pi.exec("codegraph", ["sync", path], { cwd: path, signal });
					const durationMs = Date.now() - startTime;
					const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

					if (signal?.aborted) {
						return {
							content: [{ type: "text", text: "CodeGraph sync cancelled." }],
							details: { path, executed: false, durationMs },
						};
					}

					const combinedOutput = output || "";

					// Detect not indexed condition
					if (
						combinedOutput.includes(NOT_INDEXED_MESSAGE) ||
						combinedOutput.includes("isn't available here") ||
						combinedOutput.includes("not indexed")
					) {
						return {
							content: [{
								type: "text",
								text: combinedOutput || "CodeGraph index not found. Project is not indexed.",
							}],
							details: { path, executed: false, notIndexed: true, durationMs, output: combinedOutput },
						};
					}

					// Detect lock contention condition
					if (
						combinedOutput.includes(".codegraph/lock") ||
						/lock.*held|locked by another process|index is locked|failed to acquire lock/i.test(combinedOutput)
					) {
						return {
							content: [{
								type: "text",
								text: combinedOutput || "CodeGraph index is currently locked by another process.",
							}],
							details: { path, executed: false, lockHeld: true, durationMs, output: combinedOutput },
						};
					}

					if (result.code !== 0) {
						throw new Error(`CodeGraph sync failed with exit code ${result.code}: ${combinedOutput || "no diagnostic output"}`);
					}

					const successPayload: SyncResultPayload = {
						content: [{
							type: "text",
							text: combinedOutput || "CodeGraph sync completed successfully.",
						}],
						details: { path, executed: true, durationMs, output: combinedOutput },
					};

					recentSyncs.set(path, { timestamp: Date.now(), payload: successPayload });
					return successPayload;
				} catch (error) {
					if (signal?.aborted) {
						return {
							content: [{ type: "text", text: "CodeGraph sync cancelled." }],
							details: { path, executed: false },
						};
					}
					const msg = error instanceof Error ? error.message : String(error);
					if (msg.includes(".codegraph/lock") || /lock.*held|locked by another process|index is locked/i.test(msg)) {
						return {
							content: [{ type: "text", text: msg }],
							details: { path, executed: false, lockHeld: true, output: msg },
						};
					}
					if (msg.includes(NOT_INDEXED_MESSAGE) || msg.includes("isn't available here")) {
						return {
							content: [{ type: "text", text: msg }],
							details: { path, executed: false, notIndexed: true, output: msg },
						};
					}
					throw error;
				}
			})();

			inFlight.set(path, executionPromise);
			try {
				return await executionPromise;
			} finally {
				inFlight.delete(path);
			}
		},
		renderCall: renderSyncCall,
		renderResult: renderSyncResult,
		renderShell: "self",
	});
}
