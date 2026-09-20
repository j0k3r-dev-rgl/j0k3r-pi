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
import { renderImpactCall, renderImpactResult } from "../render/index.js";
import type { CodeGraphImpactDetails } from "../types.js";

export function registerImpactTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "codegraph_impact",
		label: "CodeGraph Impact",
		description:
			"Analyze the blast radius and affected code when changing a symbol or file. Read-only.",
		promptSnippet: "Analyze code impact and affected symbols for a change with CodeGraph",
		promptGuidelines: [
			"Use codegraph_impact before refactoring or modifying a shared symbol to understand its full blast radius.",
			"codegraph_impact traces direct and transitive dependencies across the entire codebase.",
		],
		parameters: Type.Object({
			symbol: Type.String({ minLength: 1, description: "Symbol name or file path to analyze impact for." }),
			path: Type.Optional(Type.String({ minLength: 1, description: "Project path; defaults to Pi's current directory." })),
			depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 5, description: "Traversal depth (default: 2)." })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const path = resolveProjectPath(ctx.cwd, params.path);
			const depth = params.depth ?? 2;
			const details: CodeGraphImpactDetails = {
				path,
				symbol: params.symbol,
				depth,
			};

			onUpdate?.({
				content: [{ type: "text", text: `Analyzing CodeGraph impact for "${params.symbol}" in ${path}…` }],
				details,
			});

			if (signal?.aborted) {
				return { content: [{ type: "text", text: "CodeGraph impact analysis cancelled." }], details };
			}

			const args = ["impact", "--path", path, "--depth", String(depth), params.symbol];
			const result = await pi.exec("codegraph", args, { cwd: path, signal });
			const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

			if (result.code !== 0) {
				if (output.includes(NOT_INDEXED_MESSAGE)) {
					return { content: [{ type: "text", text: output }], details: { ...details, notIndexed: true } };
				}
				if (signal?.aborted) {
					return { content: [{ type: "text", text: "CodeGraph impact analysis cancelled." }], details };
				}
				throw new Error(`CodeGraph impact failed with exit code ${result.code}: ${output || "no diagnostic output"}`);
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
		renderCall: renderImpactCall,
		renderResult: renderImpactResult,
		renderShell: "self",
	});
}
