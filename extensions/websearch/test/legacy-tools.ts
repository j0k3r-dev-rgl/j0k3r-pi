import type { RegisterWebsearchToolsDeps } from '../src/types.js';
import { devtoTools } from '../src/tools/devto.js';
import { githubTools } from '../src/tools/github.js';
import { hackerNewsTools } from '../src/tools/hackernews.js';
import { stackOverflowTools } from '../src/tools/stack-overflow.js';

export function registerWebsearchTools(pi: any, deps: RegisterWebsearchToolsDeps = {}): void {
  stackOverflowTools.register(pi, deps);
  githubTools.register(pi, deps);
  devtoTools.register(pi, deps);
  hackerNewsTools.register(pi, deps);
}
