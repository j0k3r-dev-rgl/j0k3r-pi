---
name: tdd
description: "guide test-driven development (TDD) and regression strategy. Use for behavior changes, bug fixes, reproducing bugs with failing RED tests, risky refactors, RED-GREEN-REFACTOR cycles, and test baseline validation."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "3.4"
registry:
  category: "quality"
  domains: "tdd, testing, regression-testing"
  paths: "src/**, lib/**, app/**, packages/*/src/**, tests/**, test/**, spec/**, **/__tests__/**, **/*.test.*, **/*.spec.*"
  keywords: "tdd, red green refactor, regression test, failing test, characterization test, test layer, bug fix test, feature removal test"
  phases: "apply"
  related: "workflow-triage"
  priority: 90
---

# TDD

## Activation Contract

Use this skill for behavior-changing code work, bug fixes, feature removals, risky refactors, or explicit test work. Load it after the workflow is known.

Do not load it for advice-only conversations or prose-only documentation changes.

## Canonical Scope

This skill owns:

- test strategy for the approved change;
- choice of test-first or regression validation method;
- reuse of existing tests and frameworks; and
- a concise final validation summary, not a TDD audit trail.

It does not own workflow choice, repository-wide reorganization, dependency installation, or commit authority.

## Hard Rules

- Reuse the established test framework and layer from repository evidence.
- Inspect existing tests before creating a new test file.
- Prefer adapting the closest owning test file.
- Keep production code and tests in separate directories (`src/` and `test/`, or the repository's existing separate test root such as `tests/`). Never create new colocated test files inside production source directories (`src/`, `lib/`, `app/`, etc.), unless the language or toolchain strictly requires same-directory test files (for example, Go `*_test.go` package tests) or the user explicitly instructs otherwise. Mirror the source structure under the dedicated test directory when creating new test files; default to `test/` when no separate test root exists yet.
- Do not create duplicate test files, scenarios, fixtures, or helpers.
- Run the narrowest useful baseline before changing existing behavior when the environment allows it.
- Separate pre-existing failures from regressions introduced by the task.
- Ask before changing frameworks, installing dependencies, or migrating colocated tests.
- Prefer the smallest test layer that can prove the required contract without hiding it behind mocks.
- For feature removal, delete obsolete tests and keep only coverage for supported behavior.
- For security or safety-sensitive behavior, include tests for the prohibited outcome.
- Execute TDD for behavior changes: observe the expected behavior fail before implementing the fix, then make the test pass and refactor as needed. Compilation failures and broken mocks are not behavior RED.
- Follow `AGENTS.md`'s distinction between mandatory TDD execution and compact final reporting: do not save cycle-by-cycle proof or reconstruct an earlier RED. Do not weaken production behavior or tests to manufacture a pass.

## Validation Methods

- **Behavior change or bug fix** → RED → GREEN → REFACTOR.
- **Verification remediation (defects from failed `verify.md`)** → treat each behavioral defect as a bug fix: reproduce it with a failing regression test (RED) before fixing production code (GREEN).
- **Behavior-preserving refactor** → BASELINE → REFACTOR → REGRESSION.
- **Mechanical/generated change** → BASELINE → CHANGE → DIFF/REGRESSION.
- **Documentation/config only** → structural validation.
- **Pure removal with no observable absence contract** → remove obsolete tests, then run relevant regression coverage.
- **Staged / parallel apply (`Preparation` / `Parallel Units` / `Integration`)**:
  - `Preparation` (shared contracts/types/schemas): structural, type, or schema validation (plus contract tests when behavior exists).
  - `Parallel Unit`: execute RED → GREEN → REFACTOR with focused tests inside the unit's own writable and validation scope against pinned Project Contracts or local doubles as needed; do not run repo-wide or shared-resource suites owned by Integration.
  - `Integration`: validate real joined provider/consumer behavior beyond mocks (using RED → GREEN for integration gaps) and run the planned integrated regression command once.

## Decision Gates

Stop and trigger the decision protocol when:

- no usable test framework or environment exists;
- multiple frameworks plausibly own the same layer;
- unrelated failures prevent running even the narrow baseline for the touched area;
- the correct test layer is unavailable;
- existing relevant tests are colocated inside production directories and migrating them to the separate test directory is undecided (never create new colocated tests or silently migrate existing ones);
- the right existing file needs a structural split first; or
- the behavior needed for the current test-first change cannot be reproduced or tested.

These gates concern actual execution and validation, not missing records from earlier TDD cycles.

- **Circuit Breaker**: When any of the test gates above are triggered:
  - **Subagent execution**: stop dependent work and report the exact test failure, missing environment, or irreproducible condition through `ask_orchestrator` when available; wait in the same session. Return `BLOCKED` if no channel or resolution is available. Never skip required tests, fake results, treat an explanation as a passing check, or mark implementation ready without required validation.
  - **Orchestrator execution**: stop immediately, report the test blocker concisely, and ask the user for the missing decision before modifying code.

## Execution Steps

1. Classify the change type.
2. Detect the existing test framework, commands, roots, and candidate owner files.
3. Run the narrowest baseline when needed.
4. Select the owning test file in the separate test directory (`test/` or the repository's existing separate test root) or justify a new one there mirroring source structure; stop if writable scope omits the separate test root.
5. Execute the matching validation method; confirm behavior RED during the work, without recording a TDD chronology.
6. Run focused validation, then relevant broader regression checks.
7. Report only final validation commands/results and unresolved risks in the normal task artifact or response.

## Output Contract

Use the governing task's output format; do not append a separate skill report. Include only a compact final validation summary: commands actually run, outcomes (including failures or skips), and any unresolved risk or blocker. Reference existing reports only when needed to understand an issue. Do not report RED/GREEN chronology, raw logs, inspected-test inventories, or per-cycle evidence.

## References

- `AGENTS.md`
- `skills/workflow-triage/SKILL.md`
