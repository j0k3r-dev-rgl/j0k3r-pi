## Workflow Status
- Status: READY
- Blockers: None

## Goal
Detect optional-chained TypeScript calls in both call references and outgoing call hierarchy for change slug fix-ts-optional-chain-calls.

## Scope & Exclusions
In scope:
- TypeScript direct call extraction used by reference lookup in /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/function-call-tree.ts and /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts.
- TypeScript graph call extraction parity in /home/j0k3r/.pi/agent/extensions/code-research/src/core/workspace-graph.ts when needed so graph-backed results match direct mode.
- Focused regression coverage under /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-typescript.test.ts and /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts.

Out of scope:
- Java type references.
- Java Mockito or dedupe work.
- workspace_graph_status or docs/help output changes.
- Generated artifacts, secrets, or broad refactors outside extensions/code-research/**.

## Execution Scope
- Root: /home/j0k3r/.pi/agent
- Allowed Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/function-call-tree.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/workspace-graph.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-typescript.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/package.json
- Writable Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/function-call-tree.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/workspace-graph.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-typescript.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- Allowed Bash:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/function-call-tree-typescript.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test
- Notes: Keep implementation bounded to TypeScript optional-chained call extraction and graph parity needed for semantic references and outgoing call hierarchy.

## MINI-001
- Contract: Extend TypeScript direct call extraction so optional-chained invocations are recognized as callable uses for method and function-call analysis, including obj?.save(), await this.repo?.save({}), and obj.method?.() when represented by the parser.
- Acceptance:
  - code_find relation=references query=save kind=method reference_kinds=["call"] can reach optional-chain callsites through the direct TypeScript extraction path.
  - code_call_hierarchy direction=outgoing includes optional-chain callees from the direct extraction path.
  - Existing non-optional identifier and member_expression calls remain detected.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/code-research-sias-audit-discovery.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/function-call-tree.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/function-call-tree.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/function-call-tree-typescript.test.ts
- Depends on:
  - None

## MINI-002
- Contract: Keep workspace-graph TypeScript call extraction aligned with direct extraction so graph-backed reference lookup and outgoing call hierarchy also include optional-chained calls without regressing receiver metadata or external-call fallback.
- Acceptance:
  - Graph-backed and direct-mode outgoing call hierarchy produce the same optional-chain callees for the added fixture.
  - Graph-backed call references include optional-chain callsites for the same target method names.
  - Receiver text and method symbol resolution remain populated for supported optional-chained member calls.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/code-research-sias-audit-discovery.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/workspace-graph.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/function-call-tree.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/workspace-graph.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/function-call-tree.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/function-call-tree-typescript.test.ts
- Depends on:
  - MINI-001

## MINI-003
- Contract: Add focused regression fixtures and assertions covering optional-chained TypeScript call references and outgoing call hierarchy, including the SIAS-style await this.repo?.save({}) case and one obj.method?.() parser-shape case when supported by the current tree-sitter grammar.
- Acceptance:
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts asserts optional-chain call references appear and normal calls still appear.
  - /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-typescript.test.ts asserts outgoing call hierarchy includes optional-chain callees and graph/direct parity for the fixture.
  - Targeted suites, typecheck, and full Code Research test suite pass.
  - No adjacent non-symbol line is asserted as a semantic call reference in the new fixtures.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/code-research-sias-audit-discovery.md
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-typescript.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/package.json
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-typescript.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/package.json
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/function-call-tree-typescript.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test
- Depends on:
  - MINI-001
  - MINI-002

## Risks & Constraints
- Tree-sitter may represent optional chaining with node types other than identifier and member_expression; implementation must follow actual parser nodes instead of regex-only inference.
- Direct extraction and workspace-graph extraction currently have separate TypeScript call walkers, so parity must be maintained explicitly.
- This Mini-SDD must not expand into unrelated TypeScript span, docs, or workspace status fixes reserved for later roadmap slices.

## Open Decisions
- None.

## Next Permitted Action
sdd-apply for fix-ts-optional-chain-calls