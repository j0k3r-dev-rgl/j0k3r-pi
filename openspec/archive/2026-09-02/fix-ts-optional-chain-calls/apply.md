## Workflow Status
- Status: READY
- Blockers: None

## Workflow & Contracts
- Change slug: fix-ts-optional-chain-calls
- Change type: Mini-SDD apply
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-ts-optional-chain-calls/mini-sdd.md
- Artifact contract: /home/j0k3r/.pi/agent/skills/subagent-artifact-contracts/SKILL.md
- Scope source containing Execution Scope: /home/j0k3r/.pi/agent/openspec/changes/fix-ts-optional-chain-calls/mini-sdd.md
- Execution Scope applied: only the files listed in mini-sdd.md under /home/j0k3r/.pi/agent/extensions/code-research plus this apply artifact were written.

## Authorization Record
- Authorized by: user
- When: current delegated task message in this apply session
- Authorized action: automatic apply is authorized if no blockers
- Authorized scope: Mini-SDD change fix-ts-optional-chain-calls using the Execution Scope from /home/j0k3r/.pi/agent/openspec/changes/fix-ts-optional-chain-calls/mini-sdd.md
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-ts-optional-chain-calls/mini-sdd.md
- Candidate/change slug: fix-ts-optional-chain-calls

## MINI-001 Evidence
- Status: COMPLETE
- Contract covered: TypeScript direct call extraction now extracts call targets through optional-chain wrapper nodes and member-expression property fallback in /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/function-call-tree.ts.
- Implementation evidence: extractCall now delegates to extractCallTarget; extractCallTarget handles identifier, member_expression, optional_chain, chain_expression, parenthesized_expression, and non_null_expression call target shapes; receiver and receiverNodeType are preserved for member calls.
- Source evidence: resolveReceiverType now resolves this.<property> receiver types from owner class text, covering the SIAS-style await this.repo?.save({}) pattern.
- Test evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts asserts call references for this.repo?.save({}), repo?.save({}), repo.save({}), and repo.save?.({}) with only callsite lines 5-8 accepted.
- Validation evidence: cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts passed with 44 tests.
- Validation evidence: cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/function-call-tree-typescript.test.ts passed with 10 tests.

## MINI-002 Evidence
- Status: COMPLETE
- Contract covered: workspace-graph TypeScript call extraction is aligned with direct extraction for optional-chained calls in /home/j0k3r/.pi/agent/extensions/code-research/src/core/workspace-graph.ts.
- Implementation evidence: workspace-graph imports extractCalls from the direct TypeScript function-call-tree implementation and uses it through extractTypeScriptCalls, preserving existing graph behavior by requesting includeNestedCallableBodies: true.
- Source evidence: graph call edges continue to populate callsite receiverName and receiverType from extracted call.receiver and graph receiver inference; optional-chain fixture verifies Repository receiver metadata for repo and this.repo.
- Test evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-typescript.test.ts compares graph-backed and direct outgoing call hierarchy children for the optional-chain fixture and asserts matching Repository callees and receiver metadata.
- Test evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts runs the same optional-chain reference fixture in both direct and graph-enabled projects with compare_direct_fallback enabled.
- Validation evidence: cd /home/j0k3r/.pi/agent/extensions/code-research && npm test passed with 34 files and 265 tests.

## MINI-003 Evidence
- Status: COMPLETE
- Contract covered: focused regression fixtures and assertions were added for optional-chained TypeScript call references and outgoing call hierarchy.
- Test evidence: find-references regression covers SIAS-style await this.repo?.save({}), parameter optional member call repo?.save({}), existing normal call repo.save({}), and obj.method?.() parser-shape call repo.save?.({}).
- Test evidence: function-call-tree regression covers the same four calls and validates direct called_as text plus graph/direct callee parity.
- Negative acceptance evidence: the find-references regression asserts every returned call reference is on the exact semantic callsite line range 5-8, preventing adjacent non-symbol lines from being accepted.
- Validation evidence: cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts passed with 44 tests.
- Validation evidence: cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/function-call-tree-typescript.test.ts passed with 10 tests.
- Validation evidence: cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck passed.
- Validation evidence: cd /home/j0k3r/.pi/agent/extensions/code-research && npm test passed with 34 files and 265 tests.

## Approved Deviations
- None.

## Attempt Record
- Workspace graph status was checked before TypeScript implementation lookups: fresh and usable.
- Used code_find for TypeScript symbol lookup and reference impact before editing.
- Initial targeted find-references validation passed.
- Initial targeted function-call-tree validation failed because graph-backed call hierarchy does not persist called_as text while direct mode does; the assertion was corrected to validate graph/direct callee and receiver parity while keeping direct called_as coverage.
- Initial full npm test failed because removing the workspace-graph-local extractTypeScriptCalls wrapper broke an existing source-shape guard and changed graph nested-call extraction behavior; the wrapper was restored to delegate to direct extraction with includeNestedCallableBodies: true.
- Final targeted suites, typecheck, and full npm test passed.

## Candidate Identity
- Candidate/change slug: fix-ts-optional-chain-calls
- Baseline context from orchestrator: worktree was clean after commit e634e3c before apply.
- Implementation files changed:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/function-call-tree.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/workspace-graph.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-typescript.test.ts
- Apply artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-ts-optional-chain-calls/apply.md

## Residual Risks
- Optional-chain handling is based on current tree-sitter node shapes covered by the added fixtures; unusual future grammar shapes may need additional transparent-wrapper handling.
- Graph-backed call hierarchy still does not expose called_as text for call edges; this was pre-existing behavior and not part of the approved Mini-SDD scope.

## Verification Inputs
- /home/j0k3r/.pi/agent/openspec/changes/fix-ts-optional-chain-calls/mini-sdd.md
- /home/j0k3r/.pi/agent/openspec/changes/fix-ts-optional-chain-calls/apply.md
- /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/function-call-tree.ts
- /home/j0k3r/.pi/agent/extensions/code-research/src/core/workspace-graph.ts
- /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-typescript.test.ts
- Command: cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts
- Command: cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/function-call-tree-typescript.test.ts
- Command: cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Command: cd /home/j0k3r/.pi/agent/extensions/code-research && npm test

## Next Permitted Action
sdd-verify for fix-ts-optional-chain-calls
