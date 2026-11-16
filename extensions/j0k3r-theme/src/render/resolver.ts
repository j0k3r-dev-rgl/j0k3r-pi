import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	COMPACT_LEFT_MARGIN_KEY,
	COMPACT_LEFT_MARGIN_VALUE,
	COMPACT_TOOL_RENDERING_KEY,
	COMPACT_TOOL_RENDERING_VERSION,
	type CompactRenderers,
	createFallbackRenderers,
	hasLeftMargin,
	isSelfRendered,
	wrapLeftMarginComponent,
} from "../render/compact.js";
import { THEME_TOOL_RENDERERS } from "../render/index.js";

/**
 * Narrow structural view of the pinned host API. The package-local Pi copy (0.85.1) predates
 * `registerToolRenderer`; the installed 1.5.2 host documents it. Declaring only this one capability
 * avoids manifest changes or unbundled prototype mutation.
 */
interface ToolRendererHost {
	registerToolRenderer?: (resolver: (toolName: string, next: () => CompactRenderers | undefined) => CompactRenderers | undefined) => void;
}

/**
 * Wraps an owner renderer slot so a local failure stays a compact row instead of falling through to
 * Pi's boxed default and generated expansion hints.
 */
function guardSlot(
	slot: ((...args: any[]) => any) | undefined,
	kind: "call" | "result",
	toolName: string,
	ownerHasLeftMargin: boolean,
): ((...args: any[]) => any) | undefined {
	if (typeof slot !== "function") return undefined;
	return (...args: any[]) => {
		try {
			const component = slot(...args);
			if (ownerHasLeftMargin || hasLeftMargin(component)) return component;
			return wrapLeftMarginComponent(component);
		} catch {
			const fallback = createFallbackRenderers(toolName);
			const fallbackSlot: ((...args: any[]) => any) | undefined =
				kind === "call" ? fallback.renderCall : fallback.renderResult;
			return fallbackSlot?.(...args);
		}
	};
}

/**
 * Renderer-only universal resolver. Precedence:
 *
 * 1. A compliant owner definition (`compactToolRenderingVersion: 1`, `renderShell: "self"`, both safe
 *    slots) keeps its specialized presentation; slots are guarded so an owner bug cannot reach Pi's
 *    boxed fallback.
 * 2. The theme's own compact presentation for a Pi built-in the theme does not own as a tool
 *    (`grep`, `find`, `ls`, `powershell`), replacing Pi's built-in renderers and their hints.
 * 3. The local compact fallback for everything else: unmarked, missing slots, default shell,
 *    throwing, unknown/restored and dynamic MCP or resource names. Unmarked callbacks are never
 *    invoked, so their card frames and hints cannot leak into the transcript.
 *
 * `next()` runs every other resolver first (other extensions in load order, then Pi's built-ins), so
 * this resolver composes with the MCP resolver and with owner-provided definitions.
 */
export function registerCompactToolRenderer(pi: ExtensionAPI): void {
	const host = pi as unknown as ToolRendererHost;
	if (typeof host.registerToolRenderer !== "function") return;

	host.registerToolRenderer((toolName, next) => {
		const resolved = next();
		if (isSelfRendered(resolved)) {
			const ownerHasLeftMargin = hasLeftMargin(resolved);
			return {
				...resolved,
				[COMPACT_TOOL_RENDERING_KEY]: COMPACT_TOOL_RENDERING_VERSION,
				[COMPACT_LEFT_MARGIN_KEY]: COMPACT_LEFT_MARGIN_VALUE,
				renderCall: guardSlot(resolved.renderCall, "call", toolName, ownerHasLeftMargin),
				renderResult: guardSlot(resolved.renderResult, "result", toolName, ownerHasLeftMargin),
			};
		}
		const themeRenderers = THEME_TOOL_RENDERERS[toolName];
		if (themeRenderers) return themeRenderers;
		return createFallbackRenderers(toolName);
	});
}
