import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerExploreTool } from "./explore.js";
import { registerManageTool } from "./manage.js";
import { registerStatusTool } from "./status.js";
import { registerSyncTool } from "./sync.js";

export function registerCodeGraphTools(pi: ExtensionAPI) {
	registerExploreTool(pi);
	registerStatusTool(pi);
	registerManageTool(pi);
	registerSyncTool(pi);
}
