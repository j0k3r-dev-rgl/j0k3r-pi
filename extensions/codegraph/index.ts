import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTrackedTempDirs } from "./src/core.js";
import { registerCodeGraphTools } from "./src/tools/index.js";
import { _resetSyncState } from "./src/tools/sync.js";

export function isExtensionEnabled(name: string, cwd = process.cwd()): boolean {
	try {
		const configPath = join(cwd, ".pi", "extensions.json");
		if (!existsSync(configPath)) return false;
		const config = JSON.parse(readFileSync(configPath, "utf8"));
		return Boolean(config && typeof config === "object" && config[name] === true);
	} catch {
		return false;
	}
}

export default function codegraphExtension(pi: ExtensionAPI, options: { cwd?: string } = {}) {
	const cwd = options.cwd ?? process.cwd();
	if (!isExtensionEnabled("codegraph", cwd)) return;
	registerCodeGraphTools(pi);
	if (typeof (pi as any).on === "function") {
		(pi as any).on("before_agent_start", (event: { systemPrompt: string }) => {
			return {
				systemPrompt: `${event.systemPrompt}\n\n## CodeGraph Intelligence Policy\n- When inspecting indexed projects, strictly prefer \`codegraph_node\` for symbol definitions, callers/callees, and file structure over the generic \`read\` tool.\n- Before refactoring or changing shared symbols or files, use \`codegraph_impact\` to verify direct and transitive blast radius.\n- Use \`codegraph_explore\` only for wide multi-component architecture queries. Do NOT use \`codegraph_explore\` for single symbols or files.\n- On low-confidence exploration results, follow the suggested symbols using \`codegraph_node\` directly.`,
			};
		});

		(pi as any).on("session_shutdown", async () => {
			await cleanupTrackedTempDirs();
			_resetSyncState();
		});
	}
}

