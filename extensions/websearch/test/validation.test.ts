import { describe, expect, it } from 'vitest';
import * as validation from '../src/validation.js';

describe('websearch stack overflow validation', () => {
  it('applies search/question/answers defaults and bounds', () => {
    expect(validation.validateStackOverflowSearch({ query: 'TypeScript fetch' })).toEqual({
      query: 'TypeScript fetch',
      limit: 5,
    });

    expect(validation.validateStackOverflowQuestionRef({ question: 'https://stackoverflow.com/questions/12345/example' })).toEqual({
      questionId: '12345',
      url: 'https://stackoverflow.com/questions/12345/example',
    });

    expect(validation.validateStackOverflowAnswers({ question: '12345' })).toEqual({
      questionId: '12345',
      url: 'https://stackoverflow.com/questions/12345',
      limit: 10,
    });

    expect((validation as Record<string, any>).validateStackOverflowComments({ question: '12345', commentsLimit: 3, commentsOffset: 6 })).toEqual({
      questionId: '12345',
      url: 'https://stackoverflow.com/questions/12345',
      commentsLimit: 3,
      commentsOffset: 6,
    });

    expect(() => validation.validateStackOverflowSearch({ query: 'oops', limit: 11 })).toThrow(/at most 10/i);
    expect(() => validation.validateStackOverflowAnswers({ question: '12345', limit: 31 })).toThrow(/at most 30/i);
    expect(() => (validation as Record<string, any>).validateStackOverflowComments({ question: '12345', commentsLimit: 31 })).toThrow(/at most 30/i);
  });
});

