# Pi Skill Registry Extension

[English](#english) | [Español](#español)

## English

Agent-dir development version of a future Pi skill registry extension. It generates a routing index for global/user and project-local skills so agents can select and load the right `SKILL.md` without assuming a fixed path.

### What it provides

- Generates a stack-agnostic registry from global and project skills.
- Reads Pi skill locations:
  - `.pi/skills`
  - `.agents/skills`
  - `~/.pi/agent/skills`
  - `~/.agents/skills`
- Respects Pi discovery rules:
  - root `.md` files are allowed only in `.pi/skills` and `~/.pi/agent/skills`;
  - nested skills are discovered as `SKILL.md`;
  - root markdown under `.agents/skills` is ignored.
- Writes generated routing indexes:
  - `.pi/skill-registry.json`
  - `.pi/skill-registry.md`
- Adds generated registry files to an existing `.gitignore` when missing; it does not create `.gitignore` if none exists.
- Exposes an LLM-callable tool and human slash command.

#### Enable gate

The extension only registers when `.pi/skill-registry.config.json` exists with `{"enabled": true}` in project scope. Missing or invalid config defaults to disabled.

Example config:

```json
{
  "enabled": true
}
```

The registry is an index for routing. The source of truth remains each `SKILL.md`.

A dedicated agent skill for configuring this extension is available as `skill-registry-configuration`.

### Tool

| Tool | Purpose |
|---|---|
| `skill_registry_generate` | Generate the registry and optionally write output files. Defaults to write. |
| `skill_registry_resolve` | Resolve candidate skills from the live registry using intent/path/sdd-phase with optional stale-check semantics and one-hop related expansion. Read-only. |

#### `skill_registry_generate`

Parameters:

```ts
{
  write?: boolean; // default: true
}
```

Use `write: false` for validation or dry-run routing checks.

#### `skill_registry_resolve`

Parameters:

```ts
{
  intent?: string;
  paths?: string[]; // project paths; accepts '\\' or '/' and duplicate slashes are normalized
  sdd_phase?: 'explore' | 'proposal' | 'spec' | 'design' | 'task' | 'apply' | 'verify' | 'archive';
  include_related?: boolean; // default: true
  stale_check?: boolean; // default: true
  max_results?: number; // 1..50, default: 10
}
```

Behavior:

- Resolves against a **live in-memory registry** generated for the call (no writes).
- Treat the first direct match as the **primary** skill. Consider at most two more direct matches as secondary context; related matches stay advisory.
- If `stale_check` is enabled:
  - compares live `content_hash` against `.pi/skill-registry.json`,
  - reports `fresh`, `stale`, `missing`, or `invalid` cache state,
  - does not write or refresh cache files.
- Ranking is deterministic: score desc, then priority desc, then name asc.
- Returns direct matches and one-hop related matches (separated).
- Output is routing-only guidance:
  - no `SKILL.md` content is included,
  - response guidance always recommends reading each returned `SKILL.md` before acting.
- Interactive TUI rendering is compact by default: the detailed routing result is kept for the agent in tool content/details, but the visible tool row shows only a summary until the user expands tool output with Pi's native tool-expand keybinding (default `ctrl+o`).

Response shape includes:

```ts
{
  query: {
    intent?: string,
    paths: string[],
    sdd_phase?: string,
    include_related: boolean,
    stale_check: boolean,
    max_results: number,
  },
  registry_status: {
    source: 'live',
    cache: 'fresh' | 'stale' | 'missing' | 'invalid' | 'not_checked',
    live_hash: string,
    cached_hash?: string,
    cache_path: string,
  },
  matches: Array<{
    name: string,
    path: string,
    scope: 'project' | 'global',
    priority: number,
    score: number,
    reasons: Array<{ signal: string; detail: string; weight: number }>;
    routing: {
      category: string | null,
      domains: string[],
      triggers: Record<string, unknown>,
      sdd_phases: string[],
      related_skills: string[],
    },
    read_before_acting: string,
  }>,
  related_matches: Array<{
    name: string,
    path: string,
    scope: 'project' | 'global',
    routing: Record<string, unknown>,
    read_before_acting: string,
    related_from: string[],
    relation_reasons: string[],
  }>,
  warnings: string[],
  guidance: string[],
}
```

#### Command parity note

The `/skill-registry` command set remains unchanged in this MVP (`generate`, `refresh`, `write`, `status`, `list` only). There is **no** `/skill-registry resolve` command parity yet.


### Command

```text
/skill-registry generate
/skill-registry refresh
/skill-registry write
/skill-registry status
/skill-registry list
```

Command behavior:

- no args defaults to `generate`;
- `generate`, `refresh`, and `write` regenerate and write the registry;
- `status` reads the existing `.pi/skill-registry.json` and does not regenerate;
- `list` reads the existing registry when present, otherwise generates in memory without writing.

### Registry behavior

- Registry output is ordered by priority descending, then skill name ascending.
- A skill with valid `registry:` metadata is indexed for routing.
- A skill without a valid `registry:` map is ignored silently; its native Pi frontmatter remains independent and valid.
- Duplicate skill names among indexed skills produce a warning; later duplicates are ignored.
- The generator also warns about weak routing metadata such as unknown categories, self-referential `related` entries, and non-empty `phases` on skills that are not workflow owners or transversal/guardrail skills.
- Registry source metadata lives in SKILL frontmatter under an optional one-level `registry:` map.

### Registry metadata convention

Skills should include compact frontmatter metadata:

```md
---
name: example-project-skill
description: "specific trigger-focused description"
license: Apache-2.0
metadata:
  author: your-name-or-team
  version: "1.0"
registry:
  category: base
  domains: frontend, forms
  paths: front/app/routes/**/*.tsx
  keywords: useFetcher, fetcher.Form
  phases: explore, design, task, apply, verify
  related: project-testing
  priority: 50
---
```

Registry normalization rules:

- `category`: scalar string.
- `domains`, `paths`, `keywords`, `phases`, `related`: comma-separated scalars normalized to trimmed string arrays.
- Prefer `category` values from: `workflow`, `transversal`, `quality`, `security`, `base`, `runtime`, `product`, `domain`, `helper`.
- Reserve non-empty `phases` for workflow owners and true transversal guardrails. Most domain/helper skills should leave `phases` empty and rely on intent + path routing.
- `priority`: numeric scalar normalized to the existing routing priority number.
- Omit empty optional fields instead of leaving blank values.
- Omit the entire `registry:` map when the skill should not participate in Skill Registry routing.

Use `templates/skill-template.md` from this extension while this is agent-dir local. Later this extension and its templates may move to global Pi agent configuration or a package.

### Development

```bash
cd extensions/skill-registry
npm test
npm run typecheck
```

## Español

Versión de desarrollo en agent-dir de una futura extensión de skill registry para Pi. Genera un índice de routing para skills globales/de usuario y locales de proyecto, para que los agentes puedan seleccionar y cargar el `SKILL.md` correcto sin asumir una ruta fija.

### Qué proporciona

- Genera un registry stack-agnostic desde skills globales y de proyecto.
- Lee ubicaciones de skills de Pi:
  - `.pi/skills`
  - `.agents/skills`
  - `~/.pi/agent/skills`
  - `~/.agents/skills`
- Respeta reglas de descubrimiento de Pi:
  - archivos `.md` raíz se permiten solo en `.pi/skills` y `~/.pi/agent/skills`;
  - skills anidadas se descubren como `SKILL.md`;
  - markdown raíz bajo `.agents/skills` se ignora.
- Escribe índices de routing generados:
  - `.pi/skill-registry.json`
  - `.pi/skill-registry.md`
- Agrega archivos de registry generados a un `.gitignore` existente cuando faltan; no crea `.gitignore` si no existe.
- Expone una tool invocable por LLM y un comando slash humano.

#### Gate de activación

La extensión solo se registra cuando `.pi/skill-registry.config.json` existe con `{"enabled": true}` en scope de proyecto. Config faltante o inválida queda deshabilitada por defecto.

Ejemplo de config:

```json
{
  "enabled": true
}
```

El registry es un índice para routing. La fuente de verdad sigue siendo cada `SKILL.md`.

Hay una skill dedicada para configurar esta extensión: `skill-registry-configuration`.

### Tool

| Tool | Propósito |
|---|---|
| `skill_registry_generate` | Genera el registry y opcionalmente escribe archivos de salida. Escribe por defecto. |
| `skill_registry_resolve` | Resuelve skills candidatas desde el registry vivo usando intención/ruta/fase SDD, con semántica opcional de stale-check y expansión de relacionados a un salto. Read-only. |

#### `skill_registry_generate`

Parámetros:

```ts
{
  write?: boolean; // default: true
}
```

Usa `write: false` para validación o checks dry-run de routing.

#### `skill_registry_resolve`

Parámetros:

```ts
{
  intent?: string;
  paths?: string[]; // rutas de proyecto; acepta '\\' o '/' y normaliza slashes duplicados
  sdd_phase?: 'explore' | 'proposal' | 'spec' | 'design' | 'task' | 'apply' | 'verify' | 'archive';
  include_related?: boolean; // default: true
  stale_check?: boolean; // default: true
  max_results?: number; // 1..50, default: 10
}
```

Comportamiento:

- Resuelve contra un **registry vivo en memoria** generado para la llamada (sin escrituras).
- Si `stale_check` está habilitado:
  - compara `content_hash` vivo contra `.pi/skill-registry.json`,
  - reporta estado de caché `fresh`, `stale`, `missing` o `invalid`,
  - no escribe ni refresca archivos de caché.
- El ranking es determinístico: score desc, luego priority desc, luego name asc.
- Devuelve matches directos y matches relacionados a un salto (separados).
- La salida es solo guía de routing:
  - no incluye contenido de `SKILL.md`,
  - la respuesta siempre recomienda leer cada `SKILL.md` devuelto antes de actuar.
- El render TUI interactivo es compacto por defecto: el resultado detallado queda en content/details de la tool para el agente, pero la fila visible muestra solo un resumen hasta que el usuario expande el output con el keybinding nativo de Pi (default `ctrl+o`).

La forma de respuesta incluye:

```ts
{
  query: {
    intent?: string,
    paths: string[],
    sdd_phase?: string,
    include_related: boolean,
    stale_check: boolean,
    max_results: number,
  },
  registry_status: {
    source: 'live',
    cache: 'fresh' | 'stale' | 'missing' | 'invalid' | 'not_checked',
    live_hash: string,
    cached_hash?: string,
    cache_path: string,
  },
  matches: Array<{
    name: string,
    path: string,
    scope: 'project' | 'global',
    priority: number,
    score: number,
    reasons: Array<{ signal: string; detail: string; weight: number }>;
    routing: {
      category: string | null,
      domains: string[],
      triggers: Record<string, unknown>,
      sdd_phases: string[],
      related_skills: string[],
    },
    read_before_acting: string,
  }>,
  related_matches: Array<{
    name: string,
    path: string,
    scope: 'project' | 'global',
    routing: Record<string, unknown>,
    read_before_acting: string,
    related_from: string[],
    relation_reasons: string[],
  }>,
  warnings: string[],
  guidance: string[],
}
```

#### Nota de paridad de comandos

El set de comandos `/skill-registry` permanece sin cambios en este MVP (`generate`, `refresh`, `write`, `status`, `list`). Todavía **no** hay paridad de comando `/skill-registry resolve`.

### Comando

```text
/skill-registry generate
/skill-registry refresh
/skill-registry write
/skill-registry status
/skill-registry list
```

Comportamiento del comando:

- sin args, default a `generate`;
- `generate`, `refresh` y `write` regeneran y escriben el registry;
- `status` lee `.pi/skill-registry.json` existente y no regenera;
- `list` lee el registry existente cuando existe; si no, genera en memoria sin escribir.

### Comportamiento del registry

- La salida del registry se ordena por priority descendente y luego nombre de skill ascendente.
- Una skill con metadata `registry:` válida se indexa para routing.
- Una skill sin un mapa `registry:` válido se ignora silenciosamente; su frontmatter nativo de Pi sigue siendo válido e independiente.
- Nombres de skill duplicados entre las skills indexadas producen un warning; duplicados posteriores se ignoran.
- La metadata fuente del registry vive en el frontmatter del SKILL bajo un mapa opcional `registry:` de un nivel.

### Convención de metadata de registry

Las skills deben incluir metadata compacta en frontmatter:

```md
---
name: example-project-skill
description: "specific trigger-focused description"
license: Apache-2.0
metadata:
  author: your-name-or-team
  version: "1.0"
registry:
  category: base
  domains: frontend, forms
  paths: front/app/routes/**/*.tsx
  keywords: useFetcher, fetcher.Form
  phases: explore, design, task, apply, verify
  related: project-testing
  priority: 50
---
```

Reglas de normalización del registry:

- `category`: string escalar.
- `domains`, `paths`, `keywords`, `phases`, `related`: escalares separados por comas que se normalizan a arrays de strings trimmeados.
- `priority`: escalar numérico normalizado al número de prioridad de routing existente.
- Omite campos opcionales vacíos en lugar de dejarlos en blanco.

Usa `templates/skill-template.md` desde esta extensión mientras sea local al agent-dir. Más adelante esta extensión y sus templates pueden moverse a la configuración global del agente Pi o a un paquete.

### Desarrollo

```bash
cd extensions/skill-registry
npm test
npm run typecheck
```
