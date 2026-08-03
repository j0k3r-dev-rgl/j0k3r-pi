---
name: delivery-planning
description: "turn approved startup requirements and architecture into outcome-oriented roadmaps, small vertical increments, fully functional sprint goals, delivery policies, and a proportional Definition of Done without imposing ceremonies or speculative dates."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.3"
---

# Delivery Planning

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "delivery",
  "domains": ["delivery-planning", "roadmaps", "sprint-planning", "vertical-slicing", "definition-of-done"],
  "triggers": {
    "paths": [
      "docs/04-delivery/**/*.md"
    ],
    "keywords": [
      "delivery planning",
      "outcome roadmap",
      "plan sprint",
      "sprint goal",
      "vertical slice",
      "Definition of Done",
      "planificar entrega",
      "planificar sprint",
      "modulo funcional completo",
      "corte vertical"
    ]
  },
  "sdd_phases": [],
  "related_skills": [
    "startup-documentation",
    "requirements-definition",
    "architecture-definition",
    "technical-decisions",
    "product-validation",
    "tdd",
    "anti-overengineering"
  ],
  "priority": 92
}
```

## Activation Contract

Use this skill when approved product requirements and applicable architecture decisions must become an outcome roadmap, delivery model, small vertical increments, sprint plans, or a shared Definition of Done. It owns modular documents under `docs/04-delivery/`.

Activate it for one bounded planning horizon or one small functional module at a time. When the user selects sprints, each sprint should pursue one coherent outcome and deliver a small vertical module that is integrated, verifiable, and fully functional against its approved scope and applicable Definition of Done.

Do not use it to discover the product, expand scope, invent capacity or dates, redefine requirements/architecture, implement work, or impose Scrum, Kanban, two-week sprints, story points, velocity, ceremonies, feature flags, release trains, or infrastructure without an explicit need.

## Hard Rules

- Consume the `startup-documentation` and `references/document-contract.md` context already supplied by the router. If no router context was supplied, load them once for the shared contract without re-entering documentation routing. Load and follow `anti-overengineering` whenever this skill is active. Load `tdd` when planning code changes.
- Use approved product, requirement, architecture, and technical-decision IDs as inputs. Stop if the functional slice, acceptance, applicable quality conditions, dependency, or decision owner needed for planning is unresolved.
- Ask the user before selecting delivery model, cadence, sprint length, capacity assumption, priority, sequence, scope commitment, release boundary, quality policy, rollout, rollback, or date.
- Choose Scrum only when a stable team benefits from a protected short-term outcome and recurring inspect/adapt boundary. Choose Kanban/continuous flow when arrivals are volatile, interrupt-driven, or better forecast through flow. Use a hybrid only when each retained mechanism solves a demonstrated problem. When Kanban/flow is selected, use `03-increments/` records as flow items and create `04-sprints/` records only when sprints are explicitly selected.
- Roadmaps communicate outcomes, hypotheses, confidence, dependencies, and horizons. They do not become detailed feature/date promises.
- Plan at lower detail farther from execution: `Now` is concrete, `Next` is directional, and `Later` remains optional and low-confidence.
- Slice by user journey, use case, segment, workflow step, outcome, or risk. Never call frontend-only, backend-only, database-only, or infrastructure-only work a complete functional module.
- A sprint module is “fully functional” only when every requirement and acceptance criterion in its approved boundary passes, applicable quality constraints pass, the change is integrated, and the Definition of Done is met. Do not add unapproved future cases to claim completeness.
- Permit explicitly linked enabling work within the same coherent Sprint Goal only when it is necessary to deliver or safely unlock the vertical increment, has its own acceptance/DoD evidence, and is not represented as user-complete value.
- If a module cannot reasonably reach Done inside the selected sprint, split its product/requirement boundary before commitment. Do not plan an intentionally half-functional module as the sprint outcome.
- Keep one sprint focused on one coherent goal. Add multiple items only when they directly support that goal and can all reach Done without hiding capacity risk.
- Place RED → GREEN → REFACTOR inside each behavior change. Completion evidence must link the safety baseline, expected RED failure, GREEN result, refactor validation, and applicable broader checks. TDD does not replace relevant integration, end-to-end, exploratory, usability, accessibility, security, performance, operational, or product validation.
- Use a Definition of Done as the shared quality floor. Do not create a bureaucratic Definition of Ready; ask only what is necessary for the next slice to be understood and completed.
- Automate repeatable checks and scale assurance, release controls, observability, rollback, feature flags, canaries, SLOs, and operational documentation to actual risk.
- For data-affecting releases, state whether code rollback is safe. Otherwise record the approved compatibility, restore, containment, or forward-fix approach and its owner; do not design an unapproved migration.
- When an increment causes or is materially affected by an unresolved privacy incident, unauthorized personal-data processing, or privacy guardrail breach, do not claim `DONE`, approve release, or mark the next dependent increment `ELIGIBLE` until the authorized owner records containment/disposition and required Validation or change-request evidence. Unrelated work may continue only through explicit unaffected trace links.
- Require the risk-proportional release evidence defined by applicable technical decisions, including security verification, release-artifact integrity, and vulnerability/incident response ownership when relevant.
- Never use velocity, coverage, DORA, story points, or individual output as proof of product value or as individual performance quotas. Any delivery metric used must support system/process learning, not prove product value or evaluate individuals.
- Delivery may create a conditional plan pending a named ADR and may provide explicit user-approved provisional constraints to `technical-decisions`; mark each affected increment or sprint `CONDITIONAL_NOT_COMMITTABLE` until the ADR is approved, while unrelated planning proceeds only through explicit unaffected trace links.
- Create only the delivery documents needed now; do not generate future sprints or a complete roadmap speculatively.

## Decision Gates

Before planning delivery, resolve:

- approved outcome, functional module, requirement/acceptance IDs, architecture decisions, and applicable quality constraints;
- team composition, demonstrated capacity evidence, dependencies, interruptions, and operational ownership;
- Scrum, Kanban/flow, or another explicitly chosen cadence with the reason it fits;
- sprint or replenishment horizon without assuming two weeks;
- one goal and smallest vertical module capable of reaching Done;
- release exposure, data effects, blast radius, rollout, rollback/mitigation, data compatibility/restore/forward-fix needs, support, and monitoring proportional to risk;
- applicable security verification, release-integrity evidence, vulnerability/incident response ownership, and justified change-specific checks;
- Definition of Done and any justified change-specific checks;
- release authorization state: `NOT_REQUESTED | APPROVED | BLOCKED`, its owner, and evidence when approved;
- user who owns priority, scope, date, risk, and release decisions.

Stop and ask when:

- product, requirements, architecture, or acceptance are missing or contradictory;
- the proposed module is too large or is only a technical layer;
- capacity, dependencies, or external commitments cannot support the requested scope/date;
- multiple valid cadence, sequencing, rollout, or quality trade-offs remain;
- the plan requires scope expansion, migration, procurement, external delivery, or implementation not separately authorized.

## Execution Steps

1. Identify the bounded delivery decision and trace it to approved product, requirement, architecture, and technical-decision IDs.
2. Ask one concise grouped questionnaire for cadence, capacity, priority, dependencies, quality, release risk, and decision ownership.
3. Create only the required delivery paths:

```text
docs/04-delivery/
├── 00-delivery-model.md
├── 01-roadmap.md
├── 02-definition-of-done.md
├── 03-increments/
│   └── 0001-<functional-increment>.md
└── 04-sprints/
    └── 0001-<sprint-goal>.md
