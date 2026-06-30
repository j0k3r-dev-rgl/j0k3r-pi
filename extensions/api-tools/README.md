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

Extensión local de proyecto para herramientas API REST y GraphQL acotadas. Está deshabilitada por defecto y solo se activa cuando el proyecto actual contiene `<ctx.cwd>/.pi/api.json` con `"enabled": true`.

### Qué proporciona

- `api_status` para diagnósticos seguros de configuración y exposición en Git.
- `api_auth_status` para checks locales de metadata auth, como `exp` de JWT.
- `api_login` para login configurado y persistencia local de `access_token`.
- `api_rest_request` para requests REST acotados.
- `api_graphql_query` para queries y mutations GraphQL acotadas.
- `api_graphql_schema_queries` para listar métodos GraphQL Query con resumen de argumentos/retorno.
- `api_graphql_schema_query` para inspeccionar un método Query y renderizar su schema de retorno anidado acotado como texto tipo GraphQL.
- Redacción de secretos en contenido, detalles y errores.
- Metadata de truncamiento para respuestas grandes.
- Soporte de timeout y cancelación con `AbortSignal`.

### Ubicación de la extensión

En este checkout de agent-dir la extensión vive en:

```txt
extensions/api-tools/index.ts
```

Cuando se copia a una configuración Pi local de proyecto, la ruta equivalente es:

```txt
.pi/extensions/api-tools/index.ts
```

Usa `/reload` después de cambiar código de la extensión durante una sesión interactiva de Pi.

### Activación y lookup exacto de configuración

Esta extensión lee configuración desde exactamente una ruta:

```txt
<ctx.cwd>/.pi/api.json
```

Reglas:

- Sin búsqueda en directorios padre.
- Sin búsqueda en home ni configuración global.
- Sin descubrimiento de configuración por entorno.
- Si ese archivo exacto falta, la extensión no registra tools.
- Si `enabled` falta o no es exactamente el boolean JSON `true`, la extensión no registra tools.

### Ejemplo `.pi/api.json`

Usa solo placeholders. No guardes secretos reales en docs, tests o ejemplos.

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

Otros ejemplos de auth solo con placeholders:

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

Variantes auth soportadas:

- `none`
- `bearer`
- `basic`
- `api_key`
- `headers`
- `login`

### Tools expuestas al agente

La extensión expone tools solo cuando la configuración local exacta existe y `enabled === true`.

| Tool | Propósito |
|---|---|
| `api_status` | Reporta si existe configuración, si está habilitada, endpoints configurados, tipo de auth, timeout efectivo, límites efectivos, warnings y estado de exposición en Git sin exponer secretos. |
| `api_auth_status` | Inspecciona metadata auth local sin llamadas al backend. Tokens bearer JWT y `access_token` de login reportan `valid`/`expired`, `expires_at` y `seconds_remaining` desde `exp` cuando es posible; metadata no soportada o no-JWT devuelve `unknown`. |
| `api_login` | Ejecuta el login configurado, lee `access_token` desde la respuesta JSON y lo persiste en `.pi/api.json` sin exponerlo. |
| `api_rest_request` | Ejecuta `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` y `OPTIONS` contra la URL base REST configurada con salida segura y acotada. Usa `use_token: false` para endpoints públicos. |
| `api_graphql_query` | Ejecuta queries y mutations GraphQL contra `graphql_url` con salida segura y acotada. Usa `use_token: false` para operaciones públicas. |
| `api_graphql_schema_queries` | Lista métodos GraphQL `Query` con resumen de argumentos y tipos de retorno usando introspección acotada. |
| `api_graphql_schema_query` | Inspecciona un método `Query` por nombre, incluyendo argumentos y schema de retorno anidado acotado renderizado como texto tipo GraphQL. Acepta `max_depth` y `use_token`. |

Si la configuración falta o está deshabilitada, no se registra ninguna tool API.

### Modelo de mutaciones

Los métodos REST mutantes (`POST`, `PUT`, `PATCH`, `DELETE`) y las mutations GraphQL **no** agregan prompts de confirmación específicos de la extensión.

Dependen del comportamiento normal de tools y permisos de Pi.

### Expectativas de Git ignore

`.pi/api.json` puede contener credenciales y debe estar ignorado por Git.

Regla recomendada:

```gitignore
.pi/api.json
```

`api_status` revisa el estado de exposición Git del archivo y advierte cuando parece:

- no ignorado y untracked;
- trackeado por Git; o
- desconocido porque el estado Git no pudo determinarse de forma segura.

En otras palabras, se espera que `api_status` advierta si `.pi/api.json` no está ignorado, ya está trackeado o no hay evidencia Git disponible.

### Límites de salida y truncamiento

Los límites por defecto de respuesta son:

- `max_response_bytes`: `50000`
- `max_response_lines`: `2000`

Puedes sobreescribirlos en `.pi/api.json` con `limits.max_response_bytes` y `limits.max_response_lines`.

Los resultados REST y GraphQL incluyen metadata de truncamiento con los límites efectivos y si la salida fue truncada. Los resultados truncados reportan un resumen con campos como:

- `truncated`
- `limit_bytes`
- `limit_lines`
- `original_bytes_known`
- `original_lines_known`
- `returned_bytes`
- `returned_lines`
- `reason`

### Cancelación y timeouts

- Los requests respetan el `timeout_ms` configurado.
- Los requests propagan cancelación con `AbortSignal`.
- Requests con timeout o cancelados devuelven errores seguros sin exponer secretos.

### Seguridad de salida

- Los valores secretos de configuración se redactan en contenido, detalles y errores de tools.
- Los valores con apariencia de secreto en respuestas también se redactan antes de la salida visible para el modelo.
- `api_status` reporta tipo de auth y presencia de endpoints, no valores crudos de credenciales.
- `api_auth_status` nunca expone tokens crudos ni claims sensibles decodificados; cuando existe `exp` JWT, solo reporta vencimiento y segundos restantes.

### Workflow recomendado

1. Crear `<ctx.cwd>/.pi/api.json` con `"enabled": true`.
2. Agregar `.pi/api.json` a `.gitignore` antes de guardar credenciales.
3. Ejecutar `api_status` para confirmar estado habilitado, límites efectivos, endpoints y warnings Git.
4. Ejecutar `api_login` cuando se use `auth.type: "login"`; espera una respuesta JSON con `access_token` y lo persiste en `.pi/api.json`.
5. Ejecutar `api_auth_status` si necesitas un check local de metadata del token.
6. Usar `api_rest_request` o `api_graphql_query` para acceso API acotado. Pasar `use_token: true` para endpoints autenticados y `use_token: false` para endpoints públicos.
7. Usar `api_graphql_schema_queries` para descubrir métodos GraphQL Query disponibles, luego `api_graphql_schema_query` con un solo nombre de query para inspeccionar argumentos y forma de retorno.

### Validación

```bash
cd extensions/api-tools
npm test
npm run typecheck
```
