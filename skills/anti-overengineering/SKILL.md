---
name: anti-overengineering
description: "control scope and prevent overengineering during software planning, architecture, feature implementation, bug fixing, refactoring, and code review. Use when work may introduce abstractions, dependencies, migrations, compatibility layers, speculative features, or scope creep; require the simplest explicitly requested solution and stop for material unresolved decisions."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.1"
registry:
  category: "transversal"
  domains: "software-engineering, planning, implementation, scope-control"
  paths: "**/*.c, **/*.cpp, **/*.cs, **/*.go, **/*.java, **/*.js, **/*.jsx, **/*.kt, **/*.php, **/*.py, **/*.rb, **/*.rs, **/*.swift, **/*.ts, **/*.tsx, openspec/changes/**/*.md"
  keywords: "anti-overengineering, avoid overengineering, evitar sobreingenieria, simplest sufficient solution, solucion suficiente mas simple, scope creep, KISS, YAGNI, unnecessary abstraction, implicit migration, migracion implicita"
  phases: "explore, proposal, spec, design, task, apply, verify"
  related: "workflow-triage, sdd-workflow, tdd"
  priority: 75
---

# Anti-Overengineering

## Activation Contract

Use this skill whenever the agent plans, designs, implements, fixes, debugs, refactors, reviews, or otherwise changes software. Apply it as a transversal guardrail after the applicable workflow and canonical owner are known; it does not replace or outrank them.

Activate it for feature work, bug fixes, architectural planning, implementation planning, maintenance, technical design, and any task that could introduce abstractions, extra scope, migrations, dependencies, compatibility work, or unrequested future-proofing.

Do not use it to obstruct a purely conversational or non-software request. Do not use it to reconfirm instructions that the user or an applicable governing document already states explicitly.

## Canonical Scope

This skill owns:

- complexity and scope guardrails;
- prevention of speculative abstractions, compatibility, and future-proofing;
- migration and dependency authorization checks;
- preference for the smallest sufficient reversible change; and
- stopping once the requested behavior and sufficient validation are complete.

This skill does not own:

- workflow selection or execution authorization;
- product behavior, acceptance, or canonical documentation decisions;
- architecture, technology, test framework, or test-layer selection;
- repository conventions or ordinary local implementation details; or
- verification standards owned by applicable workflow, quality, security, or delivery contracts.

Use this decision order:

1. Latest explicit user instruction.
2. Applicable governing contract.
3. Approved project documentation.
4. Clearly established repository convention.
5. Simplest reversible local implementation.
6. Ask only when material ambiguity remains.

## Hard Rules

- Treat explicit user instructions and applicable governing documents as authoritative. Execute clear instructions without requesting redundant confirmation.
- Never invent a requirement, constraint, preference, acceptance criterion, scope boundary, architecture choice, migration requirement, or product decision.
- Ask only when unresolved alternatives materially differ in approved behavior, scope, architecture, compatibility, dependency, migration, cost, security, irreversibility, external effects, or another user-owned trade-off.
- Choose ordinary local implementation details directly when repository evidence resolves the convention or one option is clearly the simplest reversible compliant choice. Do not ask the user to decide naming, file placement, or equivalent internal details without a material consequence.
- Define the simplest sufficient solution as the option that minimizes new behavior, touched surfaces, dependencies, states, configuration, indirection, coupling, operational burden, blast radius, and irreversibility while fully satisfying governing contracts.
- Simplicity never authorizes weakening correctness, security, privacy, accessibility, data integrity, approved compatibility, applicable change-type validation, required verification, rollback safeguards, or external-effect controls.
- Apply KISS: minimize moving parts, indirection, configuration, dependencies, and conceptual overhead.
- Apply YAGNI: do not add extensibility, abstractions, generic frameworks, compatibility layers, hooks, flags, fallback paths, or future capabilities that were not requested.
- Prefer small local duplication over a new abstraction while no shared contract or concrete maintenance, correctness, or consistency problem is demonstrated. Do not use a universal repetition threshold.
- Lock the scope to the requested behavior and deliverables. The agent may identify and modify directly required files inside that approved boundary; ask before crossing an unapproved component, contract, data boundary, repository, service, or deliverable.
- Do not perform opportunistic cleanup, modernization, refactoring, renaming, formatting, or dependency changes outside the explicit scope.
- Reuse a governing mechanism or clearly established repository convention when it satisfies the approved behavior. Ask only when conventions conflict, ownership is unclear, or following one creates a material trade-off.
- Never perform or create any kind of migration unless the user or an applicable governing document explicitly requires it. This includes data, database schema, files, formats, configuration, APIs, contracts, dependencies, frameworks, infrastructure, storage, protocols, and deployment transitions.
- If a migration might be necessary but is not explicitly required, explain why it may be needed and ask whether it should be included. Do not treat it as automatically required.
- Present any more complex or broader approach only as an optional proposal. Ask the user what they think and do not implement it without explicit authorization.
- Do not disguise an unresolved decision as a minor implementation detail.
- Run the narrowest sufficient validation that proves the approved behavior and applicable risks. Broaden only when coupling, regression surface, security, data, migration, or external effects require it. Do not build extra validation infrastructure without authorization.
- Stop when the requested result is implemented and the required validation passes. Do not continue polishing or expanding the solution.

