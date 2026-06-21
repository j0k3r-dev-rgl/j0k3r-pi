import { describe, expect, it, vi } from 'vitest';
import { registerWebsearchTools } from './legacy-tools.js';
import { createMockPi, execute } from './helpers.js';

function baseClients(githubOverrides: Record<string, unknown>) {
  return {
    stackExchange: { searchQuestions: vi.fn(), getQuestion: vi.fn(), getAnswers: vi.fn(), getQuestionComments: vi.fn() },
    github: {
      searchIssues: vi.fn().mockResolvedValue([]),
      getIssue: vi.fn(),
      listIssueComments: vi.fn().mockResolvedValue([]),
      listIssueTimelineEvents: vi.fn().mockResolvedValue([]),
      searchPullRequests: vi.fn().mockResolvedValue([]),
      getPullRequest: vi.fn(),
      listPullRequestReviewComments: vi.fn().mockResolvedValue([]),
      listPullRequestReviews: vi.fn().mockResolvedValue([]),
      listReleases: vi.fn().mockResolvedValue([]),
      getReleaseByTag: vi.fn(),
      getRepository: vi.fn(),
      getRepositoryReadme: vi.fn(),
      getFile: vi.fn(),
      searchCode: vi.fn().mockResolvedValue([]),
      ...githubOverrides,
    },
    devto: { searchArticles: vi.fn(), getComments: vi.fn() },
    hackerNews: { searchStories: vi.fn(), getStory: vi.fn() },
  };
}

const repoPayload = {
  id: 123,
  name: 'langgraph',
  full_name: 'langchain-ai/langgraph',
  html_url: 'https://github.com/langchain-ai/langgraph',
  description: 'Build resilient language agents as graphs.',
  homepage: 'https://langchain-ai.github.io/langgraph/',
  topics: ['agents', 'llm', 'langchain'],
  default_branch: 'main',
  stargazers_count: 12345,
  forks_count: 678,
  open_issues_count: 42,
  language: 'Python',
  archived: false,
  private: false,
  pushed_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  license: { spdx_id: 'MIT' },
};

const readmePayload = {
  name: 'README.md',
  path: 'README.md',
  sha: 'readme-sha',
  size: 64,
  html_url: 'https://github.com/langchain-ai/langgraph/blob/main/README.md',
  download_url: 'https://raw.githubusercontent.com/langchain-ai/langgraph/main/README.md',
  type: 'file',
  encoding: 'base64',
  content: Buffer.from('# LangGraph\n\nBuild resilient language agents as graphs.').toString('base64'),
};

