import { registerFindSymbolTool } from './src/tools/find-symbol.js';
import { registerFunctionCallTreeTool } from './src/tools/function-call-tree.js';
import { registerReverseFunctionCallTreeTool } from './src/tools/reverse-function-call-tree.js';
import { registerWorkspaceGraphStatusTool } from './src/tools/workspace-graph.js';
import { createWorkspaceGraphScheduler, registerWorkspaceGraphLifecycle } from './src/core/graph-scheduler.js';
import { ensureWorkspaceGraphFreshness } from './src/core/workspace-graph.js';

export { findSymbol } from './src/core/find-symbol-resolver.js';
export type { FindSymbolInput, SymbolLocation } from './src/types.js';

export default function codeResearchExtension(pi: any) {
  registerFindSymbolTool(pi);
  registerFunctionCallTreeTool(pi);
  registerReverseFunctionCallTreeTool(pi);
  registerWorkspaceGraphStatusTool(pi);

  const scheduler = createWorkspaceGraphScheduler({
    refresh: async (projectRoot) => {
      await ensureWorkspaceGraphFreshness(projectRoot);
    },
  });
  registerWorkspaceGraphLifecycle(pi, scheduler);
}
