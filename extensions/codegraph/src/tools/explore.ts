import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DEFAULT_MAX_FILES, MAX_FILES_LIMIT, NOT_INDEXED_MESSAGE, resolveProjectPath } from "../core.js";
import { renderExploreCall, renderExploreResult } from "../render/index.js";
import type { CodeGraphExploreDetails } from "../types.js";

function isIdentifierLike(query: string): boolean {
	return /^[A-Za-z_$][A-Za-z0-9_$.-]*$/.test(query);
}

function exactOccurrenceCount(output: string, query: string): number {
	const haystack = output.toLocaleLowerCase();
	const needle = query.toLocaleLowerCase();
	let count = 0;
	let offset = 0;
	while ((offset = haystack.indexOf(needle, offset)) !== -1) {
		count += 1;
		offset += needle.length;
	}
	return count;
}

export function registerExploreTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "codegraph_explore",
		label: "CodeGraph Explore",
		description:
			"Explore an existing CodeGraph index for source definitions, dependencies, call paths, and relevant verbatim code. Read-only: never creates or updates an index. Output is limited to 50KB or 2000 lines; oversized output is saved to a temporary file.",
		promptSnippet: "Explore indexed code architecture, symbols, dependencies, and call paths with CodeGraph",
		promptGuidelines: [
			"Use codegraph_status before codegraph_explore when index availability or freshness is unknown.",
			"Use codegraph_explore for unfamiliar architecture and cross-component flows, then use precise symbol tools for exact declarations and references.",
			"If no CodeGraph index exists, do not call codegraph_manage unless the user explicitly authorized the exact lifecycle operation and project path.",
		],
		parameters: Type.Object({
			query: Type.String({ minLength: 1, description: "Concrete symbols, file names, or conceptual code behavior to explore." }),
			path: Type.Optional(Type.String({ minLength: 1, description: "Project path; defaults to Pi's current directory." })),
			maxFiles: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_FILES_LIMIT, description: `Maximum source files (default ${DEFAULT_MAX_FILES}).` })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const path = resolveProjectPath(ctx.cwd, params.path);
			const maxFiles = params.maxFiles ?? DEFAULT_MAX_FILES;
			onUpdate?.({
				content: [{ type: "text", text: `Exploring CodeGraph index in ${path}…` }],
				details: { path, query: params.query, maxFiles } satisfies CodeGraphExploreDetails,
			});
			if (signal?.aborted) return { content: [{ type: "text", text: "CodeGraph exploration cancelled." }], details: { path, query: params.query, maxFiles } satisfies CodeGraphExploreDetails };

			const result = await pi.exec("codegraph", ["explore", "--path", path, "--max-files", String(maxFiles), params.query], { cwd: path, signal });
			const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
			if (result.code !== 0) {
				if (output.includes(NOT_INDEXED_MESSAGE)) {
					return { content: [{ type: "text", text: output }], details: { path, query: params.query, maxFiles, notIndexed: true } satisfies CodeGraphExploreDetails };
				}
				if (signal?.aborted) return { content: [{ type: "text", text: "CodeGraph exploration cancelled." }], details: { path, query: params.query, maxFiles } satisfies CodeGraphExploreDetails };
				throw new Error(`CodeGraph failed with exit code ${result.code}: ${output || "no diagnostic output"}`);
			}

			const truncation = truncateHead(output, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
			const details: CodeGraphExploreDetails = { path, query: params.query, maxFiles };
			const lowConfidence = isIdentifierLike(params.query) && exactOccurrenceCount(output, params.query) <= 1;
			let text = truncation.content;
			if (lowConfidence) {
				details.lowConfidence = true;
				text = `[Low-confidence CodeGraph result: no exact indexed match was found for identifier-like query "${params.query}". Treat the following as fuzzy related context, not a symbol match.]\n\n${text}`;
			}
			if (truncation.truncated) {
				const directory = await mkdtemp(resolve(tmpdir(), "pi-codegraph-"));
				const fullOutputPath = resolve(directory, "output.md");
				await writeFile(fullOutputPath, output, "utf8");
				Object.assign(details, { truncated: true, fullOutputPath });
				text += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${fullOutputPath}]`;
			}
			return { content: [{ type: "text", text: text || "CodeGraph returned no output." }], details };
		},
		renderCall: renderExploreCall,
		renderResult: renderExploreResult,
		renderShell: "self",
	});
}
