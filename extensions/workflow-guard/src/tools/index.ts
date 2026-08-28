import { createGetWorkflowStateTool } from './getWorkflowState.js';
import { createValidateWorkflowTool } from './validateWorkflow.js';

export function registerWorkflowGuardTools(pi: { registerTool?: (tool: unknown) => void }): void {
  pi.registerTool?.(createGetWorkflowStateTool());
  pi.registerTool?.(createValidateWorkflowTool());
}
