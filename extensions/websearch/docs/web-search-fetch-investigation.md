# Web search and safe fetch investigation

This document is a temporary working record for the next websearch extension slice. It should be updated as provider/CLI/API options are investigated.

## Roadmap decision

Version 1 should add only:

- `web_search(query)`
- `web_fetch(url)`

Version 2 can add deeper GitHub tools:

- `github_repo_get`
- `github_file_get`
- `github_code_search`

Version 3 can add `web_search` filters:

- `site`
- `language`
- `freshness`
- `safe_search`

## Security decision for `web_fetch(url)`

`web_fetch` is the risky part of the feature and must be designed as a safe fetcher, not a browser.

Required constraints:

- Allow only `https://` URLs.
- Block `http://` URLs.
- Block all other schemes such as `file://`, `ftp://`, `gopher://`, `data:`, and similar.
- Resolve DNS and validate the final IP before connecting.
- Block private/local/link-local IP ranges, including:
  - `127.0.0.0/8`
  - `10.0.0.0/8`
  - `172.16.0.0/12`
  - `192.168.0.0/16`
  - `::1`
  - `fc00::/7`
  - `fe80::/10`
- Revalidate after every redirect.
- Block redirects from `https://` to `http://` or any non-https scheme.
- Maximum 3 redirects.
- Short timeout.
- Maximum response bytes.
- Allowed content types only:
  - `text/html`
  - `text/plain`
  - `application/json`
  - `application/pdf` optional/future, only if a safe extraction path is chosen
- Do not execute JavaScript.
- Do not load images, scripts, stylesheets, iframes, or any external subresources.
- Do not send cookies.
- Use a project-specific user-agent.
- Return structured recoverable errors.

Proposed output shape:

```json
{
  "url": "https://example.com/page",
  "final_url": "https://example.com/page",
  "status": 200,
  "content_type": "text/html",
  "title": "Example page",
  "excerpt": "Short readable excerpt...",
  "markdown": "Readable extracted text/markdown...",
  "links": [],
  "published_at": null,
  "fetched_at": "2026-06-20T00:00:00.000Z",
  "truncated": false
}
```

## Proposed `web_search(query)` contract

```json
{
  "query": "spring boot 4 announcement",
  "results": [
    {
      "title": "Spring Boot 4 announcement",
      "url": "https://example.com/article",
      "snippet": "Short snippet...",
      "source": "provider-or-cli",
      "published_at": null,
      "rank": 1,
      "followup_tool": "web_fetch"
    }
  ]
}
```

## Investigation questions

- Is there a free command-line web search tool that can be used similarly to the YouTube extension's terminal-backed approach?
- Is a local/free metasearch option practical, e.g. SearXNG, without requiring users to run a server?
- Are DuckDuckGo/Brave/Google/Bing CLI wrappers viable without paid API keys?
- Which options have acceptable reliability, terms-of-service risk, and testability?
- Which option keeps the public tool surface small and implementation maintainable?

## Investigation notes

### Local terminal availability

Probe date: 2026-06-20.

Commands checked in the current environment:

- `ddgr` — not installed
- `googler` — not installed
- `lynx` — not installed
- `w3m` — not installed
- `links` — not installed
- `elinks` — not installed
- `pandoc` — not installed
- `readability-cli` — not installed
- `trafilatura` — not installed

Implication: a terminal-backed approach like the YouTube extension is possible only if we either add runtime dependency checks and install guidance, or choose an npm/runtime implementation instead of assuming a system command exists.

### SearXNG

Evidence:

- Official docs expose a search API with `format=json`, for example `https://searx.example.org/search?q=searxng&format=json`.
- Docs state supported formats are configured in `settings.yml`.
- Open WebUI issue `open-webui/open-webui#2824` confirms many public instances return 403 because JSON is disabled; maintainer comment says most public instances do not have JSON enabled and recommends self-hosting.
- Live probes against public instances were unreliable:
  - `https://searx.be/search?...&format=json` returned 403.
  - `https://search.inetol.net/search?...&format=json` returned 429.
  - `https://searx.tiekoetter.com/search?...&format=json` returned 429.

NPM/package options found:

- `searxng` — TypeScript service for SearXNG API.
- `@agentic/searxng` — MIT, SearXNG client package.
- `sxng-cli` — MIT CLI, but requires a SearXNG service; also includes content extraction dependencies.
- `@amartinr/pi-searxng` — MIT Pi extension for SearXNG.

Assessment:

