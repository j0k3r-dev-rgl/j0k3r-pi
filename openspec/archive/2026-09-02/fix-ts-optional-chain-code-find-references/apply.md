## Workflow Status
- Status: READY
- Blockers: None

## Workflow & Contracts
- Change slug: fix-ts-optional-chain-code-find-references
- Change type: Mini-SDD apply
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-ts-optional-chain-code-find-references/mini-sdd.md
- Scope-source artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-ts-optional-chain-code-find-references/mini-sdd.md, section ## Execution Scope
- Artifact contract: /home/j0k3r/.pi/agent/skills/subagent-artifact-contracts/SKILL.md
- Supporting artifact reviewed as delegated: /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
- Implementation scope honored: only approved implementation files under /home/j0k3r/.pi/agent/extensions/code-research/** were changed.

## Authorization Record
- Authorized by: user j0k3r
- When/session reference: current Pi session, message on 2026-09-02 after commit e374a1a
- User authorization phrase: “vamos a seguir solucionando problemas”
- Orchestrator context: orchestrator stated it would continue with “TS optional-chain calls faltando en code_find references” and user did not object.
- Authorized action: apply fix-ts-optional-chain-code-find-references
- Authorized scope: within the Mini-SDD Execution Scope in /home/j0k3r/.pi/agent/openspec/changes/fix-ts-optional-chain-code-find-references/mini-sdd.md
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-ts-optional-chain-code-find-references/mini-sdd.md
- Candidate/change slug: fix-ts-optional-chain-code-find-references

## MINI-001 Evidence
- Status: Complete
- Contract evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts:199 covers TypeScript direct and graph-enabled method lookup for symbol save with reference_kinds call.
- Scenario evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts:218 asserts called_as includes repo.save({ source: 'normal' }), repo.save?.({ source: 'optional-call' }), repo?.save({ source: 'param' }), and this.repo?.save({ source: 'field' }).
- Line evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts:224 verifies every returned reference_kind is call, and line evidence at :225 keeps returned references on the actual call lines.
- Validation evidence: cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts passed with 2 files and 56 tests.

## MINI-002 Evidence
- Status: Complete
- Implementation evidence: /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts:80 preserves graph called_as metadata when present and reconstructs TypeScript method call text from the callsite source line when graph call edges omit calledAs/text metadata.
- Implementation evidence: /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts:141 adds bounded graph-consumption call expression extraction for method calls, including optional receiver/call syntax, without changing graph generation.
- Graph-only regression evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts:155 builds a graph-enabled TS project, removes src/repository.ts at :163, and queries save with reference_kinds call at :165.
- Acceptance evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts:174 asserts graph-backed results preserve called_as for repo.save, repo.save?., repo?.save, and this.repo?.save; :180 asserts reference_kind call; :181 asserts actual call lines 5-8.
- Validation evidence: cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts passed with 2 files and 56 tests.

## MINI-003 Evidence
- Status: Complete
- Direct parity evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts:199 mirrors the SIAS shape await this.repo?.save({ ... }) and validates direct plus graph-enabled save call references for this.repo?.save, repo?.save, repo.save, and repo.save?. variants.
- Graph-only parity evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts:155 proves the same optional-chain save coverage is returned from graph-backed lookup after the declaring source file is removed.
- Package validation evidence: cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts passed with 2 files and 56 tests.
- Typecheck evidence: cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck passed with tsc --noEmit.

## Approved Deviations
- None.

## Attempt Record
- RED attempt: cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts failed after adding the graph-only optional-chain regression because graph results returned undefined called_as for the four save call edges.
- Remediation: updated /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts to preserve existing call metadata and reconstruct method call text from the source line when graph call metadata is absent.
- Typecheck remediation: npm run typecheck initially reported TS2339 for edge.callsite.text; the implementation now uses a narrow optional cast for legacy graph metadata compatibility.
- GREEN validation: cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts passed with 2 files and 56 tests.
- GREEN typecheck: cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck passed.

## Candidate Identity
- Workspace root: /home/j0k3r/.pi/agent
- Base context: clean worktree after commit e374a1a before this apply relaunch, as supplied by orchestrator.
- Modified implementation files: /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
- Modified regression files: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
- Existing supporting regression evidence in candidate: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts

## Residual Risks
- The graph fallback reconstructs called_as only when the source file containing the callsite is available; if both the target and caller source files are removed and graph edges lack calledAs/text metadata, graph results can still return the call edge without reconstructed called_as.
- The extraction is intentionally line-bounded and method-only to avoid broad graph-consumption behavior changes outside the approved optional-chain call-reference slice.

## Verification Inputs
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-ts-optional-chain-code-find-references/mini-sdd.md
- Apply artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-ts-optional-chain-code-find-references/apply.md
- Implementation files to review: /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
- Regression files to review: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts; /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
- Required validation command: cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts
- Required validation command: cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck

## Next Permitted Action
sdd-verify for fix-ts-optional-chain-code-find-references
