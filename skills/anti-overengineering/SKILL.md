---
name: anti-overengineering
description: "Enforce simplest-sufficient solutions (KISS, YAGNI) and prevent overengineering. Trigger: planning, implementation, bug fixing, refactoring, or stopping premature abstractions and speculative scope."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "3.1"
registry:
  category: "transversal"
  domains: "scope-control, implementation, planning"
  paths: "**/*.c, **/*.cpp, **/*.cs, **/*.go, **/*.java, **/*.js, **/*.jsx, **/*.kt, **/*.php, **/*.py, **/*.rb, **/*.rs, **/*.swift, **/*.ts, **/*.tsx, openspec/changes/**/*.md"
  keywords: "anti-overengineering, avoid overengineering, simplest sufficient solution, KISS, YAGNI, scope creep, unnecessary abstraction, implicit migration"
  phases: "apply, verify"
  related: "workflow-triage, work-workflow, tdd"
  priority: 75
---

# Anti-Overengineering

## Activation Contract

Use this skill after the workflow is known whenever the task could introduce unnecessary abstraction, dependency churn, migration, compatibility work, or speculative future-proofing.

## Canonical Scope

This skill owns only:

- simplest-sufficient-solution guardrails;
- scope containment;
- migration/dependency caution; and
- stopping once the requested result is validated.

## Hard Rules

- Treat explicit user instructions and governing contracts as authoritative.
- Never invent requirements, acceptance criteria, architecture, migrations, or future extensibility.
- Prefer the smallest reversible change that satisfies the approved behavior.
- Do not introduce a dependency, migration, service, abstraction, flag, or compatibility layer unless explicitly required or clearly unavoidable.
- Prefer local duplication over a new abstraction unless a real shared contract already exists.
- Do not perform opportunistic cleanup or unrelated modernization.
- Ask only when alternatives change a user-owned trade-off.
- Stop when the requested outcome and required validation are complete.

## Decision Gates

Stop and trigger the decision protocol when the change would introduce:

- a new dependency or service;
- any migration or compatibility bridge;
- materially different architecture or API behavior;
- destructive or externally visible behavior; or
- expansion beyond approved scope.

- **Circuit Breaker**: When any of the gates above are triggered, or when speculative complexity or out-of-scope choices appear:
  - **Subagent execution**: trip the circuit breaker and return `BLOCKED` immediately, specifying the exact decision or trade-off needed. Never guess, assume speculative defaults, or proceed autonomously.
  - **Orchestrator execution**: stop immediately, present the trade-off concisely, and ask the user for the missing decision before performing any file mutation.
- **TypeSafe / Jev Anti-Overengineering Sensor**: When the TypeSafe extension is active in `jev-config`, the orchestrator uses Jev (`typesafe_evaluate`) to detect speculative complexity, unneeded abstractions, or YAGNI violations before planning or applying code changes:
  - Consult Jev with questions assessing overengineering risk: `is_overengineering` (Noul: does the proposed design introduce premature abstractions, unnecessary layers, or unrequested migrations?) and `simplest_solution_fit` (Choice: `simplest_direct`, `moderate`, `overengineered`).
  - If Jev scores high overengineering risk (>0.70) or selects `overengineered`, trip the Circuit Breaker: reject the speculative abstraction, adopt the simplest sufficient local implementation, or prompt the user if an architectural trade-off requires human decision.

## Execution Steps

1. Reuse the chosen workflow and approved scope.
2. Mark each choice as mandated, repository-resolved, simple local detail, or material decision.
3. Choose the simplest compliant local detail.
4. Reject speculative additions.
5. Run the narrowest sufficient validation.

## Output Contract

Integrate this guardrail into the normal response. Mention only:

- material scope decisions;
- unresolved user-owned trade-offs;
- dependency or migration authorization; and
- residual risk, if any.

## References

- `AGENTS.md`
- `skills/workflow-triage/SKILL.md`
- `skills/tdd/SKILL.md`
