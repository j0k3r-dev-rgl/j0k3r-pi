import type { RegisterWebsearchToolsDeps } from '../types.js';
import { discussionTools } from './discussions/index.js';
import { researchTools } from './research/index.js';
import type { WebsearchToolModule } from './registry.js';

const toolModules = [
  discussionTools,
  researchTools,
] as const satisfies readonly WebsearchToolModule[];

export const WEBSEARCH_TOOL_NAMES = toolModules.flatMap((module) => [...module.names]) as readonly string[];

export function registerWebsearchTools(pi: any, deps: RegisterWebsearchToolsDeps = {}): void {
  for (const module of toolModules) {
    module.register(pi, deps);
  }
}
