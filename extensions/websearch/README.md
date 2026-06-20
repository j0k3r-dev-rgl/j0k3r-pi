# websearch extension

Read-only Pi extension for bounded community/research search across discussion and academic-style sources.

## Tool inventory
- `discussion_search` — parent tool for community/human discussion sources. It can fan out across current sources or target one source with `source`.
- `research_search` — parent tool for academic/research sources. It is currently scaffolded for future providers such as OpenAlex, Semantic Scholar, and arXiv.

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

Credentials stay in environment variables only. Tools never accept secrets as inputs and redact secret-like values from returned surfaces.

## Provider notes
- GitHub uses the official `octokit` SDK for read-only public issue search/detail.
- Dev.to uses the public Forem API via native `fetch` with a tag-first MVP for article search.
- Hacker News uses the Algolia HN Search API via native `fetch` for story search and story detail.

## Source layout
- `src/tools/discussions/` contains the public `discussion_search` parent tool and discussion fan-out/routing logic.
- `src/tools/research/` contains the public `research_search` parent tool scaffold for future academic providers.
- `src/tools/` also keeps legacy provider-specific modules plus shared runtime/result/registry helpers used by tests and internal reuse.
- `src/providers/` contains provider clients per platform.
- `src/schemas/`, `src/summaries/`, and `src/types/` keep schemas, display summaries, and types split by platform.
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
