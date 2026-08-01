---
name: workflow-triage
description: "routes software requests among exactly three workflows—Direct Orchestrator, Mini-SDD, or Formal SDD—and begins concrete execution requests without redundant start confirmation."
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

Use this skill when a software request needs workflow routing, when the user asks about Direct Orchestrator versus Mini-SDD versus Formal SDD, or when missing context requires a research decision before implementation.

Do not reopen triage when the user already selected a workflow unless confirmed scope has materially changed. A concrete request to perform work authorizes the selected or best-fitting workflow to begin; a recommendation-only or hypothetical conversation does not.

## Canonical Scope

This skill owns:

- selection among exactly three workflows;
- qualitative routing and escalation signals;
- classification of the request as execution-authorized or advice-only;
- re-triage only when materially changed scope makes the current workflow no longer fit.

This skill consumes the shared semantics in `AGENTS.md` for proportional context assessment, reviewability, consent, handoff, candidate, attempt-budget, and delivery-safeguard policy. It exposes only routing or re-triage consequences from those semantics and must not redefine manifest or archive mechanics.

## Hard Rules

- Support exactly three workflows: **Direct Orchestrator**, **Mini-SDD**, and **Formal SDD**.
- PRD and discovery are optional artifacts or activities, not independent workflows.
- A concrete imperative request to change, fix, build, review, investigate, or otherwise perform work is execution authorization within its stated scope.
- Do not ask for a second start confirmation after routing or workflow selection.
- Recommendation-only, comparison, explanation, and hypothetical requests do not authorize project inspection or execution.
- Make the recommendation from context already available; do not search merely to decide whether to search.
- If material context is missing, state what is unknown and ask only for the decision needed to proceed safely.
- Use the read-only `discovery` subagent for approved unknown research by default.
- If the user asks the orchestrator to investigate or execute personally, honor that choice within the approved scope.
- Task authorization covers directly relevant reads and expected phase work; do not request permission file by file or phase by phase.
- Never reread current context or completed discovery evidence without a concrete freshness or gap reason.
- Do not silently broaden research or switch workflows.

## Routing Table

| Situation | Recommendation | Required User Decision |
|---|---|---|
| Context is complete and work is localized or explicitly assigned to the orchestrator | **Direct Orchestrator** | Begin if work was requested; otherwise provide advice only |
| Medium multi-file change or targeted refactor needing a shared lightweight plan | **Mini-SDD** | Begin if work was requested; ask only if workflow trade-offs are material |
| Large, cross-cutting, architectural, or contract-changing work | **Formal SDD** | Begin if work was requested; ask only if workflow trade-offs are material |
| Material implementation context is unknown | **Likely workflow plus bounded discovery** | Ask only for missing scope, depth, or executor decisions that materially matter |
| Product intent is unclear | Keep the likely workflow; optionally add `prd.md` | Ask for the missing product decision or PRD choice |

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

- If the user already chose a workflow, do not ask again unless the requested scope materially changes.
- If the user requested concrete work, route and begin without asking them to repeat the request as “start.”
- If the user asked only for advice or acknowledged a recommendation without requesting work, remain conversational until a concrete task is requested.
- If direct execution encounters an unapproved research need, stop and ask whether to use discovery, let the orchestrator investigate, or switch workflows.
- If Mini-SDD or Formal SDD produces a `BLOCKED` artifact, stop the sequence and ask the user for the missing decision.
- If the request is conversational advice with no requested execution, answer directly without forcing workflow selection.
- If a code change uses Direct Orchestrator, load `tdd`; for Mini-SDD or Formal SDD, load `sdd-workflow`.

## Execution Steps

1. Summarize what is already known without reading files.
2. Identify only material unknowns that prevent a safe recommendation.
3. If context quality or reviewability concerns change the route, state the specific signal and the routing consequence.
4. If research is needed, ask for depth and executor before running it.
5. Select or recommend one of the three workflows with one concise reason.
6. Classify the request as `EXECUTION_AUTHORIZED` or `ADVICE_ONLY`.
7. For `EXECUTION_AUTHORIZED`, hand the route directly to Direct Orchestrator execution or `sdd-workflow` without another start prompt.
8. For `ADVICE_ONLY`, answer conversationally and wait for a concrete task request.
9. Ask the user only when a material workflow, scope, research, executor, or product decision remains unresolved.
10. Re-triage only when scope changes materially or a blocker shows the selected workflow no longer fits.

## Output Contract

Return:

- Recommended workflow and concise rationale.
- Known context reused.
- Material unknowns, if any.
- Research depth or executor decision required, if any.
- Workflow selection status.
- Request mode: `EXECUTION_AUTHORIZED` or `ADVICE_ONLY`.
- Related skill loaded for execution or recommended for later advice-only use.
- Any recorded escalation signal and consequence.

## References

- `AGENTS.md` — canonical authority, consent, proportional context assessment, review-workload, handoff, candidate, attempt-budget, and delivery-safeguard policy.
- `skills/sdd-workflow/SKILL.md` — Mini-SDD and Formal SDD lifecycle for authorized execution requests.
- `skills/tdd/SKILL.md` — Direct Orchestrator code-change protocol.
- `docs/pi-workflow-regression-scenarios.md` — non-authoritative routing and consent regression catalog for reviewer maintenance.
