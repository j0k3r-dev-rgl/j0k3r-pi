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
      ...githubOverrides,
    },
    devto: { searchArticles: vi.fn(), getComments: vi.fn() },
    hackerNews: { searchStories: vi.fn(), getStory: vi.fn() },
  };
}

const releases = [{
  id: 1,
  tag_name: 'v6.0.3',
  name: 'TypeScript 6.0.3',
  html_url: 'https://github.com/microsoft/TypeScript/releases/tag/v6.0.3',
  author: { login: 'typescript-bot' },
  draft: false,
  prerelease: false,
  target_commitish: 'release-6.0',
  published_at: '2026-04-16T23:43:08Z',
  body: 'Stable release notes with fixes and compiler updates.',
  assets: [{ id: 1 }],
}, {
  id: 2,
  tag_name: 'v6.0-rc',
  name: 'TypeScript 6.0 RC',
  html_url: 'https://github.com/microsoft/TypeScript/releases/tag/v6.0-rc',
  author: { login: 'typescript-bot' },
  draft: false,
  prerelease: true,
  published_at: '2026-03-06T17:56:53Z',
  body: 'Prerelease candidate notes.',
  assets: [{ id: 2 }],
}];

describe('github releases tool behavior', () => {
  it('github_releases_get returns stable releases by default and hides prereleases', async () => {
    const listReleases = vi.fn().mockResolvedValue(releases);
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => baseClients({ listReleases }) });

    const tool = pi.tools.find((entry) => entry.name === 'github_releases_get');
    expect(tool).toBeDefined();
    const result = (await execute(tool!, { repo: 'microsoft/TypeScript', limit: 5 })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { items: Array<Record<string, unknown>> } };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data.items).toHaveLength(1);
    expect(result.details.data.items[0]).toMatchObject({
      repository: 'microsoft/TypeScript',
      tag: 'v6.0.3',
      prerelease: false,
      assets_count: 1,
      author: 'typescript-bot',
    });
    expect(result.content[0]?.text).toContain('1. TypeScript 6.0.3 — v6.0.3');
    expect(result.content[0]?.text).toContain('published: 2026-04-16T23:43:08Z');
    expect(result.content[0]?.text).toContain('assets: 1');
    expect(result.content[0]?.text).not.toContain('v6.0-rc');
    expect(listReleases).toHaveBeenCalledWith({ owner: 'microsoft', repo: 'TypeScript', limit: 5, includePrereleases: false }, undefined);
  });

  it('github_releases_get can include prereleases', async () => {
    const listReleases = vi.fn().mockResolvedValue(releases);
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => baseClients({ listReleases }) });

    const tool = pi.tools.find((entry) => entry.name === 'github_releases_get');
    const result = (await execute(tool!, { repo: 'microsoft/TypeScript', includePrereleases: true })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: { items: Array<Record<string, unknown>> } };
    };

    expect(result.details.data.items).toHaveLength(2);
    expect(result.content[0]?.text).toContain('v6.0-rc');
    expect(listReleases).toHaveBeenCalledWith({ owner: 'microsoft', repo: 'TypeScript', limit: 5, includePrereleases: true }, undefined);
  });

  it('uses gh api releases endpoint for the gh provider', async () => {
    const commandRunner = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(' ');
      if (command.includes('repos/microsoft/TypeScript/releases')) {
        return { stdout: JSON.stringify(releases), stderr: '' };
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

    const tool = pi.tools.find((entry) => entry.name === 'github_releases_get');
    const result = (await execute(tool!, { repo: 'microsoft/TypeScript', includePrereleases: true, limit: 2 })) as { details: { status: string } };

    expect(result.details.status).toBe('success');
    expect(commandRunner).toHaveBeenCalledWith('gh', expect.arrayContaining(['api', '-X', 'GET', 'repos/microsoft/TypeScript/releases', '-f', 'per_page=2', '-f', 'page=1']), expect.anything());
  });

  it('github_release_get returns one exact release by tag', async () => {
    const getReleaseByTag = vi.fn().mockResolvedValue(releases[0]);
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => baseClients({ getReleaseByTag }) });

    const tool = pi.tools.find((entry) => entry.name === 'github_release_get');
    expect(tool).toBeDefined();
    const result = (await execute(tool!, { repo: 'microsoft/TypeScript', tag: 'v6.0.3' })) as {
      content: Array<{ text: string }>;
      details: { status: 'success'; data: Record<string, unknown> };
    };

    expect(result.details.status).toBe('success');
    expect(result.details.data).toMatchObject({
      repository: 'microsoft/TypeScript',
      tag: 'v6.0.3',
      name: 'TypeScript 6.0.3',
      target_commitish: 'release-6.0',
      prerelease: false,
      assets_count: 1,
      author: 'typescript-bot',
    });
    expect(result.content[0]?.text).toContain('TypeScript 6.0.3 — v6.0.3');
    expect(result.content[0]?.text).toContain('target: release-6.0');
    expect(result.content[0]?.text).toContain('notes: Stable release notes');
    expect(getReleaseByTag).toHaveBeenCalledWith({ owner: 'microsoft', repo: 'TypeScript', tag: 'v6.0.3' }, undefined);
  });

  it('github_release_get returns not_found for a missing tag', async () => {
    const getReleaseByTag = vi.fn().mockResolvedValue(null);
    const pi = createMockPi();
    registerWebsearchTools(pi, { env: {}, fetch: vi.fn<typeof fetch>(), createClients: () => baseClients({ getReleaseByTag }) });

    const tool = pi.tools.find((entry) => entry.name === 'github_release_get');
    const result = (await execute(tool!, { repo: 'microsoft/TypeScript', tag: 'v0.0.0-missing' })) as {
      isError?: boolean;
      details: { status: 'failure'; error: Record<string, unknown> };
    };

    expect(result.isError).toBe(true);
    expect(result.details.error).toMatchObject({ code: 'not_found', category: 'not_found', provider: 'github' });
  });

  it('uses gh api release-by-tag endpoint for the gh provider', async () => {
    const commandRunner = vi.fn(async (_file: string, args: string[]) => {
      const command = args.join(' ');
      if (command.includes('repos/microsoft/TypeScript/releases/tags/v6.0.3')) {
        return { stdout: JSON.stringify(releases[0]), stderr: '' };
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

    const tool = pi.tools.find((entry) => entry.name === 'github_release_get');
    const result = (await execute(tool!, { repo: 'microsoft/TypeScript', tag: 'v6.0.3' })) as { details: { status: string } };

    expect(result.details.status).toBe('success');
    expect(commandRunner).toHaveBeenCalledWith('gh', expect.arrayContaining(['api', '-X', 'GET', 'repos/microsoft/TypeScript/releases/tags/v6.0.3']), expect.anything());
  });
});
