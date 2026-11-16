import { withFileMutationQueue, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createWorkflowCheckTool } from './src/tools/workflow-check.ts';
import { createWorkflowRecordTool } from './src/tools/workflow-record.ts';
import { createWorkflowToolPresentation } from './src/render/index.js';

export default function workflowCheckExtension(pi: ExtensionAPI) {
  pi.registerTool({ ...createWorkflowCheckTool(), ...createWorkflowToolPresentation('workflow_check') } as any);
  pi.registerTool({ ...createWorkflowRecordTool(withFileMutationQueue), ...createWorkflowToolPresentation('workflow_record') } as any);
}
