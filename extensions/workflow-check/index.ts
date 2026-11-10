import { withFileMutationQueue, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createWorkflowCheckTool } from './src/tools/workflow-check.ts';
import { createWorkflowRecordTool } from './src/tools/workflow-record.ts';
import { renderCall, renderResult } from './src/render/index.js';

export default function workflowCheckExtension(pi: ExtensionAPI) {
  pi.registerTool({ ...createWorkflowCheckTool(), renderCall, renderResult });
  pi.registerTool({ ...createWorkflowRecordTool(withFileMutationQueue), renderCall, renderResult });
}
