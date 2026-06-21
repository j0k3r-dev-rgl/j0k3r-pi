# websearch extension

Read-only Pi extension for bounded web, community, and research search.

## Tool inventory
- `web_search` — general web search V1 using hosted MCP-style providers: Exa primary with Parallel fallback. It returns bounded normalized results, item domains, provider metadata, and structured provider errors when fallback is needed.
- `web_fetch` — safe HTTPS page reader for selected `web_search` results. It fetches one page without JavaScript or subresources, extracts readable text with `html-to-text`, and returns links/redirect/byte metadata.
- `discussion_search` — parent search tool for community/human discussion sources. It can fan out across current sources or target one source with `source`.
- `research_search` — parent search tool for academic/research sources. It can fan out across OpenAlex, arXiv, Crossref, Europe PMC, and Semantic Scholar or target one source with `source`.

Provider-specific source tools are intentionally hidden in favor of parent search tools and grouped detail routers. The public tool surface is:

Search and fetch tools:

- `web_search`
- `web_fetch`
- `discussion_search`
- `research_search`
- `github_code_search` — bounded code search with `github_get` file follow-ups: `{ query: "OAuth provider", repo?: "owner/repo", owner?: "org", language?: "TypeScript", path?: "examples", limit?: 10 }`

Discussion detail tools:

- `discussion_get` — open one selected Stack Exchange question, GitHub issue/pull request/discussion, or Hacker News story: `{ source: "unix_linux", ref: "unix:535083" }`, `{ source: "github_issue", ref: "owner/repo#123" }`, `{ source: "hacker_news", ref: 123 }`.
- `discussion_answers_get` — bounded Stack Exchange answers: `{ source: "server_fault", ref: "serverfault:67316", limit?: 30 }`.
- `discussion_comments_get` — bounded comments/replies/review comments where supported, including Stack Exchange, GitHub issue/pull request/discussion, Dev.to article comments, and Hacker News story comments via the story detail path.

Research detail and graph tools:

- `research_get` — open one selected OpenAlex, arXiv, Crossref, Europe PMC, or Semantic Scholar item: `{ source: "openalex", ref: "W123" }`, `{ source: "crossref", doi: "10.1234/example" }`.
- `research_graph_get` — fetch citations or references where provider support is verified: `{ source: "openalex", graph: "citations", ref: "W123", limit?: 5 }`.

GitHub non-discussion detail tool:

- `github_get` — fetch repository metadata, one file, one release, or recent releases: `{ kind: "repo", repo: "owner/repo" }`, `{ kind: "file", ref: "owner/repo:path/to/file.ts" }`, `{ kind: "release", repo: "owner/repo", tag: "v1.0.0" }`, `{ kind: "releases", repo: "owner/repo" }`.

Research graph decisions and provider evidence are documented in [`docs/research-graph-tools.md`](docs/research-graph-tools.md). arXiv graph access and Crossref inbound citations are intentionally not exposed because the investigated APIs did not provide verified graph endpoints for those capabilities.

Current `research_search` source filters:
- `all` or omitted: OpenAlex, arXiv, Crossref, Europe PMC, and Semantic Scholar
- `openalex`
- `arxiv`
- `crossref`
- `europe_pmc`
- `semantic_scholar`

Research sources are consulted when selected. If a source is rate-limited or unavailable, `research_search` returns partial results plus `source_errors` explaining the failure. Semantic Scholar automatically uses `SEMANTIC_SCHOLAR_API_KEY` when present and otherwise attempts the free quota. Research search and graph results include `followup_tool: "research_get"` plus `followup_ref` and `source` so agents can inspect selected items through the grouped detail router.

Current web tool behavior:
- `web_search` uses Exa MCP (`https://mcp.exa.ai/mcp`) as the primary provider.
- `web_search` uses Parallel MCP (`https://search.parallel.ai/mcp`) as the fallback provider when Exa fails or returns no usable results.
- `web_search` defaults to `limit: 10`; agents may optionally pass `limit` from 1 to 10.
- `web_search` accepts normalized optional filters: `includeDomains`, `excludeDomains`, `afterDate`, `beforeDate`, `location`, and `mode` (`fast`, `auto`, or `deep`). Exa receives supported filters natively via its advanced MCP search when needed; Parallel MCP receives equivalent objective/query hints because its MCP interface intentionally avoids dedicated date/domain parameters.
- `EXA_API_KEY` and `PARALLEL_API_KEY` are optional; no-key best-effort calls are attempted when keys are absent.
- Successful search results include derived item `domain` values plus provider metadata validated from the MCP payload (`exa.search_time_ms`; Parallel `search_id`, `session_id`, `warnings`, and `usage` when present). Provider metadata may include `filter_application` with `native`, `query_hint`, and `unsupported` arrays to show how requested filters were applied.
- `web_fetch` is free/local: no browser, no JavaScript, no external extraction service. It allows only `https://`, blocks private/local/link-local targets, manually revalidates redirects, reads 2 MB by default, and accepts `maxBytes` up to 5 MB.

Current `discussion_search` source filters:
- `all` or omitted: Stack Overflow, Server Fault, Unix & Linux, Super User, DBA Stack Exchange, GitHub issues, GitHub pull requests, GitHub Discussions, Dev.to, and Hacker News
- `stack_overflow`
- `server_fault`
- `unix_linux`
- `super_user`
- `dba`
- `github` (issues + pull requests + discussions)
- `github_issues`
- `github_pull_requests`
- `github_discussions`
- `devto`
- `hacker_news`

