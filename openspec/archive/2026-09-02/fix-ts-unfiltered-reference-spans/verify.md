## Workflow Status
- Status: READY
- Blockers: None

## Verification Result
- Verification Result: PASS
- Change slug: fix-ts-unfiltered-reference-spans
- Verified artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-ts-unfiltered-reference-spans/apply.md
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-ts-unfiltered-reference-spans/mini-sdd.md

## Contracts & Candidate Reviewed
- Artifact contract applied: /home/j0k3r/.pi/agent/skills/subagent-artifact-contracts/SKILL.md
- Scope source reviewed: /home/j0k3r/.pi/agent/openspec/changes/fix-ts-unfiltered-reference-spans/mini-sdd.md
- Apply artifact reviewed first: /home/j0k3r/.pi/agent/openspec/changes/fix-ts-unfiltered-reference-spans/apply.md
- Canonical bug source reviewed: /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md, Remaining Issue 1
- Candidate files inspected:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/find-references-resolver.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/reference-graph-queries.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/code-find.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/package.json
- Workspace graph precheck: workspace_graph_status reported fresh and usable with extensions/code-research indexed before TypeScript code_find lookups.

## Evidence Matrix
| MINI | Contract summary | Apply evidence reviewed | Independent verification evidence | Result |
| --- | --- | --- | --- | --- |
| MINI-001 | Direct TypeScript callable unfiltered references stay on symbol occurrence lines and call-only behavior is unchanged. | Apply claims collectCallableAliases ignores aliases initialized by immediate calls and adds direct unfiltered fixture assertions. | find-references.ts:612-631 now skips aliases when the text after the matched target is an immediate call or optional immediate call, while preserving non-invoked callable aliases. find-references.test.ts:142-165 asserts chooseDestination line 4, collectModules line 9, normalizeRecord line 16 only, end_line equals line, and call-only chooseDestination remains one call. | PASS |
| MINI-002 | Graph-backed lookup and hybrid comparison preserve graph occurrence lines without adjacent false-positive rows. | Apply claims direct false-positive source was removed and graph fallback fixture covers source removal plus call-only behavior. | reference-graph-queries.ts constructs rows from edge callsite or occurrenceRange; no widening change was introduced. find-references-graph-fallback.test.ts:155-197 builds a graph-enabled generic fixture, removes src/actions.ts, runs compare_direct_fallback, and asserts unfiltered graph-backed chooseDestination line 4 and collectModules line 9 only, with call-only route reference unchanged. | PASS |
| MINI-003 | code_find unfiltered references surface actual occurrence rows and call-filtered queries remain unchanged. | Apply claims registerCodeFindTool regression and typecheck pass. | code-find.ts relation=references still flows through resolveFindReferences and addSourceLines. find-references.test.ts:1186-1224 registers the tool and asserts unfiltered details/content include only source lines containing chooseDestination or collectModules, exclude redirect(route) and console.log(moduleName), and preserve one call-only chooseDestination row. | PASS |

## Acceptance Coverage
- Genericity/no SIAS hardcoding: implementation change is a generic initializer-shape check in TypeScript callable alias collection; no SIAS-specific implementation strings or path logic were found in the changed implementation file.
- Unfiltered references stay on actual occurrence lines: direct tests assert only call rows on the queried symbol lines for chooseDestination, collectModules, and normalizeRecord; graph-backed tests assert occurrence rows after target source removal; code_find tests assert user-visible source_line content excludes adjacent body/follow-on lines.
- Call-only behavior unchanged: direct, graph-backed, and code_find call-filtered assertions each preserve one correct chooseDestination call row.
- Graph-backed behavior covered: graph fallback fixture builds the workspace graph, removes the target declaration source, uses compare_direct_fallback, and validates graph-derived occurrence lines.
- Validation commands from authority:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test -- test/find-references.test.ts test/find-references-graph-fallback.test.ts: PASS, 2 files passed, 62 tests passed.
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck: PASS.

## Implementation Evidence Review
- code_find declaration lookup confirmed collectCallableAliases and isCallableResultAliasInitializer declarations in /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts, and collectCallableAliases is called from findCallableReferences.
- The implementation addresses the observed false-positive mechanism: variables assigned from targetSymbol(...) are not added to aliasNames, so later uses of route, modules, or rawRecord are not emitted as callbacks/references for the queried callable.
- Callable-value alias behavior remains supported for assignments such as const alias = helper because the skip only triggers when the target symbol is followed by an immediate call opener.
- No implementation or test files were modified during verification.

## Issues & Required User Decision
- None.

## Skill Compliance
- Read /home/j0k3r/.pi/agent/openspec/changes/fix-ts-unfiltered-reference-spans/apply.md first.
- Read and applied /home/j0k3r/.pi/agent/skills/subagent-artifact-contracts/SKILL.md.
- Derived MINI-001 through MINI-003 from /home/j0k3r/.pi/agent/openspec/changes/fix-ts-unfiltered-reference-spans/mini-sdd.md.
- Stayed within assigned verification inputs and wrote only /home/j0k3r/.pi/agent/openspec/changes/fix-ts-unfiltered-reference-spans/verify.md.

## Post-Verification Continuity Snapshot
- Change slug: fix-ts-unfiltered-reference-spans
- Verification result: PASS
- Verified implementation files with worktree modifications:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references-graph-fallback.test.ts
- Validation status: targeted test command passed; typecheck passed.
- Residual risks: Highly dynamic aliasing outside the current immediate-call heuristic remains outside this Mini-SDD; SIAS smoke/regeneration remains outside verification scope.
- Next permitted action: sdd-archive for fix-ts-unfiltered-reference-spans
