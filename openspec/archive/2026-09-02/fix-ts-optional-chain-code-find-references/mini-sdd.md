## Workflow Status
- Status: READY
- Blockers: None

## Goal
Restore TypeScript optional-chained method call coverage in code_find relation=references for change slug fix-ts-optional-chain-code-find-references, so existing semantic call edges such as back_ia/src/application/use-cases/analyze-image-readability.use-case.ts:26 are returned as call references.

## Scope & Exclusions
In scope:
- TypeScript code_find relation=references resolver and graph-consumption paths under /home/j0k3r/.pi/agent/extensions/code-research/src/core/** and /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts.
- Minimal TypeScript call-reference matching needed to surface optional-chained callsites when the target method symbol is already known.
- Focused regression coverage under /home/j0k3r/.pi/agent/extensions/code-research/test/** proving direct, hybrid, and graph-backed reference results for optional-chained calls.

Excluded:
- Java graph generation or Java type-reference fixes.
- TypeScript type alias classification or references.
- TypeScript adjacent-line false-positive cleanup beyond keeping new assertions on the actual symbol line.
- Frontend test/mock policy, Java record accessors, framework docs, SIAS source changes, generated artifacts, secrets, and broad refactors outside extensions/code-research/**.

## Execution Scope
- Root: /home/j0k3r/.pi/agent
- Allowed Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-references-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/package.json
- Writable Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-references-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
- Allowed Bash:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Notes: Keep implementation bounded to TypeScript reference resolution and graph-backed reference consumption needed to expose existing optional-chain call edges without reopening graph generation or unrelated TypeScript reference gaps.

## MINI-001
- Contract: Make TypeScript callable reference lookup return optional-chained method invocations as call references when the target method symbol already resolves, covering obj?.method(), this.repo?.save(), and obj.method?.() parser shapes supported by the current grammar.
- Acceptance: findReferences for symbol save with language ts, kind method, and reference_kinds call returns optional-chained callsites alongside non-optional calls; returned reference lines point to the call expression line that contains the target symbol; existing non-optional method-call coverage remains intact in the same fixture.
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
- Contract: Ensure graph-backed code_find relation=references consumes persisted TypeScript calls edges for optional-chained invocations instead of dropping them during graph lookup, filtering, or hybrid comparison.
- Acceptance: a graph-enabled regression test builds the workspace graph, removes the declaring source file or otherwise prevents direct re-parse, and still returns the optional-chained save call from graph artifacts alone; graph-backed results preserve call reference_kind and the optional-chain called_as text when present in the edge metadata; hybrid comparison does not replace a complete graph result with a smaller direct result for this case.
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
- Contract: Add a regression fixture that mirrors the SIAS shape await this.aiLogRepository?.save({ ... }) and proves parity across direct and graph-backed TypeScript reference queries for the same target method.
- Acceptance: test/find-references.test.ts asserts direct and graph-enabled save call references include this.repo?.save, repo?.save, repo.save, and repo.save?. variants on their actual call lines; test/find-references-graph-fallback.test.ts asserts graph-only reference lookup still returns the optional-chained call after source removal; targeted tests and npm run typecheck pass.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/package.json
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/package.json
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Depends on:
  - MINI-001
  - MINI-002

## Risks & Constraints
- The approved authority says the back_ia graph already contains the optional-chain calls edge, so implementation must prefer resolver and graph-consumption fixes over new graph-generation work.
- TypeScript direct and graph-backed reference paths can diverge; the regression must prove both modes return the same optional-chain save coverage.
- Keep the change slice limited to call references for optional chaining and do not expand into type-alias or adjacent-line remediation.

## Open Decisions
- None.

## Next Permitted Action
sdd-apply for fix-ts-optional-chain-code-find-references