- Best free/reliable option if the user can provide or run a SearXNG instance.
- Not reliable as a default no-config provider using random public instances.
- Good candidate for configurable provider mode: `WEBSEARCH_SEARXNG_URL=https://...`.

### DuckDuckGo

Evidence:

- `duck-duck-scrape` is MIT, actively updated, and supports regular DuckDuckGo search from Node.
- `duckduckgo-search` is MIT and ports DuckDuckGo search to JS.
- `mcp-duckduckgo` and related MCP packages wrap DuckDuckGo HTML search.
- Direct live probes showed risk:
  - `https://duckduckgo.com/html/?q=spring+boot+4` returned HTML results in one probe.
  - `https://html.duckduckgo.com/html/?q=spring+boot+4` and `https://lite.duckduckgo.com/lite/?q=spring+boot+4` returned bot/anomaly challenge pages.
- DuckDuckGo Instant Answer API (`https://api.duckduckgo.com/?q=...&format=json`) is not a general web search API. It returned useful entity data for `Spring Boot`, but no useful general results for `spring boot 4`.

Assessment:

- Most practical no-key/free fallback, but it is scraping-based and can trigger bot challenges.
- Should be treated as best-effort with structured provider errors, not guaranteed infrastructure.
- If used, prefer a maintained library such as `duck-duck-scrape` over custom parsing, but keep the provider boundary isolated.

### Google/googler

Evidence:

- `jarun/googler` is mature and popular, but not installed locally and is GPL-3.0.
- GitHub issue `santinic/how2#42` documents Google scraping/rate-limit pain; comments note automated traffic is rate limited and Google Custom Search has restrictive pricing/limits.
- Google's automated query docs mention automated query/captcha behavior.

Assessment:

- Not a good default free provider for this extension.
- Avoid Google scraping as the MVP path.

### ddgr

Evidence:

- `jarun/ddgr` is mature and popular, but not installed locally and is GPL-3.0.
- It still relies on DuckDuckGo scraping behavior, so it inherits anti-bot/challenge risk.

Assessment:

- Useful as optional external command mode if we want a terminal-backed runtime later.
- Not ideal as the default because it adds a system dependency and licensing/runtime packaging questions.

### OpenCode CLI / agent web search

Evidence:

- The currently prominent OpenCode repository is `anomalyco/opencode` (formerly/redirected from `sst/opencode` in GitHub probes), MIT licensed, and describes itself as an open-source coding agent.
- It has native model-facing tools:
  - `packages/opencode/src/tool/websearch.ts`
  - `packages/opencode/src/tool/webfetch.ts`
  - `packages/opencode/src/tool/mcp-websearch.ts`
- `websearch` is not implemented as a local CLI search binary. It calls hosted MCP-style web search providers:
  - Exa MCP endpoint: `https://mcp.exa.ai/mcp`
  - Parallel MCP endpoint: `https://search.parallel.ai/mcp`
- Provider selection supports an override via `OPENCODE_WEBSEARCH_PROVIDER=exa|parallel`.
- OpenCode supports optional credentials:
  - `EXA_API_KEY` is appended to the Exa MCP URL when present.
  - `PARALLEL_API_KEY` is sent as a bearer token when present.
- Live no-key probes succeeded during investigation:
  - Exa MCP returned an SSE JSON-RPC response for `web_search_exa` with Spring Boot 4 results and crawled/highlighted content.
  - Parallel MCP returned a JSON-RPC response for `web_search` with structured JSON text containing result URLs, titles, publish dates, excerpts, and search metadata.
- OpenCode's `websearch` returns provider text optimized for the LLM rather than the exact simple ranked-result JSON contract proposed here.
- OpenCode's `webfetch` uses native HTTP client fetching plus `htmlparser2`/`turndown` conversion, with a 5 MB max response size and default 30 second timeout capped at 120 seconds.
- OpenCode's current `webfetch` safety posture differs from this project decision:
  - accepts both `http://` and `https://`;
  - tests explicitly accept `http://localhost/private`;
  - delegates redirects to the HTTP transport;
  - does not implement the strict HTTPS-only + DNS/private-IP revalidation model required here;
  - can fetch image attachments in its V1 implementation, while this project currently wants text-like content types only for V1.
- OpenCode docs expose permissions for `websearch` and `webfetch`, which is relevant to our permission/audit model but does not replace URL-level SSRF controls.
- Related plugin: `ghoulr/opencode-websearch-cited` is Apache-2.0 and adds cited web search for OpenCode using model/provider-native web search from Google, OpenAI, and OpenRouter. It is useful as an example of citation formatting, but it depends on provider auth/capabilities rather than a free general web search backend.

