import type { WebsearchConfig } from '../../config.js';
import type { DevtoClient } from '../discussions/devto.js';
import type { GitHubClient } from '../discussions/github.js';
import type { HackerNewsClient } from '../discussions/hackernews.js';
import type { StackExchangeClient } from '../discussions/stack-overflow.js';
import type { ResearchClients } from '../research/index.js';
import type { WebClients } from '../web/index.js';

export interface WebsearchClients {
  stackExchange: StackExchangeClient;
  github: GitHubClient;
  devto: DevtoClient;
  hackerNews: HackerNewsClient;
  research?: ResearchClients;
  web?: WebClients;
}

export type CommandRunnerResult = {
  stdout: string;
  stderr: string;
};

export type CommandRunner = (file: string, args: string[], options?: { signal?: AbortSignal }) => Promise<CommandRunnerResult>;

export interface RegisterWebsearchToolsDeps {
  clients?: Partial<WebsearchClients>;
  createClients?: (runtime: WebsearchRuntime) => WebsearchClients;
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  commandRunner?: CommandRunner;
  config?: WebsearchConfig;
}

export type WebsearchRuntime = {
  env: Record<string, string | undefined>;
  fetch: typeof globalThis.fetch;
  config: WebsearchConfig;
  commandRunner?: CommandRunner;
};
