# websearch extension

[English](#english) | [Español](#español)

## English

Read-only Pi extension for bounded web, community, GitHub, and research search.

The extension intentionally exposes a small public tool surface. Provider/source-specific implementations remain internal and testable, while agents interact through parent search tools and grouped detail routers.

### Public tool surface

#### Web

| Tool | Purpose |
| --- | --- |
| `web_search` | General web search via hosted providers: Exa primary with Parallel fallback. |
| `web_fetch` | Safe HTTPS page reader for one selected page. |

#### Community discussions

| Tool | Purpose |
| --- | --- |
| `discussion_search` | Search Stack Exchange, GitHub issues/PRs/discussions, Dev.to, and Hacker News. |
| `discussion_get` | Open one selected Stack Exchange question, GitHub issue/PR/discussion, or Hacker News story. |
| `discussion_answers_get` | Fetch bounded Stack Exchange answers for a selected question. |
| `discussion_comments_get` | Fetch bounded comments/replies/review comments where supported. |

#### Research

| Tool | Purpose |
| --- | --- |
| `research_search` | Search OpenAlex, arXiv, Crossref, Europe PMC, and Semantic Scholar. |
| `research_get` | Open one selected paper/work/article. |
| `research_graph_get` | Fetch citations or references where provider support is verified. |

#### GitHub non-discussion

| Tool | Purpose |
| --- | --- |
| `github_code_search` | Search GitHub code; returns `github_get` file follow-up refs. |
| `github_get` | Fetch repository metadata, one file, one release, or recent releases. |

### Common workflows

#### Search the web and fetch a page

```json
{ "tool": "web_search", "args": { "query": "sqlite vector search", "limit": 5 } }
{ "tool": "web_fetch", "args": { "url": "https://example.com/article" } }
```

#### Search discussions and open a result

`discussion_search` results include `followup_tool` and `followup_ref` when a result can be opened.

```json
{ "tool": "discussion_search", "args": { "query": "branch prediction sorted array", "source": "stack_overflow", "limit": 1 } }
{ "tool": "discussion_get", "args": { "source": "stack_overflow", "ref": 11227809 } }
```

For Stack Exchange questions, use the grouped answer/comment tools for deeper inspection:

```json
{ "tool": "discussion_answers_get", "args": { "source": "unix_linux", "ref": "unix:535083", "limit": 3 } }
{ "tool": "discussion_comments_get", "args": { "source": "unix_linux", "ref": "unix:535083", "commentsLimit": 5 } }
```

For GitHub and Hacker News comment reads, `discussion_comments_get` returns a comment-focused projection instead of full entity bodies:

```json
{ "tool": "discussion_comments_get", "args": { "source": "github_issue", "ref": "cli/cli#1", "commentsLimit": 1 } }
{ "tool": "discussion_comments_get", "args": { "source": "hacker_news", "ref": 12345, "commentsLimit": 5 } }
```

#### Search research, open a work, and inspect graph data

`research_search` and `research_graph_get` results point back to `research_get` for selected item detail reads.

```json
{ "tool": "research_search", "args": { "query": "transformer attention", "source": "arxiv", "limit": 3 } }
{ "tool": "research_get", "args": { "source": "arxiv", "paper": "1706.03762" } }
{ "tool": "research_graph_get", "args": { "source": "openalex", "graph": "references", "work": "W2741809807", "limit": 5 } }
```

#### Search GitHub code and fetch a file

`github_code_search` returns file refs in `owner/repo:path` form. Pass that value to `github_get` with `kind: "file"`.

```json
{ "tool": "github_code_search", "args": { "query": "OAuth provider", "repo": "owner/repo", "language": "TypeScript", "limit": 3 } }
{ "tool": "github_get", "args": { "kind": "file", "ref": "owner/repo:src/auth/oauth.ts" } }
```

When fetching a file by explicit `repo` + `path`, use `git_ref` for branch/tag/commit selection. `ref` is reserved for selected file follow-up refs.

```json
{ "tool": "github_get", "args": { "kind": "file", "repo": "octocat/Hello-World", "path": "README", "git_ref": "master" } }
```

#### Fetch GitHub repo and release metadata

```json
{ "tool": "github_get", "args": { "kind": "repo", "repo": "cli/cli", "includeReadme": false } }
{ "tool": "github_get", "args": { "kind": "releases", "repo": "cli/cli", "limit": 3 } }
{ "tool": "github_get", "args": { "kind": "release", "repo": "cli/cli", "tag": "v2.0.0" } }
```

### Tool details

#### `web_search`

- Uses Exa MCP (`https://mcp.exa.ai/mcp`) as primary provider.
- Uses Parallel MCP (`https://search.parallel.ai/mcp`) as fallback when Exa fails or returns no usable results.
- Defaults to `limit: 10`; accepted range is 1-10.
- Accepts normalized filters: `includeDomains`, `excludeDomains`, `afterDate`, `beforeDate`, `location`, and `mode` (`fast`, `auto`, `deep`).
- Exa receives supported filters natively when possible; Parallel receives equivalent query/objective hints when native filters are unavailable.
- Successful results include derived domains, provider metadata, and structured source/provider errors when fallback or partial failure occurs.

#### `web_fetch`

- Fetches one HTTPS URL without JavaScript, browser automation, or subresources.
- Allows text-like content only: HTML/XHTML, plain text/markdown, and JSON.
- Blocks embedded credentials and unsafe/private/local/link-local resolved addresses.
- Revalidates redirects and follows at most 3 safe redirects.
- Reads 2 MB by default; `maxBytes` is capped at 5 MB.

#### `discussion_search`

Supported `source` values:

- `all` or omitted: Stack Overflow, Server Fault, Unix & Linux, Super User, DBA, GitHub issues, GitHub pull requests, GitHub Discussions, Dev.to, and Hacker News
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

Behavior notes:

- Fan-out searches return partial results plus `source_errors` when one source fails.
- Fan-out results are interleaved before applying the global `limit` to avoid first-source dominance.
- Stack Exchange network sources use the shared Stack Exchange API with the right `site` parameter.
- Dev.to currently uses a tag-first search strategy; multi-word queries derive a usable first tag.
- Follow-ups point to grouped public tools, not source-specific internal tools.

#### `discussion_get`

Opens one selected entity. Supported sources:

- Stack Exchange: `stack_overflow`, `server_fault`, `unix_linux`, `super_user`, `dba`
- GitHub: `github_issue`, `github_issues`, `github_pull_request`, `github_pull_requests`, `github_discussion`, `github_discussions`
- Hacker News: `hacker_news`

Examples:

```json
{ "source": "stack_overflow", "ref": 11227809 }
{ "source": "server_fault", "ref": "serverfault:67316" }
{ "source": "github_pull_request", "ref": "owner/repo#123", "commentsLimit": 10, "reviewCommentsLimit": 10 }
{ "source": "hacker_news", "story_id": 12345, "commentsLimit": 10 }
```

#### `discussion_answers_get`

Fetches bounded Stack Exchange answers only. Supported sources:

- `stack_overflow`
- `server_fault`
- `unix_linux`
- `super_user`
- `dba`

Example:

```json
{ "source": "unix_linux", "question": "unix:535083", "limit": 3 }
```

#### `discussion_comments_get`

Fetches bounded comments/replies/review comments where supported.

Supported sources:

- Stack Exchange: question comments
- GitHub issues: issue comments
- GitHub pull requests: issue comments plus review comments
- GitHub Discussions: discussion comments
- Dev.to: article comments
- Hacker News: story comments via the story detail path

For GitHub and Hacker News sources, output is intentionally comment-focused: it includes comment metadata and pagination fields while omitting full issue/PR/story bodies.

#### `research_search`

Supported `source` values:

- `all` or omitted: OpenAlex, arXiv, Crossref, Europe PMC, and Semantic Scholar
- `openalex`
- `arxiv`
- `crossref`
- `europe_pmc`
- `semantic_scholar`

Behavior notes:

- Fan-out search returns partial results plus `source_errors` when a provider is unavailable or rate-limited.
- Semantic Scholar uses `SEMANTIC_SCHOLAR_API_KEY` when present and otherwise attempts free quota.
- Search results include `followup_tool: "research_get"` and a source-specific `followup_ref`.

#### `research_get`

Opens one selected research item:

```json
{ "source": "openalex", "work": "W123" }
{ "source": "arxiv", "paper": "1706.03762" }
{ "source": "crossref", "doi": "10.1038/nature12373" }
{ "source": "europe_pmc", "article": "PMC12223224" }
{ "source": "semantic_scholar", "paper": "DOI:10.5555/s2" }
```

#### `research_graph_get`

Fetches bounded citation/reference graph data where a provider has verified support.

| Source | Supported graphs | Pagination |
| --- | --- | --- |
| `openalex` | `citations`, `references` | `page` |
| `crossref` | `references` only | `offset` |
| `europe_pmc` | `citations`, `references` | `page` |
| `semantic_scholar` | `citations`, `references` | `offset` |

arXiv graph tools and Crossref inbound citation tools are intentionally not exposed because the investigated APIs did not provide verified graph endpoints for those capabilities. Research graph decisions should stay tied to provider evidence before exposing additional graph tools.

#### `github_code_search`

- Searches public GitHub code with bounded read-only results.
- Accepts `query`, optional `repo`, optional `owner`, optional `language`, optional `path`, and `limit`.
- Returns `followup_tool: "github_get"` and `followup_ref: "owner/repo:path"` for file inspection.

#### `github_get`

Supported `kind` values:

| Kind | Purpose | Key parameters |
| --- | --- | --- |
| `repo` | Repository metadata, README by default | `repo`, `includeReadme` |
| `file` | One repository file | `ref` as `owner/repo:path`, or `repo` + `path`; optional `git_ref` |
| `release` | One release by tag | `repo`, `tag` |
| `releases` | Recent releases | `repo`, `limit`, `includePrereleases` |

Important parameter semantics:

- For `kind: "file"`, `ref` means a selected follow-up ref in `owner/repo:path` form.
- For `kind: "file"` with explicit `repo` and `path`, use `git_ref` for branch/tag/commit selection.
- For `kind: "release"`, use `tag`; `ref` is not a release-tag alias.

### Configuration

Basic use requires no configuration.

Optional global config lives at:

```text
~/.pi/agent/websearch.json
```

When this repository checkout is used directly as `~/.pi/agent`, the same config appears as repo-root `websearch.json`. The installer does not copy or overwrite this local runtime config; create it manually when non-default behavior is needed.

Supported config:

```json
{
  "github": {
    "provider": "api"
  },
  "request": {
    "timeoutMs": 120000,
    "maxRetries": 1
  }
}
```

Config fields:

- `github.provider`: `api` or `gh`; defaults to `api`.
  - `api` uses the GitHub API client and optional `GITHUB_TOKEN` from environment.
  - `gh` uses `gh api` and requires `gh` on `PATH` plus `gh auth login`.
- `request.timeoutMs`: default `120000`, valid range `1000..300000`.
- `request.maxRetries`: default `1`, valid range `0..5`.

Project-level websearch config is not supported; do not create `.pi/websearch.json`. Credentials never belong in `websearch.json`.

### Environment

- `STACK_EXCHANGE_KEY` optional for higher Stack Exchange quota across Stack Overflow, Server Fault, Unix & Linux, Super User, and DBA.
- `GITHUB_TOKEN` optional, env-only, public-read GitHub quota helper used by GitHub issue/PR/discussion/release/repo/file/code functionality.
- `GITHUB_TOKEN` is required for GitHub Discussions when using the default API provider because GitHub GraphQL requires authentication.
- `OPENALEX_MAILTO` or `CROSSREF_MAILTO` optional, polite-pool identification for research APIs.
- `EXA_API_KEY` optional, higher quota/authenticated Exa MCP access for `web_search`.
- `PARALLEL_API_KEY` optional, higher quota/authenticated Parallel MCP access for `web_search`.
- `SEMANTIC_SCHOLAR_API_KEY` optional, higher quota for Semantic Scholar Graph API.

Credentials stay in environment variables only. Tools never accept secrets as inputs and redact secret-like values from returned surfaces.

### Provider notes

- Stack Exchange sources use the public Stack Exchange API via native `fetch`, with `site=stackoverflow`, `serverfault`, `unix`, `superuser`, or `dba`.
- GitHub uses the official `octokit` SDK by default for read-only public issue, pull request, release, repository, file, code search, and Discussions functionality.
- `~/.pi/agent/websearch.json` can select the `gh` CLI provider for GitHub functionality.
- GitHub Discussions use GraphQL (`SearchType.DISCUSSION` and `Repository.discussion`) and therefore require `GITHUB_TOKEN` with the API provider or an authenticated `gh` CLI with the `gh` provider.
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

### Source layout

- `src/{providers,schemas,summaries,tools,types}/common/` contains cross-family primitives only: HTTP/text helpers, limits, formatting, tool runtime/registry/result helpers, provider/error/runtime/tool types.
- `src/{providers,schemas,summaries,tools,types}/web/` contains general web modules and barrels for Exa/Parallel provider chaining plus safe `web_fetch`.
- `src/{providers,schemas,summaries,tools,types}/discussions/` contains discussion-family source modules and barrels for Stack Exchange/Stack Overflow, GitHub, Dev.to, and Hacker News.
- `src/{providers,schemas,summaries,tools,types}/research/` contains research-family source modules and barrels for OpenAlex, arXiv, Crossref, Europe PMC, and Semantic Scholar.
- `src/tools/web/index.ts`, `src/tools/discussions/index.ts`, and `src/tools/research/index.ts` are parent-tool orchestrators for `web_search`, `discussion_search`, and `research_search`.
- `src/tools/discussions/grouped.ts`, `src/tools/discussions/github-grouped.ts`, and `src/tools/research/grouped.ts` expose the public grouped routers and delegate to internally registered source modules.
- `src/tools/common/internal.ts` collects the internal source-tool registry used by grouped routers.
- `src/tools/index.ts`, `src/tools.ts`, `src/types.ts`, and `src/client.ts` remain entry/facade files; provider-specific implementation should not be added there.
- Shared/common types belong under `src/types/common/`; family/source types belong under their family folders.

### Safety and bounds

- Read-only only; no posting, editing, voting, moderation, or other mutation.
- Search tools return bounded result counts with concise snippets.
- `web_fetch` only fetches safe HTTPS text-like content, blocks unsafe/private/local targets, and caps bytes read.
- Research graph tools return bounded citation/reference lists with explicit provider pagination (`limit` plus `page` or `offset`).
- Grouped detail/get tools expose provider-returned text for selected bodies, abstracts, comments, READMEs, repository files, and selected GitHub Discussion comments, bounded by provider/API availability and explicit pagination parameters.
- GitHub code and discussion search remain bounded and return follow-up refs instead of bulk content.
- Secret-like strings are redacted as `[REDACTED_SECRET]` across `content`, `details`, and structured errors.
- Provider errors are returned as structured recoverable failures when possible.
- Community content is untrusted display content only.

### Validation

```sh
cd extensions/websearch
npm run typecheck
npm test
npm audit --omit=dev --json
```

Useful focused checks:

```sh
cd extensions/websearch
npm test -- registration.test.ts tool-consolidation.test.ts
```

## Español

Extensión read-only para búsquedas web, comunidades, GitHub e investigación.

### Resumen

Websearch expone una superficie pública acotada para búsqueda y lectura segura. Los proveedores específicos quedan internos; el agente usa routers agrupados para web, discusiones, investigación, GitHub y detalle de resultados.

### Herramientas y capacidades

- `web_search` y `web_fetch`.
- Búsqueda y lectura de discusiones: Stack Exchange, GitHub issues/PRs/discussions, Hacker News y otros.
- Búsqueda académica/investigación: OpenAlex, arXiv, Crossref, Europe PMC y Semantic Scholar.
- Búsqueda de código y metadata de GitHub.
- Routers de detalle y grafos de referencias/citas cuando el proveedor lo soporta.

### Requisitos

Las credenciales se configuran por variables de entorno. No se deben guardar tokens en el repositorio.

### Ver más

La sección en inglés documenta superficie pública, workflows, parámetros, configuración, seguridad y validación.
