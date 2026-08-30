---
name: delivery-planning
description: "turn approved product requirements and architecture into outcome-oriented delivery plans. Use when creating roadmaps, small vertical increments, functional sprint goals, delivery policies, release sequencing, or a proportional Definition of Done; do not impose ceremonies, speculative dates, or unapproved scope."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.3"
registry:
  category: "domain"
  domains: "delivery-planning, roadmaps, sprint-planning, vertical-slicing, definition-of-done"
  paths: "docs/04-delivery/**/*.md"
  keywords: "delivery planning, outcome roadmap, roadmap, create roadmap, delivery roadmap, increment, delivery increment, plan increment, delivery model, release sequencing, plan sprint, sprint goal, vertical slice, Definition of Done, planificar entrega, planificar sprint, modulo funcional completo, corte vertical"
  related: "project-documentation, anti-overengineering, tdd"
  priority: 92
---

# Delivery Planning

## Activation Contract

Use this skill when approved product requirements and applicable architecture decisions must become an outcome roadmap, delivery model, small vertical increments, sprint plans, or a shared Definition of Done. It owns modular documents under `docs/04-delivery/`.

Activate it for one bounded planning horizon or one small functional module at a time. Delivery is the only lifecycle owner that modularizes work into roadmap horizons, increments, and sprints. When the user selects sprints, each sprint should pursue one coherent outcome and deliver a small vertical module that is integrated, verifiable, and fully functional against its approved scope and applicable Definition of Done.

Do not use it to discover the product, expand scope, invent capacity or dates, redefine requirements/architecture, rewrite product documentation into phases, implement work, or impose Scrum, Kanban, two-week sprints, story points, velocity, ceremonies, feature flags, release trains, or infrastructure without an explicit need.

## Hard Rules

- Consume the `project-documentation` routing decision and shared `project-documentation/references/document-contract.md` context already supplied by the router. If no router context was supplied, load `project-documentation` once for owner selection and the shared contract without expanding the full lifecycle. Load and follow `anti-overengineering` whenever this skill is active. Load `tdd` only when planning code changes.
- Use approved product, requirement, architecture, and technical-decision IDs as inputs. Stop if the functional slice, acceptance, applicable quality conditions, dependency, or decision owner needed for planning is unresolved.
- Ask the user before selecting delivery model, cadence, sprint length, capacity assumption, priority, sequence, scope commitment, release boundary, quality policy, rollout, rollback, or date.
- Always ask a focused question set before defining each increment or sprint. Never assume the goal, scope, sequence, cadence, capacity, dependencies, validation, Definition of Done, release boundary, Git trace preference, or commit intent for an increment/sprint. The agent may recommend the simplest coherent option and explain trade-offs, but the user must decide. Then present a mini-summary of the proposed increment/sprint goal, included app behavior, exclusions, validation/DoD, dependencies, risks, and delivery model assumptions, and request explicit user confirmation before writing or updating the increment/sprint document.
- Choose Scrum only when a stable team benefits from a protected short-term outcome and recurring inspect/adapt boundary. Choose Kanban/continuous flow when arrivals are volatile, interrupt-driven, or better forecast through flow. Use a hybrid only when each retained mechanism solves a demonstrated problem. When Kanban/flow is selected, use `03-increments/` records as flow items and create `04-sprints/` records only when sprints are explicitly selected.
- Roadmaps communicate outcomes, hypotheses, confidence, dependencies, and horizons. They do not become detailed feature/date promises, and they do not redefine official product scope as phases.
- Plan at lower detail farther from execution: `Now` is concrete, `Next` is directional, and `Later` remains optional and low-confidence. If a user-supplied phase is not part of the current MVP/app work, place it in `Later`, exclusions, or possible extensions instead of treating it as current scope.
- Slice by user journey, use case, segment, workflow step, outcome, or risk. Never call frontend-only, backend-only, database-only, or infrastructure-only work a complete functional module.
- A sprint module is “fully functional” only when every requirement and acceptance criterion in its approved boundary passes, applicable quality constraints pass, the change is integrated, and the Definition of Done is met. Do not add unapproved future cases to claim completeness.
- Permit explicitly linked enabling work within the same coherent Sprint Goal only when it is necessary to deliver or safely unlock the vertical increment, has its own acceptance/DoD evidence, and is not represented as user-complete value.
- If a module cannot reasonably reach Done inside the selected sprint, return to the product or requirements owners to decide whether the behavior boundary is semantically splittable; otherwise adjust delivery scope or cadence before commitment. Do not let sprint capacity reshape canonical product/requirement scope silently, and do not plan an intentionally half-functional module as the sprint outcome.
- Keep one sprint focused on one coherent goal. Add multiple items only when they directly support that goal and can all reach Done without hiding capacity risk.
- Always recommend using Git as the trace boundary between increments or sprints: start from a clean working tree when possible, keep changes focused to the confirmed increment/sprint, and link the final commit hash to the increment/sprint record once the user authorizes commit. This is a recommendation and trace expectation, not automatic commit or push authorization.
- When delivery plans or executes a post-base extension, link the increment/sprint to the canonical product, requirement, architecture, technical-decision, validation, or change-request record that approved the extension. Do not let delivery records become the only documentation of a product extension.
- Place RED → GREEN → REFACTOR inside each behavior change. Completion evidence must link the safety baseline, expected RED failure, GREEN result, refactor validation, and applicable broader checks. TDD does not replace relevant integration, end-to-end, exploratory, usability, accessibility, security, performance, operational, or product validation.
- Use a Definition of Done as the shared quality floor. Do not create a bureaucratic Definition of Ready; ask only what is necessary for the next slice to be understood and completed.
- Automate repeatable checks and scale assurance, release controls, observability, rollback, feature flags, canaries, SLOs, and operational documentation to actual risk.
- For data-affecting releases, state whether code rollback is safe. Otherwise record the approved compatibility, restore, containment, or forward-fix approach and its owner; do not design an unapproved migration.
- When an increment causes or is materially affected by an unresolved privacy incident, unauthorized personal-data processing, or privacy guardrail breach, do not claim `DONE`, approve release, or mark the next dependent increment `ELIGIBLE` until the authorized owner records containment/disposition and required Validation or change-request evidence. Unrelated work may continue only through explicit unaffected trace links.
- Require the risk-proportional release evidence defined by applicable technical decisions, including security verification, release-artifact integrity, and vulnerability/incident response ownership when relevant.
- Never use velocity, coverage, DORA, story points, or individual output as proof of product value or as individual performance quotas. Any delivery metric used must support system/process learning, not prove product value or evaluate individuals.
- Delivery may create a conditional plan pending a named ADR and may provide explicit user-approved provisional constraints to `technical-decisions`; mark each affected increment or sprint `CONDITIONAL_NOT_COMMITTABLE` until the ADR is approved, while unrelated planning proceeds only through explicit unaffected trace links.
- Create only the delivery documents needed now; do not generate future sprints, delivery phases, or a complete roadmap speculatively.

