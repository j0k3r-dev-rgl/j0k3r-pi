## Workflow Status
- Status: READY
- Blockers: None

## Goal
Restore Java class/type/DTO reference coverage by fixing Code Research graph generation first, so fresh graph shards persist semantic Java reference evidence instead of only contains edges for ReviewPersistenceModel-, MongoIdUtils-, DocumentationItemDTO-, and MongoConfigs-like usages.

## Scope & Exclusions
In scope:
- Java graph generation and index/model updates under extensions/code-research for imports, type positions, constructor/type instantiation, .class literals, static class-qualified usages, and existing implements/extends relationships.
- Minimal graph-query consumption changes needed so normal fresh graph-backed Java class/interface reference queries stop returning zero when the graph already contains the evidence.
- Regression tests that inspect generated shard edges/artifacts and graph-backed reference results.

Excluded:
- TypeScript optional-chain resolver work.
- TypeScript type alias work.
- TypeScript adjacent-line false positives.
- Frontend tests and mocks policy.
- Java record accessor call hierarchy.
- Framework entrypoint documentation.
- Generated artifacts, secrets, SIAS source changes, and broad refactors outside extensions/code-research.

## Execution Scope
- Root: /home/j0k3r/.pi/agent
- Allowed Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/**
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/**
  - /home/j0k3r/.pi/agent/extensions/code-research/src/types.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/**
- Writable Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/**
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/**
  - /home/j0k3r/.pi/agent/extensions/code-research/src/types.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/**
- Allowed Bash:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/workspace-graph/shard-content.test.ts test/find-references-graph-fallback.test.ts test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Notes: Restrict implementation to Java graph generation, persisted graph metadata, and the minimum graph-backed reference query wiring needed to expose the new Java evidence.

## MINI-001
- Contract: Extend Java graph indexing and shard building so generated graph artifacts persist semantic edges for Java class and interface references, not just declarations and method calls. The persisted evidence must cover imports, field and method type positions, local and generic type usages, constructor or record instantiation sites, .class literals, and static class-qualified usages for target class symbols.
- Acceptance: A Java fixture modeled on MyType, MyUtils, and ItemDTO produces a shard whose edges include semantic evidence beyond contains for the target class symbols; shard assertions prove at least one import edge and one occurrence-based semantic edge for each covered usage family; persisted coordinate metadata is precise enough to identify the symbol token without rereading the source file; WORKSPACE_GRAPH_BUILDER_MODEL_VERSION is bumped if persisted shard semantics change.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/project-index.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/workspace-graph.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/graph-schema.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/workspace-graph/shard-content.test.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/project-index.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/workspace-graph.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/graph-schema.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/types.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/workspace-graph/shard-content.test.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/workspace-graph/shard-content.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Depends on:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md

## MINI-002
- Contract: Update graph-backed Java reference querying only as needed to consume the new persisted Java evidence from MINI-001, so fresh graph-backed class and interface reference lookups no longer depend on direct parsing to avoid zero-result failures.
- Acceptance: A graph-backed Java regression test builds the graph, removes or invalidates source files needed for direct parsing, and still returns non-zero references for class or interface fixtures from graph artifacts alone; unfiltered Java class or interface queries include the expected semantic categories for the fixture set, including import plus type or instantiation evidence; the result path does not rely on compare_direct_fallback to pass the graph-only test.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-references-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/graph-policy.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-references-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/graph-policy.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references-graph-fallback.test.ts test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Depends on:
  - MINI-001

## MINI-003
- Contract: Add regression fixtures and assertions that mirror the audited SIAS failure shapes, and require both shard-level proof and query-level proof for Java type references.
- Acceptance: Tests cover class or DTO imports, generic and local type usage, constructor usage, static utility qualification, and existing interface relationship coverage; at least one shard-content test asserts the graph contains the semantic edges directly, and at least one reference test asserts graph-backed Java queries surface those edges as non-zero references; the regression names and assertions clearly map to ReviewPersistenceModel, MongoIdUtils, DocumentationItemDTO, and MongoConfigs failure categories.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/workspace-graph/shard-content.test.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/workspace-graph/shard-content.test.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/workspace-graph/shard-content.test.ts test/find-references-graph-fallback.test.ts test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Depends on:
  - MINI-001
  - MINI-002

## Risks & Constraints
- Persisted graph semantics are changing, so stale shard reuse must be prevented by updating the builder model version when needed.
- Query-level success is insufficient by itself; tests must inspect shard edges so resolver fallback cannot hide a graph-generation gap.
- Keep existing Java method call, implements, extends, and permits behavior stable while adding type-reference evidence.
- Do not modify /home/j0k3r/sias/app or overwrite /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md.

## Open Decisions
- None.

## Next Permitted Action
sdd-apply for fix-graph-java-type-references