# websearch extension

Read-only Pi extension for bounded community/research search across discussion and academic-style sources.

## Tool inventory
- `discussion_search` — parent search tool for community/human discussion sources. It can fan out across current sources or target one source with `source`.
- `research_search` — parent search tool for academic/research sources. It can fan out across OpenAlex, arXiv, Crossref, Europe PMC, and Semantic Scholar or target one source with `source`.

Provider-specific search tools are intentionally hidden in favor of `discussion_search` and `research_search`, but detail/get tools remain public so agents can inspect selected results:

Research detail tools:

- `openalex_work_get`
- `arxiv_paper_get`
- `crossref_work_get`
- `europe_pmc_article_get`
- `semantic_scholar_paper_get`

Discussion detail tools:

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

Research sources are consulted when selected. If a source is rate-limited or unavailable, `research_search` returns partial results plus `source_errors` explaining the failure. Semantic Scholar automatically uses `SEMANTIC_SCHOLAR_API_KEY` when present and otherwise attempts the free quota. Research search results include `followup_tool` and `followup_ref` fields pointing to the matching detail tool.

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
- `src/{providers,schemas,summaries,tools,types}/common/` contains cross-family primitives only: HTTP/text helpers, limits, formatting, tool runtime/registry/result helpers, provider/error/runtime/tool types.
- `src/{providers,schemas,summaries,tools,types}/discussions/` contains discussion-family source modules and barrels for Stack Overflow, GitHub, Dev.to, and Hacker News.
- `src/{providers,schemas,summaries,tools,types}/research/` contains research-family source modules and barrels for OpenAlex, arXiv, Crossref, Europe PMC, and Semantic Scholar.
- `src/tools/discussions/index.ts` and `src/tools/research/index.ts` are parent-tool orchestrators (`discussion_search`, `research_search`) and source-module registrars.
- Per-source research detail tools live in their source files (`src/tools/research/openalex.ts`, `arxiv.ts`, `crossref.ts`, `europe-pmc.ts`, `semantic-scholar.ts`).
- `src/tools/index.ts`, `src/tools.ts`, `src/types.ts`, and `src/client.ts` remain entry/facade files; provider-specific implementation should not be added there.
- `src/types/shared.ts` was removed; shared/common types belong under `src/types/common/` and family/source types belong under their family folders.

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