describe('github deep read-only tools', () => {
  it('github_repo_get returns repository metadata and README by default', async () => {
    const getRepository = vi.fn().mockResolvedValue(repoPayload);
    const getRepositoryReadme = vi.fn().mockResolvedValue(readmePayload);
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => baseClients({ getRepository, getRepositoryReadme }) });

    const tool = pi.tools.find((entry) => entry.name === 'github_repo_get');
    expect(tool).toBeDefined();
    const result = (await execute(tool!, { repo: 'langchain-ai/langgraph' })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: Record<string, unknown> & { readme?: Record<string, unknown> } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({
      platform: 'github',
      repository: 'langchain-ai/langgraph',
      name: 'langgraph',
      description: 'Build resilient language agents as graphs.',
      topics: ['agents', 'llm', 'langchain'],
      default_branch: 'main',
      stars: 12345,
      forks: 678,
      license: 'MIT',
      readme: {
        path: 'README.md',
        content: expect.stringContaining('Build resilient language agents'),
      },
    });
    expect(result.content[0]?.text).toContain('langchain-ai/langgraph — Build resilient language agents as graphs.');
    expect(result.content[0]?.text).toContain('stars: 12345');
    expect(result.content[0]?.text).toContain('topics: agents, llm, langchain');
    expect(result.content[0]?.text).toContain('README.md');
    expect(getRepository).toHaveBeenCalledWith({ owner: 'langchain-ai', repo: 'langgraph' }, undefined);
    expect(getRepositoryReadme).toHaveBeenCalledWith({ owner: 'langchain-ai', repo: 'langgraph' }, undefined);
  });

  it('github_file_get reads a repository file by path and ref', async () => {
    const getFile = vi.fn().mockResolvedValue({
      name: 'config.ts',
      path: 'examples/config.ts',
      sha: 'file-sha',
      size: 42,
      html_url: 'https://github.com/acme/widgets/blob/v1/examples/config.ts',
      download_url: 'https://raw.githubusercontent.com/acme/widgets/v1/examples/config.ts',
      type: 'file',
      encoding: 'base64',
      content: Buffer.from('export const oauthProvider = "github";\n').toString('base64'),
    });
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => baseClients({ getFile }) });

    const tool = pi.tools.find((entry) => entry.name === 'github_file_get');
    expect(tool).toBeDefined();
    const result = (await execute(tool!, { repo: 'acme/widgets', path: 'examples/config.ts', ref: 'v1' })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: Record<string, unknown> };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({
      platform: 'github',
      repository: 'acme/widgets',
      path: 'examples/config.ts',
      ref: 'v1',
      size: 42,
      content: 'export const oauthProvider = "github";\n',
    });
    expect(result.content[0]?.text).toContain('acme/widgets:examples/config.ts@v1');
    expect(result.content[0]?.text).toContain('export const oauthProvider = "github";');
    expect(getFile).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets', path: 'examples/config.ts', ref: 'v1' }, undefined);
  });

  it('github_code_search returns code results with file follow-up refs', async () => {
    const searchCode = vi.fn().mockResolvedValue([{
      name: 'oauth.ts',
      path: 'examples/oauth.ts',
      sha: 'code-sha',
      html_url: 'https://github.com/acme/widgets/blob/main/examples/oauth.ts',
      repository: { full_name: 'acme/widgets' },
      score: 3.14,
      text_matches: [{ fragment: 'createOAuthProvider({ provider: "github" })' }],
    }]);
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => baseClients({ searchCode }) });

    const tool = pi.tools.find((entry) => entry.name === 'github_code_search');
    expect(tool).toBeDefined();
    const result = (await execute(tool!, { query: 'createOAuthProvider provider github', repo: 'acme/widgets', language: 'TypeScript', path: 'examples', limit: 3 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { items: Array<Record<string, unknown>>; limit: number } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.limit).toBe(3);
    expect(result.details.data.items[0]).toMatchObject({
      platform: 'github',
      repository: 'acme/widgets',
      path: 'examples/oauth.ts',
      name: 'oauth.ts',
      score: 3.14,
      snippet: 'createOAuthProvider({ provider: "github" })',
      followup_tool: 'github_file_get',
      followup_ref: 'acme/widgets:examples/oauth.ts',
    });
    expect(result.content[0]?.text).toContain('1. acme/widgets/examples/oauth.ts');
    expect(result.content[0]?.text).toContain('createOAuthProvider');
    expect(searchCode).toHaveBeenCalledWith({ query: 'createOAuthProvider provider github', repo: 'acme/widgets', language: 'TypeScript', path: 'examples', limit: 3 }, undefined);
  });

  it('uses gh api repository and readme endpoints for github_repo_get', async () => {
    const commandRunner = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(' ');
      if (command === 'api repos/langchain-ai/langgraph') {
        return { stdout: JSON.stringify(repoPayload), stderr: '' };
      }
      if (command.includes('repos/langchain-ai/langgraph/readme')) {
        return { stdout: JSON.stringify(readmePayload), stderr: '' };
      }
      throw new Error(`unexpected gh command: ${command}`);
    });
    const pi = createMockPi();
    registerWebsearchTools(pi, {
      env: {},
      fetch: vi.fn<typeof fetch>(),
      commandRunner,
      config: { github: { provider: 'gh' }, request: { timeoutMs: 120_000, maxRetries: 1 } },
    });

    const tool = pi.tools.find((entry) => entry.name === 'github_repo_get');
    const result = (await execute(tool!, { repo: 'langchain-ai/langgraph' })) as { details: { status: string } };

    expect(result.details.status).toBe('success');
    expect(commandRunner).toHaveBeenCalledWith('gh', ['api', 'repos/langchain-ai/langgraph'], expect.anything());
    expect(commandRunner).toHaveBeenCalledWith('gh', ['api', '-X', 'GET', 'repos/langchain-ai/langgraph/readme'], expect.anything());
  });

  it('uses gh api contents endpoint with ref for github_file_get', async () => {
    const filePayload = {
      name: 'oauth.ts',
      path: 'examples/oauth.ts',
      encoding: 'base64',
      content: Buffer.from('export const provider = "github";').toString('base64'),
    };
    const commandRunner = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(' ');
      if (command.includes('repos/acme/widgets/contents/examples/oauth.ts')) {
        return { stdout: JSON.stringify(filePayload), stderr: '' };
      }
      throw new Error(`unexpected gh command: ${command}`);
    });
    const pi = createMockPi();
    registerWebsearchTools(pi, {
      env: {},
      fetch: vi.fn<typeof fetch>(),
      commandRunner,
      config: { github: { provider: 'gh' }, request: { timeoutMs: 120_000, maxRetries: 1 } },
    });

    const tool = pi.tools.find((entry) => entry.name === 'github_file_get');
    const result = (await execute(tool!, { repo: 'acme/widgets', path: 'examples/oauth.ts', ref: 'v1' })) as { details: { status: string } };

    expect(result.details.status).toBe('success');
    expect(commandRunner).toHaveBeenCalledWith('gh', expect.arrayContaining(['api', '-X', 'GET', 'repos/acme/widgets/contents/examples/oauth.ts', '-f', 'ref=v1']), expect.anything());
  });

  it('uses gh api code search endpoint with text match accept header', async () => {
    const commandRunner = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(' ');
      if (command.includes('search/code')) {
        return { stdout: JSON.stringify({ items: [] }), stderr: '' };
      }
      throw new Error(`unexpected gh command: ${command}`);
    });
    const pi = createMockPi();
    registerWebsearchTools(pi, {
      env: {},
      fetch: vi.fn<typeof fetch>(),
      commandRunner,
      config: { github: { provider: 'gh' }, request: { timeoutMs: 120_000, maxRetries: 1 } },
    });

    const tool = pi.tools.find((entry) => entry.name === 'github_code_search');
    const result = (await execute(tool!, { query: 'OAuth provider', repo: 'acme/widgets', language: 'TypeScript', path: 'examples', limit: 7 })) as { details: { status: string } };

    expect(result.details.status).toBe('success');
    expect(commandRunner).toHaveBeenCalledWith('gh', expect.arrayContaining(['api', '-X', 'GET', 'search/code', '-H', 'Accept: application/vnd.github.text-match+json', '-f', 'per_page=7', '-f', 'page=1']), expect.anything());
    const searchArgs = commandRunner.mock.calls[0]?.[1] as string[];
    expect(searchArgs.join(' ')).toContain('q=OAuth provider repo:acme/widgets language:"TypeScript" path:"examples"');
  });
});
