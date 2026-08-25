---
name: anti-overengineering
description: "control scope and prevent overengineering during planning, implementation, bug fixing, refactoring, and review. Use when work may introduce abstractions, dependencies, migrations, compatibility layers, or speculative scope."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "2.0"
registry:
  category: "transversal"
  domains: "scope-control, implementation, planning"
  paths: "**/*.c, **/*.cpp, **/*.cs, **/*.go, **/*.java, **/*.js, **/*.jsx, **/*.kt, **/*.php, **/*.py, **/*.rb, **/*.rs, **/*.swift, **/*.ts, **/*.tsx, openspec/changes/**/*.md"
  keywords: "anti-overengineering, avoid overengineering, simplest sufficient solution, KISS, YAGNI, scope creep, unnecessary abstraction, implicit migration"
  phases: "explore, proposal, spec, design, task, apply, verify"
  related: "workflow-triage, sdd-workflow, tdd"
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

Stop and ask when the change would introduce:

- a new dependency or service;
- any migration or compatibility bridge;
- materially different architecture or API behavior;
- destructive or externally visible behavior; or
- expansion beyond approved scope.

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
