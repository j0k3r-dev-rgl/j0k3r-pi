# websearch extension

Read-only Pi extension for bounded web, community, and research search.

## Tool inventory
- `web_search` — general web search V1 using hosted MCP-style providers: Exa primary with Parallel fallback. It returns bounded normalized results, item domains, provider metadata, and structured provider errors when fallback is needed.
- `web_fetch` — safe HTTPS page reader for selected `web_search` results. It fetches one page without JavaScript or subresources, extracts readable text with `html-to-text`, and returns links/redirect/byte metadata.
- `discussion_search` — parent search tool for community/human discussion sources. It can fan out across current sources or target one source with `source`.
- `research_search` — parent search tool for academic/research sources. It can fan out across OpenAlex, arXiv, Crossref, Europe PMC, and Semantic Scholar or target one source with `source`.

Provider-specific search tools are intentionally hidden in favor of parent search tools (`web_search`, `discussion_search`, and `research_search`), while `web_fetch` and detail/get tools remain public so agents can inspect selected results:

Research detail and graph tools:

- `openalex_work_get`
- `openalex_work_citations_get`
- `openalex_work_references_get`
- `arxiv_paper_get`
- `crossref_work_get`
- `crossref_work_references_get`
- `europe_pmc_article_get`
- `europe_pmc_article_citations_get`
- `europe_pmc_article_references_get`
- `semantic_scholar_paper_get`
- `semantic_scholar_paper_citations_get`
- `semantic_scholar_paper_references_get`

Research graph decisions and provider evidence are documented in [`docs/research-graph-tools.md`](docs/research-graph-tools.md). arXiv graph tools and Crossref inbound citation tools are intentionally not exposed because the investigated APIs did not provide verified graph endpoints for those capabilities.

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

Current web tool behavior:
- `web_search` uses Exa MCP (`https://mcp.exa.ai/mcp`) as the primary provider.
- `web_search` uses Parallel MCP (`https://search.parallel.ai/mcp`) as the fallback provider when Exa fails or returns no usable results.
- `EXA_API_KEY` and `PARALLEL_API_KEY` are optional; no-key best-effort calls are attempted when keys are absent.
- Successful search results include derived item `domain` values plus provider metadata validated from the MCP payload (`exa.search_time_ms`; Parallel `search_id`, `session_id`, `warnings`, and `usage` when present).
- `web_fetch` is free/local: no browser, no JavaScript, no external extraction service. It allows only `https://`, blocks private/local/link-local targets, manually revalidates redirects, reads 2 MB by default, and accepts `maxBytes` up to 5 MB.

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
- `EXA_API_KEY` optional, higher quota/authenticated Exa MCP access for `web_search`
- `PARALLEL_API_KEY` optional, higher quota/authenticated Parallel MCP access for `web_search`
- `SEMANTIC_SCHOLAR_API_KEY` optional, higher quota for Semantic Scholar Graph API

Credentials stay in environment variables only. Tools never accept secrets as inputs and redact secret-like values from returned surfaces.

## Provider notes
- GitHub uses the official `octokit` SDK for read-only public issue search/detail.
- Dev.to uses the public Forem API via native `fetch` with a tag-first MVP for article search.
- Hacker News uses the Algolia HN Search API via native `fetch` for story search and story detail.
- Exa MCP is the primary hosted web search provider for `web_search` via native `fetch`.
- Parallel MCP is the hosted fallback web search provider for `web_search` via native `fetch`.
- `web_fetch` uses Node HTTPS/DNS primitives for a local SSRF-resistant page read and `html-to-text` for HTML extraction.
- OpenAlex uses the public Works API via native `fetch`.
- arXiv uses the public Atom API via native `fetch`.
- Crossref uses the public Works API via native `fetch`.
- Europe PMC uses the public REST search API via native `fetch`.
- Semantic Scholar uses the Graph API via native `fetch`, with optional `SEMANTIC_SCHOLAR_API_KEY`.

## Source layout
- `src/{providers,schemas,summaries,tools,types}/common/` contains cross-family primitives only: HTTP/text helpers, limits, formatting, tool runtime/registry/result helpers, provider/error/runtime/tool types.
- `src/{providers,schemas,summaries,tools,types}/web/` contains general web modules and barrels for Exa/Parallel provider chaining plus safe `web_fetch`.
- `src/{providers,schemas,summaries,tools,types}/discussions/` contains discussion-family source modules and barrels for Stack Overflow, GitHub, Dev.to, and Hacker News.
- `src/{providers,schemas,summaries,tools,types}/research/` contains research-family source modules and barrels for OpenAlex, arXiv, Crossref, Europe PMC, and Semantic Scholar.
- `src/tools/web/index.ts`, `src/tools/discussions/index.ts`, and `src/tools/research/index.ts` are parent-tool orchestrators (`web_search`, `discussion_search`, `research_search`) and source-module registrars.
- Per-source research detail tools live in their source files (`src/tools/research/openalex.ts`, `arxiv.ts`, `crossref.ts`, `europe-pmc.ts`, `semantic-scholar.ts`).
- `src/tools/index.ts`, `src/tools.ts`, `src/types.ts`, and `src/client.ts` remain entry/facade files; provider-specific implementation should not be added there.
- `src/types/shared.ts` was removed; shared/common types belong under `src/types/common/` and family/source types belong under their family folders.

## Safety and bounds
- Read-only only; no posting, editing, voting, moderation, or other mutation.
- Search tools return bounded result counts with concise snippets.
- `web_fetch` only fetches HTTPS text-like content (`text/html`, `application/xhtml+xml`, text/plain/markdown, and JSON), blocks embedded credentials and unsafe/private/local resolved addresses, follows at most 3 safe redirects, reads 2 MB by default, and caps `maxBytes` at 5 MB.
- Research graph tools return bounded citation/reference lists with explicit provider pagination (`limit` plus `page` or `offset`).
- Detail/get tools expose the full text returned by the provider for selected bodies, abstracts, notes, and comments; they are bounded by explicit provider/API availability and pagination parameters such as comment limits, offsets, and nested comment depth, not by arbitrary summary truncation.
- Secret-like strings are redacted as `[REDACTED_SECRET]` across `content`, `details`, and structured errors.
- Provider errors are returned as structured recoverable failures when possible.
- Community content is untrusted display content only.

## Validation
- `cd extensions/websearch && npm run typecheck`
- `cd extensions/websearch && npm run test`
- `cd extensions/websearch && npm audit --omit=dev --json`