## Decision Gates

Before planning delivery, resolve:

- approved outcome, functional module, requirement/acceptance IDs, architecture decisions, and applicable quality constraints;
- team composition, demonstrated capacity evidence, dependencies, interruptions, and operational ownership;
- Scrum, Kanban/flow, or another explicitly chosen cadence with the reason it fits;
- sprint or replenishment horizon without assuming two weeks;
- one user-confirmed goal and smallest vertical module capable of reaching Done, without assuming scope or sequence;
- whether any user-supplied phase/stage term is product scope, future extension, or delivery sequencing;
- release exposure, data effects, blast radius, rollout, rollback/mitigation, data compatibility/restore/forward-fix needs, support, and monitoring proportional to risk;
- applicable security verification, release-integrity evidence, vulnerability/incident response ownership, and justified change-specific checks;
- Definition of Done and any justified change-specific checks;
- release authorization state: `NOT_REQUESTED | APPROVED | BLOCKED`, its owner, and evidence when approved;
- Git trace preference for the increment/sprint, including whether the user authorizes a commit after validation and how the commit hash will be linked back to the delivery record;
- user who owns priority, scope, date, risk, release, and commit decisions.

Stop and ask when:

- product, requirements, architecture, or acceptance are missing or contradictory;
- the proposed module is too large or is only a technical layer;
- capacity, dependencies, or external commitments cannot support the requested scope/date;
- multiple valid cadence, sequencing, rollout, or quality trade-offs remain;
- the plan requires scope expansion, migration, procurement, external delivery, or implementation not separately authorized.

## Execution Steps

1. Identify the bounded delivery decision and trace it to approved product, requirement, architecture, and technical-decision IDs.
2. Ask one concise grouped questionnaire for cadence, capacity, priority, dependencies, quality, release risk, and decision ownership.
3. When defining or changing any increment or sprint, ask the required focused questions first and do not infer unanswered choices. Recommend options when useful, but mark unresolved choices as blockers until the user decides. Then provide a mini-summary and wait for explicit user confirmation before creating or updating that increment/sprint artifact.
4. Create only the required delivery paths:

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

