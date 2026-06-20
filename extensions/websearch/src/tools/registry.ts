import type { RegisterWebsearchToolsDeps } from '../types.js';

export type ToolRegistrar = (pi: any, deps: RegisterWebsearchToolsDeps) => void;

export type WebsearchToolModule<Name extends string = string> = {
  names: readonly Name[];
  register: ToolRegistrar;
};

export function registerTool(pi: any, tool: { name: string; description: string; parameters: unknown; execute: (...args: any[]) => Promise<unknown> }): void {
  pi.registerTool(tool);
}
