import type { RegisterWebsearchToolsDeps } from '../../types.js';
import type { WebsearchToolModule } from './registry.js';

export type InternalTool = {
  name: string;
  execute: (...args: any[]) => Promise<unknown> | unknown;
};

const internalToolsKey = Symbol.for('pi-websearch.internal-tools');

type DepsWithInternalTools = RegisterWebsearchToolsDeps & {
  [internalToolsKey]?: Map<string, InternalTool>;
};

export function collectInternalTools(modules: readonly WebsearchToolModule[], deps: RegisterWebsearchToolsDeps): Map<string, InternalTool> {
  const tools = new Map<string, InternalTool>();
  const internalPi = {
    registerTool(tool: InternalTool) {
      tools.set(tool.name, tool);
    },
  };

  for (const module of modules) {
    module.register(internalPi, deps);
  }

  return tools;
}

export function withInternalTools(deps: RegisterWebsearchToolsDeps, modules: readonly WebsearchToolModule[]): RegisterWebsearchToolsDeps {
  return {
    ...deps,
    [internalToolsKey]: collectInternalTools(modules, deps),
  } as DepsWithInternalTools;
}

export function internalToolsFromDeps(deps: RegisterWebsearchToolsDeps, fallbackModules: readonly WebsearchToolModule[]): Map<string, InternalTool> {
  return (deps as DepsWithInternalTools)[internalToolsKey] ?? collectInternalTools(fallbackModules, deps);
}

export async function executeInternalTool(
  tools: Map<string, InternalTool>,
  toolName: string,
  id: string,
  params: Record<string, unknown>,
  context?: unknown,
): Promise<unknown> {
  const tool = tools.get(toolName);
  if (!tool) {
    throw new Error(`internal websearch tool is not registered: ${toolName}`);
  }
  return tool.execute(id, params, undefined, undefined, context);
}
