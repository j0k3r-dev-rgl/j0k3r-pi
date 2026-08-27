---
name: workflow-triage
description: "route software requests among exactly three workflows: Direct Orchestrator, Mini-SDD, or Formal SDD. Use when choosing a workflow, classifying execution versus advice, or deciding whether bounded discovery is required."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "11.0"
registry:
  category: "workflow"
  domains: "workflow-routing, orchestration, openspec"
  paths: "AGENTS.md, openspec/changes/**/*.md, skills/workflow-triage/SKILL.md, skills/sdd-workflow/SKILL.md"
  keywords: "choose workflow, workflow triage, direct orchestrator, mini-sdd, formal sdd, compare workflows, openspec workflow"
  phases: "explore, proposal, spec, design, task, apply, verify, archive"
  related: "sdd-workflow, tdd"
  priority: 95
---

# Workflow Triage

## Activation Contract

Use this skill when the agent must choose or explain the workflow, or when the user asks about Direct Orchestrator, Mini-SDD, or Formal SDD.

Do not load it again once the workflow is already chosen unless scope changed materially.

## Canonical Scope

This skill owns only:

- workflow selection among exactly three workflows;
- execution-authorized vs advice-only classification; and
- re-triage after material scope change.

Global authorization, access, and delegation rules live in `AGENTS.md`.

## Hard Rules

- Support exactly three workflows: Direct Orchestrator, Mini-SDD, Formal SDD.
- A concrete work request is `EXECUTION_AUTHORIZED` within the stated scope.
- Advice-only requests are `ADVICE_ONLY` and do not authorize inspection or mutation.
- Do not ask for a second start confirmation.
- Prefer Mini-SDD for non-trivial but bounded work.
- Choose Formal SDD only when there is a concrete escalation signal: materially coupled contracts, unresolved architecture, migration/security consequences, or review that cannot stay coherent in one lightweight plan.
- Use bounded `discovery` whenever safe execution requires unknown implementation-code, behavior, dependency, test, project-structure, or external research.
- Direct Orchestrator must not inspect implementation code unless the user names exact files or symbols and the task is trivial.
- If implementation is non-trivial after discovery, choose Mini-SDD or Formal SDD instead of continuing as Direct Orchestrator.

## Routing Table

| Situation | Workflow |
|---|---|
| Answer, routing, exact known read, trivial localized edit, or lightweight validation | Direct Orchestrator |
| Work needing unknown code/behavior/test/dependency research | Likely workflow + delegated `discovery` first |
| Medium implementation inside one coherent boundary | Mini-SDD |
| Large, cross-cutting, migration-heavy, or architecture-heavy work | Formal SDD |
| Material unknown blocks the route | Likely workflow + bounded discovery |

## Execution Steps

1. Reuse current context without reading files.
2. Identify only material unknowns.
3. If unknown code, behavior, tests, dependencies, project structure, or external facts are needed, delegate bounded `discovery` before implementation.
4. Select one workflow with one concise reason.
5. Classify the request as `EXECUTION_AUTHORIZED` or `ADVICE_ONLY`.
6. For `EXECUTION_AUTHORIZED`, proceed immediately with the selected workflow.
7. Re-triage only if scope changes materially.

## Output Contract

Return:

- recommended workflow;
- request mode: `EXECUTION_AUTHORIZED` or `ADVICE_ONLY`;
- concise rationale;
- material unknowns, if any;
- whether discovery is required; and
- related execution skill to load next (`tdd` or `sdd-workflow`).

## References

- `AGENTS.md`
- `skills/sdd-workflow/SKILL.md`
- `skills/tdd/SKILL.md`
