## Workflow Status
- Status: READY
- Blockers: None

## Workflow & Contracts
- Change slug: fix-java-type-references
- Change type: Mini-SDD apply
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-java-type-references/mini-sdd.md
- Scope source artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-java-type-references/mini-sdd.md, ## Execution Scope
- Artifact contract: /home/j0k3r/.pi/agent/skills/subagent-artifact-contracts/SKILL.md
- Assigned skill read: /home/j0k3r/.pi/agent/skills/subagent-artifact-contracts/SKILL.md

## Authorization Record
- Authorized by: user
- Authorization reference: delegated task message quoting user instruction “si no hay bloqueos avanza sin preguntar ... archiva y haz commit avanzando automaticamente al otro mini-sdd”
- Authorized action: apply Mini-SDD change automatically when no blockers exist
- Authorized scope: fix-java-type-references Execution Scope from /home/j0k3r/.pi/agent/openspec/changes/fix-java-type-references/mini-sdd.md
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-java-type-references/mini-sdd.md
- Candidate/change slug: fix-java-type-references

### MINI-001 Evidence: Add Java method-signature type references
- Status: Complete
- Implementation evidence: /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts adds AST-backed Java type-reference collection for `type_identifier` and `scoped_type_identifier` nodes, with import/package-aware matching and method/class context metadata.
- Regression evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts adds coverage for Java method parameter types, method return types, and generic type arguments in signatures/fields.
- Declaration behavior: declaration lookup code and Java project-index declaration extraction were not changed.
- Validation:
  - `cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts` passed: 43 tests passed.
  - `cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck` passed.

### MINI-002 Evidence: Capture constructor and class-qualified Java type usages
- Status: Complete
- Implementation evidence: /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts keeps existing constructor matching, treats Java records as class-query targets, and adds AST-backed class-qualified `method_invocation`/`field_access` references without scanning string literals.
- Regression evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts covers constructor usage, record constructor usage, class-qualified static utility usage, and asserts string text is not returned as a semantic reference.
- Compatibility evidence: existing Java import, extends, implements, field-type, diamond instantiation, owner identity, and metadata tests pass in the targeted suite.
- Validation:
  - `cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts` passed: 43 tests passed.
  - `cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck` passed.

### MINI-003 Evidence: Add bounded Java class and record or DTO regression coverage
- Status: Complete
- Implementation evidence: /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts adds focused Java class and record/DTO fixtures covering import, field type, method parameter type, method return type, constructor call, generic type argument, static/class-qualified usage, record constructor usage, and nested DTO generic usage.
- Direct/graph evidence: new tests exercise direct roots and graph-enabled roots with direct fallback comparison for the Java type-reference cases.
- Attempt evidence: an intermediate targeted run failed before final fixes due extra duplicate/incorrect context handling; subsequent implementation adjustments made the targeted suite pass.
- Validation:
  - `cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts` passed: 43 tests passed.
  - `cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck` passed.
  - `cd /home/j0k3r/.pi/agent/extensions/code-research && npm test` passed: 34 files passed, 263 tests passed.

## Approved Deviations
- None.

## Attempt Record
- Inspected Mini-SDD authority and artifact contract.
- Confirmed workspace graph status before TS/Java symbol lookups: fresh and usable.
- Used code_find to inspect the Java reference implementation surface.
- Updated only approved implementation/test paths.
- Validation attempts:
  - `cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts` failed during implementation, then passed after remediation.
  - `cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck` initially failed on unsupported `Array.findLast`, then passed after remediation.
  - `cd /home/j0k3r/.pi/agent/extensions/code-research && npm test` passed.

## Candidate Identity
- Candidate/change slug: fix-java-type-references
- Modified implementation files:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- Output artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-java-type-references/apply.md

## Residual Risks
- Java semantic type reference extraction remains heuristic/AST-node based and bounded to the supported cases in the Mini-SDD; unusual Java grammar constructs outside the covered cases may need future dedicated coverage.
- Graph-backed class reference behavior still relies on existing direct-fallback comparison support for these tests.

## Verification Inputs
- Authority artifact: /home/j0k3r/.pi/agent/openspec/changes/fix-java-type-references/mini-sdd.md
- Supporting artifacts:
  - /home/j0k3r/.pi/agent/code-research-sias-audit-remediation.md
  - /home/j0k3r/.pi/agent/code-research-sias-audit-discovery.md
- Files to review:
  - /home/j0k3r/.pi/agent/extensions/code-research/src/languages/java/find-references.ts
  - /home/j0k3r/.pi/agent/extensions/code-research/test/find-references.test.ts
- Validation commands:
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npx vitest run test/find-references.test.ts
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm run typecheck
  - cd /home/j0k3r/.pi/agent/extensions/code-research && npm test

## Next Permitted Action
sdd-verify for fix-java-type-references
