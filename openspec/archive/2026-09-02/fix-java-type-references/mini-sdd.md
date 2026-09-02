## Workflow Status
- Status: READY
- Blockers: None

## Goal
Make Java code_find relation=references reliable for class, record, DTO, and utility type usages in Code Research so supported semantic type references are no longer missed.

## Scope & Exclusions
- In scope:
  - Extend Java type reference extraction in Code Research for imports, field types, method parameter types, method return types, constructor calls, generic type arguments, record constructor calls, and static member or class-qualified usages.
  - Use bounded Java index metadata updates only if required to locate or label those references precisely.
  - Add or update focused regression coverage in Code Research tests for class and record or DTO reference cases.
- Exclusions:
  - TypeScript optional-chain work.
  - Java Mockito verification and Java dedupe work.
  - workspace_graph_status, README, or user-facing docs changes.
  - Unrelated Pi extensions, generated artifacts, secrets, and broad refactors.

## Execution Scope
- Root: /home/j0k3r/.pi/agent
- Allowed Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/**
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/project-index.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- Writable Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/**
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/project-index.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- Allowed Bash:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test
- Notes: Keep implementation bounded to Java reference extraction and index metadata needed for semantic type references, plus the directly relevant regression tests.

### MINI-001: Add Java method-signature type references
- Contract: Extend Java type reference extraction so class or interface reference queries include method parameter type usages, method return type usages, and supported generic type argument usages without changing declaration lookup behavior.
- Acceptance:
  - code_find relation=references for a Java class or interface includes method parameter type references.
  - code_find relation=references for a Java class or interface includes method return type references.
  - code_find relation=references for a Java class or interface includes supported generic type argument references in method signatures or field declarations.
  - code_find relation=declaration still resolves the exact declaration file and line for the queried type.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/code-research-sias-audit-discovery.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/project-index.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/project-index.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Depends on:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/code-research-sias-audit-discovery.md

### MINI-002: Capture constructor and class-qualified Java type usages
- Contract: Extend Java type reference extraction so class queries include constructor and record constructor usages plus static member or class-qualified references that semantically use the target type.
- Acceptance:
  - code_find relation=references for a Java class includes constructor calls and record constructor calls for the target type.
  - code_find relation=references for a Java class includes static utility or class-qualified usages of the target type when the class name is the semantic owner.
  - Existing import, extends, implements, and field-type references remain present after the change.
  - No string-only or test-description text matches are emitted as semantic references.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/code-research-sias-audit-discovery.md
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
- Depends on:
  - MINI-001
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md

### MINI-003: Add bounded Java class and record or DTO regression coverage
- Contract: Add or update focused Code Research tests that prove the supported Java type-reference cases in direct and graph-backed reference flows remain aligned for the new semantic coverage.
- Acceptance:
  - Regression coverage includes import, field type, method parameter type, method return type, constructor call, generic type argument, and static utility or class-qualified usage for a Java class fixture.
  - Regression coverage includes record constructor usage plus nested DTO or generic usage for a Java record or DTO fixture.
  - The targeted Java references test fails before the implementation and passes after it.
  - Full Code Research test suite and typecheck pass after the targeted fix lands.
- Canonical sources:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/code-research-sias-audit-discovery.md
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- Paths:
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/src/core/project-index.ts
- Validation:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test
- Depends on:
  - MINI-001
  - MINI-002

## Risks & Constraints
- Keep the change inside extensions/code-research Java reference extraction, index metadata, and the directly relevant tests.
- Preserve existing declaration resolution and already-covered Java references such as imports, extends, implements, field types, and simple instantiation.
- Prefer bounded metadata or source-span additions over parser-wide or cross-language refactors.
- Do not broaden reference matching into plain-text or string-literal search behavior.

## Open Decisions
- None.

## Next Permitted Action
sdd-apply for fix-java-type-references
