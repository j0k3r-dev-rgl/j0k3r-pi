import { registerWorkspaceServicesTools, type RegisterWorkspaceServicesToolsOptions } from './src/tools.js';

export {
  WORKSPACE_SERVICE_TOOL_NAMES,
  registerWorkspaceServicesTools,
  type RegisterWorkspaceServicesToolsOptions,
} from './src/tools.js';
export * from './src/config.js';
export * from './src/manager.js';
export * from './src/state.js';
export * from './src/types.js';

export default function workspaceServicesExtension(pi: any, options: RegisterWorkspaceServicesToolsOptions = {}): void {
  registerWorkspaceServicesTools(pi, options);
}