```

4. Use `00-delivery-model.md` for chosen Scrum/Kanban/flow policies, rationale, cadence, planning/review triggers, WIP or sprint boundaries, interruption handling, and change conditions.
5. Use `01-roadmap.md` as a concise `Now / Next / Later` outcome map with confidence, dependencies, measures, and explicit non-commitments.
6. Use `02-definition-of-done.md` for the shared product-appropriate quality floor: review; applicable change-type validation evidence for code changes; acceptance/conformance verification; applicable integration, exploratory, usability, accessibility, security, performance, and operational checks; product-validation links when learning is required; documentation/telemetry; release-integrity and vulnerability-response evidence; rollback or data-safe mitigation; and potentially releasable status. Potentially releasable never implies release authorization.
7. Store each small vertical, independently reviewable delivery unit under `03-increments/`, linking outcome, requirements, acceptance, architecture, dependencies, validation need, completion evidence, and status: `PLANNED | IN_PROGRESS | DONE | NOT_DONE | BLOCKED | CONDITIONAL_NOT_COMMITTABLE`.
8. Store each explicitly selected sprint under `04-sprints/` with one goal, one small fully functional vertical module, any linked enabling work, scope/exclusions, increment/requirement IDs, dependencies, applicable change-type validation plan and result evidence, broader validation, Definition of Done, capacity assumptions, risks, and result status.
9. When execution evidence exists, update the increment/sprint with outcome evidence; TDD and broader-check links; `DONE | NOT_DONE | BLOCKED`; product-validation status `NOT_REQUIRED | REQUIRED | COMPLETED | BLOCKED`; learning-decision and `CR-####` links; affected upstream owners and returned dispositions; data-change migration/version, compatibility, rollback/restore/containment/forward-fix evidence and owner when applicable; release authorization; and next-increment eligibility `ELIGIBLE | BLOCKED | CONDITIONAL`.
10. Do not mark a next increment `ELIGIBLE` while it relies on an affected decision with incomplete required validation or an unresolved change request. `NOT_DONE` returns remaining behavior to bounded replanning; it never becomes hidden carry-over or value evidence.
11. If an approved increment is larger than one credible sprint, return it to product/requirements owners for boundary splitting rather than creating technical-layer sprints.
12. Validate that planned work can be independently accepted, completion claims link reproducible evidence, no date/capacity was invented, and no ceremony or release mechanism lacks a current purpose.
13. Stop before implementation or external release unless separately authorized by the applicable Pi workflow and user request.

