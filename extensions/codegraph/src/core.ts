import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import type { CodeGraphAction, CodeGraphStatus } from "./types.js";

export const NOT_INDEXED_MESSAGE = "CodeGraph isn't available here";
export const DEFAULT_MAX_FILES = 12;
export const MAX_FILES_LIMIT = 50;

export function resolveProjectPath(cwd: string, path?: string): string {
	const normalized = path?.replace(/^@/, "");
	return normalized ? resolve(cwd, normalized) : cwd;
}

export function formatCommand(args: string[]): string {
	return ["codegraph", ...args]
		.map((part) => (/^[a-zA-Z0-9_./:@=-]+$/.test(part) ? part : JSON.stringify(part)))
		.join(" ");
}

export function manageArgs(action: CodeGraphAction, path: string): string[] {
	switch (action) {
		case "init":
			return ["init", "--yes", path];
		case "sync":
			return ["sync", path];
		case "reindex":
			return ["index", path];
		case "unlock":
			return ["unlock", path];
		case "uninit":
			return ["uninit", "--force", path];
	}
}

export async function getStatus(
	pi: ExtensionAPI,
	path: string,
	signal?: AbortSignal,
): Promise<CodeGraphStatus> {
	const result = await pi.exec("codegraph", ["status", "--json", path], { cwd: path, signal });
	const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
	if (result.code !== 0) {
		throw new Error(`CodeGraph status failed with exit code ${result.code}: ${output || "no diagnostic output"}`);
	}
	try {
		return JSON.parse(result.stdout) as CodeGraphStatus;
	} catch (error) {
		throw new Error(`CodeGraph returned invalid status JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function actionImpact(action: CodeGraphAction): string {
	switch (action) {
		case "init":
			return "Create .codegraph/ and build the initial full index. This may consume significant CPU, memory, disk, and time.";
		case "sync":
			return "Update the existing index with changes since the last indexing run.";
		case "reindex":
			return "Discard and rebuild the full CodeGraph index from scratch. This may be expensive.";
		case "unlock":
			return "Remove a stale indexing lock. Confirm that no CodeGraph indexing process is currently active.";
		case "uninit":
			return "DESTRUCTIVE: permanently delete the project's entire .codegraph/ directory and index.";
	}
}
