import { readSubagentsConfig } from '../config.js';
import type { SubagentManager } from '../manager.js';
import { createSubagentListAgentsTool } from './subagent-list-agents.js';
import { createSubagentRunTool } from './subagent-run.js';
import { createSubagentContinueTool } from './subagent-continue.js';
import { createSubagentStatusTool } from './subagent-status.js';
import { createSubagentResultTool } from './subagent-result.js';
import { createSubagentListTasksTool } from './subagent-list-tasks.js';
import { createSubagentCancelTool } from './subagent-cancel.js';
import { createSubagentSendMessageTool } from './subagent-send-message.js';

export function registerSubagentTools(pi: any, manager: SubagentManager, cwd = process.cwd()): void {
  pi.registerTool(createSubagentListAgentsTool(manager));
  pi.registerTool(createSubagentRunTool(manager, pi));
  if (readSubagentsConfig(cwd).enable_continue) pi.registerTool(createSubagentContinueTool(manager, pi));
  pi.registerTool(createSubagentStatusTool(manager));
  pi.registerTool(createSubagentResultTool(manager));
  pi.registerTool(createSubagentListTasksTool(manager));
  pi.registerTool(createSubagentCancelTool(manager));
  pi.registerTool(createSubagentSendMessageTool(manager));
}
