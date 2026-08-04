---
name: skill-authoring
description: "create, review, or update Pi skills and their SKILL.md files. Use when authoring skill frontmatter, activation contracts, registry metadata, routing metadata, or validation rules, or when auditing generated Skill Registry consistency; preserve canonical ownership and regenerate derived outputs instead of editing them directly."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.1"
registry:
  category: "workflow"
  domains: "skills, agent-configuration, routing"
  paths: ".pi/skills/**/SKILL.md, .agents/skills/**/SKILL.md, skills/**/SKILL.md, ~/.pi/agent/skills/**/SKILL.md, ~/.agents/skills/**/SKILL.md, extensions/skill-registry/templates/skill-template.md, .pi/skill-registry.json, .pi/skill-registry.md"
  keywords: "create skill, crear skill, update skill, modify skill, lanzadores, activation contract, SKILL.md, skill registry contract, skill registry metadata, skill-template, registry contract, registry metadata, audit skill registry, validate skill registry, skill registry consistency"
  related: "sdd-workflow"
  priority: 85
---

# Skill Authoring

Registry metadata conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `paths`: comma-separated project paths that should activate this skill.
- `keywords`: comma-separated user/request/code keywords that should activate this skill.
- `phases`: comma-separated phases where this skill is usually useful: `explore`, `proposal`, `spec`, `design`, `task`, `apply`, `verify`, `archive`.
- `related`: comma-separated skills that should be considered when this skill is active.
- `priority`: routing priority from 0 to 100. Higher means consider earlier when multiple skills match.
- Omit empty optional fields instead of leaving blank values.

## Activation Contract

Use this skill when the user asks to create, modify, review, standardize, or document a Pi skill, especially any `SKILL.md` under project-local skill directories (`.pi/skills/**`, `.agents/skills/**`) or global/user skill directories (`~/.pi/agent/skills/**`, `~/.agents/skills/**`). Also use it to audit or validate generated `.pi/skill-registry.json` and `.pi/skill-registry.md` against their canonical `SKILL.md` sources. Prefer this skill before writing skill files so all new skills follow the canonical template from `extensions/skill-registry/templates/skill-template.md`.

## Hard Rules

- Always follow the canonical structure from `extensions/skill-registry/templates/skill-template.md` unless the user explicitly requests a different format.
- Treat generated `.pi/skill-registry.json` and `.pi/skill-registry.md` as derivative audit targets only. Never edit them directly; correct canonical `SKILL.md` sources and regenerate.
- Always include frontmatter with `name`, `description`, `license`, and `metadata` containing `author` and `version`.
- Include compact `registry` metadata only when the skill should participate in Skill Registry routing. If it should be excluded, omit the entire `registry:` map; native Pi fields remain valid and the registry ignores the skill without a warning.
- When present, store registry routing metadata in the frontmatter `registry:` map using scalar `category` and `priority`, plus comma-separated `domains`, `paths`, `keywords`, `phases`, and `related` values.
- Always include an `Activation Contract` section with human-readable launchers: concrete user intents, touched surfaces, risks, and cases where the skill should not load.
- Keep `description` trigger-focused: mention the surfaces, actions, or risks that should activate the skill.
- Keep `paths`, `keywords`, `domains`, and `related` concrete and useful for routing.
- Reserve non-empty `phases` for SDD workflow owners or guardrails that are genuinely mandatory throughout those phases. Domain, documentation, configuration, and helper skills use empty phases and rely on intent/path routing because phase-only matches are returned as direct matches and can create unnecessary skill loading.
- Trigger paths must cover the real surfaces agents edit: project-local paths, global/user paths, and repo-relative paths when the active workspace is the global agent directory (for example `skills/**/SKILL.md` under `~/.pi/agent`).
- Trigger keywords should include canonical English terms plus common aliases users actually use when they ask for the skill, without adding broad words that steal unrelated routing.
- Do not put secrets, credentials, private keys, or user-private data in skills.
- Do not invent durable project rules. If a rule is uncertain, put it under `Decision Gates` or ask the user.
- Use English for reusable skill content even when conversing with the user in another language.

## Launcher Quality Checklist

Before considering a skill update complete, check the launchers:

- Path-only routing: representative touched paths should resolve to the intended skill even with a weak intent such as `edit file`.
- Intent-only routing: representative user phrases should resolve to the intended skill even when no path is supplied.
- Weak-intent + path routing: vague requests plus target paths should still route correctly.
- Scope coverage: include project-local paths (`.pi/...`, `.agents/...`), global/user paths (`~/.pi/agent/...`, `~/.agents/...`), and repo-relative paths (`skills/...`, `subagents/...`, root config files) when applicable to the current workspace.
- Specificity: avoid overly broad path globs or keywords that make the skill outrank more specific skills for unrelated work.
- Priority: choose a priority that lets domain-specific skills outrank generic helpers, while workflow/router skills can still win when routing is the task.
- Related skills: include only skills that a future agent should realistically consider one hop away.

## Decision Gates

- If the skill governs PRD/SDD/OpenSpec workflows, also consider `sdd-workflow` and do not contradict its gates.
- If the skill governs memory behavior, follow `AGENTS.md` and the current Engram tool contract so save/recall policy remains consistent.
- If creating a project-local skill for a codebase you have not inspected, ask whether to inspect the relevant files first or write a generic starter skill.
- If the requested skill would change future agent behavior globally, confirm the intended scope: global agent skill vs project-local skill.

## Execution Steps

1. Identify the target scope and path: global agent skill or project-local skill.
2. Read `extensions/skill-registry/templates/skill-template.md` if it has not already been loaded in the conversation.
3. Choose a lowercase kebab-case skill name and matching directory name.
4. Write `SKILL.md` using the canonical section order:
   - frontmatter with optional `registry` metadata;
   - title;
   - `Activation Contract`;
   - `Hard Rules`;
   - `Decision Gates`;
   - `Execution Steps`;
   - `Output Contract`;
   - `References`.
5. Validate that the `registry` frontmatter stays compact and structurally valid, using comma-separated values for `domains`, `paths`, `keywords`, `phases`, and `related`.
6. Regenerate the skill registry after creating or updating any `SKILL.md` when generated artifacts should reflect the change immediately.
7. Run at least 2-3 representative `skill_registry_resolve` checks for changed launchers:
   - one path-only or weak-intent + path query;
   - one intent-only query;
   - one realistic mixed intent + path query for the most important surface.
8. Confirm the updated skill appears with expected paths, keywords, priority, related skills, and read-before-acting guidance. Read `.pi/skill-registry.json` directly only for debugging or when resolver/generator tools are unavailable.

## Output Contract

Return:

- Skill applied: `skill-authoring`.
- Skill path created or updated.
- Scope chosen: global agent skill or project-local skill.
- Template sections included.
- Related skills considered or explicitly discarded.
- Validation executed, including registry generation and representative `skill_registry_resolve` checks, or the concrete reason any were not run.
- Any open decisions about scope, routing, or registry regeneration.

## References

- `extensions/skill-registry/templates/skill-template.md` — canonical skill file format and registry metadata conventions.
- `AGENTS.md` — authoritative memory behavior and Engram policy.
- `~/.pi/agent/skills/sdd-workflow/SKILL.md` or project-local equivalent selected by the skill registry — workflow/gating skill example.
