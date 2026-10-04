import type { SubagentDefinition } from '../types.js';

export function buildPrompt(_definition: SubagentDefinition, task: string, context?: string, _tools: string[] = _definition.tools): string {
  return [
    context ? `## orchestrator context\n${context}` : '',
    `## delegated task\n${task}`,
  ].filter(Boolean).join('\n\n');
}
