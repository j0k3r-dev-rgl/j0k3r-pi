## Workflow Status
- Status: READY
- Blockers: None

## Goal
Fix TypeScript type alias declaration and reference behavior for change slug fix-ts-type-alias-references so code_find can reliably surface ReviewAnalysisStatus-style aliases, declaration_kind=type_alias, and semantic references in import and type positions across direct and graph-backed queries.

## Scope & Exclusions
In scope:
- TypeScript symbol extraction and declaration mapping under /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/** needed to preserve reliable declaration_kind=type_alias behavior for export type aliases.
- TypeScript direct reference discovery under /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts for type aliases used through import type, named imports, type annotations, type assertions, and other type positions already covered by the bounded fixture.
- Workspace graph/index modeling and graph query consumption under /home/j0k3r/.pi/agent/extensions/code-research/src/core/** and /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/function-call-tree.ts needed to persist and return TypeScript type-alias import/read edges.
- Focused regression coverage under /home/j0k3r/.pi/agent/extensions/code-research/test/** for declaration parity, direct references, graph-only references, and shard content.

Excluded:
- TypeScript adjacent-line false-positive cleanup.
- Frontend test/mock policy decisions.
- Java graph/type-reference work, Java record accessors, framework docs, SIAS source changes, generated artifacts, secrets, and broad refactors outside extensions/code-research/**.

## Execution Scope
- Root: /home/j0k3r/.pi/agent
- Allowed Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/symbol-extractor.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-symbol.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/function-call-tree.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/workspace-graph.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-symbol-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/workspace-graph/shard-content.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/package.json
- Writable Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/symbol-extractor.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-symbol.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/function-call-tree.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/workspace-graph.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-symbol-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/workspace-graph/shard-content.test.ts
- Allowed Bash:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-symbol.test.ts test/find-symbol-graph-fallback.test.ts test/find-references.test.ts test/find-references-graph-fallback.test.ts test/workspace-graph/shard-content.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Notes: Keep the change bounded to TypeScript type-alias declaration and reference behavior in Code Research direct and graph-backed flows without expanding into other TypeScript or Java audit findings.

## MINI-001
- Contract: Preserve and prove reliable TypeScript type-alias declaration metadata so export type aliases can be selected by declaration_kind=type_alias in both direct and graph-backed symbol queries, while any compatibility-oriented coarse kind behavior remains explicit and test-covered.
- Acceptance: A ReviewAnalysisStatus-style fixture with export type ReviewAnalysisStatus = ... returns declaration_kind type_alias from findSymbol/query flows in direct and graph-backed modes; if the coarse kind remains variable for compatibility, tests assert that exact behavior alongside declaration_kind reliability; no query path regresses existing callable_variable or interface extraction.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/symbol-extractor.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-symbol.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-symbol-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol-graph-fallback.test.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/symbol-extractor.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-symbol.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-symbol-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol-graph-fallback.test.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-symbol.test.ts test/find-symbol-graph-fallback.test.ts test/find-references.test.ts test/find-references-graph-fallback.test.ts test/workspace-graph/shard-content.test.ts
- Depends on:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md

## MINI-002
- Contract: Extend direct TypeScript reference lookup so type aliases are referenceable symbols and relation=references returns semantic import and type-position hits for ReviewAnalysisStatus-style usage, including import type bindings and annotations in consumer files.
- Acceptance: A focused fixture using export type ReviewAnalysisStatus, import type { ReviewAnalysisStatus }, and const status: ReviewAnalysisStatus returns non-zero references in direct mode; results include the type-only import as reference_kind import and type-position usages as semantic reads on lines containing ReviewAnalysisStatus; declaration lines are not double-counted as references; untyped text-only matches are not required.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/function-call-tree.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/function-call-tree.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-symbol.test.ts test/find-symbol-graph-fallback.test.ts test/find-references.test.ts test/find-references-graph-fallback.test.ts test/workspace-graph/shard-content.test.ts
- Depends on:
  - MINI-001

## MINI-003
- Contract: Persist symbol-targeted TypeScript graph edges for type-alias imports and type-position references, then return them through graph-backed relation=references even when direct parsing of the relevant source is unavailable.
- Acceptance: After buildWorkspaceGraph, the shard for a type-alias fixture contains a symbol node for ReviewAnalysisStatus with declarationKind type_alias plus consumer edges that let queryReferencesFromGraph/findReferences return type-only import and type-position references after removing a participating source file; graph-backed results preserve parseable line and column values on lines containing the alias symbol; hybrid comparison does not replace complete graph answers with an empty direct fallback for this case.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/workspace-graph.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/function-call-tree.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/workspace-graph/shard-content.test.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/workspace-graph.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/function-call-tree.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/workspace-graph/shard-content.test.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-symbol.test.ts test/find-symbol-graph-fallback.test.ts test/find-references.test.ts test/find-references-graph-fallback.test.ts test/workspace-graph/shard-content.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Depends on:
  - MINI-001
  - MINI-002

## Risks & Constraints
- Current TypeScript query contracts already document that type aliases may surface with coarse kind variable, so the fix must not depend on changing public tool schemas unless the bounded implementation can prove compatibility.
- Direct and graph-backed TypeScript references currently use different evidence sources; regression coverage must prove parity for declaration_kind and type-alias references instead of fixing only one path.
- The approved scope excludes adjacent-line cleanup, so new reference assertions must stay on lines that actually contain ReviewAnalysisStatus without widening the change into unrelated location-precision work.

## Open Decisions
- None.

## Next Permitted Action
sdd-apply for fix-ts-type-alias-references
