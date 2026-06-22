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
  "domains": ["skill-registry-configuration", "skill-registry-config"],
  "triggers": {
    "paths": [
      ".pi/skill-registry.config.json"
    ],
    "keywords": [
      "skill registry configuration",
      "configure skill registry",
      "configurar skill registry",
      "configuro skill registry",
      "como configurar skill registry",
      "cómo configurar skill registry",
      "como configuro skill registry",
      "cómo configuro skill registry",
      "como se configura skill registry",
      "cómo se configura skill registry",
      "configuracion skill registry",
      "configuración skill registry",
      "skill registry config",
      "skill-registry.config.json",
      "enable skill registry",
      "disable skill registry"
    ]
  },
  "sdd_phases": [],
  "related_skills": [],
  "priority": 84
}
```

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `triggers.paths`: glob-like project paths that should activate this skill.
- `triggers.keywords`: configuration-only keywords that should activate this skill.
- `sdd_phases`: keep empty for configuration-only skills so phase routing alone does not load them.
- `related_skills`: configuration-adjacent skills only; do not add usage, implementation, or workflow skills.
- `priority`: routing priority from 0 to 100. Higher means consider earlier when multiple skills match.

## Activation Contract

Use this skill only when the user asks how to configure Pi Skill Registry for a project or when editing/reviewing `.pi/skill-registry.config.json`. Cover opt-in enablement and generated-cache expectations as configuration topics only.

Do not load this skill for ordinary skill routing, registry generation/resolution usage, generated `.pi/skill-registry.json` / `.pi/skill-registry.md` cache edits, extension implementation work, or editing this skill file; those are not configuration questions.

## Hard Rules

- Treat `.pi/skill-registry.config.json` as project configuration, not as generated registry content.
- `enabled` defaults to `false`; the extension should be considered off unless the project explicitly opts in with `enabled: true`.
- Generated `.pi/skill-registry.json` and `.pi/skill-registry.md` are outputs, not the source of truth.
- Do not store secrets, tokens, or unrelated project state in `.pi/skill-registry.config.json`.
- After changing `.pi/skill-registry.config.json`, tell the user to `/reload` or restart Pi before relying on the new behavior.
- Use English for reusable configuration examples and skill content.

Recommended project config:

```json
{
  "enabled": true
}
```

Field rules:

- `enabled`: defaults to `false`; set `true` to let the extension register its Skill Registry runtime surfaces for the project.

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
7. If generated outputs are inspected, treat `.pi/skill-registry.json` and `.pi/skill-registry.md` as cache/index artifacts only, not configuration.

## Output Contract

Return:

- Skill applied: `skill-registry-configuration`.
- Target project/path configured or reviewed.
- Whether the registry is enabled and why.
- Reload/validation performed, or the concrete reason it was not run.
- Risks, drift, or open decisions.

## References

- `.pi/skill-registry.config.json` — project skill-registry configuration.
- `extensions/skill-registry/README.md` — Skill Registry configuration and generated-cache behavior.
- `extensions/skill-registry/src/config.ts` — config parsing and default-off behavior.
