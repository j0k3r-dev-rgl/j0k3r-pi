import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { bashRenderers } from "../render/bashRenderer.js";
import {
	COMPACT_LEFT_MARGIN_KEY,
	COMPACT_LEFT_MARGIN_VALUE,
	COMPACT_TOOL_RENDERING_KEY,
	COMPACT_TOOL_RENDERING_VERSION,
} from "../render/compact.js";
import { editRenderers, readRenderers, writeRenderers } from "../render/nativeToolRenderers.js";

export const DEFAULT_BASH_TIMEOUT_SECONDS = 120; // 2 minutos default si la tool o el LLM no envían timeout

/**
 * The theme's bash timeout rule: an explicit positive timeout wins, otherwise the theme default applies.
 * Exported so the behavior is testable without starting a shell.
 */
export function resolveBashTimeout(timeout: number | undefined): number {
	return timeout !== undefined && timeout > 0 ? timeout : DEFAULT_BASH_TIMEOUT_SECONDS;
}

/** The parameters the theme forwards to Pi's bash tool: unchanged, with the theme's timeout applied. */
export function applyBashTimeout<T extends { timeout?: number }>(params: T): T & { timeout: number } {
	return { ...params, timeout: resolveBashTimeout(params?.timeout) };
}

/**
 * Registers the four built-ins the theme already owns as tool definitions, now with the pinned compact
 * presentation marker. The bash execution wrapper is unchanged: the theme's default timeout still
 * applies exactly as before.
 *
 * `grep`, `find`, `ls` and `powershell` stay execution-owned by Pi; their compact presentation comes
 * from the renderer-only universal resolver, so no dummy tool or active-tool change is introduced.
 */
export function registerNativeToolOverrides(pi: ExtensionAPI, cwd: string = process.cwd()): void {
	// 1. bash
	const bashDef = createBashToolDefinition(cwd);
	const originalBashExecute = bashDef.execute;
	const bash: Record<string, unknown> = {
		...bashDef,
		renderShell: "self",
		[COMPACT_TOOL_RENDERING_KEY]: COMPACT_TOOL_RENDERING_VERSION,
		[COMPACT_LEFT_MARGIN_KEY]: COMPACT_LEFT_MARGIN_VALUE,
		execute: async (toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) =>
			originalBashExecute(toolCallId, applyBashTimeout(params), signal, onUpdate, ctx),
		renderCall: bashRenderers.renderCall,
		renderResult: bashRenderers.renderResult,
	};
	pi.registerTool(bash as unknown as ToolDefinition);

	// 2. read
	const readDef = createReadToolDefinition(cwd);
	const read: Record<string, unknown> = {
		...readDef,
		renderShell: "self",
		[COMPACT_TOOL_RENDERING_KEY]: COMPACT_TOOL_RENDERING_VERSION,
		[COMPACT_LEFT_MARGIN_KEY]: COMPACT_LEFT_MARGIN_VALUE,
		renderCall: readRenderers.renderCall,
		renderResult: readRenderers.renderResult,
	};
	pi.registerTool(read as unknown as ToolDefinition);

	// 3. edit
	const editDef = createEditToolDefinition(cwd);
	const edit: Record<string, unknown> = {
		...editDef,
		renderShell: "self",
		[COMPACT_TOOL_RENDERING_KEY]: COMPACT_TOOL_RENDERING_VERSION,
		[COMPACT_LEFT_MARGIN_KEY]: COMPACT_LEFT_MARGIN_VALUE,
		renderCall: editRenderers.renderCall,
		renderResult: editRenderers.renderResult,
	};
	pi.registerTool(edit as unknown as ToolDefinition);

	// 4. write
	const writeDef = createWriteToolDefinition(cwd);
	const write: Record<string, unknown> = {
		...writeDef,
		renderShell: "self",
		[COMPACT_TOOL_RENDERING_KEY]: COMPACT_TOOL_RENDERING_VERSION,
		[COMPACT_LEFT_MARGIN_KEY]: COMPACT_LEFT_MARGIN_VALUE,
		renderCall: writeRenderers.renderCall,
		renderResult: writeRenderers.renderResult,
	};
	pi.registerTool(write as unknown as ToolDefinition);
}
