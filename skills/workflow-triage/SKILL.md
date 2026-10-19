---
name: workflow-triage
description: "Route software requests between Direct Orchestrator and Planned Workflow and select standalone research lanes. Trigger: non-trivial software work, workflow selection, standalone research, or parallel research dispatch."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "12.2"
registry:
  category: "workflow"
  domains: "workflow-routing, orchestration, openspec"
  paths: "AGENTS.md, openspec/changes/**/*.md, skills/workflow-triage/SKILL.md, skills/work-workflow/SKILL.md"
  keywords: "choose workflow, workflow triage, direct orchestrator, planned-workflow, compare workflows, openspec workflow, standalone research, parallel research"
  related: "work-workflow, tdd"
  priority: 95
---

# Workflow Triage

## Activation Contract

Use for non-trivial software work, workflow selection, or standalone research routing. Load once per session; re-triage only after material scope changes. Global authorization and precedence live in `AGENTS.md`.

## Canonical Scope

This skill selects Direct Orchestrator or Planned Workflow, classifies advice versus execution, and selects the research lane (`deep-researcher` for user-requested investigations or standalone research; `00-discovery` for pre-implementation discovery). It does not authorize implementation or own artifact formats.

## Hard Rules

- Apply explicit no-delegation authorization first: use Direct Orchestrator for the approved scope, including investigation, planning, implementation, and validation. Do not delegate or create mandatory Planned Workflow ceremony under this override.
- **Research-to-Direct Execution Fast Path**: Reuse completed research with an exact root cause, files, and solution. Route the targeted implementation to Direct Orchestrator only with applicable user implementation authorization under `AGENTS.md`; otherwise present findings and stop. Do not repeat discovery/planning or request authorization already granted. Research alone never grants mutation authority.
- Without that override, use Direct Orchestrator for answers to direct factual questions, exact known reads, trivial localized edits, and lightweight validation; use Planned Workflow for bounded implementation needing a shared contract.
- When requested to investigate, research, or inspect a topic, behavior, question, architecture, or codebase outside an implementation change, use the standalone research route below with existing `deep-researcher` workers (each writes `report.md` and `sources.md`), unless explicit direct execution is authorized.
- For unknown local code, behavior, tests, or structure before an implementation change in Planned Workflow, delegate `00-discovery` with an exact absolute `openspec/changes/<change-slug>/discovery.md` output path. Project files remain read-only; only that artifact may be written.
- Research alone may finish with its artifact; it does not mandate implementation or Planned Workflow continuation.
- If work is too broad or material decisions are unresolved, trip the circuit breaker and narrow/split it with the user rather than introducing another workflow.
- A concrete request authorizes work within its scope, subject to the Pre-Mutation Summary Gate before any file modification; advice-only does not authorize inspection or mutation.

## Execution Steps

1. Reuse supplied context and classify request mode.
2. Check explicit executor decisions before normal routing.
3. Select the smallest valid route and resolve only material unknowns.
4. If local discovery is needed, reuse the active change directory or assign a topic slug; confirm the destination is not owned by another investigation. Pass the exact output path and artifact-contract skill.
5. For standalone research, dispatch and integrate using the rules below; for discovery, read its artifact before relying on its evidence. Stop dependent work on a material blocker.
6. For Planned Workflow, load `work-workflow`; for direct code changes, apply the relevant validation and scope skills.

### Standalone research: bounded dispatch and parent integration

1. Apply explicit no-delegation first; advice-only remains non-executing. Otherwise use parallel `deep-researcher` lanes only when complementary questions can be answered independently from shared known context and the split is useful. Start with two when useful, not as a mandatory or universal count. Keep small or dependent questions with one researcher rather than manufacturing parallelism; direct factual answers and exact known reads retain their Direct Orchestrator route. This is not pre-implementation `00-discovery`.
2. Supply each lane the seven delegation fields from `AGENTS.md`: shared known facts and constraints, one bounded complementary question, depth (`STANDARD` or `DEEP`), allowed/excluded source families, freshness/timeframe/version/geography/language constraints or `None`, report language, exclusions and sensitive boundaries, and permitted evidence types. Choose proportional sources, not an exhaustive tool/source sweep or fixed source quota.
3. For parallel lanes, assign exact, distinct timestamped output directories under `investigaciones/<YYYY-MM-DD>-<HHmm>-<slug>/`, with lane-specific slugs. Confirm no directory belongs to another investigation. Each directory contains only its lane's `report.md` and `sources.md`; workers never share writable outputs. The existing standalone worker fallback remains available outside parallel dispatch.
4. Launch independent lanes concurrently in one parent turn. Omit `mode` unless the user explicitly requested it; the manager selects execution mode. Consume completion notifications without polling. Existing authorization, consent, tool-access, and live-question/fallback contracts still apply.
5. Account for every launched lane and read returned reports and source indexes before relying on their evidence. Give one integrated answer in the parent, without a synthesizer agent, additional phase, or required integration artifact. Cite material conclusions with lane-qualified report/source references, for example `lane-a/report.md — finding; lane-a/sources.md [S-001]`, so identical local source IDs cannot be confused. Distinguish supported facts, interpretation, uncertainty, and disagreement; do not manufacture consensus.
6. Explicitly report each `BLOCKED`, `FAILED`, missing, or unusable lane; never silently discard it or count it as completed evidence. With mixed results, report usable independent findings with limitations, but stop conclusions/actions dependent on missing evidence or an unresolved decision and do not represent them as complete. Workers ask through `ask_orchestrator` and wait when available, otherwise return `BLOCKED`. The parent answers known facts/approved decisions and asks the user for unmade material decisions, without speculative defaults or authority expansion. Research-only results stop here; integration never authorizes implementation.

## Output Contract

Briefly state the route, material blocker if any, and next action when useful. Do not add a routing ceremony to trivial answers.

## References

- `~/.pi/agent/AGENTS.md` — authorization, precedence, direct override.
- `~/.pi/agent/skills/work-workflow/SKILL.md` — lightweight lifecycle.
- `~/.pi/agent/skills/subagent-artifact-contracts/SKILL.md` — discovery and handoff formats.
- `~/.pi/agent/subagents/deep-researcher.md` — bounded research inputs, evidence, two-file output, and handoff.
- `~/.pi/agent/skills/tdd/SKILL.md` — validation by change type.
