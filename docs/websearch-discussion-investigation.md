# Websearch discussion tools investigation notes

Date: 2026-06-20
Status: investigation captured; follow-up testing still pending

## Context

This note captures a real investigation flow using the public discussion tools after the websearch modularization work. The investigation topic was:

- `sqlite vector search`
- `sqlite-vec semantic search`
- `sqlite fts5 vector embeddings search`

The purpose was not only to smoke-test tool availability, but to understand whether the discussion tools produce useful engineering evidence and where the tool experience needs correction.

## Tools exercised

Discovery:

- `discussion_search` with fan-out across all sources
- `discussion_search` with `source: github`
- `discussion_search` with `source: stack_overflow`
- `discussion_search` with `source: hacker_news`
- `discussion_search` with `source: devto`

Detail inspection:

- `github_issue_get`
- `github_pull_request_get`
- `hackernews_story_get`
- `stack_overflow_question_get`
- `devto_comments_get`

## High-signal evidence found

### GitHub issues and pull requests

GitHub was the strongest discussion source for actionable engineering detail.

Useful references:

- `NousResearch/hermes-agent#44075` — feature issue for hybrid BM25 + vector session search.
- `NousResearch/hermes-agent#44093` — implementation PR with detailed design tradeoffs.
- `NousResearch/hermes-agent#47825` — semantic wiki-search skill with graceful fallback design.
- `Abhash-Chakraborty/Find#310` — sqlite-vec proof-of-concept with review comments exposing real risks.
- `dripnex/readide#319` — spike criteria for sqlite-vec semantic search over notes.
- `l3ad3r1/Hermes-Agent-Android#4` — mobile persistent vector store acceptance criteria.

Important design patterns observed:

- Hybrid search combines FTS5/BM25 with vector similarity.
- Reciprocal rank fusion is preferred over naive score normalization because BM25 and vector distances have incompatible scales.
- `min_similarity` or equivalent floors are important to avoid nearest off-topic KNN matches.
- Graceful fallback is essential when sqlite-vec, embeddings, provider config, or extension loading is unavailable.
- Avoid network calls in the write hot path; use backfill or bounded opportunistic embedding.
- Plain embedding tables plus sqlite-vec scalar distance can be safer than always relying on virtual tables that require extension loading.
- Store embedding model/dimension metadata to avoid crashes or invalid comparisons after model changes.

Review/testing risks observed in real PRs:

- Validate embedding dimensions before interpolating them into SQL DDL.
- Insert metadata and vector rows atomically in one transaction.
- Treat sqlite-vec as optional when appropriate and test skip/fallback behavior.
- Keep formatting/lint gates in the validation path.
- Ensure tests target the actual implementation API, not a mismatched wrapper.

### Hacker News

HN was useful for ecosystem signals and local-first product patterns, but often had few comments.

Useful references:

- Story `44711872`: SQLite-vector extension, no-index/blob storage angle; comment asked about binary quantized vectors and Hamming distance.
- Story `47162581`: Context Harness local-first context engine using SQLite, FTS5, optional vector embeddings, CLI, and MCP.
- Story `47572701`: Rails + SQLite-vec semantic search; low discussion volume.
- Story `48557446`: browser/client-side semantic search over wallpapers with sqlite-wasm + sqlite-vec + transformers.js.

Important ecosystem signals:

- Local-first AI memory/search tools often converge on SQLite + FTS5 + optional vector embeddings.
- MCP/CLI integration is a recurring interface pattern.
- Offline/local embeddings are desirable to avoid API keys and cloud data movement.

## Lower-signal sources for this topic

### Stack Overflow

For `sqlite vector search`, Stack Overflow results were noisy because lexical matching on `vector` returned old Android/C++ questions about vectors/lists, not modern vector search.

Observed issue:

- `stack_overflow` is useful for Q&A topics, but weak for modern or niche topics where keywords are overloaded.

Possible improvement:

- Improve source ranking or query handling for Stack Overflow.
- Consider detecting modern terms like `sqlite-vec`, `embeddings`, `semantic search`, `vector database` and favoring GitHub/HN/research sources.

### Dev.to

Dev.to was low signal for this topic.

Observed issues:

- `discussion_search` uses tag-style Dev.to search, which can drift from the actual multi-word query.
- `devto_comments_get` works, but comments were often empty.
- There is no `devto_article_get`, so the agent cannot inspect article body/content after finding a result.

Possible improvement:

- Add `devto_article_get` to inspect selected articles.
- Improve Dev.to query/tag derivation.
- Consider marking Dev.to as lower-confidence when only comments are available and no article detail tool exists.

## Tool behavior observations

Good:

- `discussion_search` fan-out gives fast multi-source discovery.
- Follow-up fields are useful for selecting detail tools.
- GitHub detail tools provide enough structured detail to extract design decisions, validation commands, review comments, related issues, and PR relationships.
- HN detail tool gives story text and bounded nested comments.

Needs correction or deeper validation:

- Ranking can surface low-signal Stack Overflow/Dev.to results above more relevant GitHub/HN results for modern engineering topics.
- Dev.to lacks article-detail inspection.
- Stack Overflow query behavior is too lexical for overloaded terms like `vector`.
- We need systematic tests for discussion ranking and source-specific behavior, not only live manual checks.

## Pending test plan

These tests should be added or expanded before treating discussion tools as fully verified.

### Parent `discussion_search`

- Fan-out returns partial results and `source_errors` when one provider fails.
- Source ordering/interleaving remains stable and bounded by `limit`.
- `source: github` expands to both issues and pull requests.
- `source: stack_overflow`, `source: hacker_news`, and `source: devto` call only their selected providers.
- Follow-up metadata is present for every normalized discussion item.
- Secret redaction applies to summaries, details, and provider errors.

### Ranking / quality tests

- Multi-source ranking should not let low-relevance Stack Overflow lexical matches dominate modern topic queries.
- GitHub issues/PRs with exact `sqlite-vec` or `semantic search` terms should outrank generic `vector` matches.
- Dev.to tag derivation should be tested with multi-word queries and hyphenated terms such as `sqlite-vec`.
- HN results with exact title/body matches should be preserved even when comments are zero.

### Detail tools

- `github_issue_get` includes related PRs/issues when timeline relations are available.
- `github_pull_request_get` includes comments, review comments, reviews, and pagination offsets.
- `hackernews_story_get` preserves nested comments within depth/total bounds.
- `stack_overflow_question_get`, `stack_overflow_answers_get`, and `stack_overflow_comments_get` handle missing/deleted/unavailable posts.
- `devto_comments_get` handles empty comments, nested comments, pagination, and provider failures.

### Missing capability to consider

- Add `devto_article_get` for selected article inspection.
- Consider stronger ranking metadata or confidence annotations in `discussion_search` results.
- Consider source-specific query rewrites for overloaded terms.

## Recommended next workflow

1. Keep this as investigation evidence.
2. Add focused failing tests for ranking/source behavior.
3. Implement only the smallest corrections needed.
4. Re-run local validation:
   - `cd extensions/websearch && npm run typecheck`
   - `cd extensions/websearch && npm run test`
   - `cd extensions/websearch && npm audit --omit=dev --json`
5. Reload Pi and run live discussion smoke again.
