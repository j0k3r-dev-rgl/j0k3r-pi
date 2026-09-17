import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerCodeFindTool } from './src/tools/code-find.js';
import { registerCodeCallHierarchyTool } from './src/tools/code-call-hierarchy.js';
import { registerWorkspaceGraphStatusTool } from './src/tools/workspace-graph.js';
import { registerCodeChangeSurfaceTool } from './src/tools/code-change-surface.js';
import { loadCodeResearchConfigSync } from './src/config.js';
import { registerWorkspaceGraphLifecycle, workspaceGraphScheduler } from './src/core/graph-scheduler.js';

export { findSymbol } from './src/core/find-symbol-resolver.js';
export type { FindSymbolInput, SymbolLocation } from './src/types.js';

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

export default function codeResearchExtension(pi: any) {
  if (!isExtensionEnabled('code-research')) return;

  const config = loadCodeResearchConfigSync(process.cwd());
  if (!config.graph.enable) return;

  registerCodeFindTool(pi);
  registerCodeCallHierarchyTool(pi);
  registerWorkspaceGraphStatusTool(pi);
  registerCodeChangeSurfaceTool(pi);

  registerWorkspaceGraphLifecycle(pi, workspaceGraphScheduler);
}
