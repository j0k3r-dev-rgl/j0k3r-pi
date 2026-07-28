import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerWorkspaceServicesTools, type RegisterWorkspaceServicesToolsOptions, WORKSPACE_SERVICE_TOOL_NAMES } from './src/tools/index.js';

export { WORKSPACE_SERVICE_TOOL_NAMES, registerWorkspaceServicesTools, type RegisterWorkspaceServicesToolsOptions };
export type { WorkspaceServiceOutcome, WorkspaceServicesConfig, RuntimeStateV1, ManagedProcessIdentityV1 } from './src/types.js';

export default function workspaceServicesExtension(
  pi: ExtensionAPI,
  options: RegisterWorkspaceServicesToolsOptions = {},
): void {
  registerWorkspaceServicesTools(pi, options);
}
