## Workflow Status
- Status: READY
- Blockers: None

## Goal
Make Java method reference extraction reliable in Mockito verification chains and remove duplicate Java references from nested lambda and assertion contexts for change slug fix-java-mockito-and-dedupe.

## Scope & Exclusions
In scope:
- Java method call extraction and resolution used by Code Research references and Java call flow under /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/function-call-tree.ts.
- Java method reference assembly and dedupe under /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts.
- Focused regression coverage under /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts and /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-java.test.ts.

Out of scope:
- Java type-reference expansion already completed in fix-java-type-references.
- TypeScript optional-chain work already completed in fix-ts-optional-chain-calls.
- workspace_graph_status, README, docs, generated artifacts, secrets, and broad refactors outside extensions/code-research/**.

## Execution Scope
- Root: /home/j0k3r/.pi/agent
- Allowed Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/function-call-tree.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-java.test.ts
- Writable Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/function-call-tree.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-java.test.ts
- Allowed Bash:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/function-call-tree-java.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test
- Notes: Keep implementation bounded to Java Mockito verification call extraction, Java reference dedupe, and directly relevant regression tests.

## MINI-001
- Contract: Extend Java method call extraction so Mockito verification chains contribute semantic call references for the verified target method, including verify(mock).method(...), verify(mock, never()).method(...), and verify(mock, times(1)).method(...).
- Acceptance:
  - code_find relation=references query=<method> kind=method reference_kinds=["call"] returns the target method from verify(mock).method(...).
  - code_find relation=references query=<method> kind=method reference_kinds=["call"] returns the target method from verify(mock, never()).method(...).
  - code_find relation=references query=<method> kind=method reference_kinds=["call"] returns the target method from verify(mock, times(1)).method(...).
  - Existing direct Java call references and simple Mockito verify(mock).method(...) behavior remain present after the change.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/code-research-sias-audit-discovery.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/function-call-tree.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/function-call-tree.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/function-call-tree-java.test.ts
- Depends on:
  - None

## MINI-002
- Contract: Deduplicate Java method references by stable tuple of target symbol id, source file, AST node span, and reference kind so nested lambda or assertion contexts emit one reference per actual invocation node without hiding distinct calls.
- Acceptance:
  - A Java invocation inside assertThatThrownBy(() -> service.method()) is returned once for the actual invocation node.
  - A Java invocation inside assertDoesNotThrow(() -> service.method()) is returned once for the actual invocation node.
  - Duplicate references caused by overlapping resolved-call and callback-regex paths are removed.
  - Distinct invocations in the same method body remain distinct results when their AST node spans differ.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/code-research-sias-audit-discovery.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/function-call-tree.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/function-call-tree.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Depends on:
  - MINI-001

## MINI-003
- Contract: Add focused Java regression fixtures and assertions covering Mockito verification chains and nested assertion or lambda dedupe in the direct reference path and the Java call extraction path used to resolve those references.
- Acceptance:
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts covers verify(mock).method(...), verify(mock, never()).method(...), and verify(mock, times(1)).method(...) as call references.
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts covers assertThatThrownBy(() -> service.method()) and assertDoesNotThrow(() -> service.method()) with one reference per actual invocation node.
  - /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-java.test.ts covers the Java extraction shape needed to preserve Mockito wrapper handling or nested callback behavior without duplicate child calls.
  - Targeted suites, typecheck, and full Code Research test suite pass after the fix lands.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/code-research-sias-audit-discovery.md
  - /home/j0k3r/.pi/agent/openspec/archive/2026-09-02/fix-java-type-references/verify.md
  - /home/j0k3r/.pi/agent/openspec/archive/2026-09-02/fix-ts-optional-chain-calls/verify.md
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-java.test.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/function-call-tree-java.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/function-call-tree.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/function-call-tree-java.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test
- Depends on:
  - MINI-001
  - MINI-002

## Risks & Constraints
- Java method references currently mix AST-resolved calls with a regex callback fallback, so dedupe must be strengthened without dropping legitimate callback or method_reference results.
- Mockito wrapper support must follow actual Java AST shapes and stay bounded to verification chains needed by this change.
- Keep the change inside Java call extraction and Java reference assembly; do not reopen type-reference work or cross-language behavior.

## Open Decisions
- None.

## Next Permitted Action
sdd-apply for fix-java-mockito-and-dedupe
