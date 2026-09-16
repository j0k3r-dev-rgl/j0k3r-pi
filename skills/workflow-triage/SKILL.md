---
name: workflow-triage
description: "route software requests between Direct Orchestrator and Planned Workflow. Use to classify execution versus advice, honor explicit no-delegation authorization, and select bounded local or external research."
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
- Without that override, use Direct Orchestrator for answers to direct factual questions, exact known reads, trivial localized edits, and lightweight validation; use Planned Workflow for bounded implementation needing a shared contract.
- When requested to investigate, research, or inspect a topic, behavior, question, architecture, or codebase outside an implementation change, delegate to `deep-researcher` (which writes `report.md` and `sources.md`).
- For unknown local code, behavior, tests, or structure before an implementation change in Planned Workflow, delegate `00-discovery` with an exact absolute `openspec/changes/<change-slug>/discovery.md` output path. Project files remain read-only; only that artifact may be written.
- Research alone may finish with its artifact; it does not mandate implementation or Planned Workflow continuation.
- If work is too broad or material decisions are unresolved, trip the circuit breaker and narrow/split it with the user rather than introducing another workflow.
- A concrete request authorizes work within its scope, subject to the Pre-Mutation Summary Gate before any file modification; advice-only does not authorize inspection or mutation.

## Execution Steps

1. Reuse supplied context and classify request mode.
2. Check explicit executor decisions before normal routing.
3. Select the smallest valid route and resolve only material unknowns.
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
