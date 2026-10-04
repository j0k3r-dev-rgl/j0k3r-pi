import { Type } from 'typebox';
import type { SubagentManager } from '../manager.js';
import { renderSubagentSendMessageCall, renderSubagentSendMessageResult } from '../render/tools/subagent-send-message.js';
import { sessionIdFromToolContext } from './result-details.js';
import { ok, fail } from './tool-response.js';

export function createSubagentSendMessageTool(manager: SubagentManager) {
  return {
    name: 'subagent_send_message',
    label: 'Subagent Send Message',
    description: 'Queue a live steering message for a running background subagent owned by the current Pi session.',
    parameters: Type.Object({
      task_id: Type.String(),
      message: Type.String(),
    }),
    renderShell: 'self',
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const result = manager.sendMessage({
          task_id: params.task_id,
          message: params.message,
          session_id: sessionIdFromToolContext(ctx),
        });
        const text = result.status === 'queued'
          ? `queued: ${result.message}`
          : `rejected: ${result.message}`;
        return ok(text, result);
      } catch (error) {
        return fail(error);
      }
    },
    renderCall: renderSubagentSendMessageCall,
    renderResult: renderSubagentSendMessageResult,
  };
}