## Output Contract

Return:

- Skills applied: `delivery-planning`, `startup-documentation`, and `anti-overengineering`; `tdd` when code work is planned.
- Delivery decision and approved input IDs.
- Delivery model and reason selected.
- Roadmap, increment, sprint, or Definition of Done documents created or updated.
- Sprint goal and small vertical module expected to be fully functional against its approved boundary.
- Scope, exclusions, dependencies, capacity assumptions, provisional constraints, data-safe rollback/mitigation, and user-owned commitments.
- Planned change-type validation and acceptance/conformance evidence expectations, broader-quality and product-validation expectations, and anticipated learning-decision/change-request links.
- Observed execution evidence only when already produced by a separately authorized Pi workflow: TDD/check results, result status, affected owner dispositions, next-increment eligibility, applicable data-change evidence, and release authorization; otherwise `None`.
- Speculative dates, ceremonies, infrastructure, and future sprints added: `None`.
- Implementation or release performed: `None` unless separately authorized.
- Validation executed.
- One next permitted action.

## References

- `~/.pi/agent/skills/startup-documentation/SKILL.md` — documentation routing.
- `~/.pi/agent/skills/startup-documentation/references/document-contract.md` — modular Markdown contract.
- `~/.pi/agent/skills/requirements-definition/SKILL.md` — functional and acceptance owner.
- `~/.pi/agent/skills/architecture-definition/SKILL.md` — architecture input owner.
- `~/.pi/agent/skills/tdd/SKILL.md` — change-type validation guidance.
- `https://scrumguides.org/scrum-guide.html` — Product Goal, Sprint Goal, refinement, and Definition of Done.
- `https://kanbanguides.org/the-kanban-guide/` — current workflow, WIP, flow measures, and service-level expectations guidance.
- `https://continuousdelivery.com/implementing/patterns/` — small batches, automated validation, and continuous feedback.
- `https://dora.dev/research/` — delivery metrics used for system learning rather than individual targets.