## Decision Gates

Stop and ask the user before proceeding when any of these is not explicitly resolved:

- expected behavior, acceptance criteria, scope, or exclusions when existing contracts do not resolve them;
- selection between materially different implementations that changes a user-owned trade-off;
- architecture, data model, API, user experience, compatibility, or security behavior when the choice is not already approved;
- introduction of a dependency, service, abstraction, configuration option, feature flag, fallback, or reusable framework;
- any migration, conversion, backfill, upgrade, compatibility bridge, rollout, or infrastructure transition;
- destructive, irreversible, externally visible, or data-affecting behavior;
- expansion beyond the requested files, components, deliverables, or stated objective;
- a trade-off involving complexity, performance, maintainability, cost, risk, or delivery time.

Do not stop when the user, an applicable governing document, approved project documentation, or a clear repository convention already resolves the question. A concrete, unambiguous request authorizes execution without a second start confirmation. Ordinary local, reversible, low-risk details are agent decisions, not user gates.

When blocked, ask all currently known questions together when practical. For each question:

1. Name the missing decision.
2. Explain briefly why it blocks the work.
3. Put the simplest compliant option first.
4. List only materially distinct alternatives.
5. Ask for an explicit choice.

After every answer, reassess only the unresolved decisions. Do not reopen settled decisions unless new evidence creates a real conflict.

## Execution Steps

1. Reuse the selected workflow, canonical owner, approved objective, behavior, deliverables, constraints, exclusions, and acceptance evidence.
2. Classify each needed choice as user/governing-mandated, resolved by repository evidence, ordinary local and reversible, or materially unresolved.
3. Apply mandated and evidence-resolved choices, choose the simplest compliant local details, and ask one concise grouped questionnaire only for materially unresolved decisions.
4. Define the smallest sufficient solution and bounded directly required file set; reject speculative additions and unapproved boundary crossings.
5. Implement only the approved behavior under applicable workflow, safety, quality, and testing contracts.
6. Run the narrowest sufficient validation for the behavior and risks.
7. Report material scope decisions, authorization-sensitive changes, validation, blockers, and residual risks when applicable. Then stop.

## Output Contract

Integrate this guardrail into the normal workflow response rather than emitting a separate ceremonial report. Include only what applies:

- material scope or complexity decisions;
- unresolved user-owned choices and questions;
- dependency, migration, destructive, irreversible, or external-effect authorization;
- validation executed or the concrete blocker; and
- material deferred risk.

For a routine bounded change with no material exception, a concise normal completion response is sufficient.

## References

- `~/.pi/agent/AGENTS.md` — canonical authority for user intent, workflow authorization, scope, change-type validation, and blocker handling.
- `~/.pi/agent/skills/workflow-triage/SKILL.md` — workflow selection without redundant confirmation.
- `~/.pi/agent/skills/tdd/SKILL.md` — required test-driven behavior for code changes.
