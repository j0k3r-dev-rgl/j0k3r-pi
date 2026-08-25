---
name: tdd
description: "guide test and regression strategy for code changes. Use for behavior changes, bug fixes, risky refactors, removals, and validation planning."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "2.0"
registry:
  category: "quality"
  domains: "tdd, testing, regression-testing"
  paths: "src/**, lib/**, app/**, packages/*/src/**, tests/**, test/**, spec/**, **/__tests__/**, **/*.test.*, **/*.spec.*"
  keywords: "tdd, red green refactor, regression test, failing test, characterization test, test layer, bug fix test, feature removal test"
  phases: "task, apply, verify"
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
- choice of evidence path;
- reuse of existing tests and frameworks; and
- concise validation reporting.

It does not own workflow choice, repository-wide reorganization, dependency installation, or commit authority.

## Hard Rules

- Reuse the established test framework and layer from repository evidence.
- Inspect existing tests before creating a new test file.
- Prefer adapting the closest owning test file.
- Do not create duplicate test files, scenarios, fixtures, or helpers.
- Run the narrowest useful baseline before changing existing behavior when the environment allows it.
- Separate pre-existing failures from regressions introduced by the task.
- Ask before changing frameworks, installing dependencies, or migrating colocated tests.
- Prefer the smallest test layer that can prove the required contract without hiding it behind mocks.
- For feature removal, delete obsolete tests and keep only coverage for supported behavior.
- For security or safety-sensitive behavior, include negative evidence for the prohibited outcome.

## Evidence Paths

- **Behavior change or bug fix** → RED → GREEN → REFACTOR.
- **Behavior-preserving refactor** → BASELINE → REFACTOR → REGRESSION.
- **Mechanical/generated change** → BASELINE → CHANGE → DIFF/REGRESSION.
- **Documentation/config only** → structural validation.
- **Pure removal with no observable absence contract** → remove obsolete tests, then run relevant regression coverage.

## Decision Gates

Stop and ask when:

- no usable test framework or environment exists;
- multiple frameworks plausibly own the same layer;
- baseline evidence is blocked by unrelated failures;
- the correct test layer is unavailable;
- relevant tests are colocated and migration is undecided;
- the right existing file needs a structural split first; or
- RED is required but the issue is not reproducible.

## Execution Steps

1. Classify the change type.
2. Detect the existing test framework, commands, roots, and candidate owner files.
3. Run the narrowest baseline when needed.
4. Select the owning test file or justify a new one.
5. Apply the matching evidence path.
6. Run focused validation, then relevant broader regression checks.
7. Report selected test file, layer, commands, outcomes, and remaining risks.

## Output Contract

Return:

- Skill applied: `tdd`.
- Change type and evidence path.
- Existing test candidates inspected and selected owner file.
- Framework and layer used.
- Commands run and results.
- Any blocked validation, unresolved risk, or required user decision.

## References

- `AGENTS.md`
- `skills/workflow-triage/SKILL.md`
