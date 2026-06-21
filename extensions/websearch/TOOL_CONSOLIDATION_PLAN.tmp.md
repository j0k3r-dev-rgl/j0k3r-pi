# Temporary websearch tool consolidation plan

Status: implemented / validation passed. This file is temporary and can be deleted once the change is accepted.

## Goal

Reduce the public websearch tool surface by grouping read/detail operations by functionality while keeping search tools separate and preserving all sources and provider functionality internally.

## Non-goals

- Do not merge search and get tools.
- Do not remove provider implementations or test coverage.
- Do not reduce supported sources.
- Do not change hosted provider credentials or runtime config semantics.

## Target public tool groups

### Search tools kept separate

- `web_search`
- `web_fetch`
- `discussion_search`
- `research_search`
- `github_code_search`

### Discussion detail group

- `discussion_get`
  - Sources: `stack_overflow`, `server_fault`, `unix_linux`, `super_user`, `dba`, `github_issue`, `github_pull_request`, `github_discussion`, `hacker_news`.
  - Opens one selected discussion/community entity.
- `discussion_answers_get`
  - Sources: Stack Exchange network sources only for now.
  - Returns bounded answers.
- `discussion_comments_get`
  - Sources: Stack Exchange network sources plus GitHub issue / pull request / discussion, Dev.to article comments, and Hacker News story comments via story detail where supported.
  - Returns bounded comments/replies/review comments as source capabilities allow.

### Research detail group

- `research_get`
  - Sources: `openalex`, `arxiv`, `crossref`, `europe_pmc`, `semantic_scholar`.
  - Opens one selected paper/work/article.
- `research_graph_get`
  - Sources: providers with citation/reference support.
  - Parameters include `graph: "citations" | "references"`.

### GitHub non-discussion group

- `github_get`
  - Kinds: `repo`, `file`, `release`, `releases`.
  - Keeps `github_code_search` separate because it is a search tool.

## Public tools hidden after routers exist

Kept internally implemented/testable, but removed from `WEBSEARCH_TOOL_NAMES` public registration:

- Discussion-specific detail tools:
  - `stack_overflow_question_get`
  - `stack_overflow_answers_get`
  - `stack_overflow_comments_get`
  - `stack_exchange_question_get`
  - `stack_exchange_answers_get`
  - `stack_exchange_comments_get`
  - `github_issue_get`
  - `github_pull_request_get`
  - `github_discussion_get`
  - `devto_comments_get`
  - `hackernews_story_get`
- Research-specific detail/graph tools:
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
- GitHub non-discussion detail/list tools:
  - `github_repo_get`
  - `github_file_get`
  - `github_releases_get`
  - `github_release_get`

## Follow-up migration

- [x] `discussion_search` result followups point to `discussion_get` where an entity can be opened.
- [x] Stack Exchange answer/comment followups from `discussion_get` point to `discussion_answers_get` and `discussion_comments_get`.
- [x] `research_search` result followups point to `research_get`.
- [x] Research graph results point back to `research_get`.
- [x] GitHub code/file/repo flows use `github_get` for get/list operations, while `github_code_search` remains public.

## Validation checklist

- [x] Registration contract verifies only grouped public tools are exposed.
- [x] Hidden source-specific tools remain internally registered in legacy/source module tests where needed.
- [x] Full validation command: `cd extensions/websearch && npm run typecheck && npm test`.
- [x] Live reload smoke tests should cover at least one discussion, one research get/graph, and one github_get kind.

## Post-review refinements

- [x] Public tool names are derived from the public module list to reduce manual registration drift.
- [x] Grouped routers share one internal source-tool registry when registered together.
- [x] `discussion_get`, `discussion_comments_get`, `research_graph_get`, and `github_get` schemas expose source/kind-specific variants.
- [x] `research_graph_get` schema narrows Crossref to `graph: "references"` because Crossref inbound citations are unsupported.
- [x] `github_get` keeps file follow-up refs, file `git_ref`, and release `tag` semantics distinct.
- [x] `discussion_comments_get` projects GitHub/Hacker News detail responses into comment-focused results instead of returning full entity bodies.
- [x] Post-refinement live reload smoke tests passed for comment projection, github file refs/git_ref, crossref references, and github_code_search -> github_get follow-up.
