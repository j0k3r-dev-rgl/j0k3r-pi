---
name: context7-configuration
description: "configure Pi Context7 Extension, including .pi/context7.json cache/defaults, API-key handling, readiness checks, and safe documentation fetching."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Context7 Configuration

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "runtime",
  "domains": ["context7", "documentation", "library-docs", "cache", "configuration"],
  "triggers": {
    "paths": [
      ".pi/context7.json",
      "context7.json",
      "extensions/context7/**",
      "skills/context7-configuration/SKILL.md"
    ],
    "keywords": [
      "context7",
      "context7_status",
      "context7 api key",
      "context7 cache",
      "library docs",
      "up-to-date docs"
    ]
  },
  "sdd_phases": ["explore", "design", "apply", "verify"],
  "related_skills": [
    "permission-guard-configuration",
    "skill-authoring"
  ],
  "priority": 70
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

Use this skill when configuring or troubleshooting Context7 in Pi, especially `.pi/context7.json`, cache settings, defaults for documentation output, readiness/API-key checks, or deciding how agents should fetch up-to-date library documentation.

## Hard Rules

- Never store `CONTEXT7_API_KEY` or any token in `.pi/context7.json` or repository files.
- Use environment variables for live Context7 credentials.
- Run `context7_status` before live documentation calls when readiness is uncertain.
- Keep cache outside the repository; the extension disables unsafe cache locations.
- Keep output bounded with `defaults.max_chars` and `defaults.result_limit`.
- Prefer focused documentation queries over broad library dumps.
- After changing `.pi/context7.json` or extension code, tell the user to `/reload` or restart Pi.

Recommended project config:

```json
{
  "cache": {
    "enabled": true,
    "ttl_seconds": 86400
  },
  "defaults": {
    "max_chars": 12000,
    "result_limit": 5
  }
}
```

## Decision Gates

- If the user wants live Context7 calls, confirm the API key is available in the Pi process environment, not in config.
- If documentation output risks flooding context, lower `max_chars` or ask for a narrower query.
- If cache is disabled for privacy or freshness reasons, do not re-enable it without user confirmation.
- If Context7 docs are needed for SDD discovery, consider `sdd-workflow` routing and use Context7 as evidence, not as implementation approval.

## Execution Steps

1. Identify whether the task is configuration, readiness troubleshooting, or documentation retrieval.
2. Read existing `.pi/context7.json` before editing.
3. Configure only non-secret fields: `cache.enabled`, `cache.ttl_seconds`, `defaults.max_chars`, and `defaults.result_limit`.
4. Validate JSON syntax after edits.
5. Tell the user to `/reload` or restart Pi.
6. Run `context7_status` when practical to verify effective defaults, cache state, and API-key presence without exposing secrets.
7. For docs retrieval, search by human library name first unless the exact Context7 library ID is known.

## Output Contract

Return:

- Skill applied: `context7-configuration`.
- Config path reviewed or changed.
- Cache/default values set or preserved.
- Secret handling confirmation.
- Readiness/status validation executed, or the concrete reason it was not run.
- Required reload/restart note and open risks.

## References

- `extensions/context7/README.md` — Context7 configuration, cache behavior, and tool usage.
- `extensions/context7/src/config.ts` — config parsing and default validation.
- `extensions/context7/src/cache.ts` — cache location and safety behavior.
- `extensions/context7/src/security.ts` — secret redaction behavior.
