## Workflow Status
- Status: READY
- Blockers: None

## Workflow & Contracts
- Change slug: fix-usability-status-and-docs
- Change type: Mini-SDD apply
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-usability-status-and-docs/mini-sdd.md
- Scope-source artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-usability-status-and-docs/mini-sdd.md, section ## Execution Scope
- Artifact contract: /home/j0k3r/.pi/agent/skills/subagent-artifact-contracts/SKILL.md
- Documentation guidance: /home/j0k3r/.pi/agent/skills/cognitive-doc-design/SKILL.md
- Implementation summary: Implemented the approved bounded slice for TypeScript callable reference spans, workspace_graph_status unreadable-directory compact output, and Code Research README/tool guidance.

## Authorization Record
- Authorized by: User via current delegated task message
- Authorized when: Current session/message reference containing "User authorization: automatic apply is authorized if no blockers"
- Authorized action: Apply Mini-SDD change and write apply artifact
- Authorized scope: Exactly the Execution Scope in /home/j0k3r/.pi/agent/openspec/changes/fix-usability-status-and-docs/mini-sdd.md for fix-usability-status-and-docs
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-usability-status-and-docs/mini-sdd.md
- Candidate/change slug: fix-usability-status-and-docs

## MINI-001 Evidence: Tighten TypeScript callable reference spans to the actual call node
- Status: Complete
- Implementation paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- Source evidence:
  - createCallableReference now sets end_line to the matched call line and end_column to the matched call text span instead of the enclosing caller body.
  - TypeScript receiver-heuristic, typed-receiver, and object-literal method reference construction now use matched call-line spans rather than context end spans.
- Test evidence:
  - Added regression coverage for getDefaultRouteForRole and buildModulesByDependencyModuleVariables fixture names, asserting returned references stay on the line containing the matched call.
- Validation evidence:
  - PASS: cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts, 46 tests passed.
  - PASS: cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck.

## MINI-002 Evidence: Expose bounded unreadable-directory details in workspace_graph_status output
- Status: Complete
- Implementation paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/workspace-graph.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/extension-entry.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/workspace-graph/permission-tolerance.test.ts
- Source evidence:
  - workspace_graph_status compact text now preserves unreadable_dirs count and adds unreadable_paths only when unreadable directories exist.
  - The unreadable path summary is relative, bounded to five entries, and uses an omitted-count suffix for larger lists.
- Test evidence:
  - Existing permission-tolerance coverage still proves unreadable directories are captured in coverage state.
  - Added extension-entry integration coverage asserting compact output includes unreadable_dirs=1 and unreadable_paths=blocked while preserving details coverage.
- Validation evidence:
  - PASS: cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/extension-entry.test.ts test/workspace-graph/permission-tolerance.test.ts, 12 tests passed.
  - PASS: cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck.

## MINI-003 Evidence: Add implementation-safe Code Research guidance for noisy queries and known limits
- Status: Complete
- Implementation paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/README.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/code-find.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol.test.ts
- Source and documentation evidence:
  - README now recommends smallest relevant path, explicit language, explicit kind, declaring-file path for common method names, and reference_kinds=["call"] for call-only checks.
  - README preserves the semantic-first contract and tells users to validate suspicious misses or audit-grade gaps with targeted rg or grep.
  - README now documents call-hierarchy limits for dynamic dispatch, dependency injection, reflection, generated wiring, and injected receiver calls.
  - code_find prompt guidance now carries the same common-name, semantic-vs-rg fallback, dynamic/DI limitation, and TypeScript type-alias expectations.
  - find-symbol test coverage confirms TypeScript type aliases expose declaration_kind=type_alias while the compatibility coarse kind remains variable.
- Validation evidence:
  - PASS: cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-symbol.test.ts, 26 tests passed.
  - PASS: cd /home/j0k3r/.pi/agent/extensions/code-research && npm test, 34 files and 269 tests passed.
  - PASS: cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck.

## Approved Deviations
- None.

## Attempt Record
- workspace_graph_status pre-implementation check: fresh, usable=yes, monorepo=yes, unreadable_dirs=0.
- Symbol inspection evidence:
  - code_find declaration createCallableReference in /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts returned 1 declaration.
  - code_find declaration formatUnreadableDirectorySummary in /home/j0k3r/.pi/agent/extensions/code-research/src/tools/workspace-graph.ts returned 1 declaration.
- Validation commands run:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/extension-entry.test.ts test/workspace-graph/permission-tolerance.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-symbol.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test
- Final validation result: All required targeted tests, full npm test, and typecheck passed.

## Candidate Identity
- Change slug: fix-usability-status-and-docs
- Base commit before apply: 8fe2f3c4973f8d4da4fe880b03bd776ceea0f164
- Working tree candidate: uncommitted changes in approved Execution Scope plus /home/j0k3r/.pi/agent/openspec/changes/fix-usability-status-and-docs/apply.md

## Residual Risks
- TypeScript callable span tightening intentionally uses the matched call text length; unusual multi-line call expressions may still require future refinement, but the accepted scenario requires spans stay on the matched call line.
- workspace_graph_status exposes only relative directory summaries and not contents; large unreadable sets are intentionally truncated.

## Verification Inputs
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-usability-status-and-docs/mini-sdd.md
- Apply artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-usability-status-and-docs/apply.md
- Changed implementation and test paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/typescript/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/workspace-graph.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/tools/code-find.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/README.md
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/extension-entry.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-symbol.test.ts
- Required validation commands for verifier:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/extension-entry.test.ts test/workspace-graph/permission-tolerance.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-symbol.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck

## Next Permitted Action
- sdd-verify for fix-usability-status-and-docs
