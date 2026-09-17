import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { getServicesStatus } from './src/core/manager.js';
import { registerWorkspaceServicesTools, type RegisterWorkspaceServicesToolsOptions, WORKSPACE_SERVICE_TOOL_NAMES } from './src/tools/index.js';

export { WORKSPACE_SERVICE_TOOL_NAMES, registerWorkspaceServicesTools, type RegisterWorkspaceServicesToolsOptions };
export type { WorkspaceServiceOutcome, WorkspaceServicesConfig, RuntimeStateV1, ManagedProcessIdentityV1 } from './src/types.js';

function isExtensionEnabled(name: string, cwd = process.cwd()): boolean {
  try {
    const configPath = join(cwd, '.pi', 'extensions.json');
    if (!existsSync(configPath)) return false;
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    return Boolean(config && typeof config === 'object' && config[name] === true);
  } catch {
    return false;
  }
}

export default function workspaceServicesExtension(
  pi: ExtensionAPI,
  options: RegisterWorkspaceServicesToolsOptions = {},
): void {
  const cwd = options.cwd ?? process.cwd();
  if (!isExtensionEnabled('workspace-services', cwd)) return;

  registerWorkspaceServicesTools(pi, options);

  pi.on('session_start', async (_event, ctx) => {
    if (!ctx.isProjectTrusted()) return;
    await getServicesStatus(options.cwd ?? ctx.cwd, ctx.signal).catch(() => undefined);
  });
}
