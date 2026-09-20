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
import { NOT_INDEXED_MESSAGE, resolveProjectPath, trackTempDir } from "../core.js";
import { renderNodeCall, renderNodeResult } from "../render/index.js";
import type { CodeGraphNodeDetails } from "../types.js";

export function registerNodeTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "codegraph_node",
		label: "CodeGraph Node",
		description:
			"Inspect a single symbol's source code and caller/callee trail, or inspect a file with line numbers and dependents. Read-only.",
		promptSnippet: "Inspect one symbol's definition, caller/callee trail, or file structure with CodeGraph",
		promptGuidelines: [
			"Use codegraph_node for focused symbol or file inspection when you do not need a wide architecture exploration.",
			"codegraph_node is much lighter than codegraph_explore and consumes significantly fewer tokens.",
		],
		parameters: Type.Object({
			name: Type.String({ minLength: 1, description: "Symbol name (e.g. 'isExtensionEnabled') or file path to inspect." }),
			path: Type.Optional(Type.String({ minLength: 1, description: "Project path; defaults to Pi's current directory." })),
			file: Type.Optional(Type.String({ minLength: 1, description: "Treat as file mode or disambiguate a symbol to this file." })),
			offset: Type.Optional(Type.Integer({ minimum: 1, description: "File mode: 1-based start line." })),
			limit: Type.Optional(Type.Integer({ minimum: 1, description: "File mode: maximum lines." })),
			symbolsOnly: Type.Optional(Type.Boolean({ description: "File mode only: just symbol map + dependents." })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const path = resolveProjectPath(ctx.cwd, params.path);
			const details: CodeGraphNodeDetails = {
				path,
				name: params.name,
				file: params.file,
				offset: params.offset,
				limit: params.limit,
				symbolsOnly: params.symbolsOnly,
			};

			onUpdate?.({
				content: [{ type: "text", text: `Inspecting CodeGraph node "${params.name}" in ${path}…` }],
				details,
			});

			if (signal?.aborted) {
				return { content: [{ type: "text", text: "CodeGraph node inspection cancelled." }], details };
			}

			const args = ["node", "--path", path];
			if (params.file) args.push("--file", params.file);
			if (params.offset !== undefined) args.push("--offset", String(params.offset));
			if (params.limit !== undefined) args.push("--limit", String(params.limit));
			if (params.symbolsOnly) args.push("--symbols-only");
			args.push(params.name);

			const result = await pi.exec("codegraph", args, { cwd: path, signal });
			const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

			if (result.code !== 0) {
				if (output.includes(NOT_INDEXED_MESSAGE)) {
					return { content: [{ type: "text", text: output }], details: { ...details, notIndexed: true } };
				}
				if (signal?.aborted) {
					return { content: [{ type: "text", text: "CodeGraph node inspection cancelled." }], details };
				}
				throw new Error(`CodeGraph node failed with exit code ${result.code}: ${output || "no diagnostic output"}`);
			}

			const truncation = truncateHead(output, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
			let text = truncation.content;
			if (truncation.truncated) {
				const directory = await mkdtemp(resolve(tmpdir(), "pi-codegraph-"));
				trackTempDir(directory);
				const fullOutputPath = resolve(directory, "output.md");
				await writeFile(fullOutputPath, output, "utf8");
				text += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${fullOutputPath}]`;
			}

			return { content: [{ type: "text", text: text || "CodeGraph returned no output." }], details };
		},
		renderCall: renderNodeCall,
		renderResult: renderNodeResult,
		renderShell: "self",
	});
}
