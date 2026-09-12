import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { bashRenderers } from "../render/bashRenderer.js";
import { editRenderers, readRenderers, writeRenderers } from "../render/nativeToolRenderers.js";

export function registerNativeToolOverrides(pi: ExtensionAPI, cwd: string = process.cwd()): void {
	// 1. bash
	const bashDef = createBashToolDefinition(cwd);
	pi.registerTool({
		...bashDef,
		renderShell: "self",
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
