import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerExploreTool } from "./explore.js";
import { registerImpactTool } from "./impact.js";
import { registerManageTool } from "./manage.js";
import { registerNodeTool } from "./node.js";
import { registerStatusTool } from "./status.js";
import { registerSyncTool } from "./sync.js";

export function registerCodeGraphTools(pi: ExtensionAPI) {
	registerExploreTool(pi);
	registerStatusTool(pi);
	registerManageTool(pi);
	registerSyncTool(pi);
	registerNodeTool(pi);
	registerImpactTool(pi);
}

