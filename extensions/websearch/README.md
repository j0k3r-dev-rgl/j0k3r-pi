# websearch extension

Read-only Pi extension for bounded community/research search across discussion and academic-style sources.

## Tool inventory
- `discussion_search` — parent search tool for community/human discussion sources. It can fan out across current sources or target one source with `source`.
- `research_search` — parent search tool for academic/research sources. It can fan out across OpenAlex, arXiv, Crossref, Europe PMC, and Semantic Scholar or target one source with `source`.

Provider-specific search tools are intentionally hidden in favor of `discussion_search`, but detail/get tools remain public so agents can inspect selected results:

- `stack_overflow_question_get`
- `stack_overflow_answers_get`
- `stack_overflow_comments_get`
- `github_issue_get`
- `github_pull_request_get`
- `github_releases_get`
- `github_release_get`
- `devto_comments_get`
- `hackernews_story_get`

Current `research_search` source filters:
- `all` or omitted: OpenAlex, arXiv, Crossref, Europe PMC, and Semantic Scholar
- `openalex`
- `arxiv`
- `crossref`
- `europe_pmc`
- `semantic_scholar`

Research sources are consulted when selected. If a source is rate-limited or unavailable, `research_search` returns partial results plus `source_errors` explaining the failure. Semantic Scholar automatically uses `SEMANTIC_SCHOLAR_API_KEY` when present and otherwise attempts the free quota.

Current `discussion_search` source filters:
- `all` or omitted: Stack Overflow, GitHub issues, GitHub pull requests, Dev.to, and Hacker News
- `stack_overflow`
- `github` (issues + pull requests)
- `github_issues`
- `github_pull_requests`
- `devto`
- `hacker_news`

The legacy provider-specific tool modules remain internally testable so existing provider functionality, clients, normalization, bounds, and safety behavior are preserved behind the parent tools.

Fan-out searches are resilient: if one source fails, `discussion_search` returns partial results plus `source_errors` instead of failing the entire tool call. Successful fan-out results are interleaved across sources before applying the global `limit`, avoiding first-source dominance. Dev.to currently uses a tag-based API, so multi-word queries derive a usable first tag before searching.

## Environment
- `STACK_EXCHANGE_KEY` optional for higher Stack Exchange quota
- `GITHUB_TOKEN` optional, env-only, public-read GitHub quota helper
- `OPENALEX_MAILTO` or `CROSSREF_MAILTO` optional, polite-pool identification for research APIs
- `SEMANTIC_SCHOLAR_API_KEY` optional, higher quota for Semantic Scholar Graph API

Credentials stay in environment variables only. Tools never accept secrets as inputs and redact secret-like values from returned surfaces.

## Provider notes
- GitHub uses the official `octokit` SDK for read-only public issue search/detail.
- Dev.to uses the public Forem API via native `fetch` with a tag-first MVP for article search.
- Hacker News uses the Algolia HN Search API via native `fetch` for story search and story detail.
- OpenAlex uses the public Works API via native `fetch`.
- arXiv uses the public Atom API via native `fetch`.
- Crossref uses the public Works API via native `fetch`.
- Europe PMC uses the public REST search API via native `fetch`.
- Semantic Scholar uses the Graph API via native `fetch`, with optional `SEMANTIC_SCHOLAR_API_KEY`.

## Source layout
- `src/tools/discussions/` contains the public `discussion_search` parent tool plus discussion detail/search module internals.
- `src/providers/discussions/`, `src/schemas/discussions/`, `src/summaries/discussions/`, and `src/types/discussions/` contain discussion-source provider clients, schemas, summaries, and types.
- `src/tools/research/` contains the public `research_search` parent tool and research fan-out/routing logic.
- `src/providers/research/`, `src/schemas/research/`, `src/summaries/research/`, and `src/types/research/` contain the research-specific provider clients, schemas, summaries, and types.
- `src/providers/common/`, `src/schemas/common/`, `src/summaries/common/`, `src/tools/common/`, and `src/types/common/` contain shared helpers used by modular source families.
- `src/tools/` also keeps shared runtime/result/registry helpers used by source-family tools and tests.
- `src/tools.ts`, `src/types.ts`, and `src/client.ts` remain compatibility facades for existing imports.

## Safety and bounds
- Read-only only; no posting, editing, voting, moderation, or other mutation.
- Output is bounded for search results, bodies, comments, and nested comment depth.
- Secret-like strings are redacted as `[REDACTED_SECRET]` across `content`, `details`, and structured errors.
- Provider errors are returned as structured recoverable failures when possible.
- Community content is untrusted display content only.

## Validation
- `cd extensions/websearch && npm run typecheck`
- `cd extensions/websearch && npm run test`
- `cd extensions/websearch && npm audit --omit=dev --json`
