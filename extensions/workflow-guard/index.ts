import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerWorkflowGuardHooks } from './src/hooks/index.js';
import { registerWorkflowGuardTools } from './src/tools/index.js';

export default function workflowGuardExtension(pi: ExtensionAPI): void {
  registerWorkflowGuardTools(pi as any);
  registerWorkflowGuardHooks(pi as any);
}
