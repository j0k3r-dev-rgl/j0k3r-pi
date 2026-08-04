---
name: context7-configuration
description: "configure the Pi Context7 extension for library documentation lookup. Use when enabling or changing .pi/context7.json, cache or default settings, API-key handling, readiness checks, library resolution, or safe focused documentation fetching."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.1"
---

# Context7 Configuration

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `paths`: glob-like project paths that should activate this skill.
- `keywords`: configuration-only keywords that should activate this skill.
- `phases`: keep empty for configuration-only skills so phase routing alone does not load them.
- `related`: configuration-adjacent skills only; do not add usage, implementation, or workflow skills.
- `priority`: routing priority from 0 to 100. Higher means consider earlier when multiple skills match.

## Activation Contract

Use this skill only when the user asks how to configure Context7 in Pi or when editing/reviewing Context7 configuration files such as `.pi/context7.json` or agent-root `context7.json`. Cover cache settings, output defaults, and API-key readiness as configuration topics only.

Do not load this skill for ordinary library documentation lookup, tool usage, implementation work under `extensions/context7/**`, or editing this skill file; those are not configuration questions.

## Hard Rules

- Never store `CONTEXT7_API_KEY` or any token in `.pi/context7.json` or repository files.
- Use environment variables for live Context7 credentials.
- Run `context7_status` only for configuration readiness checks when readiness is uncertain.
- Keep cache outside the repository; the extension disables unsafe cache locations.
- Keep output bounded with `defaults.max_chars` and `defaults.result_limit`.
- After changing `.pi/context7.json` or agent-root `context7.json`, tell the user to `/reload` or restart Pi.

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

## Execution Steps

1. Identify whether the task is configuration or readiness troubleshooting.
2. Read existing `.pi/context7.json` before editing.
3. Configure only non-secret fields: `cache.enabled`, `cache.ttl_seconds`, `defaults.max_chars`, and `defaults.result_limit`.
4. Validate JSON syntax after edits.
5. Tell the user to `/reload` or restart Pi.
6. Run `context7_status` when practical to verify effective defaults, cache state, and API-key presence without exposing secrets.

## Output Contract

Return:

- Skill applied: `context7-configuration`.
- Config path reviewed or changed.
- Cache/default values set or preserved.
- Secret handling confirmation.
- Readiness/status validation executed, or the concrete reason it was not run.
- Required reload/restart note and open risks.

## References

- `extensions/context7/README.md` — Context7 configuration and cache behavior.
- `extensions/context7/src/config.ts` — config parsing and default validation.
- `extensions/context7/src/cache.ts` — cache location and safety behavior.
- `extensions/context7/src/security.ts` — secret redaction behavior.
