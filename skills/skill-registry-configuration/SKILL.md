---
name: skill-registry-configuration
description: "configure Pi Skill Registry project settings, especially .pi/skill-registry.config.json opt-in enablement, generated registry outputs, and safe routing validation."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Skill Registry Configuration

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "workflow",
  "domains": ["skills", "skill-registry", "project-configuration", "routing"],
  "triggers": {
    "paths": [
      ".pi/skill-registry.config.json",
      ".pi/skill-registry.json",
      ".pi/skill-registry.md",
      "extensions/skill-registry/**",
      "skills/skill-registry-configuration/SKILL.md",
      "~/.pi/agent/skills/skill-registry-configuration/SKILL.md"
    ],
    "keywords": [
      "skill registry configuration",
      "skill-registry.config.json",
      "enable skill registry",
      "disable skill registry",
      "skill registry",
      "skill_registry_generate",
      "skill_registry_resolve"
    ]
  },
  "sdd_phases": ["explore", "design", "task", "apply", "verify"],
  "related_skills": [
    "skill-authoring",
    "persistent-memory"
  ],
  "priority": 84
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

Use this skill when a user asks to configure Pi Skill Registry for a project, create or review `.pi/skill-registry.config.json`, enable or disable the registry, explain why registry tools are missing, or validate generated registry files. Prefer this skill before editing skill-registry project configuration.

## Hard Rules

- Treat `.pi/skill-registry.config.json` as project configuration, not as generated registry content.
- `enabled` defaults to `false`; the extension should be considered off unless the project explicitly opts in with `enabled: true`.
- Generated `.pi/skill-registry.json` and `.pi/skill-registry.md` are outputs, not the source of truth.
- Do not store secrets, tokens, or unrelated project state in `.pi/skill-registry.config.json`.
- After changing `.pi/skill-registry.config.json` or extension code, tell the user to `/reload` or restart Pi before relying on the new behavior.
- Validate routing with `skill_registry_generate` and representative `skill_registry_resolve` checks only when the extension is enabled and available.
- Use English for reusable configuration examples and skill content.

Recommended project config:

```json
{
  "enabled": true
}
```

Field rules:

- `enabled`: defaults to `false`; set `true` to let the extension register `skill_registry_generate`, `skill_registry_resolve`, and the `/skill-registry` command for the project.

## Decision Gates

- If the user wants the registry active in the project, confirm that `enabled: true` is intentional, because disabled is now the safe default.
- If the user expects registry tools but the config is missing or invalid, explain the opt-in gate first before debugging generated artifacts.
- If the user asks to change skills and generated routing behavior together, also consider `skill-authoring`.

## Execution Steps

1. Identify the target project cwd and whether `.pi/skill-registry.config.json` already exists.
2. Read the existing config before editing.
3. Preserve valid fields unless the user asks to replace them.
4. Add or update `enabled` according to the approved project behavior.
5. Validate the JSON syntax after edits.
6. Tell the user to `/reload` or restart Pi.
7. If enabled and the user requested validation, run `skill_registry_generate` and at least 2 focused `skill_registry_resolve` checks.
8. If generated outputs are inspected, treat `.pi/skill-registry.json` and `.pi/skill-registry.md` as cache/index artifacts only.

## Output Contract

Return:

- Skill applied: `skill-registry-configuration`.
- Target project/path configured or reviewed.
- Whether the registry is enabled and why.
- Reload/validation performed, or the concrete reason it was not run.
- Risks, drift, or open decisions.

## References

- `.pi/skill-registry.config.json` — project skill-registry configuration.
- `extensions/skill-registry/README.md` — Skill Registry extension behavior and generated outputs.
- `extensions/skill-registry/index.ts` — entrypoint enable gate.
- `extensions/skill-registry/src/config.ts` — config parsing and default-off behavior.
- `extensions/skill-registry/src/tools.ts` — registry tools available only when enabled.
- `.pi/agent/skills/skill-authoring/SKILL.md` — canonical skill authoring format.
