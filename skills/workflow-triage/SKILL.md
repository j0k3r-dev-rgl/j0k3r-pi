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
- `triggers.keywords`: user/request terms that should activate this skill.
- `sdd_phases`: phases where this skill is useful.
- `related_skills`: skills that should be considered one hop away.
- `priority`: routing priority from 0 to 100.

## Activation Contract

Use this skill when a software request needs a workflow recommendation, when the user asks about Direct Orchestrator versus Mini-SDD versus Formal SDD, or when missing context requires an explicit research decision before implementation.

Do not reopen triage when the user already selected a workflow. Preserve that choice, but do not treat workflow selection or proposal approval as permission to begin execution.

## Hard Rules

- Support exactly three workflows: **Direct Orchestrator**, **Mini-SDD**, and **Formal SDD**.
- PRD and exploration are optional artifacts or activities, not independent workflows.
- Workflow selection and execution authorization are separate gates.
- Do not inspect project files, investigate, delegate, edit, write artifacts, or run commands before the user explicitly instructs the selected workflow to start.
- Make the recommendation from context already available; do not search merely to decide whether to search.
- If material context is missing, state what is unknown and ask whether research should be small, broad, or skipped.
- Use the read-only `discovery` subagent for approved unknown research by default.
- If the user explicitly asks the orchestrator to investigate or execute personally, honor that choice within the approved scope.
- The explicit start instruction is task-scoped: after it is received, directly relevant reads and expected phase work do not require permission file by file.
- Never reread current context or completed discovery evidence without a concrete freshness or gap reason.

## Routing Table

| Situation | Recommendation | Required User Decision |
|---|---|---|
| Context is complete and work is localized or explicitly assigned to the orchestrator | **Direct Orchestrator** | Select Direct, then explicitly start it |
| Medium multi-file change or targeted refactor needing a shared lightweight plan | **Mini-SDD** | Select Mini-SDD, then explicitly start it |
| Large, cross-cutting, architectural, or contract-changing work | **Formal SDD** | Select Formal SDD, then explicitly start it |
| Material implementation context is unknown | **No workflow yet** | Choose research depth and executor first |
| Product intent is unclear | Keep the likely workflow; optionally add `prd.md` | Approve PRD clarification |

## Decision Gates

- If the user already chose a workflow, do not ask again unless the requested scope materially changes; wait for an explicit start instruction if none has been given.
- Ambiguous agreement such as acknowledging the recommendation does not count as a start instruction.
- If direct execution encounters an unapproved research need after starting, stop and ask whether to use discovery, let the orchestrator investigate, or switch workflows.
- If Mini-SDD or Formal SDD produces a `BLOCKED` artifact, stop the sequence and ask the user for the missing decision.
- If the request is conversational advice with no requested execution, answer directly without forcing workflow selection.
- If a code change uses Direct Orchestrator, load `tdd`; for Mini-SDD or Formal SDD, load `sdd-workflow`.

## Execution Steps

1. Summarize what is already known without reading files.
2. Identify only material unknowns that prevent a safe recommendation.
3. If research is needed, ask for depth and executor before running it.
4. Recommend one of the three workflows with one concise reason.
5. Wait for workflow selection unless the user has already made an explicit choice.
6. State that the selected workflow is ready and wait for a separate, contextually clear start instruction.
7. Only after that instruction, hand the route to Direct Orchestrator execution or `sdd-workflow`.
8. Re-triage only when scope changes materially or a blocker invalidates the selected route.

## Output Contract

Return:

- Recommended workflow and concise rationale.
- Known context reused.
- Material unknowns, if any.
- Research depth/executor decision required, if any.
- Workflow selection status.
- Explicit start status: `WAITING` or `AUTHORIZED`.
- Related skill to load only after start authorization.

## References

- `AGENTS.md` — authoritative consent, context reuse, executor choice, and orchestration policy.
- `skills/sdd-workflow/SKILL.md` — Mini-SDD and Formal SDD lifecycle after authorization.
- `skills/tdd/SKILL.md` — Direct Orchestrator code-change protocol.
