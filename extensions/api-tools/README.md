# Pi API Tools Extension

[English](#english) | [Español](#español)

## English

Project-local Pi extension for bounded REST and GraphQL API tools. It is disabled by default and only activates when the current project contains `<ctx.cwd>/.pi/api.json` with `"enabled": true`.

### What it provides

- `api_status` for safe config and Git-exposure diagnostics.
- `api_auth_status` for local auth metadata checks such as JWT `exp`.
- `api_login` for configured login and local `access_token` persistence.
- `api_rest_request` for bounded REST requests.
- `api_graphql_query` for bounded GraphQL queries and mutations.
- `api_graphql_schema_queries` for listing GraphQL Query methods with argument/return summaries.
- `api_graphql_schema_query` for inspecting one GraphQL Query method and rendering its bounded nested return schema as GraphQL-like type text.
- Secret redaction in tool content, details, and errors.
- Output truncation metadata for large responses.
- Timeout and `AbortSignal` cancellation support.

### Extension location

In this agent-dir checkout the extension lives at:

```txt
extensions/api-tools/index.ts
```

When copied into a project-local Pi setup, the equivalent path is:

```txt
.pi/extensions/api-tools/index.ts
```

Use `/reload` after changing extension code during an interactive Pi session.

### Enablement and exact config lookup

This extension reads configuration from exactly one path:

```txt
<ctx.cwd>/.pi/api.json
```

Rules:

- No parent-directory lookup.
- No home-directory or global lookup.
- No environment-based config discovery.
- If that exact file is missing, the extension registers no tools.
- If `enabled` is absent or not exactly JSON boolean `true`, the extension registers no tools.

### Example `.pi/api.json`

Use placeholders only. Do not store real secrets in docs, tests, or examples.

```json
{
  "enabled": true,
  "url": "https://api.example.com",
  "port": 443,
  "graphql_url": "https://api.example.com/graphql",
  "timeout_ms": 30000,
  "limits": {
    "max_response_bytes": 50000,
    "max_response_lines": 2000
  },
  "headers": {
    "x-project-client": "pi"
  },
  "auth": {
    "type": "login",
    "login_path": "/login",
    "username": "example-user",
    "password": "<password>",
    "access_token": ""
  }
}
```

Other placeholder-only auth examples:

```json
{ "type": "none" }
```

```json
{ "type": "basic", "username": "example-user", "password": "<password>" }
```

```json
{ "type": "api_key", "header": "x-api-key", "value": "REDACTED" }
```

```json
{ "type": "headers", "headers": { "authorization": "Bearer <token>", "x-extra-auth": "example" } }
```

```json
{ "type": "login", "login_path": "/login", "username": "example-user", "password": "<password>", "access_token": "" }
```

Supported auth variants:

- `none`
- `bearer`
- `basic`
- `api_key`
- `headers`
- `login`

### Tools exposed to the agent

The extension exposes tools only when the exact local config exists and `enabled === true`.

| Tool | Purpose |
|---|---|
| `api_status` | Report whether config exists, whether it is enabled, configured endpoints, auth type, effective timeout, effective limits, warnings, and Git exposure state without exposing secrets. |
| `api_auth_status` | Inspect local auth metadata without backend calls. Bearer JWT tokens and login `access_token` values report `valid`/`expired`, `expires_at`, and `seconds_remaining` from `exp` when possible; unsupported or non-JWT metadata returns `unknown`. |
| `api_login` | Execute configured login, read `access_token` from the JSON response, and persist it into `.pi/api.json` without exposing it. |
| `api_rest_request` | Execute `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS` against the configured REST base URL with safe bounded output. Set `use_token: false` for public endpoints. |
| `api_graphql_query` | Execute GraphQL queries and mutations against the configured `graphql_url` with safe bounded output. Set `use_token: false` for public operations. |
| `api_graphql_schema_queries` | List GraphQL `Query` methods with argument and return type summaries using bounded introspection. |
| `api_graphql_schema_query` | Inspect one GraphQL `Query` method by name, including arguments and a bounded nested return schema rendered as GraphQL-like type text. Accepts `max_depth` and `use_token`. |

If the config is missing or disabled, none of the API tools are registered.

### Mutation model

REST mutating methods (`POST`, `PUT`, `PATCH`, `DELETE`) and GraphQL mutations do **not** add extension-specific confirmation prompts.

They rely on Pi's normal tool and permission behavior.

### Git ignore expectations

`.pi/api.json` may contain credentials and must be Git-ignored.

Recommended ignore rule:

```gitignore
.pi/api.json
```

`api_status` checks the file's Git exposure state and warns when it appears:

- unignored and untracked;
- tracked by Git; or
- unknown because Git status could not be determined safely.

In other words, `api_status` is expected to warn if `.pi/api.json` is not ignored, is already tracked, or Git evidence is unavailable.

### Output limits and truncation

Default response limits are:

- `max_response_bytes`: `50000`
- `max_response_lines`: `2000`

You can override them in `.pi/api.json` with `limits.max_response_bytes` and `limits.max_response_lines`.

REST and GraphQL results include truncation metadata with the effective limits and whether output was truncated. Truncated results report a summary with fields such as:

- `truncated`
- `limit_bytes`
- `limit_lines`
- `original_bytes_known`
- `original_lines_known`
- `returned_bytes`
- `returned_lines`
- `reason`

### Cancellation and timeouts

- Requests respect the configured `timeout_ms`.
- Requests propagate `AbortSignal` cancellation.
- Timed out or cancelled requests return safe errors without exposing secrets.

### Output safety

- Secret values from config are redacted from tool content, details, and errors.
- Secret-like values in responses are also redacted before model-visible output.
- `api_status` reports auth type and endpoint presence, not raw credential values.
- `api_auth_status` never exposes raw tokens or decoded sensitive claims; when JWT `exp` is available, it reports only expiry time and seconds remaining.

### Recommended workflow

1. Create `<ctx.cwd>/.pi/api.json` with `"enabled": true`.
2. Add `.pi/api.json` to `.gitignore` before storing credentials.
3. Run `api_status` to confirm enabled state, effective limits, endpoints, and Git warnings.
4. Run `api_login` when using `auth.type: "login"`; it expects a JSON response with `access_token` and persists it into `.pi/api.json`.
5. Run `api_auth_status` if you need a local token metadata check.
6. Use `api_rest_request` or `api_graphql_query` for bounded API access. Pass `use_token: true` for authenticated endpoints and `use_token: false` for public endpoints.
7. Use `api_graphql_schema_queries` to discover available GraphQL Query methods, then `api_graphql_schema_query` with a single query name to inspect its arguments and return shape.

### Validation

```bash
cd extensions/api-tools
npm test
npm run typecheck
```

## Español

Extensión de Pi para exponer herramientas REST y GraphQL acotadas por proyecto.

### Resumen

API Tools se activa solo cuando el proyecto actual contiene `<ctx.cwd>/.pi/api.json` con `enabled: true`. Permite llamadas API locales o remotas con configuración explícita, login/token, límites de salida y diagnósticos seguros.

### Herramientas y capacidades

- Herramientas REST configuradas por proyecto.
- Herramientas GraphQL configuradas por proyecto.
- Login y persistencia de access token cuando la configuración lo permite.
- Control por request para usar o no usar token.
- Límites de salida, timeouts, cancelación y protección contra filtrado de secretos.

### Uso recomendado

Úsalo cuando el agente necesite consultar APIs del proyecto sin hardcodear endpoints ni credenciales en prompts o código.

### Ver más

La sección en inglés documenta el formato completo de `.pi/api.json`, modelo de mutaciones, límites, seguridad y validación.
