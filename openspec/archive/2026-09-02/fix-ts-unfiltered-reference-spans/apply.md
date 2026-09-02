## Workflow Status
- Status: READY
- Blockers: None

## Workflow & Contracts
- Change slug: fix-ts-unfiltered-reference-spans
- Change type: Mini-SDD apply
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-ts-unfiltered-reference-spans/mini-sdd.md
- Scope-source artifact with Execution Scope: /home/j0k3r/.pi/agent/openspec/changes/fix-ts-unfiltered-reference-spans/mini-sdd.md
- Artifact contract: /home/j0k3r/.pi/agent/skills/subagent-artifact-contracts/SKILL.md
- Supporting artifact: /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
- Implementation summary: Generic TypeScript callable result aliases are no longer treated as callable-value aliases, preventing callback/body arguments derived from call results from becoming independent unfiltered references. Regression coverage verifies direct, graph-backed, and code_find tool-level unfiltered references stay on real occurrence lines while call-only behavior is preserved.

## Authorization Record
- Authorized by: user j0k3r
- Authorization reference: current Pi session, message on 2026-09-02 saying “recuerda que tiene que ser agnostico asi que vamos”
- Authorized action: apply fix-ts-unfiltered-reference-spans within its Mini-SDD Execution Scope
- Authorized scope: continuing to fix remaining agnostic Code Research issues; implementation bounded to the Mini-SDD Execution Scope
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-ts-unfiltered-reference-spans/mini-sdd.md
- Candidate/change slug: fix-ts-unfiltered-reference-spans

## MINI-001 Evidence
- Status: Complete
- Contract evidence: /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts now rejects aliases initialized from immediate callable invocations in collectCallableAliases, so call-result variables such as route, modules, or rawRecord are not later emitted as callback references for the queried callable.
- Test evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts adds a generic fixture covering direct unfiltered references followed by redirect, callback-body, and follow-on statement lines. The assertions require only the true chooseDestination, collectModules, and normalizeRecord call lines and preserve call-only chooseDestination behavior.
- Validation evidence: cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts passed with 62 tests.

## MINI-002 Evidence
- Status: Complete
- Contract evidence: /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts removes the direct false-positive source that could cause hybrid graph/direct comparison to prefer noisier direct coverage over clean graph occurrence rows.
- Test evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts adds a graph-enabled generic fixture, removes the target declaration source after graph build, and asserts unfiltered graph-backed references for chooseDestination and collectModules return only occurrence lines. The same fixture asserts call-only graph behavior remains one correct call row.
- Validation evidence: cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts passed with 62 tests.

## MINI-003 Evidence
- Status: Complete
- Contract evidence: Tool-level code_find uses resolveFindReferences and addSourceLines without new SIAS-specific logic; the generic resolver fix applies to code_find unfiltered TypeScript references while reference_kinds call filtering remains unchanged.
- Test evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts adds a registerCodeFindTool regression that asserts unfiltered chooseDestination and collectModules output/details exclude redirect and callback-body lines, and a paired call-only query returns the same single chooseDestination call.
- Validation evidence: cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts passed with 62 tests; cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck passed.

## Approved Deviations
- None.

## Attempt Record
- workspace_graph_status: fresh and usable before TypeScript implementation lookup.
- Code lookup: code_find found findReferences-related TypeScript declarations under /home/j0k3r/.pi/agent/extensions/code-research.
- Implementation files edited:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
- Validation commands:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts: PASS, 2 files passed, 62 tests passed
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck: PASS

## Candidate Identity
- Change slug: fix-ts-unfiltered-reference-spans
- Candidate root: /home/j0k3r/.pi/agent
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-ts-unfiltered-reference-spans/mini-sdd.md
- Apply artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-ts-unfiltered-reference-spans/apply.md
- Worktree base noted by orchestrator: clean after commit 1c1fd3b

## Residual Risks
- The fix intentionally preserves callable-value alias support for non-invoked assignments such as const callback = targetSymbol, while suppressing aliases initialized from targetSymbol(...). Highly dynamic aliasing patterns outside this heuristic may still require broader semantic analysis.
- SIAS smoke validation still requires extension reload/regeneration outside this apply scope.

## Verification Inputs
- /home/j0k3r/.pi/agent/openspec/changes/fix-ts-unfiltered-reference-spans/mini-sdd.md
- /home/j0k3r/.pi/agent/openspec/changes/fix-ts-unfiltered-reference-spans/apply.md
- /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
- /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
- /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
- Validation command: cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts
- Validation command: cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck

## Next Permitted Action
sdd-verify for fix-ts-unfiltered-reference-spans
