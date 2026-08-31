import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { getServicesStatus } from './src/core/manager.js';
import { registerWorkspaceServicesTools, type RegisterWorkspaceServicesToolsOptions, WORKSPACE_SERVICE_TOOL_NAMES } from './src/tools/index.js';

export { WORKSPACE_SERVICE_TOOL_NAMES, registerWorkspaceServicesTools, type RegisterWorkspaceServicesToolsOptions };
export type { WorkspaceServiceOutcome, WorkspaceServicesConfig, RuntimeStateV1, ManagedProcessIdentityV1 } from './src/types.js';

export default function workspaceServicesExtension(
  pi: ExtensionAPI,
  options: RegisterWorkspaceServicesToolsOptions = {},
): void {
  registerWorkspaceServicesTools(pi, options);

  pi.on('session_start', async (_event, ctx) => {
    if (!ctx.isProjectTrusted()) return;
    await getServicesStatus(options.cwd ?? ctx.cwd, ctx.signal).catch(() => undefined);
  });
}
