import type { RegisterWebsearchToolsDeps } from '../src/types.js';
import { devtoTools } from '../src/tools/discussions/devto.js';
import { githubTools } from '../src/tools/discussions/github.js';
import { hackerNewsTools } from '../src/tools/discussions/hackernews.js';
import { stackOverflowTools } from '../src/tools/discussions/stack-overflow.js';

export function registerWebsearchTools(pi: any, deps: RegisterWebsearchToolsDeps = {}): void {
  stackOverflowTools.register(pi, deps);
  githubTools.register(pi, deps);
  devtoTools.register(pi, deps);
  hackerNewsTools.register(pi, deps);
}
