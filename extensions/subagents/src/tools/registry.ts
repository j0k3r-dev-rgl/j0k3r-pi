import type { SubagentManager } from '../manager.js';
import { createSubagentRunTool } from './subagent-run.js';

export function registerSubagentTools(pi: any, manager: SubagentManager, _cwd = process.cwd()): void {
  pi.registerTool(createSubagentRunTool(manager, pi));
}
