---
name: tdd
description: "guide change validation using the appropriate test and regression strategy. Use for behavior changes and bug fixes requiring RED-GREEN-REFACTOR, behavior-preserving refactors requiring baseline and regression evidence, mechanical changes requiring diff checks, existing-test discovery, or meaningful assertions."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.6"
registry:
  category: "quality"
  domains: "tdd, testing, regression-testing, test-organization"
  paths: "src/**, lib/**, app/**, packages/*/src/**, tests/**, test/**, spec/**, **/__tests__/**, **/*.test.*, **/*.spec.*"
  keywords: "tdd, test-driven development, red green refactor, write tests, add tests, update tests, adapt existing tests, remove obsolete tests, feature removal, delete functionality, regression test, failing test, test coverage, test baseline, assertion quality, test layer, mock hygiene, triangulation, characterization test, test organization, bug fix, fix a bug, fix bugs, fix this bug, bug in, bugfix, bug fix test"
  related: "workflow-triage"
  priority: 90
---

# TDD

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `paths`: glob-like project paths that should activate this skill.
- `keywords`: user/request/code keywords that should activate this skill.
- `phases`: phases where this skill is usually useful: `explore`, `proposal`, `spec`, `design`, `task`, `apply`, `verify`, `archive`.
- `related`: skills that should be considered when this skill is active.
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

### Safety baseline and pre-existing failures

- Before modifying existing production behavior, run the narrowest established tests that currently exercise the affected surface when the environment is available.
- Record enough baseline evidence to distinguish existing failures from regressions introduced by the change; exact test counts are useful when the runner provides them but are not mandatory.
- Do not silently fix unrelated or pre-existing failures. Report them and continue only when they do not invalidate the focused TDD evidence or when the user approves the necessary scope.
- A missing or unreliable baseline is a risk to report, not a reason to invent replacement tests that do not exercise the affected behavior.

### Test framework ownership

- Detect the active test framework from repository evidence: dependency manifests, lockfiles, test configuration, task scripts, imports, and existing test files.
- If one framework is clearly established for the relevant test layer, reuse it without asking the user to choose again.
- If different frameworks are intentionally used for different layers, use the framework already assigned to the relevant layer.
- Do not install, replace, upgrade, or configure a test framework without explicit user approval.
- If no test framework or test infrastructure exists, stop before writing tests and ask the user to choose. The agent may present stack-appropriate options and trade-offs, but the user owns the decision.

### Test layer and dependency boundaries

- Choose the test layer that can demonstrate the agreed observable behavior with the least unnecessary coupling, following the repository's existing layer conventions.
- Prefer unit tests for isolated logic, integration tests for meaningful component or service boundaries, and end-to-end tests for critical user journeys or external contracts.
- Do not automatically choose the highest or lowest available layer. A faster layer is not a valid substitute when it cannot prove the same contract.
- If the appropriate layer is unavailable, do not hide the gap behind mocks. Use a narrower layer only when it still provides meaningful evidence; otherwise report the blocked validation and ask for a strategy when material.
- Prefer pure functions when they naturally express domain logic and improve design. Do not extract production code solely to make an internal implementation detail easier to test.

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

### Evidence by development context

- `greenfield`: start from the first observable contract and avoid testing speculative architecture.
- `legacy-continuation`: establish characterization for important existing behavior before changing it; preserve required compatibility and expose known debt separately.
- `migration`: test source and target invariants, compatibility/cutover behavior, and rollback or recovery where applicable.
- `feature`: drive the new acceptance behavior plus relevant compatibility boundaries.
- `bugfix`: reproduce the defect with a failing regression test, then make the smallest sufficient correction.
- `refactor`: prove behavior preservation before and after structural changes; do not hide new behavior in the refactor.
- `removal`: remove tests/support owned exclusively by obsolete behavior and retain meaningful absence/dependency evidence.

### Assertion quality and mock hygiene

- Each test claimed as behavioral evidence must exercise a relevant runtime or compile-time production contract, assert a specific meaningful outcome, and be capable of failing when that contract is wrong.
- Do not count tautologies, incidental type/existence-only checks, render-without-behavior smoke checks, or assertions inside potentially empty loops as behavioral coverage. Type, schema, existence, or smoke tests remain valid when that limited contract is explicitly the intended outcome.
- Empty or negative results are valid when the setup intentionally produces them and the production path actually runs; do not require a companion test mechanically when equivalent positive behavior is already covered elsewhere.
- Prefer observable outputs and contracts over internal state, incidental call counts, private symbols, or styling implementation. Internal or visual details may be asserted when they are explicitly part of the product contract and the chosen test layer is appropriate.
- Use the fewest mocks needed to isolate the owned behavior. Heavy mock setup is a signal to reconsider the layer or design, not an automatic failure based on an arbitrary numeric threshold.

