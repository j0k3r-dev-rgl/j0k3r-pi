---
name: api-tools-configuration
description: "configure Pi API Tools Extension, including project-local .pi/api.json enablement, localhost endpoints, login/access_token persistence, token usage flags, and safe reload guidance."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# API Tools Configuration

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "runtime",
  "domains": ["api-tools-configuration", "api-json-config", "rest-graphql-config", "login-token-config"],
  "triggers": {
    "paths": [
      ".pi/api.json",
      "api.json",
      "extensions/api-tools/README.md"
    ],
    "keywords": [
      "api tools configuration",
      "configure api tools",
      "configurar api tools",
      "configuracion api tools",
      "configuración api tools",
      "como configurar api tools",
      "cómo configurar api tools",
      "como se configura api tools",
      "cómo se configura api tools",
      "api.json",
      ".pi/api.json",
      "api login config",
      "access_token",
      "graphql_url",
      "use_token",
      "api_status",
      "api_login",
      "api_auth_status"
    ]
  },
  "sdd_phases": [],
  "related_skills": [
    "permission-guard-configuration"
  ],
  "priority": 70
}
```

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `triggers.paths`: configuration paths or docs that should activate this skill.
- `triggers.keywords`: configuration-only phrases and field names that should activate this skill.
- `sdd_phases`: keep empty for configuration-only skills so phase routing alone does not load it.
- `related_skills`: configuration-adjacent skills only; do not add implementation or SDD skills for normal config help.
- `priority`: route similarly to other extension configuration skills.

## Activation Contract

Use this skill only when the user asks how to configure, enable, troubleshoot, or explain the Pi API Tools Extension configuration, especially project-local `.pi/api.json`, localhost REST/GraphQL endpoints, login credentials, `access_token` persistence, `use_token` request behavior, or safe readiness checks.

Do not load this skill for implementation work under `extensions/api-tools/**`, adding new API tools, changing runtime behavior, or broad SDD planning. Those are code/change tasks, not configuration-only help.

## Hard Rules

- The extension reads exactly `<ctx.cwd>/.pi/api.json`; do not tell users that global, parent-directory, or environment config files are used.
- The extension is disabled unless `.pi/api.json` exists and contains JSON boolean `"enabled": true`.
- `.pi/api.json` can contain credentials and must be ignored by Git. Recommend `.pi/api.json` in `.gitignore` and verify with `api_status` or `git check-ignore -v .pi/api.json` when needed.
- Never print or store real passwords, tokens, or private credentials in chat, docs, memories, commits, or examples.
- Use placeholders in examples. If inspecting a live config, report booleans such as `has_password` or token length/status, not raw values.
- For login-based auth, configure `auth.type: "login"`, `login_path`, `username`, `password`, and optional `access_token`. The `api_login` tool persists the backend response token into `auth.access_token`.
- The preferred persisted token field is `access_token`. The login response may provide either `access_token` or `token`; the extension persists either one as `auth.access_token`.
- For authenticated REST/GraphQL calls, set `use_token: true` or omit it. For public endpoints, set `use_token: false`.
- After changing `.pi/api.json` or extension config docs, tell the user to `/reload` or restart Pi before expecting tool registration/config changes to appear.

Recommended local development config:

```json
{
  "enabled": true,
  "url": "http://localhost",
  "port": 8080,
  "graphql_url": "http://localhost:8080/graphql",
  "timeout_ms": 30000,
  "limits": {
    "max_response_bytes": 50000,
    "max_response_lines": 2000
  },
  "headers": {
    "x-project-client": "test"
  },
  "auth": {
    "type": "login",
    "login_path": "/auth/login",
    "username": "<username>",
    "password": "<password>",
    "access_token": ""
  }
}
```

Configuration field notes:

- `url`: REST base URL. `port`, when provided, is applied to REST requests.
- `graphql_url`: full GraphQL endpoint URL.
- `timeout_ms`: request timeout.
- `limits.max_response_bytes` and `limits.max_response_lines`: response bounding.
- `headers`: non-secret default request headers; secret-like headers are redacted in output.
- `auth.type`: supported values include `none`, `bearer`, `basic`, `api_key`, `headers`, and `login`; prefer `login` for automatic local token persistence.

## Decision Gates

- If the user asks to add or modify tool behavior, stop treating it as configuration-only and use the normal workflow triage/code-change process.
- If the backend login response uses a different token field than `access_token` or `token`, ask for the response shape before advising changes.
- If the user wants to test a live endpoint, confirm whether the endpoint is public (`use_token: false`) or private (`use_token: true`).
- If `api_auth_status` reports `unknown`, explain that the token may not be a JWT with `exp`; do not assume it is invalid.
- If `api_status` warns that `.pi/api.json` is tracked/unignored/unknown, prioritize fixing Git exposure before storing real credentials.

## Execution Steps

1. Identify whether the task is configuration help, readiness troubleshooting, or a code-change request.
2. If editing config, read existing `.pi/api.json` first and preserve unrelated fields.
3. Ensure `enabled: true`, local `url`/`port`, `graphql_url`, safe `limits`, and appropriate `auth` shape.
4. Verify `.pi/api.json` is ignored before real credentials are stored.
5. Tell the user to `/reload` after config or extension changes.
6. Use `api_status` to confirm effective config without exposing secrets.
7. Use `api_login` only when `auth.type: "login"` is configured and the user wants the token persisted.
8. Use `api_auth_status` to inspect token validity/expiry when the token is JWT-like.
9. For GraphQL discovery, use `api_graphql_schema_queries` to list methods, then `api_graphql_schema_query` for one method's schema.

## Output Contract

Return:

- Skill applied: `api-tools-configuration`.
- Config path reviewed or changed.
- Enablement, endpoint, auth mode, and token-handling guidance.
- Secret handling confirmation.
- Readiness/status validation executed, or why it was not run.
- Required `/reload` or restart note.
- Any open decisions such as login response shape, public/private endpoint token usage, or Git ignore status.

## References

- `extensions/api-tools/README.md` — user-facing setup, tools, login, token, and GraphQL schema discovery guidance.
- `extensions/api-tools/src/config.ts` — exact `.pi/api.json` lookup, enablement, defaults, and auth parsing.
- `extensions/api-tools/src/client.ts` — REST/GraphQL request construction, login request, and token header behavior.
- `extensions/api-tools/src/tools.ts` — registered tools, `api_login`, `api_auth_status`, and GraphQL schema tool behavior.
- `extensions/api-tools/src/security.ts` — redaction, response limits, and token expiry inspection.
