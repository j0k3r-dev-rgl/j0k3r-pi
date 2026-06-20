# Future improvement: discussion search ranking

## Context

`discussion_search` currently merges fan-out results with a round-robin strategy across sources before applying the global `limit`. This prevents one source from dominating the output, but it is not a true relevance ranking.

## Goal

Add a lightweight ranking layer that improves result ordering while preserving source diversity.

## Proposed approach

Start with a local heuristic ranker before considering embeddings or model-based reranking.

Possible ranking signals:

- exact phrase match in title
- query term coverage in title and summary
- source-native popularity, normalized per source
  - Hacker News points
  - Stack Overflow score
  - GitHub issue/PR score when available
  - Dev.to reactions
- discussion activity, normalized by comment count
- recency/freshness when timestamps are available
- source diversity penalty to avoid repeated consecutive results from one source

Example output additions:

```json
{
  "rank_score": 8.42,
  "rank_reasons": [
    "title phrase match",
    "high comment activity",
    "query terms in summary"
  ]
}
```

## Suggested algorithm

1. Fetch bounded results per source.
2. Compute a `rank_score` for each item using normalized local signals.
3. Sort by `rank_score`.
4. Apply a diversity guard, for example max 2 consecutive results from the same source.
5. Apply the final global `limit`.
6. Return score/reasons in `details.data.items`, while keeping visible content compact.

## Open questions

- Should ranking weights be configurable?
- Should source diversity be strict or only a penalty?
- Should `source`-specific searches skip diversity and use pure rank?
- Should future research sources use a separate ranking profile from discussion sources?

## Later option

If local heuristics are not enough, add semantic reranking with embeddings or a bounded LLM reranker. Keep it optional because ranking should remain fast, cheap, and robust without external model calls.
