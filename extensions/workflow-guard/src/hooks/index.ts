import { guardToolCall } from './guardToolCall.js';
import { syncOnAgentSettled } from './syncOnAgentSettled.js';
import { syncOnSessionStart } from './syncOnSessionStart.js';
import { syncOnToolResult } from './syncOnToolResult.js';

export function registerWorkflowGuardHooks(pi: { on?: (event: string, handler: (...args: any[]) => unknown) => void }): void {
  pi.on?.('tool_call', guardToolCall);
  pi.on?.('session_start', syncOnSessionStart);
  pi.on?.('tool_result', syncOnToolResult);
  pi.on?.('agent_settled', syncOnAgentSettled);
}
