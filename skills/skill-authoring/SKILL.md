---
name: skill-authoring
description: "create, review, or update Pi skills and their SKILL.md files. Use when authoring skill frontmatter, activation contracts, registry metadata, or validating registry-derived routing."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "2.0"
registry:
  category: "workflow"
  domains: "skills, routing, agent-configuration"
  paths: ".pi/skills/**/SKILL.md, .agents/skills/**/SKILL.md, skills/**/SKILL.md, ~/.pi/agent/skills/**/SKILL.md, ~/.agents/skills/**/SKILL.md, extensions/skill-registry/templates/skill-template.md, .pi/skill-registry.json, .pi/skill-registry.md"
  keywords: "create skill, update skill, modify skill, skill template, skill registry, skill routing, SKILL.md"
  related: "sdd-workflow"
  priority: 85
---

# Skill Authoring

## Activation Contract

Use this skill when creating, editing, auditing, or standardizing a `SKILL.md`, or when validating Skill Registry behavior after a skill change.

## Canonical Scope

This skill owns:

- the canonical `SKILL.md` structure;
- compact registry metadata rules;
- skill-routing quality checks; and
- regeneration of derived registry outputs.

## Hard Rules

- Follow `extensions/skill-registry/templates/skill-template.md` unless the user explicitly wants another format.
- Never edit generated `.pi/skill-registry.json` or `.pi/skill-registry.md` directly.
- Every skill must include `name`, `description`, `license`, and `metadata.author` + `metadata.version`.
- Include `registry:` only when the skill should participate in routing.
- Keep `description` trigger-focused and concrete.
- Keep routing metadata compact and comma-separated.
- Reserve non-empty `registry.phases` for workflow owners and true transversal guardrails. Most domain/helper skills should leave `phases` empty.
- Do not store secrets or private data in skills.
- Use English for reusable skill content.

## Execution Steps

1. Read the template.
2. Choose the smallest useful skill scope.
3. Write or edit the skill with this section order:
   - frontmatter;
   - title;
   - Activation Contract;
   - Canonical Scope;
   - Hard Rules;
   - Execution Steps;
   - Output Contract;
   - References.
4. Regenerate the skill registry.
5. Run at least three routing checks:
   - path-only or weak-intent + path;
   - intent-only;
   - realistic mixed intent + path.

## Output Contract

Return:

- skill path updated;
- scope chosen;
- template compliance status;
- registry regeneration status; and
- routing checks run.

## References

- `extensions/skill-registry/templates/skill-template.md`
- `AGENTS.md`