### Behavior ownership and feature removal

- Tests are executable contracts for current application behavior, not historical artifacts or coverage placeholders.
- When an approved change removes a feature, delete the tests that exclusively specify that removed behavior in the same change. Do not preserve or replace them with artificial tests for functionality that no longer exists.
- If a test mixes removed and retained behavior, update it narrowly: remove obsolete scenarios and assertions while preserving coverage for behavior that still exists.
- Remove or update test-only fixtures, mocks, snapshots, helpers, and data that become orphaned by the feature removal.
- Do not add tests merely to compensate for deleted test counts or coverage percentages. There is no universal requirement that every code change add a test; test only real, supported behavior and meaningful product contracts.
- Test a feature's absence only when that absence is an observable product contract, such as a retired route returning the agreed status or a removed option being rejected. Do not test implementation trivia such as a deleted private symbol or file no longer existing.
- After removing obsolete tests, run the relevant broader suite to detect retained behavior that depended unexpectedly on the removed feature.

### Change-type validation

- Define the expected outcome before changing code and classify the change as adding behavior, changing behavior, fixing a bug, preserving behavior through refactoring, removing behavior, mechanical/generated code, or documentation/configuration.
- Use RED → GREEN → REFACTOR for added or changed behavior, bug fixes, and observable absence contracts.
- Use BASELINE → REFACTOR → REGRESSION for behavior-preserving refactors; do not manufacture a failing test when no behavior should change.
- Use BASELINE → CHANGE → DIFF/REGRESSION for mechanical or generated code changes.
- Use structural, syntax, schema, link, consistency, or focused smoke validation for documentation and configuration without artificial product-code tests.
- For added or changed supported behavior, RED: add or adapt the narrowest relevant test, run it, and confirm that it fails for the expected behavioral reason.
- If the test passes before the implementation change, it does not yet demonstrate the missing behavior. Improve the test or explain why the reported issue cannot be reproduced; do not claim RED.
- For a pure feature removal with no meaningful observable absence contract, do not manufacture a new failing test. Use the existing feature tests to identify the removal boundary, delete obsolete tests with the production behavior, update shared tests, and validate the broader suite.
- When feature absence is itself an observable contract, adapt the closest relevant test and apply normal RED-GREEN evidence to that contract.
- GREEN: implement the smallest production change that makes the focused test pass, or complete the smallest approved removal that leaves only tests for supported behavior, then run the relevant validation.
- REFACTOR: improve structure only after GREEN, without weakening assertions or changing the agreed behavior, then rerun relevant validation.
- Do not alter a valid expectation merely to make the implementation pass; delete an expectation only when its owning behavior is explicitly being removed.
- Use established project commands; this skill must not invent or standardize language-specific commands.

### Selective triangulation and characterization

- Add another case when the first could pass through hardcoding, misses a meaningful branch or boundary, or the approved scenarios require materially different inputs and outcomes.
- Do not impose a minimum number of tests per behavior. One strong case can be sufficient when it proves the complete contract; multiple weak cases do not add confidence.
- Before a behavior-preserving refactor, inspect existing coverage and add characterization tests only for important behavior that is not already protected.
- Characterization tests preserve behavior that must remain stable; they must not entrench behavior the approved change explicitly intends to correct or remove.
- After each meaningful refactor step, rerun the narrowest relevant tests; broaden validation when structural changes affect wider boundaries.

### Security and negative assurance

- When the approved behavior protects secrets, authorization, persistence, process identity/signals, concurrency, filesystem containment, migrations, or destructive operations, include negative/adversarial evidence for the prohibited outcome, not only a happy-path assertion.
- Test the exact approved mechanism when that mechanism is normative and externally or operationally observable. An outcome-equivalent implementation test must not hide a forbidden substitution.
- Examples include proving that secrets are absent from files, argv, and process environments; mismatched identities receive zero signals; replacement processes are not spawned before confirmed stop; symlink escapes fail closed; malformed persisted identities are rejected; and separate OS processes cannot overlap a serialized transaction.
- If the required negative evidence cannot be produced, report the requirement as blocked or residual risk. Passing positive tests alone is not GREEN for that safety contract.

### Scope and evidence

