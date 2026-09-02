## Workflow Status
- Status: READY
- Blockers: None

## Verification Result
- Verification Result: PASS
- Change slug: fix-java-mockito-and-dedupe
- Verified artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-java-mockito-and-dedupe/verify.md
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-java-mockito-and-dedupe/mini-sdd.md
- Apply artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-java-mockito-and-dedupe/apply.md

## Contracts & Candidate Reviewed
- Artifact contract reviewed: /home/j0k3r/.pi/agent/skills/subagent-artifact-contracts/SKILL.md
- Scope-source artifact reviewed: /home/j0k3r/.pi/agent/openspec/changes/fix-java-mockito-and-dedupe/mini-sdd.md, section ## Execution Scope
- Apply artifact reviewed first: /home/j0k3r/.pi/agent/openspec/changes/fix-java-mockito-and-dedupe/apply.md
- Changed implementation paths reviewed:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/function-call-tree.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts
- Changed regression-test paths reviewed:
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-java.test.ts
- Workspace graph status before TypeScript verification lookups: fresh, usable=yes, monorepo=yes, indexed_projects=16, indexed_files=458.

## Evidence Matrix
| Mini ID | Contract summary | Apply evidence reviewed | Independent verify evidence | Result |
| --- | --- | --- | --- | --- |
| MINI-001 | Java Mockito verification chains produce semantic call references for verified target methods, including verify(mock), verify(mock, never()), and verify(mock, times(1)). | apply.md MINI-001 claims function-call-tree unwraps Mockito verify receivers and find-references consumes resolved Java graph calls; test coverage in find-references.test.ts. | /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/function-call-tree.ts includes unwrapMockitoReceiverInvocation returning the first verify argument and resolveInvocationExpressionType using it before resolving receiver type. /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts asserts verify(useCase).deleteById("3"), verify(useCase, never()).deleteById("4"), and verify(useCase, times(1)).deleteById("5") appear as call references. Targeted validation passed: cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts, 45 tests passed. | PASS |
| MINI-002 | Java references deduplicate by stable symbol/file/span/kind tuple so nested lambda/assertion contexts emit one reference per invocation without hiding distinct invocations. | apply.md MINI-002 claims callback nodes are skipped during top-level extraction, callback roots still extract calls, and reference dedupe includes spans. | /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/function-call-tree.ts extractMethodCalls skips lambda_expression, method_reference, and anonymous-class callback nodes in top-level traversal while extractMethodCallsFromNode still extracts callback-root calls. /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts records line/column/end_line/end_column on resolved calls and dedupeReferences keys symbol, kind, file, start span, end span, and reference_kind. /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts asserts assertion lambda results have one reference for thrownBy and doesNotThrow and two distinct results for two separate service.method() invocations. Validation passed: targeted find-references suite and npm run typecheck. | PASS |
| MINI-003 | Add focused regression tests for Mockito verification chains and nested assertion/lambda dedupe in direct references and Java call extraction; targeted suites, typecheck, and full suite pass. | apply.md MINI-003 claims focused tests were added in find-references.test.ts and function-call-tree-java.test.ts and all listed validation passed. | /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts includes Java interface method call coverage through direct call, assertion lambda, and three Mockito verify variants, plus dedupe coverage for assertThatThrownBy, assertDoesNotThrow, and distinct duplicate-looking calls. /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-java.test.ts includes extraction coverage for Mockito verification chains and assertion lambdas without duplicate child calls. Independent validation passed for both targeted suites, typecheck, and full Code Research test suite. | PASS |

## Acceptance Coverage
- MINI-001 acceptance covered:
  - verify(mock).method(...) target call references are asserted by find-references.test.ts using verify(useCase).deleteById("3").
  - verify(mock, never()).method(...) target call references are asserted by find-references.test.ts using verify(useCase, never()).deleteById("4").
  - verify(mock, times(1)).method(...) target call references are asserted by find-references.test.ts using verify(useCase, times(1)).deleteById("5").
  - Existing direct Java calls and simple Mockito behavior remain covered by the same Java interface method test and the existing Java method-reference tests.
- MINI-002 acceptance covered:
  - assertThatThrownBy(() -> service.method()) returns one invocation reference in find-references.test.ts.
  - assertDoesNotThrow(() -> service.method()) returns one invocation reference in find-references.test.ts.
  - Overlapping resolved-call and callback paths are addressed by top-level callback skipping plus span-aware dedupe and covered by assertion lambda tests.
  - Distinct same-method-body invocations remain distinct when spans differ, covered by the distinct() test expecting two references.
- MINI-003 acceptance covered:
  - find-references.test.ts covers all three Mockito verification variants as call references.
  - find-references.test.ts covers assertion lambda dedupe for assertThatThrownBy and assertDoesNotThrow.
  - function-call-tree-java.test.ts covers the Java extraction shape for Mockito wrappers and nested callback behavior without duplicate child calls.
  - Required validation passed: targeted suites, typecheck, and full Code Research test suite.

## Implementation Evidence Review
- code_find declaration lookup confirmed one extractMethodCalls declaration in /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/function-call-tree.ts with callback-node skipping during top-level method invocation traversal.
- code_find declaration lookup confirmed one unwrapMockitoReceiverInvocation declaration in /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/function-call-tree.ts that unwraps verify(...) receiver expressions by returning the first top-level verify argument.
- code_find declaration lookup confirmed one collectResolvedReferenceCalls declaration in /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts that recursively resolves callback calls and marks callback-origin references.
- code_find declaration lookup confirmed one dedupeReferences declaration in /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts using symbol, kind, file, start span, end span, and reference kind.
- Implementation remained within the Execution Scope paths from mini-sdd.md for reviewed code and tests. No implementation files were modified during verification.

## Issues & Required User Decision
- None.

## Skill Compliance
- Assigned skill applied: /home/j0k3r/.pi/agent/skills/subagent-artifact-contracts/SKILL.md
- Read apply.md first and used mini-sdd.md as Mini-SDD authority.
- Derived and verified the full Mini-SDD item set: MINI-001, MINI-002, MINI-003.
- Read only the assigned skill and delegated verification inputs.
- Wrote only the assigned verify.md output path.
- Verification artifact follows the verify.md, Workflow Status, and Handoff contracts.

## Post-Verification Continuity Snapshot
- Candidate/change slug: fix-java-mockito-and-dedupe
- Verification Result: PASS
- Workflow Status: READY
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-java-mockito-and-dedupe/mini-sdd.md
- Apply artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-java-mockito-and-dedupe/apply.md
- Verify artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-java-mockito-and-dedupe/verify.md
- Verified MINI set: MINI-001, MINI-002, MINI-003
- Independent validation commands:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts: PASS, 1 file, 45 tests
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/function-call-tree-java.test.ts: PASS, 1 file, 14 tests
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck: PASS
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test: PASS, 34 files, 267 tests
- Next permitted action: sdd-archive for fix-java-mockito-and-dedupe