The legacy provider-specific tool modules remain internally testable so existing provider functionality, clients, normalization, bounds, and safety behavior are preserved behind the public parent/grouped tools.

Fan-out searches are resilient: if one source fails, `discussion_search` returns partial results plus `source_errors` instead of failing the entire tool call. Successful fan-out results are interleaved across sources before applying the global `limit`, avoiding first-source dominance. Stack Exchange network sources use the shared Stack Exchange API with the corresponding `site` parameter (`serverfault`, `unix`, `superuser`, `dba`) and return `discussion_get` follow-ups for detail reads, with `discussion_answers_get` and `discussion_comments_get` available for deeper inspection. Dev.to currently uses a tag-based API, so multi-word queries derive a usable first tag before searching and article comment follow-ups use `discussion_comments_get`.

## Environment
- `STACK_EXCHANGE_KEY` optional for higher Stack Exchange quota across Stack Overflow, Server Fault, Unix & Linux, Super User, and DBA Stack Exchange
- `GITHUB_TOKEN` optional, env-only, public-read GitHub quota helper used by GitHub issue/PR/discussion/release/repo/file/code functionality; required for GitHub Discussions when using the default API provider because GitHub GraphQL requires authentication
- `OPENALEX_MAILTO` or `CROSSREF_MAILTO` optional, polite-pool identification for research APIs
- `EXA_API_KEY` optional, higher quota/authenticated Exa MCP access for `web_search`
- `PARALLEL_API_KEY` optional, higher quota/authenticated Parallel MCP access for `web_search`
- `SEMANTIC_SCHOLAR_API_KEY` optional, higher quota for Semantic Scholar Graph API

Credentials stay in environment variables only. Tools never accept secrets as inputs and redact secret-like values from returned surfaces.

## Provider notes
- Stack Exchange sources use the public Stack Exchange API via native `fetch`, with `site=stackoverflow`, `serverfault`, `unix`, `superuser`, or `dba` depending on the selected `discussion_search` source.
- GitHub uses the official `octokit` SDK by default for read-only public issue, pull request, release, repository, file, code search, and Discussions tools; `~/.pi/agent/websearch.json` can select the `gh` CLI provider. GitHub Discussions use GraphQL (`SearchType.DISCUSSION` and `Repository.discussion`) and therefore require `GITHUB_TOKEN` with the API provider or an authenticated `gh` CLI with the `gh` provider.
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
- `src/{providers,schemas,summaries,tools,types}/discussions/` contains discussion-family source modules and barrels for Stack Exchange/Stack Overflow, GitHub, Dev.to, and Hacker News.
- `src/{providers,schemas,summaries,tools,types}/research/` contains research-family source modules and barrels for OpenAlex, arXiv, Crossref, Europe PMC, and Semantic Scholar.
- `src/tools/web/index.ts`, `src/tools/discussions/index.ts`, and `src/tools/research/index.ts` are parent-tool orchestrators (`web_search`, `discussion_search`, `research_search`) and source-module registrars.
- `src/tools/discussions/grouped.ts`, `src/tools/discussions/github-grouped.ts`, and `src/tools/research/grouped.ts` expose the public grouped routers while delegating to internally registered source modules.
- Per-source research detail tools live in their source files (`src/tools/research/openalex.ts`, `arxiv.ts`, `crossref.ts`, `europe-pmc.ts`, `semantic-scholar.ts`) and remain internal behind `research_get` / `research_graph_get`.
- `src/tools/index.ts`, `src/tools.ts`, `src/types.ts`, and `src/client.ts` remain entry/facade files; provider-specific implementation should not be added there.
- `src/types/shared.ts` was removed; shared/common types belong under `src/types/common/` and family/source types belong under their family folders.

## Safety and bounds
- Read-only only; no posting, editing, voting, moderation, or other mutation.
- Search tools return bounded result counts with concise snippets.
- `web_fetch` only fetches HTTPS text-like content (`text/html`, `application/xhtml+xml`, text/plain/markdown, and JSON), blocks embedded credentials and unsafe/private/local resolved addresses, follows at most 3 safe redirects, reads 2 MB by default, and caps `maxBytes` at 5 MB.
- Research graph tools return bounded citation/reference lists with explicit provider pagination (`limit` plus `page` or `offset`).
- Grouped detail/get tools expose the full text returned by the provider for selected bodies, abstracts, notes, comments, READMEs, repository files, and selected GitHub Discussion comments; they are bounded by explicit provider/API availability and pagination parameters such as comment limits, offsets, and nested comment depth, not by arbitrary summary truncation. GitHub code and discussion search remain bounded to at most 10 results and return follow-up refs instead of bulk content.
- Secret-like strings are redacted as `[REDACTED_SECRET]` across `content`, `details`, and structured errors.
- Provider errors are returned as structured recoverable failures when possible.
- Community content is untrusted display content only.

## Validation
- `cd extensions/websearch && npm run typecheck`
- `cd extensions/websearch && npm run test`
- `cd extensions/websearch && npm audit --omit=dev --json`