- Keep test changes within the approved behavior and test layer.
- Run the narrowest useful test during RED and GREEN when they apply; for pure removals, run the relevant broader suite after obsolete test cleanup.
- Preserve concise evidence for the safety baseline, selected layer and test file, RED failure reason when applicable, GREEN or removal result, obsolete test/support cleanup, and post-refactor validation.
- Passing tests are validation evidence, not permission to commit or reorganize additional files.

## Decision Gates

Stop and ask the user when:

- no test framework or infrastructure exists;
- multiple frameworks could own the same test layer and repository evidence does not resolve the choice;
- pre-existing failures or a missing test environment materially prevent trustworthy focused evidence;
- the test layer needed to prove the agreed contract is unavailable and a narrower layer would not provide equivalent evidence;
- relevant tests are colocated with production code and migration to a dedicated mirrored tree has not been decided;
- the appropriate existing test file needs a structural split before it can accept the new scenario cleanly;
- existing tests encode behavior that conflicts with the requested expectation, unless they exclusively own an explicitly approved feature removal;
- RED is required for added, changed, bug-fix, or observable-absence behavior but cannot be demonstrated because the issue is not reproducible, the environment is unavailable, or required fixtures/dependencies are missing;
- satisfying the request would require installing dependencies, changing the framework, moving unrelated tests, or expanding scope.

When asking about colocated tests, present both choices explicitly: migrate the agreed tests to the dedicated mirrored tree, or adapt them in place without treating that choice as a permanent convention.

## Execution Steps

1. Confirm the expected behavior and affected production surface; classify the change as adding, changing, removing, or preserving behavior through refactoring.
2. Detect the existing test framework, commands, roots, naming patterns, and available test layers from repository evidence.
3. Map the affected source path or behavior to candidate existing tests before creating anything.
4. When modifying existing behavior, run the narrowest relevant baseline and separate pre-existing failures from task regressions.
5. Choose the layer that can prove the contract without unnecessary coupling, then select the closest semantically responsible test file; if none qualifies, justify a new file under the dedicated mirrored test tree.
6. For feature removal, inventory tests and test-only support artifacts owned exclusively by the removed behavior, shared tests that need narrowing, and any real observable absence contract.
7. For behavior-preserving refactors, confirm existing coverage and add characterization only for important uncovered behavior.
8. Resolve any baseline, framework, layer, colocation, migration, oversized-file, or conflicting-expectation decision gate with the user.
9. Apply the classified evidence path: RED for added, changed, bug-fix, or observable-absence behavior; BASELINE for behavior-preserving refactors or mechanical/generated code; structural baseline for documentation/configuration; or a recorded non-applicability reason for pure removal without an absence contract.
10. Complete the matching change step: GREEN for behavior changes, the approved REFACTOR for behavior preservation, the bounded mechanical/generated CHANGE, the structural documentation/configuration change, or the smallest approved removal.
11. Triangulate only when another case is needed to defeat a trivial implementation, exercise a meaningful branch, or cover another approved scenario.
12. REFACTOR only when useful, keeping responsibilities cohesive and removing duplication; rerun validation after meaningful steps.
13. For safety/security behavior, run the required negative/adversarial cases and confirm they fail when the exact control is absent.
14. Run the relevant broader suite when practical and review assertions, mocks, changed test paths, obsolete coverage, orphaned artifacts, mirrored organization, and accidental duplication.
15. Report evidence, decisions, risks, and any validation that could not run.

## Output Contract

Return:

- Skill applied: `tdd`.
- Expected behavior and affected test layer.
- Existing test candidates inspected and the files selected for adaptation or deletion, or the reason a new file was necessary.
- Detected framework, safety baseline, selected test layer, and repository evidence supporting those choices.
- Location of retained or new tests and how they mirror the production source structure; include any user decision about colocated tests.
- The selected change type and evidence path: RED/GREEN/REFACTOR, BASELINE/REFACTOR/REGRESSION, BASELINE/CHANGE/DIFF-REGRESSION, structural validation, or justified pure-removal evidence.
- Commands/results for each applicable step and the post-change broader validation.
- For feature removals, obsolete tests and support artifacts deleted or updated, shared coverage preserved, and any observable absence contract retained.
- Assertion quality, mock usage, triangulation, duplication, size, and obsolete-coverage review, with remaining risks, blocked checks, and decisions still needed.
- Explicit confirmation that no framework, migration, or commit was performed without approval.

## References

- `AGENTS.md` — approval boundaries, change-type validation, code inspection, review, and Git policy.
- `skills/workflow-triage/SKILL.md` — mandatory workflow selection before non-trivial implementation.
- Project-local dependency manifests, test configuration, scripts, and existing tests — authoritative runtime evidence for framework and organization choices.
