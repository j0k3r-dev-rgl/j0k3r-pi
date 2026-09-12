import { renderWebsearchToolCall, renderWebsearchToolResult } from '../../render/index.js';
import type { RegisterWebsearchToolsDeps } from '../../types.js';

export type ToolRegistrar = (pi: any, deps: RegisterWebsearchToolsDeps) => void;

export type WebsearchToolModule<Name extends string = string> = {
  names: readonly Name[];
  register: ToolRegistrar;
};

type ToolDefinition = {
  name: string;
  label?: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
  execute: (...args: any[]) => Promise<unknown>;
  renderShell?: 'self';
  renderCall?: (...args: any[]) => unknown;
  renderResult?: (...args: any[]) => unknown;
};

export function registerTool(pi: any, tool: ToolDefinition): void {
  pi.registerTool({
    ...tool,
    renderShell: tool.renderShell ?? 'self',
    renderCall: tool.renderCall ?? ((args: any, theme: any, context?: any) => renderWebsearchToolCall(tool.name, args, theme, context)),
    renderResult: tool.renderResult ?? ((result: any, options: any, theme: any, context?: any) => renderWebsearchToolResult(tool.name, result, options, theme, context)),
  });
}