5. Use `00-delivery-model.md` for chosen Scrum/Kanban/flow policies, rationale, cadence, planning/review triggers, WIP or sprint boundaries, interruption handling, and change conditions.
6. Use `01-roadmap.md` as a concise `Now / Next / Later` outcome map with confidence, dependencies, measures, and explicit non-commitments.
7. Use `02-definition-of-done.md` for the shared product-appropriate quality floor: review; applicable change-type validation evidence for code changes; acceptance/conformance verification; applicable integration, exploratory, usability, accessibility, security, performance, and operational checks; product-validation links when learning is required; documentation/telemetry; release-integrity and vulnerability-response evidence; rollback or data-safe mitigation; and potentially releasable status. Potentially releasable never implies release authorization.
8. Store each confirmed small vertical, independently reviewable delivery unit under `03-increments/`, linking outcome, requirements, acceptance, architecture, dependencies, validation need, Git trace recommendation, completion evidence, commit hash when the user authorized and created one, and status: `PLANNED | IN_PROGRESS | DONE | NOT_DONE | BLOCKED | CONDITIONAL_NOT_COMMITTABLE`.
9. Store each explicitly selected and confirmed sprint under `04-sprints/` with one goal, one small fully functional vertical module, any linked enabling work, scope/exclusions, increment/requirement IDs, dependencies, applicable change-type validation plan and result evidence, broader validation, Definition of Done, capacity assumptions, risks, Git trace recommendation, commit hash when the user authorized and created one, and result status.
10. When execution evidence exists, update the increment/sprint with outcome evidence; TDD and broader-check links; linked commit hash or `Not created — <reason>`; `DONE | NOT_DONE | BLOCKED`; product-validation status `NOT_REQUIRED | REQUIRED | COMPLETED | BLOCKED`; learning-decision and `CR-####` links; affected upstream owners and returned dispositions; data-change migration/version, compatibility, rollback/restore/containment/forward-fix evidence and owner when applicable; release authorization; and next-increment eligibility `ELIGIBLE | BLOCKED | CONDITIONAL`.
11. Do not mark a next increment `ELIGIBLE` while it relies on an affected decision with incomplete required validation or an unresolved change request. `NOT_DONE` returns remaining behavior to bounded replanning; it never becomes hidden carry-over or value evidence.
12. If an approved increment is larger than one credible sprint, return it to product/requirements owners for boundary splitting rather than creating technical-layer sprints.
13. Validate that planned work can be independently accepted, completion claims link reproducible evidence and any authorized commit hash, no goal/scope/sequence/date/capacity/dependency/DoD/release or Git decision was invented, every increment/sprint has user confirmation evidence, Git trace guidance is present, and no ceremony or release mechanism lacks a current purpose.
14. Stop before implementation or external release unless separately authorized by the applicable Pi workflow and user request.

## Output Contract

Return:

- Skills applied: `delivery-planning`, `startup-documentation`, and `anti-overengineering`; `tdd` when code work is planned.
- Delivery decision and approved input IDs.
- Delivery model and reason selected.
- Roadmap, increment, sprint, or Definition of Done documents created or updated.
- Sprint goal and small vertical module expected to be fully functional against its approved boundary.
- Questions asked, recommendations offered without assumptions, unresolved choices blocked, and mini-summary confirmation evidence for each increment or sprint defined.
- Scope, exclusions, dependencies, capacity assumptions, provisional constraints, data-safe rollback/mitigation, and user-owned commitments.
- Git trace recommendation and linked authorized commit hash for completed increments/sprints, or `Not authorized — <reason>` / `Not created — <reason>` when no commit hash exists.
- Planned change-type validation and acceptance/conformance evidence expectations, broader-quality and product-validation expectations, and anticipated learning-decision/change-request links.
- Observed execution evidence only when already produced by a separately authorized Pi workflow: TDD/check results, result status, affected owner dispositions, next-increment eligibility, applicable data-change evidence, and release authorization; otherwise `None`.
- Speculative dates, ceremonies, infrastructure, and future sprints added: `None`.
- Implementation or release performed: `None` unless separately authorized.
- Validation executed.
- One next permitted action.

## References

- `~/.pi/agent/skills/project-documentation/SKILL.md` — lightweight project documentation routing.
- `~/.pi/agent/skills/project-documentation/references/owners/startup-documentation.md` — new-project lifecycle initialization and shared documentation contract.
- `~/.pi/agent/skills/project-documentation/references/document-contract.md` — modular Markdown contract.
- `~/.pi/agent/skills/project-documentation/references/owners/requirements-definition.md` — functional and acceptance owner.
- `~/.pi/agent/skills/project-documentation/references/owners/architecture-definition.md` — architecture input owner.
- `~/.pi/agent/skills/tdd/SKILL.md` — change-type validation guidance.
- `https://scrumguides.org/scrum-guide.html` — Product Goal, Sprint Goal, refinement, and Definition of Done.
- `https://kanbanguides.org/the-kanban-guide/` — current workflow, WIP, flow measures, and service-level expectations guidance.
- `https://continuousdelivery.com/implementing/patterns/` — small batches, automated validation, and continuous feedback.
- `https://dora.dev/research/` — delivery metrics used for system learning rather than individual targets.
