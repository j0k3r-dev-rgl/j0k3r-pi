## Workflow Status
- Status: READY
- Blockers: None

## Goal
Make Code Research return generic TypeScript unfiltered relation=references results on the actual queried-symbol occurrence lines only for change slug fix-ts-unfiltered-reference-spans, so adjacent callback, body, or follow-on lines that do not contain the symbol are not emitted as independent references while call-only behavior stays unchanged.

## Scope & Exclusions
In scope:
- TypeScript direct reference extraction, graph-backed reference consumption, hybrid merge behavior, and reference output paths under /home/j0k3r/.pi/agent/extensions/code-research/** that can widen one true occurrence into extra unfiltered reference rows.
- Focused regression coverage under /home/j0k3r/.pi/agent/extensions/code-research/test/** proving generic unfiltered relation=references results stay on real symbol/call occurrence lines for direct, graph-backed, and tool-level flows.
- Preservation of existing call-only behavior for TypeScript function and method references.

Excluded:
- TypeScript type alias work already remediated.
- TypeScript optional-chain work already remediated except where existing coverage is reused to prevent regressions.
- Frontend test/mock policy, Java graph/type refs, Java record accessors, framework docs, SIAS source modifications, generated artifacts, secrets, and any hardcoded SIAS symbol or path logic.
- Broad refactors outside the bounded TypeScript reference resolver/direct/graph merge/output paths and relevant tests under extensions/code-research/**.

## Execution Scope
- Root: /home/j0k3r/.pi/agent
- Allowed Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-references-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/code-find.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/package.json
- Writable Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-references-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/code-find.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
- Allowed Bash:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Notes: Keep the fix generic to TypeScript reference span selection, graph/direct reconciliation, and user-visible reference rows without widening into SIAS-specific handling or unrelated TypeScript and Java remediations.

## MINI-001
- Contract: Direct TypeScript function and method reference extraction must emit unfiltered relation=references rows only for lines that contain the queried symbol occurrence, and must not promote adjacent callback-body, loop-body, redirect, or follow-on statement lines into separate references.
- Acceptance: A generic local fixture with a true call followed by unrelated callback or body lines returns only the actual symbol-bearing line for the reference and any legitimate callback reference only when the queried symbol itself appears on that callback line; unfiltered results for the fixture do not include adjacent lines that omit the symbol; existing call-only queries for the same fixture keep the same call line count and called_as values.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts
- Depends on:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md

## MINI-002
- Contract: Graph-backed TypeScript reference consumption and hybrid graph/direct comparison must preserve occurrence-level lines from graph edges when present and must not widen one true reference into extra unfiltered rows during graph lookup, fallback comparison, or row construction.
- Acceptance: A graph-enabled regression fixture builds the workspace graph, removes the target declaration source or otherwise forces graph-backed lookup, and unfiltered relation=references still returns only the true occurrence lines for the queried symbol with no adjacent false-positive rows; compare_direct_fallback does not replace a clean graph result with a noisier direct result for the same target; call-only graph behavior remains unchanged for the same fixture.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-references-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-references-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts
- Depends on:
  - MINI-001

## MINI-003
- Contract: Tool-level code_find relation=references output for the generic regression fixtures must surface only actual symbol-occurrence rows in unfiltered mode and must continue to show the same call-only rows when reference_kinds is restricted to call.
- Acceptance: A bounded tool test using registerCodeFindTool asserts unfiltered TypeScript references output and details for generic fixtures exclude adjacent lines that do not contain the queried symbol, while a paired reference_kinds call query for the same symbols still returns the expected call-only lines and counts; targeted tests and npm run typecheck pass.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/openspec/archive/2026-09-02/fix-ts-optional-chain-code-find-references/mini-sdd.md
  - /home/j0k3r/.pi/agent/openspec/archive/2026-09-02/fix-ts-type-alias-graph-consumption/mini-sdd.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/code-find.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/package.json
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/code-find.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/package.json
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Depends on:
  - MINI-001
  - MINI-002

## Risks & Constraints
- Authority evidence says reference_kinds call already returns correct TypeScript lines, so the fix must preserve existing call-only behavior and target only the unfiltered line-widening path.
- The approved solution must stay agnostic: SIAS examples are evidence of the bug shape, not allowed hardcoded fixtures or symbol-specific logic.
- Direct and graph-backed TypeScript paths can disagree; regression coverage must prove parity for unfiltered and call-only queries after source-removal graph fallback.
- Keep context useful only as metadata if needed; do not emit callback/body context rows as independent references when the queried symbol is absent from that line.

## Open Decisions
- None.

## Next Permitted Action
sdd-apply for fix-ts-unfiltered-reference-spans
