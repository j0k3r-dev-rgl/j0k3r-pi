import type { CompactRenderers } from "./compact.js";
import { bashRenderers, powershellRenderers } from "./bashRenderer.js";
import { editRenderers, findRenderers, grepRenderers, lsRenderers, readRenderers, writeRenderers } from "./nativeToolRenderers.js";

/**
 * The theme's compact presentation for every Pi built-in tool.
 *
 * `read`, `edit`, `write` and `bash` are also registered as tools by this extension (bash keeps the
 * theme's default timeout wrapper). `grep`, `find`, `ls` and `powershell` stay execution-owned by Pi;
 * their presentation is supplied here so Pi's built-in renderers — which generate card frames and
 * expansion hints — never reach the transcript.
 */
export const THEME_TOOL_RENDERERS: Record<string, CompactRenderers> = {
	read: readRenderers,
	edit: editRenderers,
	write: writeRenderers,
	bash: bashRenderers,
	powershell: powershellRenderers,
	grep: grepRenderers,
	find: findRenderers,
	ls: lsRenderers,
};
