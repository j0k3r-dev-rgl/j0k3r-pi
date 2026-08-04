---
name: example-project-skill
description: "specific trigger-focused description. mention the surfaces, actions, or risks that should activate this skill."
license: Apache-2.0
metadata:
  author: your-name-or-team
  version: "1.0"

# Include the registry map only when this skill should participate in Skill Registry routing.
registry:
  category: "base"
  domains: "frontend, forms"
  paths: "front/app/routes/**/*.tsx, front/app/components/**/*.tsx"
  keywords: "useFetcher, fetcher.Form, validation, loading state"
  phases: "explore, design, task, apply, verify"
  related: "example-testing-skill"
  priority: 50
---

# Example Project Skill

Registry metadata conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `paths`: comma-separated glob-like project paths that should activate this skill.
- `keywords`: comma-separated user/request/code keywords that should activate this skill.
- `phases`: comma-separated phases where this skill is usually useful: `explore`, `proposal`, `spec`, `design`, `task`, `apply`, `verify`, `archive`.
- `related`: comma-separated skills that should be considered when this skill is active.
- `priority`: routing priority from 0 to 100. Higher means consider earlier when multiple skills match.
- Omit empty optional fields instead of leaving blank values.
- To exclude a skill from Skill Registry routing, omit the entire `registry:` map. Keep the native Pi fields such as `name` and `description`.

## Activation Contract

Use this skill when {concrete user intent, touched surface, risk, or file pattern}. Prefer the most specific skill that applies.

## Hard Rules

- Rule based on verified project evidence.
- Another non-negotiable convention.
- Do not include speculative rules; mark uncertain guidance as a decision gate.

## Decision Gates

- If {condition}, also consider `{related-skill}`.
- If the change crosses {boundary}, stop and ask for confirmation or escalate to SDD.

## Execution Steps

1. Identify the touched surface.
2. Apply the hard rules before editing.
3. Load related skills when their trigger applies.
4. Run the narrowest relevant validation.

## Output Contract

Return:

- Skill applied: `example-project-skill`.
- Surface and hard rules considered.
- Related skills loaded or explicitly discarded.
- Validation executed, or the concrete reason it was not run.
- Risks, drift, or open decisions.

## References

- `path/to/source` — why it supports this skill.