describe('websearch community-platform validation contracts', () => {
  it('exports shared search defaults and platform-specific comment bounds', () => {
    const contracts = validation as Record<string, unknown>;

    expect(contracts.SEARCH_DEFAULT_LIMIT).toBe(5);
    expect(contracts.SEARCH_MAX_LIMIT).toBe(10);
    expect(contracts.GITHUB_COMMENTS_DEFAULT_LIMIT).toBe(5);
    expect(contracts.GITHUB_COMMENTS_MAX_LIMIT).toBe(20);
    expect(contracts.DEVTO_TOP_LEVEL_COMMENTS_DEFAULT_LIMIT).toBe(10);
    expect(contracts.DEVTO_TOTAL_COMMENTS_MAX).toBe(25);
    expect(contracts.DEVTO_MAX_DEPTH).toBe(2);
    expect(contracts.HN_COMMENTS_DEFAULT_LIMIT).toBe(10);
    expect(contracts.HN_COMMENTS_MAX_LIMIT).toBe(25);
    expect(contracts.HN_MAX_DEPTH).toBe(3);
  });

  it('parses GitHub issue references from URLs and owner/repo#number refs', () => {
    const validateGitHubIssueRef = (validation as Record<string, unknown>).validateGitHubIssueRef as
      | ((value: unknown) => unknown)
      | undefined;

    expect(validateGitHubIssueRef).toBeTypeOf('function');
    expect(validateGitHubIssueRef?.({ issue: 'https://github.com/octo/widgets/issues/42' })).toEqual({
      owner: 'octo',
      repo: 'widgets',
      issueNumber: 42,
      url: 'https://github.com/octo/widgets/issues/42',
    });
    expect(validateGitHubIssueRef?.({ issue: 'octo/widgets#42' })).toEqual({
      owner: 'octo',
      repo: 'widgets',
      issueNumber: 42,
      url: 'https://github.com/octo/widgets/issues/42',
    });
  });

  it('defaults and caps search/detail requests for GitHub, Dev.to, and Hacker News', () => {
    const contracts = validation as Record<string, unknown>;
    const validateGitHubIssueSearch = contracts.validateGitHubIssueSearch as ((value: unknown) => unknown) | undefined;
    const validateGitHubIssueGet = contracts.validateGitHubIssueGet as ((value: unknown) => unknown) | undefined;
    const validateGitHubPullRequestSearch = contracts.validateGitHubPullRequestSearch as ((value: unknown) => unknown) | undefined;
    const validateGitHubPullRequestGet = contracts.validateGitHubPullRequestGet as ((value: unknown) => unknown) | undefined;
    const validateGitHubReleasesGet = contracts.validateGitHubReleasesGet as ((value: unknown) => unknown) | undefined;
    const validateGitHubReleaseGet = contracts.validateGitHubReleaseGet as ((value: unknown) => unknown) | undefined;
    const validateGitHubRepoGet = contracts.validateGitHubRepoGet as ((value: unknown) => unknown) | undefined;
    const validateGitHubFileGet = contracts.validateGitHubFileGet as ((value: unknown) => unknown) | undefined;
    const validateGitHubCodeSearch = contracts.validateGitHubCodeSearch as ((value: unknown) => unknown) | undefined;
    const validateGitHubDiscussionSearch = contracts.validateGitHubDiscussionSearch as ((value: unknown) => unknown) | undefined;
    const validateGitHubDiscussionGet = contracts.validateGitHubDiscussionGet as ((value: unknown) => unknown) | undefined;
    const validateDevtoArticleSearch = contracts.validateDevtoArticleSearch as ((value: unknown) => unknown) | undefined;
    const validateDevtoCommentsGet = contracts.validateDevtoCommentsGet as ((value: unknown) => unknown) | undefined;
    const validateHackerNewsSearch = contracts.validateHackerNewsSearch as ((value: unknown) => unknown) | undefined;
    const validateHackerNewsStoryGet = contracts.validateHackerNewsStoryGet as ((value: unknown) => unknown) | undefined;

    expect(validateGitHubIssueSearch).toBeTypeOf('function');
    expect(validateGitHubIssueGet).toBeTypeOf('function');
    expect(validateGitHubPullRequestSearch).toBeTypeOf('function');
    expect(validateGitHubPullRequestGet).toBeTypeOf('function');
    expect(validateGitHubReleasesGet).toBeTypeOf('function');
    expect(validateGitHubReleaseGet).toBeTypeOf('function');
    expect(validateGitHubRepoGet).toBeTypeOf('function');
    expect(validateGitHubFileGet).toBeTypeOf('function');
    expect(validateGitHubCodeSearch).toBeTypeOf('function');
    expect(validateGitHubDiscussionSearch).toBeTypeOf('function');
    expect(validateGitHubDiscussionGet).toBeTypeOf('function');
    expect(validateDevtoArticleSearch).toBeTypeOf('function');
    expect(validateDevtoCommentsGet).toBeTypeOf('function');
    expect(validateHackerNewsSearch).toBeTypeOf('function');
    expect(validateHackerNewsStoryGet).toBeTypeOf('function');

    expect(validateGitHubIssueSearch?.({ query: 'vitest repo:octo/widgets' })).toEqual({
      query: 'vitest repo:octo/widgets',
      limit: 5,
    });
    expect(validateGitHubIssueSearch?.({ query: 'vitest', repo: 'octo/widgets', state: 'all' })).toEqual({
      query: 'vitest',
      repo: 'octo/widgets',
      state: 'all',
      limit: 5,
    });
    expect(validateGitHubPullRequestSearch?.({ query: 'corepack', repo: 'octo/widgets', state: 'merged' })).toEqual({
      query: 'corepack',
      repo: 'octo/widgets',
      state: 'merged',
      limit: 5,
    });
    expect(validateGitHubReleasesGet?.({ repo: 'octo/widgets', includePrereleases: true })).toEqual({
      owner: 'octo',
      repo: 'widgets',
      limit: 5,
      includePrereleases: true,
    });
    expect(validateGitHubReleaseGet?.({ repo: 'octo/widgets', tag: 'v1.2.3' })).toEqual({
      owner: 'octo',
      repo: 'widgets',
      tag: 'v1.2.3',
    });
    expect(validateGitHubRepoGet?.({ repo: 'octo/widgets' })).toEqual({
      owner: 'octo',
      repo: 'widgets',
      includeReadme: true,
    });
    expect(validateGitHubRepoGet?.({ repo: 'octo/widgets', includeReadme: false })).toEqual({
      owner: 'octo',
      repo: 'widgets',
      includeReadme: false,
    });
    expect(validateGitHubFileGet?.({ repo: 'octo/widgets', path: '/src/index.ts', ref: 'main' })).toEqual({
      owner: 'octo',
      repo: 'widgets',
      path: 'src/index.ts',
      ref: 'main',
    });
    expect(validateGitHubCodeSearch?.({ query: 'OAuth provider', owner: 'octo-org', language: 'TypeScript', path: 'examples', limit: 2 })).toEqual({
      query: 'OAuth provider',
      owner: 'octo-org',
      language: 'TypeScript',
      path: 'examples',
      limit: 2,
    });
    expect(validateGitHubCodeSearch?.({ query: 'OAuth provider', repo: 'octo/widgets', owner: 'ignored-owner' })).toEqual({
      query: 'OAuth provider',
      repo: 'octo/widgets',
      owner: undefined,
      limit: 5,
      language: undefined,
      path: undefined,
    });
    expect(validateGitHubDiscussionSearch?.({ query: 'agent memory', owner: 'octo-org', limit: 4 })).toEqual({
      query: 'agent memory',
      owner: 'octo-org',
      limit: 4,
    });
    expect(validateGitHubDiscussionSearch?.({ query: 'agent memory', repo: 'octo/widgets', owner: 'ignored-owner' })).toEqual({
      query: 'agent memory',
      repo: 'octo/widgets',
      owner: undefined,
      limit: 5,
    });
    expect(validateGitHubDiscussionGet?.({ discussion: 'https://github.com/octo/widgets/discussions/42', commentsLimit: 3, commentsOffset: 6 })).toEqual({
      owner: 'octo',
      repo: 'widgets',
      discussionNumber: 42,
      url: 'https://github.com/octo/widgets/discussions/42',
      commentsLimit: 3,
      commentsOffset: 6,
    });
    expect(validateGitHubDiscussionGet?.({ discussion: 'octo/widgets#42' })).toEqual({
      owner: 'octo',
      repo: 'widgets',
      discussionNumber: 42,
      url: 'https://github.com/octo/widgets/discussions/42',
      commentsLimit: 5,
      commentsOffset: 0,
    });
    expect(() => validateGitHubIssueSearch?.({ query: 'vitest', repo: 'octo' })).toThrow(/repo must be an owner\/repo reference/i);
    expect(validateDevtoArticleSearch?.({ tag: 'typescript' })).toEqual({
      tag: 'typescript',
      limit: 5,
    });
    expect(validateHackerNewsSearch?.({ query: 'typescript' })).toEqual({
      query: 'typescript',
      limit: 5,
    });
    expect(validateGitHubIssueGet?.({ issue: 'octo/widgets#42', commentsLimit: 3, commentsOffset: 6 })).toEqual({
      owner: 'octo',
      repo: 'widgets',
      issueNumber: 42,
      url: 'https://github.com/octo/widgets/issues/42',
      commentsLimit: 3,
      commentsOffset: 6,
    });
    expect(validateGitHubPullRequestGet?.({ pull_request: 'https://github.com/octo/widgets/pull/42', commentsLimit: 2, commentsOffset: 4, reviewCommentsLimit: 3, reviewCommentsOffset: 6 })).toEqual({
      owner: 'octo',
      repo: 'widgets',
      pullNumber: 42,
      url: 'https://github.com/octo/widgets/pull/42',
      commentsLimit: 2,
      commentsOffset: 4,
      reviewCommentsLimit: 3,
      reviewCommentsOffset: 6,
    });
    expect(validateDevtoCommentsGet?.({ article_id: 1234, topLevelLimit: 2, topLevelOffset: 4 })).toEqual({
      articleId: 1234,
      topLevelLimit: 2,
      topLevelOffset: 4,
      totalLimit: 25,
      maxDepth: 2,
    });
    expect(validateHackerNewsStoryGet?.({ story_id: 9876, commentsLimit: 2, commentsOffset: 4 })).toEqual({
      storyId: 9876,
      commentsLimit: 2,
      commentsOffset: 4,
      maxDepth: 3,
    });

    expect(() => validateGitHubIssueSearch?.({ query: 'oops', limit: 11 })).toThrow(/at most 10/i);
    expect(() => validateGitHubPullRequestSearch?.({ query: 'oops', state: 'draft' })).toThrow(/open.*closed.*merged.*all/i);
    expect(() => validateGitHubIssueGet?.({ issue: 'octo/widgets#42', commentsLimit: 21 })).toThrow(/at most 20/i);
    expect(() => validateGitHubPullRequestGet?.({ pull_request: 'octo/widgets#42', reviewCommentsLimit: 21 })).toThrow(/at most 20/i);
    expect(() => validateGitHubReleasesGet?.({ repo: 'octo', limit: 11 })).toThrow(/repo must be an owner\/repo reference|at most 10/i);
    expect(() => validateGitHubReleaseGet?.({ repo: 'octo/widgets', tag: '' })).toThrow(/tag is required/i);
    expect(() => validateGitHubFileGet?.({ repo: 'octo/widgets', path: '../secret' })).toThrow(/repository-relative path/i);
    expect(() => validateGitHubCodeSearch?.({ query: 'oops', owner: 'bad/owner' })).toThrow(/owner must be a GitHub owner name/i);
    expect(() => validateGitHubCodeSearch?.({ query: 'oops', limit: 11 })).toThrow(/at most 10/i);
    expect(() => validateGitHubDiscussionSearch?.({ query: 'oops', owner: 'bad/owner' })).toThrow(/owner must be a GitHub owner name/i);
    expect(() => validateGitHubDiscussionSearch?.({ query: 'oops', limit: 11 })).toThrow(/at most 10/i);
    expect(() => validateGitHubDiscussionGet?.({ discussion: 'octo/widgets#0' })).toThrow(/discussion must be a GitHub discussion url or owner\/repo#number reference/i);
    expect(() => validateDevtoCommentsGet?.({ article_id: 1234, topLevelLimit: 26 })).toThrow(/at most 25/i);
    expect(() => validateHackerNewsStoryGet?.({ story_id: 9876, commentsLimit: 26 })).toThrow(/at most 25/i);
  });
});
