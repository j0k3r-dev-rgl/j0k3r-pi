---
name: workflow-triage
description: "routes software requests among exactly three workflows—Direct Orchestrator, Mini-SDD, or Formal SDD—and enforces a separate explicit start instruction before any execution."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "8.0"
---

# Workflow Triage

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "workflow",
  "domains": ["workflow-routing", "orchestration", "openspec", "user-consent"],
  "triggers": {
    "paths": [
      "AGENTS.md",
      "openspec/changes/**/*.md",
      "skills/workflow-triage/SKILL.md",
      "skills/sdd-workflow/SKILL.md"
    ],
    "keywords": [
      "choose workflow",
      "workflow triage",
      "direct orchestrator",
      "mini-sdd",
      "formal sdd",
      "openspec workflow",
      "elegir flujo",
      "flujo directo",
      "sdd completo"
    ]
  },
  "sdd_phases": ["explore", "proposal", "spec", "design", "task", "apply", "verify", "archive"],
  "related_skills": ["sdd-workflow", "tdd"],
  "priority": 95
}
```

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `triggers.paths`: glob-like project paths that should activate this skill.
- `triggers.keywords`: user/request/code keywords that should activate this skill.
- `sdd_phases`: phases where this skill is useful.
- `related_skills`: skills that should be considered one hop away.
- `priority`: routing priority from 0 to 100.

## Activation Contract

Use this skill when a software request needs a workflow recommendation, when the user asks about Direct Orchestrator versus Mini-SDD versus Formal SDD, or when missing context requires an explicit research decision before implementation.

Do not reopen triage when the user already selected a workflow unless confirmed scope has materially changed. Preserve the user's choice, but do not treat workflow selection or proposal approval as permission to begin execution.

## Canonical Scope

This skill owns:

- selection among exactly three workflows;
- qualitative routing and escalation signals;
- separately recorded workflow-selection and start-authorization results;
- re-triage only when materially changed scope makes the current workflow no longer fit.

This skill consumes the shared semantics in `AGENTS.md` for proportional context assessment, reviewability, consent, handoff, candidate, attempt-budget, and delivery-safeguard policy. It exposes only routing or re-triage consequences from those semantics and must not redefine manifest or archive mechanics.

## Hard Rules

- Support exactly three workflows: **Direct Orchestrator**, **Mini-SDD**, and **Formal SDD**.
- PRD and discovery are optional artifacts or activities, not independent workflows.
- Workflow selection and execution authorization are separate semantic results even when one message satisfies both.
- Treat a combined user message as satisfying both gates only when it unambiguously selects one named workflow and instructs it to start now.
- Do not inspect project files, investigate, delegate, edit, write artifacts, or run commands before the user explicitly instructs the selected workflow to start.
- Make the recommendation from context already available; do not search merely to decide whether to search.
- If material context is missing, state what is unknown and ask whether research should be small, broad, or skipped.
- Use the read-only `discovery` subagent for approved unknown research by default.
- If the user explicitly asks the orchestrator to investigate or execute personally, honor that choice within the approved scope.
- The explicit start instruction is task-scoped: after it is received, directly relevant reads and expected phase work do not require permission file by file.
- Never reread current context or completed discovery evidence without a concrete freshness or gap reason.
- Do not silently broaden research, switch workflows, or treat escalation as start consent.

## Routing Table

| Situation | Recommendation | Required User Decision |
|---|---|---|
| Context is complete and work is localized or explicitly assigned to the orchestrator | **Direct Orchestrator** | Select Direct, then explicitly start it |
| Medium multi-file change or targeted refactor needing a shared lightweight plan | **Mini-SDD** | Select Mini-SDD, then explicitly start it |
| Large, cross-cutting, architectural, or contract-changing work | **Formal SDD** | Select Formal SDD, then explicitly start it |
| Material implementation context is unknown | **No workflow yet** | Choose research depth and executor first |
| Product intent is unclear | Keep the likely workflow; optionally add `prd.md` | Approve PRD clarification |

## Qualitative Escalation Signals

Record the observed signal and its routing consequence when any of these appear:

- unfamiliar or weakly understood implementation surfaces;
- multiple coupled policy, data, API, security, or delivery boundaries;
- contradictory or equal-authority sources;
- broad cross-file impact that is difficult to summarize coherently;
- context quality is incomplete, stale, truncated, or otherwise unreliable for the next safe action;
- an approved next step would require unauthorized discovery or broader access than current consent allows;
- the requested review workload cannot be presented as coherent, independently reviewable units;
- missing or non-credible test strategy;
- material candidate, artifact, or contract drift likelihood across actors or boundaries; or
- emergent external, irreversible, migration, or rollback consequences.

Permitted outcomes only:

- continue with the selected workflow;
- decompose within the approved scope;
- request bounded discovery and executor choice;
- pause for an authority or scope decision;
- recommend re-triage after a material scope change.

## Decision Gates

- If the user already chose a workflow, do not ask again unless the requested scope materially changes; wait for an explicit start instruction if none has been given.
- If the user provides an unambiguous combined selection-and-start message, record both results as satisfied while keeping them as separate semantic gates.
- Ambiguous agreement such as acknowledging the recommendation does not count as a selection or start instruction unless the missing gate is otherwise explicit.
- If direct execution encounters an unapproved research need after starting, stop and ask whether to use discovery, let the orchestrator investigate, or switch workflows.
- If Mini-SDD or Formal SDD produces a `BLOCKED` artifact, stop the sequence and ask the user for the missing decision.
- If the request is conversational advice with no requested execution, answer directly without forcing workflow selection.
- If a code change uses Direct Orchestrator, load `tdd`; for Mini-SDD or Formal SDD, load `sdd-workflow`.

## Execution Steps

1. Summarize what is already known without reading files.
2. Identify only material unknowns that prevent a safe recommendation.
3. If context quality or reviewability concerns change the route, state the specific signal and the routing consequence.
4. If research is needed, ask for depth and executor before running it.
5. Recommend one of the three workflows with one concise reason.
6. Record workflow-selection status and start-authorization status separately.
7. Wait for workflow selection unless the user has already made an explicit choice.
8. State that the selected workflow is ready and wait for a separate, contextually clear start instruction unless the same message already supplied one unambiguously.
9. Only after authorization, hand the route to Direct Orchestrator execution or `sdd-workflow`.
10. Re-triage only when scope changes materially or a blocker shows the selected workflow no longer fits.

## Output Contract

Return:

- Recommended workflow and concise rationale.
- Known context reused.
- Material unknowns, if any.
- Research depth or executor decision required, if any.
- Workflow selection status.
- Explicit start status: `WAITING` or `AUTHORIZED`.
- Related skill to load only after start authorization.
- Any recorded escalation signal and consequence.

## References

- `AGENTS.md` — canonical authority, consent, proportional context assessment, review-workload, handoff, candidate, attempt-budget, and delivery-safeguard policy.
- `skills/sdd-workflow/SKILL.md` — Mini-SDD and Formal SDD lifecycle after authorization.
- `skills/tdd/SKILL.md` — Direct Orchestrator code-change protocol.
- `docs/pi-workflow-regression-scenarios.md` — non-authoritative routing and consent regression catalog for reviewer maintenance.
