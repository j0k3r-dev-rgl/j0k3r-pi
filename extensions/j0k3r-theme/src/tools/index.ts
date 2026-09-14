import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { bashRenderers } from "../render/bashRenderer.js";
import { editRenderers, readRenderers, writeRenderers } from "../render/nativeToolRenderers.js";

export const DEFAULT_BASH_TIMEOUT_SECONDS = 120; // 2 minutos default si la tool o el LLM no envían timeout

export function registerNativeToolOverrides(pi: ExtensionAPI, cwd: string = process.cwd()): void {
	// 1. bash
	const bashDef = createBashToolDefinition(cwd);
	const originalBashExecute = bashDef.execute;

	pi.registerTool({
		...bashDef,
		renderShell: "self",
		execute: async (toolCallId, params, signal, onUpdate, ctx) => {
			const effectiveTimeout =
				params?.timeout !== undefined && params?.timeout > 0
					? params.timeout
					: DEFAULT_BASH_TIMEOUT_SECONDS;
			const effectiveParams = {
				...params,
				timeout: effectiveTimeout,
			};
			return originalBashExecute(toolCallId, effectiveParams as any, signal, onUpdate, ctx);
		},
		renderCall: bashRenderers.renderCall as ToolDefinition["renderCall"],
		renderResult: bashRenderers.renderResult as ToolDefinition["renderResult"],
	});

	// 2. read
	const readDef = createReadToolDefinition(cwd);
	pi.registerTool({
		...readDef,
		renderShell: "self",
		renderCall: readRenderers.renderCall as ToolDefinition["renderCall"],
		renderResult: readRenderers.renderResult as ToolDefinition["renderResult"],
	});

	// 3. edit
	const editDef = createEditToolDefinition(cwd);
	pi.registerTool({
		...editDef,
		renderShell: "self",
		renderCall: editRenderers.renderCall as ToolDefinition["renderCall"],
		renderResult: editRenderers.renderResult as ToolDefinition["renderResult"],
	});

	// 4. write
	const writeDef = createWriteToolDefinition(cwd);
	pi.registerTool({
		...writeDef,
		renderShell: "self",
		renderCall: writeRenderers.renderCall as ToolDefinition["renderCall"],
		renderResult: writeRenderers.renderResult as ToolDefinition["renderResult"],
	});
}
