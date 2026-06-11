---
name: skill-authoring
description: "create, review, or update Pi skills while preserving the canonical SKILL.md format, registry contract, activation rules, and validation expectations."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Skill Authoring

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "workflow",
  "domains": ["skills", "agent-configuration", "routing"],
  "triggers": {
    "paths": [
      ".pi/skills/**/SKILL.md",
      ".pi/agent/skills/**/SKILL.md",
      "extensions/skill-registry/templates/skill-template.md"
    ],
    "keywords": [
      "create skill",
      "crear skill",
      "SKILL.md",
      "skill registry",
      "skill-template",
      "registry contract"
    ]
  },
  "sdd_phases": ["explore", "design", "task", "apply", "verify"],
  "related_skills": [
    "sdd-workflow",
    "persistent-memory"
  ],
  "priority": 85
}
```

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `triggers.paths`: glob-like project paths that should activate this skill.
- `triggers.keywords`: user/request/code keywords that should activate this skill.
- `sdd_phases`: phases where this skill is usually useful: `explore`, `proposal`, `spec`, `design`, `task`, `apply`, `verify`, `archive`.
- `related_skills`: skills that should be considered when this skill is active.
- `priority`: routing priority from 0 to 100. Higher means consider earlier when multiple skills match.

## Activation Contract

Use this skill when the user asks to create, modify, review, standardize, or document a Pi skill, especially any `SKILL.md` under `.pi/skills/**` or `.pi/agent/skills/**`. Prefer this skill before writing skill files so all new skills follow the canonical template from `extensions/skill-registry/templates/skill-template.md`.

## Hard Rules

- Always follow the canonical structure from `extensions/skill-registry/templates/skill-template.md` unless the user explicitly requests a different format.
- Always include frontmatter with `name`, `description`, `license`, and `metadata` containing `author` and `version`.
- Always include a valid JSON `Registry Contract` block.
- Keep `description` trigger-focused: mention the surfaces, actions, or risks that should activate the skill.
- Keep `triggers.paths`, `triggers.keywords`, `domains`, and `related_skills` concrete and useful for routing.
- Do not put secrets, credentials, private keys, or user-private data in skills.
- Do not invent durable project rules. If a rule is uncertain, put it under `Decision Gates` or ask the user.
- Use English for reusable skill content even when conversing with the user in another language.

## Decision Gates

- If the skill governs PRD/SDD/OpenSpec workflows, also consider `sdd-workflow` and do not contradict its gates.
- If the skill governs memory behavior, also consider `persistent-memory` and keep save/recall policy consistent.
- If creating a project-local skill for a codebase you have not inspected, ask whether to inspect the relevant files first or write a generic starter skill.
- If the requested skill would change future agent behavior globally, confirm the intended scope: global agent skill vs project-local skill.

## Execution Steps

1. Identify the target scope and path: global agent skill or project-local skill.
2. Read `extensions/skill-registry/templates/skill-template.md` if it has not already been loaded in the conversation.
3. Choose a lowercase kebab-case skill name and matching directory name.
4. Write `SKILL.md` using the canonical section order:
   - frontmatter;
   - title;
   - `Registry Contract`;
   - `Activation Contract`;
   - `Hard Rules`;
   - `Decision Gates`;
   - `Execution Steps`;
   - `Output Contract`;
   - `References`.
5. Validate that the registry contract JSON parses mentally or with a lightweight command when appropriate.
6. If routing should use the new skill immediately, recommend regenerating the skill registry.

## Output Contract

Return:

- Skill applied: `skill-authoring`.
- Skill path created or updated.
- Scope chosen: global agent skill or project-local skill.
- Template sections included.
- Related skills considered or explicitly discarded.
- Validation executed, or the concrete reason it was not run.
- Any open decisions about scope, routing, or registry regeneration.

## References

- `extensions/skill-registry/templates/skill-template.md` — canonical skill file format and registry contract conventions.
- `.pi/agent/skills/persistent-memory/SKILL.md` — memory policy skill example.
- `.pi/agent/skills/sdd-workflow/SKILL.md` — workflow/gating skill example.
