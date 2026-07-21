---
name: tdd
description: "guide language-agnostic test-driven changes with existing-test discovery, framework reuse, mirrored test-tree organization, regression coverage, feature-removal cleanup, and red-green-refactor evidence."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.1"
---

# TDD

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "quality",
  "domains": ["tdd", "testing", "regression-testing", "test-organization"],
  "triggers": {
    "paths": [
      "src/**",
      "lib/**",
      "app/**",
      "packages/*/src/**",
      "tests/**",
      "test/**",
      "spec/**",
      "**/__tests__/**",
      "**/*.test.*",
      "**/*.spec.*"
    ],
    "keywords": [
      "tdd",
      "test-driven development",
      "red green refactor",
      "write tests",
      "add tests",
      "update tests",
      "adapt existing tests",
      "remove obsolete tests",
      "feature removal",
      "delete functionality",
      "eliminar funcionalidad",
      "eliminar tests obsoletos",
      "regression test",
      "failing test",
      "test coverage",
      "test organization",
      "bug fix",
      "fix this bug",
      "bugfix",
      "bug fix test",
      "corrige este bug",
      "arregla este bug",
      "pruebas",
      "agregar test",
      "adaptar tests",
      "tests repetidos",
      "organizar tests"
    ]
  },
  "sdd_phases": ["explore", "design", "task", "apply", "verify"],
  "related_skills": [
    "workflow-triage"
  ],
  "priority": 90
}
```

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `triggers.paths`: glob-like project paths that should activate this skill.
- `triggers.keywords`: user/request/code keywords that should activate this skill.
- `sdd_phases`: phases where this skill is usually useful: `explore`, `proposal`, `spec`, `design`, `task`, `apply`, `verify`, `archive`.
- `related_skills`: skills that should be considered when this skill is active.
- `priority`: choose from 0 to 100. Higher means consider earlier when multiple skills match.

## Activation Contract

Use this skill for behavior-changing code work, bug fixes, regression fixes, feature removals, refactors with behavior risk, or explicit requests to add, update, remove, organize, or review tests. Apply it regardless of programming language or test framework.

Load it after `workflow-triage` selects the execution route. This skill governs test discipline; it does not grant permission to investigate, implement, reorganize files, install dependencies, or commit changes.

Do not load it for answer-only questions, read-only investigation with no test design requested, or prose-only documentation changes with no executable behavior.

## Hard Rules

### Existing tests first

- Before creating or editing a test, inspect the project's test manifests, configuration, scripts, imports, directory conventions, and existing tests related to the affected behavior.
- For a fix or bug, first identify whether an existing test file owns the affected production module, feature, behavior, or regression surface.
- Prefer adapting the closest relevant test file. Do not create a parallel test file merely to isolate one new case, one fix, or one agent task.
- Create a new test file only when no existing file semantically owns the behavior, the relevant test layer is absent, or adding the case to an existing file would violate a clear responsibility boundary.
- Before creating a file, state which existing candidates were checked and why none is suitable.
- Never duplicate an existing scenario, fixture, helper, setup block, or assertion pattern when the existing one can be extended safely.

### Test framework ownership

- Detect the active test framework from repository evidence: dependency manifests, lockfiles, test configuration, task scripts, imports, and existing test files.
- If one framework is clearly established for the relevant test layer, reuse it without asking the user to choose again.
- If different frameworks are intentionally used for different layers, use the framework already assigned to the relevant layer.
- Do not install, replace, upgrade, or configure a test framework without explicit user approval.
- If no test framework or test infrastructure exists, stop before writing tests and ask the user to choose. The agent may present stack-appropriate options and trade-offs, but the user owns the decision.

### Dedicated mirrored test tree

- Keep tests under a dedicated test tree outside production source directories, mirroring the production structure relative to its source root.
- Reuse the project's established dedicated root name, such as `tests/`, `test/`, or `spec/`. If none exists, propose `tests/` unless the user chooses another name.
- Preserve framework-specific filenames while mirroring directories. For example, `src/domain/cart/service.*` maps conceptually to `tests/domain/cart/service.<test-suffix>.*`.
- In a monorepo, preserve the owning package boundary and follow an existing package-level test root when one exists.
- If relevant tests are colocated with production code, do not move them silently. Ask whether the user wants to migrate them to a dedicated mirrored test tree or adapt them in place for the current task.
- A migration approval applies only to the agreed scope. Do not reorganize unrelated tests as a side effect.

### Cohesion, size, and duplication

- Organize test files by stable production responsibility or coherent behavior, not by bug ticket, implementation session, individual test case, or agent task.
- Do not create one file per case, and do not force unrelated responsibilities into one file merely to reduce file count.
- Extend existing suites, nested contexts, fixtures, helpers, or parameterized/table-driven cases when they express the new scenario clearly without duplication.
- Before adding a case, check for equivalent inputs, assertions, setup, and behavior coverage.
- If the correct test file is already excessively large or mixes responsibilities, do not append blindly and do not create a duplicate parallel file. Propose a cohesive split and ask for approval before performing that structural refactor.
- Split by responsibility, behavior boundary, or test layer rather than by arbitrary line count.

### Behavior ownership and feature removal

- Tests are executable contracts for current application behavior, not historical artifacts or coverage placeholders.
- When an approved change removes a feature, delete the tests that exclusively specify that removed behavior in the same change. Do not preserve or replace them with artificial tests for functionality that no longer exists.
- If a test mixes removed and retained behavior, update it narrowly: remove obsolete scenarios and assertions while preserving coverage for behavior that still exists.
- Remove or update test-only fixtures, mocks, snapshots, helpers, and data that become orphaned by the feature removal.
- Do not add tests merely to compensate for deleted test counts or coverage percentages. There is no universal requirement that every code change add a test; test only real, supported behavior and meaningful product contracts.
- Test a feature's absence only when that absence is an observable product contract, such as a retired route returning the agreed status or a removed option being rejected. Do not test implementation trivia such as a deleted private symbol or file no longer existing.
- After removing obsolete tests, run the relevant broader suite to detect retained behavior that depended unexpectedly on the removed feature.

### Red, green, refactor

- Define the expected behavior before changing code and classify the change as adding, changing, or removing behavior.
- For added or changed supported behavior, RED: add or adapt the narrowest relevant test, run it, and confirm that it fails for the expected behavioral reason.
- If the test passes before the implementation change, it does not yet demonstrate the missing behavior. Improve the test or explain why the reported issue cannot be reproduced; do not claim RED.
- For a pure feature removal with no meaningful observable absence contract, do not manufacture a new failing test. Use the existing feature tests to identify the removal boundary, delete obsolete tests with the production behavior, update shared tests, and validate the broader suite.
- When feature absence is itself an observable contract, adapt the closest relevant test and apply normal RED-GREEN evidence to that contract.
- GREEN: implement the smallest production change that makes the focused test pass, or complete the smallest approved removal that leaves only tests for supported behavior, then run the relevant validation.
- REFACTOR: improve structure only after GREEN, without weakening assertions or changing the agreed behavior, then rerun relevant validation.
- Do not alter a valid expectation merely to make the implementation pass; delete an expectation only when its owning behavior is explicitly being removed.
- Use established project commands; this skill must not invent or standardize language-specific commands.

### Scope and evidence

- Keep test changes within the approved behavior and test layer.
- Run the narrowest useful test during RED and GREEN when they apply; for pure removals, run the relevant broader suite after obsolete test cleanup.
- Preserve concise evidence for the selected test file, framework, RED failure reason when applicable, GREEN or removal result, obsolete test/support cleanup, and post-refactor validation.
- Passing tests are validation evidence, not permission to commit or reorganize additional files.

## Decision Gates

Stop and ask the user when:

- no test framework or infrastructure exists;
- multiple frameworks could own the same test layer and repository evidence does not resolve the choice;
- relevant tests are colocated with production code and migration to a dedicated mirrored tree has not been decided;
- the appropriate existing test file needs a structural split before it can accept the new scenario cleanly;
- existing tests encode behavior that conflicts with the requested expectation, unless they exclusively own an explicitly approved feature removal;
- RED is required for added, changed, or observable-absence behavior but cannot be demonstrated because the issue is not reproducible, the environment is unavailable, or required fixtures/dependencies are missing;
- satisfying the request would require installing dependencies, changing the framework, moving unrelated tests, or expanding scope.

When asking about colocated tests, present both choices explicitly: migrate the agreed tests to the dedicated mirrored tree, or adapt them in place without treating that choice as a permanent convention.

## Execution Steps

1. Confirm the expected behavior and affected production surface; classify the change as adding, changing, or removing behavior.
2. Detect the existing test framework, commands, roots, naming patterns, and test layers from repository evidence.
3. Map the affected source path or behavior to candidate existing tests before creating anything.
4. For added or changed behavior, select the closest semantically responsible test file; if none qualifies, justify a new file under the dedicated mirrored test tree.
5. For feature removal, inventory tests and test-only support artifacts owned exclusively by the removed behavior, shared tests that need narrowing, and any real observable absence contract.
6. Resolve any framework, colocation, migration, oversized-file, or conflicting-expectation decision gate with the user.
7. RED for added, changed, or observable-absence behavior: adapt or create the approved test and confirm the expected failure with the narrowest relevant command. For a pure removal without such a contract, record why RED is not applicable rather than creating an artificial test.
8. GREEN: make the smallest implementation change or approved removal, delete obsolete tests and support artifacts, update shared tests, and confirm the focused validation passes when applicable.
9. REFACTOR only when useful, keeping responsibilities cohesive and removing duplication; rerun validation.
10. Run the relevant broader suite when practical and review changed test paths for obsolete coverage, orphaned artifacts, mirrored organization, and accidental duplication.
11. Report evidence, decisions, risks, and any validation that could not run.

## Output Contract

Return:

- Skill applied: `tdd`.
- Expected behavior and affected test layer.
- Existing test candidates inspected and the files selected for adaptation or deletion, or the reason a new file was necessary.
- Detected framework and repository evidence supporting its use.
- Location of retained or new tests and how they mirror the production source structure; include any user decision about colocated tests.
- RED command/result and expected failure reason, or why RED correctly did not apply to a pure removal.
- GREEN or removal command/result and post-refactor or broader validation.
- For feature removals, obsolete tests and support artifacts deleted or updated, shared coverage preserved, and any observable absence contract retained.
- Duplication/size/obsolete-coverage review, remaining risks, blocked checks, and decisions still needed.
- Explicit confirmation that no framework, migration, or commit was performed without approval.

## References

- `AGENTS.md` — approval boundaries, strict TDD, code inspection, review, and Git policy.
- `skills/workflow-triage/SKILL.md` — mandatory workflow selection before non-trivial implementation.
- Project-local dependency manifests, test configuration, scripts, and existing tests — authoritative runtime evidence for framework and organization choices.
