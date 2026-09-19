import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { registerCodeGraphTools } from "./src/tools/index.js";

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
}
