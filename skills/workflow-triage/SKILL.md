---
name: workflow-triage
description: "Route software requests between Direct Orchestrator and Planned Workflow. Trigger: non-trivial software work, workflow selection, choosing between direct execution and planned delegation."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "12.0"
registry:
  category: "workflow"
  domains: "workflow-routing, orchestration, openspec"
  paths: "AGENTS.md, openspec/changes/**/*.md, skills/workflow-triage/SKILL.md, skills/work-workflow/SKILL.md"
  keywords: "choose workflow, workflow triage, direct orchestrator, planned-workflow, compare workflows, openspec workflow"
  related: "work-workflow, tdd"
  priority: 95
---

# Workflow Triage

## Activation Contract

Use for non-trivial software work or workflow selection. Load once per session; re-triage only after material scope changes. Global authorization and precedence live in `AGENTS.md`.

## Canonical Scope

This skill selects Direct Orchestrator or Planned Workflow, classifies advice versus execution, and selects the research lane (`deep-researcher` for user-requested investigations or standalone research; `00-discovery` for pre-implementation discovery). It does not authorize implementation or own artifact formats.

## Hard Rules

- Apply explicit no-delegation authorization first: use Direct Orchestrator for the approved scope, including investigation, planning, implementation, and validation. Do not delegate or create mandatory Planned Workflow ceremony under this override.
- **Research-to-Direct Execution Fast Path**: If a prior deep research or investigation (such as from `deep-researcher`) has already identified the exact root cause, files, and proposed solution, do not force Planned Workflow or redundant `00-discovery`. Route directly to Direct Orchestrator to apply the targeted fix, run tests, and report the verified outcome.
- Without that override, use Direct Orchestrator for answers to direct factual questions, exact known reads, trivial localized edits, and lightweight validation; use Planned Workflow for bounded implementation needing a shared contract.
- When requested to investigate, research, or inspect a topic, behavior, question, architecture, or codebase outside an implementation change, delegate to `deep-researcher` (which writes `report.md` and `sources.md`).
- For unknown local code, behavior, tests, or structure before an implementation change in Planned Workflow, delegate `00-discovery` with an exact absolute `openspec/changes/<change-slug>/discovery.md` output path. Project files remain read-only; only that artifact may be written.
- Research alone may finish with its artifact; it does not mandate implementation or Planned Workflow continuation.
- If work is too broad or material decisions are unresolved, trip the circuit breaker and narrow/split it with the user rather than introducing another workflow.
- A concrete request authorizes work within its scope, subject to the Pre-Mutation Summary Gate before any file modification; advice-only does not authorize inspection or mutation.
- **Shadow Telemetry Recording (Non-Authoritative)**: When the TypeSafe extension is active, the orchestrator explicitly records shadow triage telemetry after selecting the canonical route by invoking `typesafe_record_shadow_triage` (or `typesafe_shadow_triage`) with the original user request (`original_prompt`) and the selected canonical route enum (`route`: `direct_orchestrator`, `planned_workflow`, or `deep_researcher`). TypeSafe's consultative prediction is persisted in local SQLite telemetry to benchmark question calibration and agreement without altering or delaying the workflow. Shadow recommendations are strictly non-authoritative: LLM triage decisions governed by this skill and `AGENTS.md` remain 100% authoritative with zero override or veto power. Confirmation turns (e.g., "yes", "proceed") are not triage decisions and must never be evaluated.

## Execution Steps

1. Reuse supplied context and classify request mode.
2. Check explicit executor decisions before normal routing.
3. Select the smallest valid route and resolve only material unknowns. When the TypeSafe extension is active, explicitly record shadow telemetry via `typesafe_record_shadow_triage` using the original user request and selected canonical route (`direct_orchestrator`, `planned_workflow`, or `deep_researcher`); do not evaluate confirmation turns.
4. If local discovery is needed, reuse the active change directory or assign a topic slug; confirm the destination is not owned by another investigation. Pass the exact output path and artifact-contract skill.
5. Read the resulting artifact before relying on its evidence. Stop on a material blocker.
6. For Planned Workflow, load `work-workflow`; for direct code changes, apply the relevant validation and scope skills.

## Output Contract

Briefly state the route, material blocker if any, and next action when useful. Do not add a routing ceremony to trivial answers.

## References

- `~/.pi/agent/AGENTS.md` — authorization, precedence, direct override.
- `~/.pi/agent/skills/work-workflow/SKILL.md` — lightweight lifecycle.
- `~/.pi/agent/skills/subagent-artifact-contracts/SKILL.md` — discovery and handoff formats.
- `~/.pi/agent/skills/tdd/SKILL.md` — validation by change type.
