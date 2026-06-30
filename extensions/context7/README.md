# Pi Context7 Extension

[English](#english) | [Español](#español)

## English

Native Pi extension for fetching up-to-date library and framework documentation from Context7 using `@upstash/context7-sdk`. It exposes safe, bounded Context7 tools to the agent without requiring MCP.

### What it provides

- Context7 readiness/status tool that never exposes API keys.
- Library search by human package/framework name and focused query.
- Documentation fetch for known Context7 library IDs.
- Convenience resolver that searches, selects an unambiguous candidate, and fetches docs.
- Optional user-local TTL cache for repeated queries.
- Secret redaction in tool content, structured details, and formatted errors.
- Output truncation with explicit metadata to protect LLM context.
- Offline unit-testable client/tool design using injectable clients.

### Extension location

In this agent-dir checkout the extension lives at:

```txt
extensions/context7/index.ts
```

When copied into a project-local Pi setup, the equivalent path is:

```txt
.pi/extensions/context7/index.ts
```

Pi auto-discovers project-local extensions from `.pi/extensions/*/index.ts` once the project is trusted. Use `/reload` after changing extension code during an interactive session.

### Required environment

Live Context7 calls require:

```bash
CONTEXT7_API_KEY=your_context7_api_key
```

Rules:

- Set the key in the Pi process environment.
- Do not store `CONTEXT7_API_KEY` in `.pi/context7.json` or any repository file.
- `context7_status` reports only whether the key is present, never its value.

### Project configuration

Optional project config lives in `.pi/context7.json` at the project root or an ancestor directory.

Example:

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

#### Config fields

| Field | Default | Range | Description |
|---|---:|---:|---|
| `cache.enabled` | `false` | boolean | Enables user-local file cache. |
| `cache.ttl_seconds` | `86400` | positive integer | TTL for cached Context7 responses. |
| `defaults.max_chars` | `12000` | `1000`-`50000` | Default maximum chars returned by documentation tools. |
| `defaults.result_limit` | `5` | `1`-`10` | Default candidate limit for library searches. |

Invalid numeric values produce warnings and fall back to defaults.

#### Secret-like keys

Any config key that looks like `apiKey`, `token`, `secret`, or `password` is ignored and reported as a warning. Use environment variables for secrets.

### Cache behavior

Cache is disabled by default.

When enabled, cache files are stored outside the active workspace/configured repository root passed to the extension:

```txt
$XDG_CACHE_HOME/pi/context7
```

Fallback:

```txt
~/.cache/pi/context7
```

Safety rules:

- Cache directory must not resolve inside the active workspace/configured repository root; if it does, cache is disabled.
- Cache keys omit secret-like fields and are SHA-256 hashed.
- Cache files use mode `0600`; directories use mode `0700`.
- Cache entries expire according to `cache.ttl_seconds`.

### Tools exposed to the agent

| Tool | Purpose |
|---|---|
| `context7_status` | Report readiness, API-key presence, cache state, defaults, and warnings without network calls. |
| `context7_search_library` | Search Context7 libraries and return compact candidates. |
| `context7_get_context` | Fetch focused documentation for a known Context7 library ID. |
| `context7_resolve_and_get_context` | Resolve a library and fetch focused documentation when the candidate is unambiguous. |

This extension does not register slash commands.

### Tool details

#### `context7_status`

Parameters: none.

Use it to check whether the extension is ready before live calls.

Returns:

- SDK availability;
- whether `CONTEXT7_API_KEY` is present;
- cache enabled/disabled state;
- effective defaults;
- non-secret warnings.

#### `context7_search_library`

Parameters:

```ts
{
  libraryName: string; // required, non-empty
  query: string;       // required, non-empty
  limit?: number;      // integer 1-10
}
```

Use when the agent does not know the exact Context7 library ID.

Returns compact candidates with fields such as:

- `id`;
- `name`;
- `description` capped for compactness;
- `totalSnippets`;
- `trustScore`;
- `benchmarkScore`;
- `versions`.

#### `context7_get_context`

Parameters:

```ts
{
  libraryId: string;      // required, non-empty
  query: string;          // required, non-empty
  type?: "json" | "txt"; // default: json
  max_chars?: number;     // clamped/floored to 1000-50000
}
```

Use when the correct Context7 library ID is already known, for example `/vercel/next.js`.

Output:

- `json`: formatted snippets with title/source/content; snippet content is bounded per snippet, so total JSON output can exceed `max_chars` when multiple snippets are returned.
- `txt`: text output with a Context7 header, truncated to the effective total max char limit.

#### `context7_resolve_and_get_context`

Parameters:

```ts
{
  libraryName: string;
  query: string;
  version?: string;
  max_chars?: number;
}
```

Behavior:

1. Searches candidates using the configured `defaults.result_limit`; callers cannot pass a per-call `limit` to the resolver.
2. Scores candidates by name/id match, optional version match, trust score, benchmark score, snippet coverage, and description overlap.
3. Returns `no_results`, `ambiguous`, or `selected`.
4. If unambiguous, fetches JSON documentation for the selected library ID.

Use this tool for convenience only when ambiguity is acceptable to handle in the result. For high-risk implementation decisions, prefer explicit `context7_search_library` followed by `context7_get_context` after confirming the selected ID.

### Output safety

All tool outputs are designed to be safe for LLM context:

- exact API key values are redacted;
- secret-looking text patterns are redacted;
- private key blocks are redacted;
- `txt` documentation output is truncated by `max_chars`; JSON snippet content is bounded per snippet and may exceed `max_chars` in total;
- search descriptions are capped;
- errors are formatted with actionable messages;
- upstream `401`, `403`, `404`, `429`, and `5xx` failures get user-actionable wording.

### Recommended workflow

1. Run `context7_status` if readiness is uncertain.
2. Run `context7_search_library` for the dependency and focused topic.
3. Pick the correct `libraryId` from candidates.
4. Run `context7_get_context` with a narrow query.
5. Summarize only the relevant facts in the answer or SDD artifact.
6. Do not store full Context7 dumps in Pi Memory or OpenSpec artifacts.

Example focused query:

```txt
libraryName: next.js
query: app router route handlers cookies api
```

### SDD usage policy

Use Context7 during SDD only when current external dependency documentation materially affects a requirement, design decision, implementation detail, or verification judgment.

When Context7 influences an SDD artifact, record concise source metadata, not full documentation dumps:

- library ID;
- focused query;
- source title or URL when available;
- retrieval date;
- relevance summary.

### Development

Install dependencies once:

```bash
cd extensions/context7
npm install
```

Run tests:

```bash
cd extensions/context7
npm test
```

Run typecheck:

```bash
cd extensions/context7
npm run typecheck
```

The test suite is designed to run without live Context7 network access or a real API key by using mocked clients/fixtures.

### Related project docs

- `skills/context7-configuration/SKILL.md` — agent-facing Context7 configuration and usage policy.
- `extensions/context7/src/config.ts` — config parsing and defaults.
- `extensions/context7/src/tools.ts` — tool schemas and output shaping.
- `extensions/context7/src/cache.ts` — cache location and safety behavior.
- `extensions/context7/src/security.ts` — redaction and safe output helpers.

## Español

Extensión nativa de Pi para obtener documentación actualizada de librerías y frameworks desde Context7 usando `@upstash/context7-sdk`. Expone tools Context7 seguras y acotadas al agente sin requerir MCP.

### Qué proporciona

- Tool de readiness/status de Context7 que nunca expone API keys.
- Búsqueda de librerías por nombre humano de paquete/framework y query enfocada.
- Obtención de documentación para IDs de librería Context7 conocidos.
- Resolver de conveniencia que busca, selecciona un candidato no ambiguo y obtiene docs.
- Caché TTL opcional local de usuario para queries repetidas.
- Redacción de secretos en contenido de tools, detalles estructurados y errores formateados.
- Truncamiento de salida con metadata explícita para proteger el contexto LLM.
- Diseño de cliente/tools testeable offline con clientes inyectables.

### Ubicación de la extensión

En este checkout de agent-dir la extensión vive en:

```txt
extensions/context7/index.ts
```

Cuando se copia a una configuración Pi local de proyecto, la ruta equivalente es:

```txt
.pi/extensions/context7/index.ts
```

Pi autodetecta extensiones locales de proyecto desde `.pi/extensions/*/index.ts` una vez que el proyecto es confiable. Usa `/reload` después de cambiar código de extensión durante una sesión interactiva.

### Entorno requerido

Las llamadas live de Context7 requieren:

```bash
CONTEXT7_API_KEY=your_context7_api_key
```

Reglas:

- Define la key en el entorno del proceso Pi.
- No guardes `CONTEXT7_API_KEY` en `.pi/context7.json` ni en ningún archivo del repositorio.
- `context7_status` reporta solo si la key está presente, nunca su valor.

### Configuración de proyecto

La configuración opcional de proyecto vive en `.pi/context7.json` en la raíz del proyecto o un directorio ancestro.

Ejemplo:

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

#### Campos de configuración

| Campo | Default | Rango | Descripción |
|---|---:|---:|---|
| `cache.enabled` | `false` | boolean | Habilita caché local de usuario en archivos. |
| `cache.ttl_seconds` | `86400` | entero positivo | TTL para respuestas Context7 cacheadas. |
| `defaults.max_chars` | `12000` | `1000`-`50000` | Máximo de caracteres por defecto devueltos por tools de documentación. |
| `defaults.result_limit` | `5` | `1`-`10` | Límite de candidatos por defecto para búsquedas de librerías. |

Valores numéricos inválidos producen warnings y vuelven a defaults.

#### Keys con apariencia de secreto

Cualquier key de configuración que parezca `apiKey`, `token`, `secret` o `password` se ignora y se reporta como warning. Usa variables de entorno para secretos.

### Comportamiento de caché

La caché está deshabilitada por defecto.

Cuando se habilita, los archivos de caché se guardan fuera del workspace activo/raíz configurada del repositorio pasada a la extensión:

```txt
$XDG_CACHE_HOME/pi/context7
```

Fallback:

```txt
~/.cache/pi/context7
```

Reglas de seguridad:

- El directorio de caché no debe resolver dentro del workspace activo/raíz configurada del repositorio; si lo hace, se deshabilita la caché.
- Las keys de caché omiten campos con apariencia de secreto y se hashean con SHA-256.
- Los archivos de caché usan modo `0600`; los directorios usan `0700`.
- Las entradas de caché expiran según `cache.ttl_seconds`.

### Tools expuestas al agente

| Tool | Propósito |
|---|---|
| `context7_status` | Reporta readiness, presencia de API key, estado de caché, defaults y warnings sin llamadas de red. |
| `context7_search_library` | Busca librerías Context7 y devuelve candidatos compactos. |
| `context7_get_context` | Obtiene documentación enfocada para un ID de librería Context7 conocido. |
| `context7_resolve_and_get_context` | Resuelve una librería y obtiene documentación cuando el candidato no es ambiguo. |

Esta extensión no registra comandos slash.

### Detalles de tools

#### `context7_status`

Parámetros: ninguno.

Úsala para comprobar si la extensión está lista antes de llamadas live.

Devuelve:

- disponibilidad del SDK;
- si `CONTEXT7_API_KEY` está presente;
- estado de caché habilitada/deshabilitada;
- defaults efectivos;
- warnings sin secretos.

#### `context7_search_library`

Parámetros:

```ts
{
  libraryName: string; // requerido, no vacío
  query: string;       // requerido, no vacío
  limit?: number;      // entero 1-10
}
```

Úsala cuando el agente no conoce el ID exacto de librería Context7.

Devuelve candidatos compactos con campos como:

- `id`;
- `name`;
- `description` acotada para compacidad;
- `totalSnippets`;
- `trustScore`;
- `benchmarkScore`;
- `versions`.

#### `context7_get_context`

Parámetros:

```ts
{
  libraryId: string;      // requerido, no vacío
  query: string;          // requerido, no vacío
  type?: "json" | "txt"; // default: json
  max_chars?: number;     // clamp/floor a 1000-50000
}
```

Úsala cuando el ID correcto de librería Context7 ya se conoce, por ejemplo `/vercel/next.js`.

Salida:

- `json`: snippets formateados con título/fuente/contenido; el contenido de cada snippet está acotado, por lo que la salida JSON total puede superar `max_chars` cuando se devuelven varios snippets.
- `txt`: salida de texto con header Context7, truncada al límite efectivo total de caracteres.

#### `context7_resolve_and_get_context`

Parámetros:

```ts
{
  libraryName: string;
  query: string;
  version?: string;
  max_chars?: number;
}
```

Comportamiento:

1. Busca candidatos usando `defaults.result_limit` configurado; callers no pueden pasar un `limit` por llamada al resolver.
2. Puntúa candidatos por coincidencia de nombre/id, coincidencia opcional de versión, trust score, benchmark score, cobertura de snippets y overlap de descripción.
3. Devuelve `no_results`, `ambiguous` o `selected`.
4. Si no hay ambigüedad, obtiene documentación JSON para el ID de librería seleccionado.

Usa esta tool solo por conveniencia cuando sea aceptable manejar ambigüedad en el resultado. Para decisiones de implementación de alto riesgo, preferí `context7_search_library` explícito seguido por `context7_get_context` después de confirmar el ID seleccionado.

### Seguridad de salida

Todas las salidas de tools están diseñadas para ser seguras para contexto LLM:

- los valores exactos de API keys se redactan;
- patrones de texto con apariencia de secreto se redactan;
- bloques de private key se redactan;
- la salida de documentación `txt` se trunca por `max_chars`; el contenido JSON de snippets está acotado por snippet y puede superar `max_chars` en total;
- las descripciones de búsqueda se acotan;
- los errores se formatean con mensajes accionables;
- fallos upstream `401`, `403`, `404`, `429` y `5xx` reciben wording accionable para el usuario.

### Workflow recomendado

1. Ejecutar `context7_status` si la readiness es incierta.
2. Ejecutar `context7_search_library` para la dependencia y tema enfocado.
3. Elegir el `libraryId` correcto entre candidatos.
4. Ejecutar `context7_get_context` con una query estrecha.
5. Resumir solo los hechos relevantes en la respuesta o artefacto SDD.
6. No guardar dumps completos de Context7 en Pi Memory ni artefactos OpenSpec.

Ejemplo de query enfocada:

```txt
libraryName: next.js
query: app router route handlers cookies api
```

### Política de uso SDD

Usa Context7 durante SDD solo cuando documentación externa actual de dependencias afecte materialmente un requisito, decisión de diseño, detalle de implementación o juicio de verificación.

Cuando Context7 influya un artefacto SDD, registra metadata de fuente concisa, no dumps completos de documentación:

- ID de librería;
- query enfocada;
- título o URL de fuente cuando esté disponible;
- fecha de recuperación;
- resumen de relevancia.

### Desarrollo

Instalar dependencias una vez:

```bash
cd extensions/context7
npm install
```

Ejecutar tests:

```bash
cd extensions/context7
npm test
```

Ejecutar typecheck:

```bash
cd extensions/context7
npm run typecheck
```

La suite de tests está diseñada para correr sin acceso live a Context7 ni API key real usando clientes/fixtures mockeados.

### Docs relacionadas del proyecto

- `skills/context7-configuration/SKILL.md` — política de configuración y uso de Context7 para agentes.
- `extensions/context7/src/config.ts` — parsing de config y defaults.
- `extensions/context7/src/tools.ts` — schemas de tools y shaping de salida.
- `extensions/context7/src/cache.ts` — ubicación de caché y comportamiento de seguridad.
- `extensions/context7/src/security.ts` — helpers de redacción y salida segura.
