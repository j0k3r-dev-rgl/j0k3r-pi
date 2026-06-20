import { renderWebsearchToolResult } from '../../render/index.js';
import type { RegisterWebsearchToolsDeps } from '../../types.js';

export type ToolRegistrar = (pi: any, deps: RegisterWebsearchToolsDeps) => void;

export type WebsearchToolModule<Name extends string = string> = {
  names: readonly Name[];
  register: ToolRegistrar;
};

type ToolDefinition = {
  name: string;
  description: string;
  parameters: unknown;
  execute: (...args: any[]) => Promise<unknown>;
  renderResult?: (...args: any[]) => unknown;
};

export function registerTool(pi: any, tool: ToolDefinition): void {
  pi.registerTool({
    ...tool,
    renderResult: tool.renderResult ?? ((result: any, options: any, theme: any) => renderWebsearchToolResult(tool.name, result, options, theme)),
  });
}
