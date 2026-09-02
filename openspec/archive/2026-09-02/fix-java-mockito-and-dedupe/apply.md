## Workflow Status
- Status: READY
- Blockers: None

## Workflow & Contracts
- Change slug: fix-java-mockito-and-dedupe
- Change type: Mini-SDD apply
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-java-mockito-and-dedupe/mini-sdd.md
- Scope-source artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-java-mockito-and-dedupe/mini-sdd.md, section ## Execution Scope
- Artifact contract: /home/j0k3r/.pi/agent/skills/subagent-artifact-contracts/SKILL.md
- Implementation summary: Implemented Java Mockito verify receiver unwrapping for one- and two-argument verification chains, prevented callback bodies from being emitted both as top-level and callback-resolved Java calls, added call-node spans to Java method references, strengthened Java reference dedupe to a stable symbol/file/span/kind tuple, and added focused regression tests for Java references and Java call extraction.
- Assigned skill applied: /home/j0k3r/.pi/agent/skills/subagent-artifact-contracts/SKILL.md

## Authorization Record
- Authorized by: User
- Authorization reference: Current delegated apply prompt in this session
- Authorized action: Apply Mini-SDD change fix-java-mockito-and-dedupe and write /home/j0k3r/.pi/agent/openspec/changes/fix-java-mockito-and-dedupe/apply.md
- Authorized scope: Exactly the Execution Scope in /home/j0k3r/.pi/agent/openspec/changes/fix-java-mockito-and-dedupe/mini-sdd.md
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-java-mockito-and-dedupe/mini-sdd.md
- Candidate/change slug: fix-java-mockito-and-dedupe

## MINI-001 Evidence
- Status: Complete
- Contract evidence: /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/function-call-tree.ts now unwraps Mockito verify receiver expressions with one or more arguments before resolving the verified method receiver, so verify(mock).method(...), verify(mock, never()).method(...), and verify(mock, times(1)).method(...) resolve to the mocked object type.
- Reference evidence: /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts consumes the resolved Java graph calls and records the verified target method call span and called_as text.
- Regression evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts asserts direct Java references include verify(useCase).deleteById("3"), verify(useCase, never()).deleteById("4"), and verify(useCase, times(1)).deleteById("5") as call references while retaining direct and assertion references.
- Validation evidence: cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts passed with 45 tests.

## MINI-002 Evidence
- Status: Complete
- Contract evidence: /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/function-call-tree.ts skips lambda, method-reference, and anonymous-class callback nodes during top-level Java method-call extraction while still extracting calls from callback roots, preventing overlapping resolved-call and callback traversal paths.
- Dedupe evidence: /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts records method call end spans and deduplicates references by symbol, kind, file, start span, end span, and reference kind.
- Regression evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts asserts assertThatThrownBy(() -> service.method()) and assertDoesNotThrow(() -> service.method()) each produce one reference, while two distinct service.method() invocations in the same method remain two references.
- Validation evidence: cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts passed with 45 tests; cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck passed.

## MINI-003 Evidence
- Status: Complete
- Find-references regression evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts covers Mockito verify(mock).method(...), verify(mock, never()).method(...), verify(mock, times(1)).method(...), assertThatThrownBy(() -> service.method()), assertDoesNotThrow(() -> service.method()), and distinct duplicate-looking calls with different AST spans.
- Function-call-tree regression evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-java.test.ts covers Java call extraction for Mockito verification chains and assertion lambda callback child extraction without duplicate child calls.
- Validation evidence: cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/function-call-tree-java.test.ts passed with 14 tests; cd /home/j0k3r/.pi/agent/extensions/code-research && npm test passed with 34 files and 267 tests.

## Approved Deviations
- None.

## Attempt Record
- workspace_graph_status: fresh; usable=yes; monorepo=yes; indexed_projects=16; indexed_files=458.
- code_find declaration lookup: extractMethodCalls in /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/function-call-tree.ts returned one declaration.
- code_find declaration lookup: dedupeReferences in /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts returned one declaration.
- Command: cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts; Result: PASS, 45 tests.
- Command: cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/function-call-tree-java.test.ts; Result: PASS, 14 tests.
- Command: cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck; Result: PASS.
- Command: cd /home/j0k3r/.pi/agent/extensions/code-research && npm test; Result: PASS, 34 test files, 267 tests.

## Candidate Identity
- Candidate/change slug: fix-java-mockito-and-dedupe
- Worktree baseline noted by orchestrator: clean after commit b9144be
- Modified implementation paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/function-call-tree.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts
- Modified regression-test paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-java.test.ts

## Residual Risks
- Java resolution remains syntax/index based rather than full compiler type solving; Mockito and callback fixes are bounded to the approved AST patterns and existing project-index capabilities.
- Regex fallback references are still retained for method references and callback compatibility, but dedupe now uses spans to suppress overlapping duplicates.

## Verification Inputs
- /home/j0k3r/.pi/agent/openspec/changes/fix-java-mockito-and-dedupe/mini-sdd.md
- /home/j0k3r/.pi/agent/openspec/changes/fix-java-mockito-and-dedupe/apply.md
- /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/function-call-tree.ts
- /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts
- /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-java.test.ts
- Validation commands listed in Attempt Record

## Next Permitted Action
sdd-verify for fix-java-mockito-and-dedupe
