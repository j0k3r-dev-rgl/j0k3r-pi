---
name: example-project-skill
description: "specific trigger-focused description. mention the surfaces, actions, or risks that should activate this skill."
license: Apache-2.0
metadata:
  author: your-name-or-team
  version: "1.0"

# Include registry only when this skill should participate in Skill Registry routing.
registry:
  category: "base"
  domains: "frontend, forms"
  paths: "front/app/routes/**/*.tsx, front/app/components/**/*.tsx"
  keywords: "useFetcher, fetcher.Form, validation, loading state"
  related: "example-testing-skill"
  priority: 50
---

# Example Project Skill

Registry metadata conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: comma-separated routing domains.
- `paths`: comma-separated path globs.
- `keywords`: comma-separated trigger phrases.
- `phases`: optional comma-separated SDD phases. Leave empty for most domain/helper skills; use only for workflow owners and true transversal guardrails.
- `related`: optional comma-separated nearby skills.
- `priority`: routing priority from 0 to 100.
- Omit empty optional fields instead of leaving blanks.
- To exclude a skill from routing, omit `registry:` entirely.

## Activation Contract

Use this skill when {concrete user intent, touched surface, or risk}. Prefer the most specific skill that applies.

## Canonical Scope

This skill owns:

- {decision or behavior 1}
- {decision or behavior 2}

It does not own:

- {workflow choice, global policy, or other owners}

## Hard Rules

- Rule based on verified project evidence.
- Another non-negotiable convention.
- Do not repeat global policy from `AGENTS.md`; add only skill-specific rules.

## Execution Steps

1. Identify the touched surface.
2. Apply the hard rules.
3. Load related skills only when their trigger applies.
4. Run the narrowest relevant validation.

## Output Contract

Return:

- Skill applied: `example-project-skill`.
- Surface and rules considered.
- Related skills loaded or discarded.
- Validation executed, or the concrete reason it was not run.

## References

- `path/to/source` — why it supports this skill.
