## Workflow Status
- Status: READY
- Blockers: None

## Goal
Make Code Research consume and present generic TypeScript type-alias graph results correctly for change slug fix-ts-type-alias-graph-consumption, so graph-backed relation=references returns persisted type-alias import/read edges and code_find output clearly exposes declarationKind=type_alias when available.

## Scope & Exclusions
In scope:
- Graph-backed TypeScript type-alias reference consumption and fallback behavior under /home/j0k3r/.pi/agent/extensions/code-research/src/core/** needed to return persisted reads/imports edges for type aliases.
- Code Research symbol/result rendering under /home/j0k3r/.pi/agent/extensions/code-research/src/tools/** needed to expose declaration_kind or declarationKind clearly when present for declaration output.
- Focused regression coverage under /home/j0k3r/.pi/agent/extensions/code-research/test/** proving generic type-alias graph references, declaration_kind filtering, and user-visible output behavior.

Excluded:
- Adjacent-line false-positive cleanup.
- Frontend test/mock policy decisions.
- Java graph/type references, Java record accessors, framework docs, SIAS source changes, generated artifacts, secrets, and any hardcoded SIAS symbol or path logic.
- Broad TypeScript direct-reference extraction or graph-generation refactors unless required to preserve the approved graph-consumption contract.

## Execution Scope
- Root: /home/j0k3r/.pi/agent
- Allowed Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-references-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-symbol-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/code-find.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/package.json
- Writable Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-references-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-symbol-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/code-find.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol-graph-fallback.test.ts
- Allowed Bash:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts test/find-symbol-graph-fallback.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Notes: Keep the fix generic to TypeScript type-alias graph consumption, declaration-kind filtering, and result rendering inside Code Research without widening into SIAS-specific logic or adjacent reference-location cleanup.

## MINI-001
- Contract: Graph-backed TypeScript relation=references must return persisted import and read edges that target declarations whose declarationKind is type_alias, without requiring any SIAS-specific symbol handling.
- Acceptance: A generic export type alias fixture that already produces graph imports and reads returns non-zero references in graph-backed mode after the consumer file is removed; results include at least one import reference and type-position read references on lines containing the alias symbol; compare_direct_fallback does not replace those graph results with an empty fallback result set.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/openspec/archive/2026-09-02/fix-ts-type-alias-references/mini-sdd.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-references-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-references-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts test/find-symbol-graph-fallback.test.ts
- Depends on:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md

## MINI-002
- Contract: Declaration queries for TypeScript type aliases must remain filterable by declaration_kind=type_alias, and code_find declaration output must surface the precise declaration kind when that metadata exists even if the coarse compatibility kind remains variable.
- Acceptance: A graph-backed type-alias declaration query filtered with declaration_kind=type_alias returns only alias declarations; tool-level declaration output for the same fixture visibly includes type_alias in the rendered row or equivalent parseable declaration-kind metadata, without removing the existing coarse kind field unless compatibility is proven by tests.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-symbol-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/code-find.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-symbol-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/code-find.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts test/find-symbol-graph-fallback.test.ts
- Depends on:
  - MINI-001

## MINI-003
- Contract: Regression coverage must prove the fix is generic rather than SIAS-named by using bounded local fixtures that exercise type-only imports, type-position reads, declaration_kind filtering, and code_find rendering through approved extension tests.
- Acceptance: Focused tests fail before the fix and pass after it for a generic alias fixture; at minimum they assert graph-backed relation=references returns reads/imports for a removed consumer file, declaration_kind=type_alias filters alias declarations, and rendered code_find declaration output exposes type_alias when available.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/package.json
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/package.json
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts test/find-symbol-graph-fallback.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Depends on:
  - MINI-001
  - MINI-002

## Risks & Constraints
- Authority evidence says the graph already persists type_alias declarations and typescript_type_alias_reference and typescript_type_alias_import edges, so the fix must stay in consumption, filtering, fallback, or rendering unless a bounded test proves otherwise.
- The solution must be agnostic: ReviewAnalysisStatus is only a regression example, not an allowed hardcoded dependency.
- Existing tool guidance already documents coarse kind compatibility for TypeScript aliases, so any visible output change must preserve parseable compatibility while making declaration kind explicit.
- Adjacent-line false positives are explicitly out of scope; acceptance should assert lines that actually contain the alias symbol and should not expand into broader location-precision work.

## Open Decisions
- None.

## Next Permitted Action
sdd-apply for fix-ts-type-alias-graph-consumption
