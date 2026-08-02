---
name: anti-overengineering
description: "prevent overengineering during software planning, architecture, feature implementation, bug fixing, refactoring, and other programming work. require the simplest explicitly requested solution, stop for unresolved decisions, and forbid implicit migrations or speculative scope."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Anti-Overengineering

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "transversal",
  "domains": ["software-engineering", "planning", "implementation", "scope-control"],
  "triggers": {
    "paths": [
      "**/*.c",
      "**/*.cpp",
      "**/*.cs",
      "**/*.go",
      "**/*.java",
      "**/*.js",
      "**/*.jsx",
      "**/*.kt",
      "**/*.php",
      "**/*.py",
      "**/*.rb",
      "**/*.rs",
      "**/*.swift",
      "**/*.ts",
      "**/*.tsx",
      "openspec/changes/**/*.md"
    ],
    "keywords": [
      "anti-overengineering",
      "avoid overengineering",
      "evitar sobreingenieria",
      "simplest solution",
      "solucion mas simple",
      "plan software",
      "implementar feature",
      "fix bug",
      "refactor",
      "migration"
    ]
  },
  "sdd_phases": ["explore", "proposal", "spec", "design", "task", "apply", "verify"],
  "related_skills": [
    "workflow-triage",
    "sdd-workflow",
    "tdd"
  ],
  "priority": 95
}
```

## Activation Contract

Use this skill whenever the agent plans, designs, implements, fixes, debugs, refactors, reviews, or otherwise changes software. Apply it at every project stage, alongside any more specific domain or workflow skill.

Activate it for feature work, bug fixes, architectural planning, implementation planning, maintenance, technical design, and any task that could introduce abstractions, extra scope, migrations, dependencies, compatibility work, or unrequested future-proofing.

Do not use it to obstruct a purely conversational or non-software request. Do not use it to reconfirm instructions that the user or an applicable governing document already states explicitly.

## Hard Rules

- Treat explicit user instructions and applicable governing documents as authoritative. Execute clear instructions without requesting redundant confirmation.
- Never invent a requirement, constraint, preference, acceptance criterion, scope boundary, architecture choice, migration requirement, or product decision.
- When required information is missing or more than one valid approach remains, stop before material work. Ask a concise questionnaire and continue asking only necessary follow-up questions until every decision required for the next action is explicitly resolved.
- Do not choose between valid alternatives on the user's behalf. Briefly present the smallest viable options, their material trade-offs, and ask which option the user wants.
- Prefer the simplest solution that satisfies exactly the explicit request and governing contracts.
- Apply KISS: minimize moving parts, indirection, configuration, dependencies, and conceptual overhead.
- Apply YAGNI: do not add extensibility, abstractions, generic frameworks, compatibility layers, hooks, flags, fallback paths, or future capabilities that were not requested.
- Lock the scope to the requested deliverables. Do not modify adjacent behavior or files merely because an improvement appears convenient.
- Do not perform opportunistic cleanup, modernization, refactoring, renaming, formatting, or dependency changes outside the explicit scope.
- Reuse an explicitly required existing mechanism before proposing a new one. If the governing instructions do not select a mechanism, ask rather than infer one from convention.
- Never perform or create any kind of migration unless the user or an applicable governing document explicitly requires it. This includes data, database schema, files, formats, configuration, APIs, contracts, dependencies, frameworks, infrastructure, storage, protocols, and deployment transitions.
- If a migration might be necessary but is not explicitly required, explain why it may be needed and ask whether it should be included. Do not treat it as automatically required.
- Present any more complex or broader approach only as an optional proposal. Ask the user what they think and do not implement it without explicit authorization.
- Do not disguise an unresolved decision as a minor implementation detail.
- Use the narrowest meaningful validation required by the governing contracts. Do not build extra validation infrastructure without authorization.
- Stop when the requested result is implemented and the required validation passes. Do not continue polishing or expanding the solution.

## Decision Gates

Stop and ask the user before proceeding when any of these is not explicitly resolved:

- expected behavior, acceptance criteria, scope, exclusions, or target files;
- selection between two or more valid implementations;
- architecture, data model, API, user experience, compatibility, or security behavior;
- introduction of a dependency, service, abstraction, configuration option, feature flag, fallback, or reusable framework;
- any migration, conversion, backfill, upgrade, compatibility bridge, rollout, or infrastructure transition;
- destructive, irreversible, externally visible, or data-affecting behavior;
- expansion beyond the requested files, components, deliverables, or stated objective;
- a trade-off involving complexity, performance, maintainability, cost, risk, or delivery time.

Do not stop when the user or an applicable governing document has already answered the exact question. A concrete, unambiguous request authorizes execution without a second start confirmation.

When blocked, ask all currently known questions together when practical. For each question:

1. Name the missing decision.
2. Explain briefly why it blocks the work.
3. Put the simplest compliant option first.
4. List only materially distinct alternatives.
5. Ask for an explicit choice.

After every answer, reassess only the unresolved decisions. Do not reopen settled decisions unless new evidence creates a real conflict.

## Execution Steps

1. Extract the exact objective, deliverables, constraints, exclusions, and acceptance criteria from the user's request and applicable governing documents.
2. Identify every decision the requested work would require. Separate explicitly resolved decisions from unresolved ones.
3. If any required decision is unresolved, stop before material work and run the concise questionnaire from `Decision Gates`.
4. Once the task is unambiguous, define the smallest compliant solution and its strict scope. If defining it requires choosing among valid alternatives, return to the questionnaire.
5. Implement only the explicitly requested behavior. Follow applicable workflow, safety, and testing contracts without adding unrelated work.
6. Run only the narrowest meaningful required validation.
7. Report what was done, the validation result, and any explicitly deferred optional ideas. Then stop.

## Output Contract

Return:

- Skill applied: `anti-overengineering`.
- Explicit objective and bounded scope followed.
- Ambiguities found and questions asked, or `None`.
- Simplest compliant solution used.
- Migrations performed: `None` unless explicitly authorized; otherwise cite the authorizing instruction.
- Optional broader ideas not implemented, or `None`.
- Validation executed, or the concrete reason it was not run.

## References

- `~/.pi/agent/AGENTS.md` — canonical authority for user intent, workflow authorization, scope, Strict TDD, and blocker handling.
- `~/.pi/agent/skills/workflow-triage/SKILL.md` — workflow selection without redundant confirmation.
- `~/.pi/agent/skills/tdd/SKILL.md` — required test-driven behavior for code changes.
