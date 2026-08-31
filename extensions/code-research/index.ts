import { registerCodeFindTool } from './src/tools/code-find.js';
import { registerCodeCallHierarchyTool } from './src/tools/code-call-hierarchy.js';
import { registerWorkspaceGraphStatusTool } from './src/tools/workspace-graph.js';
import { createWorkspaceGraphScheduler, registerWorkspaceGraphLifecycle } from './src/core/graph-scheduler.js';
import { ensureWorkspaceGraphFreshness } from './src/core/workspace-graph.js';

export { findSymbol } from './src/core/find-symbol-resolver.js';
export type { FindSymbolInput, SymbolLocation } from './src/types.js';

export default function codeResearchExtension(pi: any) {
  registerCodeFindTool(pi);
  registerCodeCallHierarchyTool(pi);
  registerWorkspaceGraphStatusTool(pi);

  const scheduler = createWorkspaceGraphScheduler({
    refresh: async (projectRoot) => {
      await ensureWorkspaceGraphFreshness(projectRoot);
    },
  });
  registerWorkspaceGraphLifecycle(pi, scheduler);
}