Assessment:

- OpenCode is useful prior art for tool shape, provider abstraction, MCP JSON-RPC/SSE parsing, permission gating, and HTML-to-markdown conversion.
- Its hosted Exa/Parallel MCP providers are promising no-key candidates because live probes worked, but they are external hosted services with unknown long-term free quota/terms. Treat them as best-effort unless official free-use terms are verified.
- OpenCode's `webfetch` is not safe enough for our chosen threat model; do not copy its network policy. Our implementation should keep HTTPS-only, DNS/IP validation, redirect revalidation, and private IP blocking.
- A practical V1 provider order could be configurable SearXNG first, then OpenCode-style Exa/Parallel MCP best-effort, then DuckDuckGo best-effort, but this adds more provider complexity than the initial two-provider plan.

### Exa vs Parallel hosted provider comparison

Probe date: 2026-06-20.

Both providers were investigated because OpenCode uses hosted MCP-style endpoints for web search. These endpoints worked without API keys in live probes, but they are external hosted services. Treat no-key use as best-effort unless official free-use terms and quotas remain acceptable.

#### Exa

Official/public signals:

- Search/product focus: technical and agent-oriented web search, with page text/highlights.
- Free tier: pricing page says "Run up to 20,000 requests per month for free".
- Cost after free tier: pricing page lists Search at `$7 / 1k requests`.
- Startup/education grants: pricing page mentions `$1000 worth of free credits` for qualified projects.
- Rate limits: docs list `/search` at `10 QPS` and `/contents` at `100 QPS` by default.
- MCP support: Exa docs have "Web Search MCP" and the live endpoint `https://mcp.exa.ai/mcp` worked without an API key.
- Content extraction: Exa has a Contents endpoint for full page contents, summaries, and metadata; docs examples show `POST /contents`, cached results, automatic live crawling fallback, and `costDollars` examples. Exa MCP also exposes web search/fetch style tools.

Assessment:

- Best quality in the technical benchmark below.
- More official documentation in top 5 results than Parallel for the tested developer queries.
- Faster in this small no-key MCP probe.
- More expensive per 1,000 searches than Parallel when billed (`$7/1k` vs Parallel Search `$5/1k`).
- Good candidate as the first hosted best-effort provider if we accept relying on a hosted external service.

#### Parallel

Official/public signals:

- Search/product focus: web search for AI agents, extract API, task/deep research APIs.
- Free tier: pricing page says "Run up to 16,000 requests for free".
- Search cost after free tier: pricing page lists Search API at `$0.005 for 10 results`, equivalent to `$5 / 1,000 search requests` at 10 results.
- Extract cost: pricing page lists Extract API at `$0.001` per request.
- Rate limits: pricing page lists Search API at `600 requests / min` and Extract API at `600 requests / min`.
- MCP support: docs say Search MCP is free to use with no API key for exploration/light use; `https://search.parallel.ai/mcp` worked without an API key.
- Availability: live endpoint returned HTTP 200 JSON-RPC responses in probes.

Assessment:

- Cheaper per 1,000 search requests than Exa when billed.
- More generous published no-key/free request count than Exa by raw requests (`16,000` vs `20,000/month` depends on period wording; Parallel page does not state the same monthly framing in the captured text).
- Slightly slower in this small benchmark.
- Good for general web results and compressed excerpts, but returned more non-official/blog-like results than Exa in this technical benchmark.
- Good candidate as a secondary hosted best-effort provider or explicit fallback.

#### Live benchmark

Queries tested against no-key MCP endpoints:

- `spring boot 4 migration guide`
- `nextjs 16 release notes`
- `mongodb 8 authentication issue`
- `docker rootless networking`

Method:

- Exa endpoint: `https://mcp.exa.ai/mcp`, tool `web_search_exa`, `type=fast`, `numResults=5`, `livecrawl=fallback`, `contextMaxCharacters=5000`.
- Parallel endpoint: `https://search.parallel.ai/mcp`, tool `web_search`, one `objective` and one `search_queries` entry matching the query.
- Latency measured around the full HTTP POST with Python `urllib`.
- Top 5 relevance was judged by URL/title inspection and a simple official-domain count.

Results:

| Query | Provider | Time | Official docs/results in top 5 | Blog-like results in top 5 | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| `spring boot 4 migration guide` | Exa | 1.37s | 2 | 0 | Top result was official Spring Boot GitHub migration guide; also found Spring announcement. |
| `spring boot 4 migration guide` | Parallel | 2.42s | 1 | 1 | Top result official migration guide, but also Medium and SEO/blog-like entries. |
| `nextjs 16 release notes` | Exa | 1.24s | 5 | 0 | Excellent: official Next.js blog, GitHub release, release list, 16.1 blog, upgrade doc source. |
| `nextjs 16 release notes` | Parallel | 2.45s | 2 | 0 | Found official Next.js blog and upgrade guide but mixed in third-party articles. |
| `mongodb 8 authentication issue` | Exa | 1.55s | 1 | 0 | Found MongoDB auth docs plus Stack Overflow/GitHub issue style troubleshooting. |
| `mongodb 8 authentication issue` | Parallel | 2.15s | 2 | 0 | Found MongoDB v8.2 auth docs and Atlas troubleshooting, but first results were tutorial/SEO pages. |
| `docker rootless networking` | Exa | 1.24s | 2 | 0 | Found Docker docs plus rootlesskit/moby GitHub docs. |
| `docker rootless networking` | Parallel | 2.18s | 2 | 1 | Top two were official Docker docs; also returned unrelated/general tutorial/blog entries. |

Aggregate from this small test:

- Average latency:
  - Exa: `1.35s`
  - Parallel: `2.30s`
- Official docs/results in top 5 across four queries:
  - Exa: `10/20`
  - Parallel: `7/20`
- Blog-like results in top 5 across four queries:
  - Exa: `0/20`
  - Parallel: `2/20`

Interpretation:

- Exa looked better for technical/developer queries in relevance, official docs, and latency.
- Parallel looked useful and cheaper, and sometimes placed the best official result first, but had more third-party/SEO/tutorial noise in this small sample.
- Both endpoints are viable best-effort hosted candidates, but neither removes the need for our own structured result normalization and provider error handling.

Recommendation from this comparison:

- If hosted no-key providers are accepted in V1, prefer Exa first for technical quality and speed, then Parallel as fallback.
- If minimizing external hosted dependency risk is more important than out-of-the-box quality, keep SearXNG-configured mode first and make Exa/Parallel opt-in via config.
- Do not use either provider's hosted contents/extract endpoint as a replacement for `web_fetch` safety. Even if Exa Contents or Parallel Extract can fetch pages, this project still needs its own HTTPS-only SSRF-resistant `web_fetch` for auditable URL-level controls.

### Brave/Bing/paid APIs

No no-key free terminal/API option was verified during this investigation. Brave Search API can be useful in general, but it requires an API key/account, so it does not satisfy the current "free first" goal unless added later as optional keyed provider.

### `web_fetch` extraction options

NPM packages checked:

- `@mozilla/readability` — Apache-2.0, article extraction used by Firefox Reader View.
- `jsdom` — MIT, heavy DOM implementation; can be used without executing scripts, but has many dependencies.
- `linkedom` — ISC, lighter DOM implementation.
- `html-to-text` — MIT, converts HTML to plain text.
- `turndown` — MIT, converts HTML to Markdown.
- `defuddle` — MIT, extracts article content and metadata from web pages.

Assessment:

- `web_fetch` should not shell out to a browser or execute JavaScript.
- Use native Node fetch/undici-style fetching plus explicit DNS/IP/redirect validation.
- For V1, prefer deterministic HTML parsing/extraction in-process over a browser. Candidate approaches:
  - safer/simple: `html-to-text` plus lightweight title/link extraction;
  - richer article extraction: `@mozilla/readability` with a DOM implementation such as `jsdom` or `linkedom`;
  - evaluate `defuddle` only if its dependency/behavior is acceptable.

## V1 decision

Implement `web_search(query)` first, without `web_fetch` in the same slice.

V1 provider behavior:

- Use OpenCode-style hosted MCP search providers.
- Exa MCP is the primary provider.
- Parallel MCP is the fallback provider when Exa fails or returns no usable results.
- `EXA_API_KEY` and `PARALLEL_API_KEY` are optional; no-key best-effort calls are attempted when keys are absent.
- Return structured provider errors when Exa fallback is needed or when both providers fail.
- Keep general web modules in their own `web/` folder family under `providers`, `schemas`, `summaries`, `tools`, and `types`; do not mix this implementation into `discussions` or `research`.

Deferred:

- `web_fetch(url)` remains a separate later slice because it needs stricter HTTPS-only SSRF-resistant controls and extraction-stack selection.
- SearXNG, DuckDuckGo, Brave, Bing, or other providers can be evaluated later as explicit extensions beyond V1.
