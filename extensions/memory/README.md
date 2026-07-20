# Pi Memory Extension

[English](#english) | [Español](#español)

## English

Local-first persistent memory for Pi agents. This extension gives the agent a project-aware memory brain backed by SQLite + FTS5, exposes memory tools to the LLM, adds slash commands for humans, captures session prompts for audit, and summarizes sessions at shutdown.

### What it provides

- Project/general/global memory records with kinds such as `decision`, `command`, `workflow`, `todo`, `learning`, `project_profile`, and `discovery_finding`.
- Local SQLite storage with FTS5 search, WAL, foreign keys, and `busy_timeout`.
- Automatic project context resolution from `.pi/memory.json`, git remote/root, folder name, or home directory.
- Startup memory context injection once per session.
- Prompt/session audit records.
- Fast local session summaries on shutdown by default.
- Optional semantic session summary and semantic project-profile update.
- Export/import to JSONL.
- Duplicate-memory consolidation support.
- Interactive `/memory-browser`.
- Optional local retrieval telemetry with explicit opt-in.
- Cloud-sync-ready metadata and status fields; no real cloud push/pull backend yet.

### Extension location

In this agent-dir checkout the extension lives at:

```txt
extensions/memory/index.ts
```

When copied into a project-local Pi setup, the equivalent path is:

```txt
.pi/extensions/memory/index.ts
```

Pi auto-discovers project-local extensions from `.pi/extensions/*/index.ts` once the project is trusted. Use `/reload` after changing extension code during an interactive session.

### Configuration

Project configuration lives in `.pi/memory.json` at the project root or an ancestor directory.

Minimal config:

```json
{
  "enabled": true,
  "project_name": "j0k3r-pi"
}
```

Recommended project config for automatic project-scoped backups and safe restores. This example intentionally overrides the built-in legacy default backup path (`.pi/mempry-backups/...`) with the clearer `.pi/memory-backups/...` path and keeps retrieval telemetry disabled by default:

```json
{
  "project_name": "j0k3r-pi",
  "aliases": [],
  "default_scope": "project",
  "debug": false,
  "session_end": {
    "semantic": false
  },
  "import": {
    "mode": "merge",
    "on_conflict": "keep_local"
  },
  "enabled": true,
  "backups": {
    "path": ".pi/memory-backups/memory-backup.jsonl",
    "mode": "mirror",
    "include_sessions": true
  },
  "telemetry": {
    "retrieval": {
      "enabled": false,
      "retention_days": 30
    }
  },
  "cloud": {
    "enabled": false
  }
}
```

Use `backups.include_sessions=true` only when the project intentionally wants session and session-prompt export/import. Prompt rows are always stored locally for audit as part of sessions.

Full supported shape:

```json
{
  "project_name": "j0k3r-pi",
  "aliases": ["pi-agent-workflow"],
  "default_scope": "project",
  "debug": false,
  "session_end": {
    "semantic": false
  },
  "import": {
    "mode": "merge",
    "on_conflict": "keep_local"
  },
  "backups": {
    "path": ".pi/mempry-backups/memory-backup.jsonl",
    "mode": "mirror",
    "include_sessions": false
  },
  "git": {
    "enabled": false,
    "sync": {
      "cloud": false,
      "export": false,
      "import": false
    }
  },
  "telemetry": {
    "retrieval": {
      "enabled": false,
      "retention_days": 30
    }
  },
  "cloud": {
    "enabled": false,
    "organization_id": "org_abc123",
    "actor_id": "actor_j0k3r",
    "remote_project_id": "proj_j0k3r_pi",
    "url_env": "PI_MEMORY_CLOUD_URL",
    "token_env": "PI_MEMORY_CLOUD_TOKEN"
  }
}
```

#### Config fields

| Field | Default | Description |
|---|---:|---|
| `project_name` | inferred | Canonical project name. If present, it wins over git/folder inference. |
| `aliases` | `[]` | Optional legacy project-name aliases kept for compatibility. |
| `default_scope` | parsed only | Reserved config field for `general`, `project`, or `global`; currently parsed for compatibility but not used by context resolution. |
| `debug` | `false` | Enables local lifecycle debug logging to `memory-session-debug.log` in the current working directory. Logs session IDs/files and lifecycle events, never prompt text. Keep disabled unless auditing session behavior. |
| `session_end.semantic` | `false` | Enables model-backed shutdown summary/profile update. Off by default for fast exit. |
| `import.mode` | `dry_run` | Default `memory_import` mode when the tool call omits `mode`. Valid values: `dry_run`, `merge`. Invalid config values are ignored with a warning. |
| `import.on_conflict` | `mark_conflict` | Default `memory_import` conflict policy when omitted. Valid values: `keep_local`, `keep_imported`, `mark_conflict`. Invalid config values are ignored with a warning. |
| `backups.path` | `.pi/mempry-backups/memory-backup.jsonl` | Relative path, resolved from the current working directory, for automatic import/export backups. Absolute paths and paths escaping the workdir are rejected with a warning. |
| `backups.mode` | `mirror` | Export write mode. `mirror` rewrites the file from current scoped DB state. `merge` preserves existing backup rows and updates/adds current rows. Invalid values are ignored with a warning. |
| `backups.include_sessions` | `false` | When `true`, automatic `memory_export` includes `memory_sessions` and linked `memory_session_prompts` for the current project. Session prompts are audit data, so this is opt-in. |
| `enabled` | `false` | Enable memory extension registration for this project when true. |
| `git.enabled` | `false` | Enables Git-aware memory features such as commit/changelog tools. This setting does not gate generic `memory_link`. |
| `git.sync.cloud` | `false` | Include Git-derived records in cloud sync readiness/status only when enabled. |
| `git.sync.export` | `false` | Include Git-derived records in exports only when enabled. |
| `git.sync.import` | `false` | Include Git-derived records in imports only when enabled. |
| `telemetry.retrieval.enabled` | `false` | Enables local retrieval telemetry only when explicitly set to `true`. Disabled projects write no telemetry rows and perform no telemetry pruning. |
| `telemetry.retrieval.retention_days` | `30` | Retrieval telemetry retention in days. Values are clamped to the inclusive range `1..365` with a warning. |
| `cloud.enabled` | `false` | Marks project rows as cloud-sync pending and enables cloud readiness checks. |
| `cloud.organization_id` | `null` | Required only when cloud is enabled. |
| `cloud.actor_id` | `null` | Required only when cloud is enabled. |
| `cloud.remote_project_id` | `null` | Required only when cloud is enabled. |
| `cloud.url_env` | `PI_MEMORY_CLOUD_URL` | Environment variable name for cloud URL. |
| `cloud.token_env` | `PI_MEMORY_CLOUD_TOKEN` | Environment variable name for cloud token. |

Never store cloud tokens directly in `.pi/memory.json`.

#### Setup checklist for a new project

1. Create `.pi/memory.json` with the recommended config above and set `project_name` to the canonical project name.
2. Keep `backups.path` relative to the project working directory. Absolute paths and `..` escapes are rejected/ignored.
3. Leave `telemetry.retrieval.enabled=false` unless the project explicitly opts in to local metadata-only telemetry.
4. Run `/reload` or restart Pi after changing `.pi/memory.json` or extension code.
5. Use `memory_context` to verify the resolved project identity.
6. Run `memory_export` (tool) or `/memory-export` (command) from the project cwd. The agent or user does not need to pass a path.
7. To restore from that backup, run `memory_import` (default respects configured defaults) or `/memory-import dry_run` for an explicit dry-run, then use `memory_import` with merge mode or `/memory-import merge` when you want to apply changes.
8. Inspect the backup meta if needed: `format` should be `pi-memory-backup`, `version` should be `2`, `mode` should match `backups.mode`, `mirror` should be `true` for mirror mode and `false` for merge mode, and `includes_sessions` should match `backups.include_sessions`.

A dedicated agent skill for this is available as `memory-configuration`.

### Storage

Default DB path:

```txt
$XDG_DATA_HOME/pi/memory/memory.sqlite
```

Fallback:

```txt
~/.local/share/pi/memory/memory.sqlite
```

Environment overrides:

```bash
PI_MEMORY_DB_PATH=/absolute/path/to/memory.sqlite
PI_MEMORY_HOME=/absolute/path/to/memory-home
```

SQLite settings:

- `PRAGMA foreign_keys = ON`
- `PRAGMA journal_mode = WAL`
- `PRAGMA busy_timeout = 5000`

### Context resolution

The extension resolves the active memory context in this order:

1. If `cwd` is the user's home directory, scope is `general`.
2. If `.pi/memory.json` contains `project_name`, scope is `project` with `project:<slug(project_name)>`.
3. If inside a git repo with a parseable `remote.origin.url`, scope is `project` with `git:<host>/<owner>/<repo>`.
4. If inside a git repo without parseable remote, scope is `project` from git root folder name.
5. Otherwise scope is `project` from current folder name.

Use `/memory-context` or the `memory_context` tool to inspect the resolved context.

### Session lifecycle

Registered lifecycle events:

- `session_start`: resolves memory context and sets footer status without creating or reopening a memory session.
- `before_agent_start`: lazily creates, resumes, or reopens the memory session on the first non-empty user prompt, captures that prompt, and injects startup brain context once per distinct Pi session. New lifecycle-managed sessions use the exact non-empty `ctx.sessionManager.getSessionId()` as `memory_sessions.id`; if Pi does not provide one, lifecycle creation is skipped safely instead of generating a fallback id. The context is a compact index with bounded summaries and explicit cues for task-relevant retrieval.
- `session_shutdown`: closes the memory session unless shutdown reason is `reload`.

Memory sessions are linked to Pi sessions using this conservative priority:

1. Reuse an existing compatible session whose row id already equals `ctx.sessionManager.getSessionId()`.
2. Reuse an existing compatible session matched by `metadata_json.pi_session_id`.
3. Reuse an existing compatible session matched by `metadata_json.pi_session_file`.
4. Reuse an existing compatible Pi custom session entry persisted with `pi.appendEntry("memory-session", { memory_session_id })`.
5. When no Pi id, session file, or custom entry is available, reuse one unambiguous recent active auto-started session for the same project and cwd.
6. Otherwise create a new lifecycle-managed session whose `memory_sessions.id` exactly equals the non-empty Pi session id.

Compatible legacy rows keep their existing ids unchanged. If Pi cannot provide a non-empty session id and no compatible session can be reused, the extension skips lifecycle session creation and prompt capture instead of generating a fallback lifecycle id.

When a completed memory session is resumed with the same Pi identity, `session_start` leaves it closed and the first non-empty `before_agent_start` prompt reactivates it with `status='active'` and `ended_at=NULL`. Empty startup prompts do not create or reopen sessions. The previous summary is preserved until the next finish rewrites it.

Shutdown behavior:

- Default: writes a fast heuristic local session summary.
- With `session_end.semantic=true`: tries a semantic session summary with the active model, then falls back to the heuristic summary on error or missing auth.
- Explicit `memory_session_finish` is the real visible close action for user-requested close/end/finish flows. If a session was already completed explicitly, later graceful shutdown marks local runtime state closed without overwriting the saved summary, learned content, metadata, or ended timestamp.
- Reload does not close the active lifecycle session.
- Session shutdown never changes the canonical project profile. Agents read and explicitly maintain it through `memory_project_profile` when durable project facts change. The canonical profile is intentionally excluded from the regular startup memory slots and compact `memory_start_chat` context.

### Memory quality behavior

#### Startup brain context

Startup memory injection is deterministic and prompt-independent:

- only `active` memories are eligible;
- `archived` and `superseded` memories are excluded;
- only general/global memories plus the current project's project-scoped memories are considered;
- the selector returns at most 4 memories;
- one completed session summary may still be appended separately;
- stale low-value progress/noise is demoted instead of deleted.

The selector uses durable kind priority, importance, and a bounded staleness penalty. It does not inspect prompt text and does not call external ranking services.

#### Project profile behavior

`project_profile` is canonical per project:

- each project keeps at most one active `project_profile`;
- `memory_add(kind='project_profile')` updates the canonical active record in place instead of creating a second active profile;
- `memory_project_profile` is the primary canonical profile read/update API and returns the complete profile after get, ensure, or update;
- canonical profile content preserves original case so case-sensitive paths, commands, symbols, identifiers, versions, acronyms, and quoted literals remain accurate, while normal prose, titles, and tags keep their lowercase-oriented normalization;
- agents are instructed to read it when relevant and update it explicitly when durable project facts change;
- duplicate active profiles found during migration are marked `superseded`, kept readable, and linked to the canonical record;
- superseded duplicate content is preserved.

#### Discovery findings and explicit links

Use `discovery_finding` for durable investigation findings that may later be implemented or superseded.

Generic links are explicit:

- `memory_link` works even when `git.enabled=false`;
- allowed relations are `supports`, `supersedes`, `contradicts`, `derived_from`, `related_to`, and `implements`;
- endpoints must already exist;
- self-links and cross-project links are rejected;
- mutual reverse `implements` and `supersedes` links are rejected;
- duplicate identical links are treated as idempotent success.

`memory_commit_changelog_link` remains Git-gated for commit/changelog workflows.

### Tools exposed to the agent

| Tool | Purpose |
|---|---|
| `memory_context` | Resolve current memory scope/project identity. |
| `memory_add` | Store durable memories. |
| `memory_search` | Search compact local memories/session summaries. |
| `memory_get` | Read a complete memory by id selected from trusted compact indexes such as startup context, search, list, recall, or related Memory results. |
| `memory_list` | List compact memories by filters. |
| `memory_update` | Update memory content/tags/status/confidence/importance. |
| `memory_archive` | Archive a memory without deleting it. |
| `memory_session_start` | Create/register a separate manual non-lifecycle memory session. |
| `memory_session_prompt_add` | Store a relevant session prompt for audit. |
| `memory_session_finish` | Finish a memory session; `session_id` is optional only for the active lifecycle session, and explicit close/end requests should use it before confirming closure. |
| `memory_start_chat` | Explicit/manual API to start a separate non-lifecycle memory session and return compact startup context without the canonical project profile. |
| `memory_recall` | Recall compact workflow-moment context. Aliases: `task`, `edit`, `test`, `commit`, `end`. |
| `memory_project_profile` | Get/ensure/update the current project profile and return its complete canonical content. |
| `memory_consolidate` | Find or apply duplicate-memory consolidation. Dry-run defaults to true. |
| `memory_link` | Create an explicit generic relationship between two existing memories. |
| `memory_sync_status` | Show local sync-aware status counts. |
| `memory_export` | Export memory to JSONL. |
| `memory_import` | Import memory from JSONL. Dry-run by default. |

### Slash commands

| Command | Description |
|---|---|
| `/memory-status` | Show DB path, current context, and cloud readiness. |
| `/memory-context` | Show resolved memory context JSON. |
| `/memory-search <query>` | Search local memory. |
| `/memory-list` | List recent memories. |
| `/memory-doctor` | Diagnose DB, FTS5, context, and cloud config. |
| `/memory-sync-status` | Show counts by sync status. |
| `/memory-consolidate [kind]` | Dry-run duplicate detection. |
| `/memory-project-profile` | Ensure and show current project profile. |
| `/memory-export [jsonl|sqlite] [mirror|merge] [sessions] [active-only]` | Export scoped memory backup. |
| `/memory-import [merge|dry_run] [keep_local|keep_imported|mark_conflict]` | Import memory backup (defaults to configured import mode; often `dry_run`). |
| `/memory-browser` | Open the interactive memory browser. |

### Memory browser

`/memory-browser` opens an interactive browser with nvim-style navigation. It lists only the current project's memories, sessions, and captured prompts. Session details include the prompts linked to that session for audit/debugging. Subagent sessions/prompts are linked to their parent user session and hidden by default; user session details show linked subagent sessions, and `origin=subagent` or `origin=all` can inspect them directly within the current project. It supports filter commands such as:

```txt
:query=npm kind=command scope=project status=active project=app
:origin=subagent
:origin=all
:clear
```

### Export and import

`memory_export`/`memory_import` tools and `/memory-export`/`/memory-import` commands use an automatic configured backup path; no `path` argument is required.

#### User command usage

- Export: `/memory-export`
  - `jsonl` (default)
  - `mirror|merge` to override `backups.mode` for this export
  - `sessions` to include sessions and prompts (or `sessions=false` / `include_sessions=false`)
  - `active-only` to export only active memories
  - `active` is equivalent to `active-only` (`include_archived=false`)
  - `help` to show usage

  Examples:

  - `/memory-export`
  - `/memory-export merge`
  - `/memory-export sessions`
  - `/memory-export jsonl active-only`

- Import: `/memory-import`
  - `dry_run` (default, or project-configured default)
  - `merge` to apply changes
  - `keep_local|keep_imported|mark_conflict` for conflict handling
  - `help` to show usage

  Recommended flow:
  1. `/memory-import dry_run`
  2. Review inserted/conflict output.
  3. `/memory-import merge` to apply.

`memory_export` and `memory_import` use an automatic configured backup path. The agent does not need to pass a `path` parameter.

Default backup file:

```txt
<workdir>/.pi/mempry-backups/memory-backup.jsonl
```

Project override:

```json
{
  "backups": {
    "path": "relative/path/to/memory-backup.jsonl",
    "mode": "mirror",
    "include_sessions": true
  }
}
```

Notes:

- `backups.path` must be relative to the current working directory. Absolute paths and `..` escapes are ignored with warnings.
- `memory_export` writes a JSONL backup with a `meta` record, `manifest`, and hashed row records.
- Export is scoped to the current memory context/project for rows read from the DB: project backups contain that project's memories, sessions, prompts (when sessions are included), and related entities/links.
- Retrieval telemetry is local-only operational metadata and is never exported.
- `backups.mode="mirror"` rewrites the file from current scoped DB state, so scoped rows removed locally are removed from the backup too.
- `backups.mode="merge"` preserves existing backup rows and updates/adds current rows. Use this when the backup should accumulate restored/older rows instead of being pruned by the current DB. Use `mirror` when you intentionally want deletions or privacy cleanup reflected in the backup.
- `memory_export` defaults to JSONL and includes archived memories unless `include_archived=false` is passed.
- SQLite export is reserved for future implementation.
- Session prompt rows are included only when `backups.include_sessions=true` or the tool call explicitly passes `include_sessions=true`.
- Legacy support: if only `backups.include_prompts` exists, it is used as fallback with a deprecation warning.
- Import defaults to `dry_run` and validates backup format/schema version.
- Import dry-run reports `project_profile` collisions before any write.
- Merge import keeps one active canonical `project_profile` per project. Depending on `on_conflict`, the canonical profile keeps local fields, updates from the imported profile, or preserves the import as a conflict-marked superseded record.
- Preserved duplicate/imported profiles remain readable as `superseded` records linked to the canonical profile.
- Projects can override omitted import defaults in `.pi/memory.json`, for example:

  ```json
  {
    "import": {
      "mode": "merge",
      "on_conflict": "keep_local"
    }
  }
  ```

- Explicit `memory_import` mode/conflict parameters always override `.pi/memory.json` defaults.

### Retrieval telemetry (opt-in)

Retrieval telemetry is optional and local-only.

Opt-in example:

```json
{
  "telemetry": {
    "retrieval": {
      "enabled": true,
      "retention_days": 30
    }
  }
}
```

Rules:

- default is disabled;
- retention defaults to `30` days and is clamped to `1..365`;
- writes happen only to the local SQLite `retrieval_telemetry` table;
- telemetry is best-effort and does not break search, recall, or startup if telemetry writing fails.

Stored fields are closed and metadata-only:

- `timestamp`
- `operation`
- `trigger_category`
- `project_id`
- `session_id`
- `result_memory_ids`
- `result_ranks`
- `result_count`
- `latency_ms`
- `success`
- `error_category`

The extension does not store prompt text, query text, query-derived hashes, memory titles, summaries, contents, rendered results, secrets, or arbitrary free-form telemetry payloads.

### Security and privacy

- Do not store secrets, tokens, passwords, private keys, or raw logs.
- Memory add, prompt capture, and session finish flows reject obvious secret-like content before storage.
- `.pi/memory.json` must not contain cloud tokens.
- Session prompts are audit records; include session exports only intentionally.
- Retrieval telemetry is off by default, local-only, and metadata-only when enabled.
- The extension writes the local DB outside the repository by default to avoid accidental commits.
- Cloud sync is not implemented yet; cloud config currently affects status/readiness and initial sync metadata.

### Development

Install dependencies once:

```bash
cd extensions/memory
npm install
```

Run tests:

```bash
cd extensions/memory
npm test
```

Run typecheck:

```bash
cd extensions/memory
npm run typecheck
```

The extension uses Node's built-in `node:sqlite` module, so run it with a Node version that provides that API.

Deterministic quality checks use synthetic local SQLite fixtures, fixed clocks for startup scoring/retention behavior, and no external services.

### Related project docs

- `skills/persistent-memory/SKILL.md` — agent operating policy for using memory.
- `skills/memory-configuration/SKILL.md` — `.pi/memory.json`, backup, import, restore, and telemetry configuration policy.
- `extensions/memory/src/config.ts` — config parsing and defaults.
- `extensions/memory/src/export-import.ts` — backup format and import behavior.
- `extensions/memory/src/startup-selection.ts` — deterministic startup scoring and selection.
- `extensions/memory/src/retrieval-telemetry.ts` — local retrieval telemetry behavior.

## Español

Memoria persistente local-first para agentes Pi. Esta extensión le da al agente un cerebro de memoria consciente del proyecto respaldado por SQLite + FTS5, expone tools de memoria al LLM, agrega comandos slash para humanos, captura prompts de sesión para auditoría y resume sesiones al apagar.

### Qué proporciona

- Registros de memoria `project`/`general`/`global` con kinds como `decision`, `command`, `workflow`, `todo`, `learning`, `project_profile` y `discovery_finding`.
- Almacenamiento SQLite local con búsqueda FTS5, WAL, foreign keys y `busy_timeout`.
- Resolución automática de contexto de proyecto desde `.pi/memory.json`, remote/root git, nombre de carpeta o home.
- Inyección de contexto de memoria al inicio una vez por sesión.
- Registros de auditoría de prompts/sesiones.
- Resúmenes locales rápidos de sesión al shutdown por defecto.
- Resumen semántico opcional de sesión y actualización semántica opcional del perfil de proyecto.
- Export/import a JSONL.
- Soporte para consolidación de memorias duplicadas.
- `/memory-browser` interactivo.
- Telemetría local opcional de recuperación con opt-in explícito.
- Metadata y campos de estado preparados para cloud sync; todavía no hay backend real cloud push/pull.

### Ubicación de la extensión

En este checkout de agent-dir la extensión vive en:

```txt
extensions/memory/index.ts
```

Cuando se copia a una configuración Pi local de proyecto, la ruta equivalente es:

```txt
.pi/extensions/memory/index.ts
```

Pi autodetecta extensiones locales de proyecto desde `.pi/extensions/*/index.ts` una vez que el proyecto es confiable. Usa `/reload` después de cambiar código de extensión durante una sesión interactiva.

### Configuración

La configuración de proyecto vive en `.pi/memory.json` en la raíz del proyecto o un directorio ancestro.

Config mínima:

```json
{
  "enabled": true,
  "project_name": "j0k3r-pi"
}
```

Config recomendada de proyecto para backups project-scoped automáticos y restores seguros. Este ejemplo sobreescribe intencionalmente la ruta legacy default integrada (`.pi/mempry-backups/...`) con la ruta más clara `.pi/memory-backups/...` y mantiene la telemetría de recuperación deshabilitada por defecto:

```json
{
  "project_name": "j0k3r-pi",
  "aliases": [],
  "default_scope": "project",
  "debug": false,
  "session_end": {
    "semantic": false
  },
  "import": {
    "mode": "merge",
    "on_conflict": "keep_local"
  },
  "enabled": true,
  "backups": {
    "path": ".pi/memory-backups/memory-backup.jsonl",
    "mode": "mirror",
    "include_sessions": true
  },
  "telemetry": {
    "retrieval": {
      "enabled": false,
      "retention_days": 30
    }
  },
  "cloud": {
    "enabled": false
  }
}
```

Usa `backups.include_sessions=true` solo cuando el proyecto quiera intencionalmente export/import de sesiones y prompts de sesión. Las filas de prompts siempre se almacenan localmente para auditoría como parte de las sesiones.

Forma completa soportada:

```json
{
  "project_name": "j0k3r-pi",
  "aliases": ["pi-agent-workflow"],
  "default_scope": "project",
  "debug": false,
  "session_end": {
    "semantic": false
  },
  "import": {
    "mode": "merge",
    "on_conflict": "keep_local"
  },
  "backups": {
    "path": ".pi/mempry-backups/memory-backup.jsonl",
    "mode": "mirror",
    "include_sessions": false
  },
  "git": {
    "enabled": false,
    "sync": {
      "cloud": false,
      "export": false,
      "import": false
    }
  },
  "telemetry": {
    "retrieval": {
      "enabled": false,
      "retention_days": 30
    }
  },
  "cloud": {
    "enabled": false,
    "organization_id": "org_abc123",
    "actor_id": "actor_j0k3r",
    "remote_project_id": "proj_j0k3r_pi",
    "url_env": "PI_MEMORY_CLOUD_URL",
    "token_env": "PI_MEMORY_CLOUD_TOKEN"
  }
}
```

#### Campos de configuración

| Campo | Default | Descripción |
|---|---:|---|
| `project_name` | inferido | Nombre canónico del proyecto. Si está presente, gana sobre inferencia por git/carpeta. |
| `aliases` | `[]` | Aliases opcionales de nombres legacy de proyecto mantenidos por compatibilidad. |
| `default_scope` | solo parseado | Campo reservado para `general`, `project` o `global`; actualmente se parsea por compatibilidad pero no se usa para resolución de contexto. |
| `debug` | `false` | Habilita logging local de lifecycle a `memory-session-debug.log` en el cwd actual. Loguea IDs/files de sesión y eventos lifecycle, nunca texto de prompts. Mantener deshabilitado salvo auditoría. |
| `session_end.semantic` | `false` | Habilita resumen de shutdown respaldado por modelo y update de perfil. Off por defecto para salida rápida. |
| `import.mode` | `dry_run` | Modo default de `memory_import` cuando la tool omite `mode`. Valores: `dry_run`, `merge`. Valores inválidos se ignoran con warning. |
| `import.on_conflict` | `mark_conflict` | Política default de conflicto de `memory_import` cuando se omite. Valores: `keep_local`, `keep_imported`, `mark_conflict`. Valores inválidos se ignoran con warning. |
| `backups.path` | `.pi/mempry-backups/memory-backup.jsonl` | Ruta relativa, resuelta desde el cwd actual, para backups automáticos import/export. Rutas absolutas y escapes fuera del workdir se rechazan con warning. |
| `backups.mode` | `mirror` | Modo de escritura export. `mirror` reescribe el archivo desde el estado DB scoped actual. `merge` preserva filas existentes del backup y actualiza/agrega filas actuales. Valores inválidos se ignoran con warning. |
| `backups.include_sessions` | `false` | Cuando es `true`, `memory_export` automático incluye `memory_sessions` y `memory_session_prompts` linkeados para el proyecto actual. Los prompts de sesión son datos de auditoría, por eso es opt-in. |
| `enabled` | `false` | Habilita registro de la extensión memory para este proyecto cuando es true. |
| `git.enabled` | `false` | Habilita features de memoria conscientes de Git como tools de commit/changelog. Esta configuración no bloquea `memory_link` genérico. |
| `git.sync.cloud` | `false` | Incluye registros derivados de Git en readiness/status de cloud sync solo cuando está habilitado. |
| `git.sync.export` | `false` | Incluye registros derivados de Git en exports solo cuando está habilitado. |
| `git.sync.import` | `false` | Incluye registros derivados de Git en imports solo cuando está habilitado. |
| `telemetry.retrieval.enabled` | `false` | Habilita telemetría local de recuperación solo cuando se setea explícitamente en `true`. Los proyectos deshabilitados no escriben filas de telemetría ni ejecutan pruning. |
| `telemetry.retrieval.retention_days` | `30` | Retención de telemetría de recuperación en días. Los valores se limitan al rango inclusivo `1..365` con warning. |
| `cloud.enabled` | `false` | Marca filas de proyecto como pendientes de cloud-sync y habilita checks de readiness cloud. |
| `cloud.organization_id` | `null` | Requerido solo cuando cloud está habilitado. |
| `cloud.actor_id` | `null` | Requerido solo cuando cloud está habilitado. |
| `cloud.remote_project_id` | `null` | Requerido solo cuando cloud está habilitado. |
| `cloud.url_env` | `PI_MEMORY_CLOUD_URL` | Nombre de variable de entorno para URL cloud. |
| `cloud.token_env` | `PI_MEMORY_CLOUD_TOKEN` | Nombre de variable de entorno para token cloud. |

Nunca guardes tokens cloud directamente en `.pi/memory.json`.

#### Checklist de setup para un proyecto nuevo

1. Crear `.pi/memory.json` con la config recomendada arriba y setear `project_name` al nombre canónico del proyecto.
2. Mantener `backups.path` relativo al working directory del proyecto. Rutas absolutas y escapes `..` se rechazan/ignoran.
3. Mantener `telemetry.retrieval.enabled=false` salvo que el proyecto haga opt-in explícito a telemetría local solo de metadata.
4. Ejecutar `/reload` o reiniciar Pi después de cambiar `.pi/memory.json` o código de extensión.
5. Usar `memory_context` para verificar la identidad de proyecto resuelta.
6. Ejecutar `memory_export` (tool) o `/memory-export` (comando) desde el cwd del proyecto. El agente o usuario no necesita pasar una ruta.
7. Para restaurar desde ese backup, ejecutar `memory_import` (default respeta defaults configurados) o `/memory-import dry_run` para dry-run explícito, luego usar `memory_import` con modo merge o `/memory-import merge` cuando quieras aplicar cambios.
8. Inspeccionar la metadata del backup si hace falta: `format` debe ser `pi-memory-backup`, `version` debe ser `2`, `mode` debe coincidir con `backups.mode`, `mirror` debe ser `true` para modo mirror y `false` para merge, y `includes_sessions` debe coincidir con `backups.include_sessions`.

Hay una skill dedicada para esto: `memory-configuration`.

### Almacenamiento

Ruta DB por defecto:

```txt
$XDG_DATA_HOME/pi/memory/memory.sqlite
```

Fallback:

```txt
~/.local/share/pi/memory/memory.sqlite
```

Overrides de entorno:

```bash
PI_MEMORY_DB_PATH=/absolute/path/to/memory.sqlite
PI_MEMORY_HOME=/absolute/path/to/memory-home
```

Settings SQLite:

- `PRAGMA foreign_keys = ON`
- `PRAGMA journal_mode = WAL`
- `PRAGMA busy_timeout = 5000`

### Resolución de contexto

La extensión resuelve el contexto de memoria activo en este orden:

1. Si `cwd` es el home del usuario, scope `general`.
2. Si `.pi/memory.json` contiene `project_name`, scope `project` con `project:<slug(project_name)>`.
3. Si está dentro de un repo git con `remote.origin.url` parseable, scope `project` con `git:<host>/<owner>/<repo>`.
4. Si está dentro de un repo git sin remote parseable, scope `project` desde el nombre de carpeta de la raíz git.
5. Si no, scope `project` desde el nombre de la carpeta actual.

Usa `/memory-context` o la tool `memory_context` para inspeccionar el contexto resuelto.

### Lifecycle de sesión

Eventos lifecycle registrados:

- `session_start`: resuelve el contexto de memoria y setea estado de footer sin crear ni reabrir una sesión memory.
- `before_agent_start`: crea, resume o reabre la sesión memory de forma lazy con el primer prompt no vacío del usuario, captura ese prompt e inyecta startup brain context una vez por cada sesión Pi distinta. Las nuevas sesiones lifecycle-managed usan el `ctx.sessionManager.getSessionId()` exacto y no vacío como `memory_sessions.id`; si Pi no lo provee o colisiona con una fila de contexto incompatible, la creación lifecycle se omite de forma segura en lugar de generar un id fallback o reabrir/finalizar una fila ajena. El contexto es un índice compacto con resúmenes acotados y señales explícitas para recuperar memoria relevante para la tarea.
- `session_shutdown`: cierra la sesión memory salvo que la razón de shutdown sea `reload`.

Las sesiones Memory se linkean a sesiones Pi usando esta prioridad conservadora:

1. Reusar una sesión compatible existente cuya fila ya tenga `id === ctx.sessionManager.getSessionId()`.
2. Reusar una sesión compatible existente matcheada por `metadata_json.pi_session_id`.
3. Reusar una sesión compatible existente matcheada por `metadata_json.pi_session_file`.
4. Reusar una entrada custom compatible de sesión Pi persistida con `pi.appendEntry("memory-session", { memory_session_id })`.
5. Cuando no hay Pi id, archivo de sesión ni entrada custom disponibles, reusar una sesión reciente activa auto-started no ambigua para el mismo proyecto y cwd.
6. Si no hay match compatible, crear una nueva sesión lifecycle-managed cuyo `memory_sessions.id` sea exactamente el Pi session id no vacío.

Las filas legacy compatibles conservan sus ids existentes sin cambios. Si Pi no puede proveer un session id no vacío y no hay una sesión compatible para reusar, la extensión omite la creación lifecycle y la captura de prompts en lugar de generar un id fallback. Si el Pi session id exacto ya pertenece a una fila de scope/contexto incompatible, la extensión falla de forma segura y no reabre ni finaliza esa fila ajena.

Cuando una sesión memory completada se resume con la misma identidad Pi, `session_start` la deja cerrada y el primer prompt no vacío en `before_agent_start` la reactiva con `status='active'` y `ended_at=NULL`. Los prompts vacíos de startup no crean ni reabren sesiones. El resumen previo se preserva hasta que el próximo finish lo reescribe.

Comportamiento de shutdown:

- Default: escribe un resumen local heurístico rápido de la sesión.
- Con `session_end.semantic=true`: intenta un resumen semántico con el modelo activo y cae al resumen heurístico si hay error o falta auth.
- `memory_session_finish` explícita es la acción real y visible de cierre para pedidos del usuario de close/end/finish. Si una sesión ya quedó completada explícitamente, un shutdown graceful posterior solo marca el estado runtime local como cerrado y no sobreescribe el summary guardado, learned, metadata ni `ended_at`.
- Reload no cierra la sesión lifecycle activa.
- El cierre de sesión nunca modifica el perfil canónico del proyecto. Los agentes lo leen y mantienen explícitamente mediante `memory_project_profile` cuando cambian hechos durables del proyecto. El perfil canónico queda fuera de los slots startup regulares y del contexto compacto de `memory_start_chat`.

### Comportamiento de calidad de memoria

#### Startup brain context

La inyección de memoria al inicio es determinística e independiente del prompt:

- solo memorias `active` son elegibles;
- `archived` y `superseded` quedan excluidas;
- solo se consideran memorias general/global más las memorias project-scoped del proyecto actual;
- el selector devuelve como máximo 4 memorias;
- todavía puede anexarse por separado un resumen de una sesión completada;
- el progreso/ruido stale de bajo valor se degrada en ranking en lugar de borrarse.

El selector usa prioridad por kind durable, importancia y una penalización acotada por staleness. No inspecciona texto de prompts ni llama servicios externos de ranking.

#### Comportamiento del perfil de proyecto

`project_profile` es canónico por proyecto:

- cada proyecto mantiene como máximo un `project_profile` activo;
- `memory_add(kind='project_profile')` actualiza el registro activo canónico in-place en vez de crear un segundo perfil activo;
- `memory_project_profile` es la API principal para leer/actualizar el perfil canónico y devuelve el perfil completo después de get, ensure o update;
- el contenido del perfil canónico preserva mayúsculas y minúsculas para mantener rutas e identificadores case-sensitive correctos, mientras títulos y tags conservan su normalización habitual a minúsculas;
- los agentes reciben instrucciones para leerlo cuando sea relevante y actualizarlo explícitamente cuando cambien hechos durables del proyecto;
- los perfiles activos duplicados detectados durante migración se marcan `superseded`, siguen siendo legibles y se linkean al registro canónico;
- el contenido de los duplicados superseded se preserva.

#### Discovery findings y links explícitos

Usa `discovery_finding` para hallazgos durables de investigación que luego pueden implementarse o supersederse.

Los links genéricos son explícitos:

- `memory_link` funciona incluso cuando `git.enabled=false`;
- las relaciones permitidas son `supports`, `supersedes`, `contradicts`, `derived_from`, `related_to` e `implements`;
- los endpoints deben existir previamente;
- self-links y cross-project links se rechazan;
- se rechazan links mutuos inversos `implements` y `supersedes`;
- links idénticos duplicados se tratan como éxito idempotente.

`memory_commit_changelog_link` sigue siendo Git-gated para workflows de commit/changelog.

### Tools expuestas al agente

| Tool | Propósito |
|---|---|
| `memory_context` | Resuelve scope/identidad de proyecto de memoria actual. |
| `memory_add` | Guarda memorias durables. |
| `memory_search` | Busca memorias/resúmenes compactos locales. |
| `memory_get` | Lee una memoria completa por id seleccionado desde índices compactos confiables como startup, search, list, recall o resultados relacionados de Memory. |
| `memory_list` | Lista memorias compactas por filtros. |
| `memory_update` | Actualiza contenido/tags/status/confidence/importance. |
| `memory_archive` | Archiva una memoria sin borrarla. |
| `memory_session_start` | Crea/registra una sesión memory manual separada, no lifecycle. |
| `memory_session_prompt_add` | Guarda un prompt relevante de sesión para auditoría. |
| `memory_session_finish` | Finaliza una sesión memory; `session_id` es opcional solo para la sesión lifecycle activa y los pedidos explícitos de close/end deben usarla antes de confirmar el cierre. |
| `memory_start_chat` | API explícita/manual para iniciar una sesión memory separada, no lifecycle, y devolver contexto startup compacto sin el project profile canónico. |
| `memory_recall` | Recupera contexto compacto de momento de workflow. Aliases: `task`, `edit`, `test`, `commit`, `end`. |
| `memory_project_profile` | Obtiene/asegura/actualiza el perfil actual y devuelve su contenido canónico completo. |
| `memory_consolidate` | Encuentra o aplica consolidación de memorias duplicadas. Dry-run por defecto. |
| `memory_link` | Crea una relación genérica explícita entre dos memorias existentes. |
| `memory_sync_status` | Muestra conteos locales conscientes de sync status. |
| `memory_export` | Exporta memoria a JSONL. |
| `memory_import` | Importa memoria desde JSONL. Dry-run por defecto. |

### Comandos slash

| Comando | Descripción |
|---|---|
| `/memory-status` | Muestra ruta DB, contexto actual y readiness cloud. |
| `/memory-context` | Muestra JSON del contexto memory resuelto. |
| `/memory-search <query>` | Busca memoria local. |
| `/memory-list` | Lista memorias recientes. |
| `/memory-doctor` | Diagnostica DB, FTS5, contexto y config cloud. |
| `/memory-sync-status` | Muestra conteos por sync status. |
| `/memory-consolidate [kind]` | Dry-run de detección de duplicados. |
| `/memory-project-profile` | Asegura y muestra el perfil del proyecto actual. |
| `/memory-export [jsonl|sqlite] [mirror|merge] [sessions] [active-only]` | Exporta backup scoped de memoria. |
| `/memory-import [merge|dry_run] [keep_local|keep_imported|mark_conflict]` | Importa backup de memoria (por defecto usa modo configurado; normalmente `dry_run`). |
| `/memory-browser` | Abre el browser interactivo de memoria. |

### Memory browser

`/memory-browser` abre un browser interactivo con navegación estilo nvim. Lista solo memorias, sesiones y prompts capturados del proyecto actual. Los detalles de sesión incluyen los prompts linkeados a esa sesión para auditoría/debug. Sesiones/prompts de subagentes se linkean a su sesión de usuario padre y se ocultan por defecto; los detalles de sesión de usuario muestran sesiones de subagente linkeadas, y `origin=subagent` u `origin=all` permiten inspeccionarlas directamente dentro del proyecto actual. Soporta comandos de filtro como:

```txt
:query=npm kind=command scope=project status=active project=app
:origin=subagent
:origin=all
:clear
```

### Export e import

Las tools `memory_export`/`memory_import` y comandos `/memory-export`/`/memory-import` usan una ruta automática de backup configurada; no se requiere argumento `path`.

#### Uso de comandos de usuario

- Export: `/memory-export`
  - `jsonl` (default)
  - `mirror|merge` para sobreescribir `backups.mode` en este export
  - `sessions` para incluir sesiones y prompts (o `sessions=false` / `include_sessions=false`)
  - `active-only` para exportar solo memorias activas
  - `active` equivale a `active-only` (`include_archived=false`)
  - `help` para mostrar uso

  Ejemplos:

  - `/memory-export`
  - `/memory-export merge`
  - `/memory-export sessions`
  - `/memory-export jsonl active-only`

- Import: `/memory-import`
  - `dry_run` (default o default configurado por proyecto)
  - `merge` para aplicar cambios
  - `keep_local|keep_imported|mark_conflict` para manejo de conflictos
  - `help` para mostrar uso

  Flujo recomendado:
  1. `/memory-import dry_run`
  2. Revisar salida de insertados/conflictos.
  3. `/memory-import merge` para aplicar.

`memory_export` y `memory_import` usan una ruta automática de backup configurada. El agente no necesita pasar parámetro `path`.

Archivo backup default:

```txt
<workdir>/.pi/mempry-backups/memory-backup.jsonl
```

Override de proyecto:

```json
{
  "backups": {
    "path": "relative/path/to/memory-backup.jsonl",
    "mode": "mirror",
    "include_sessions": true
  }
}
```

Notas:

- `backups.path` debe ser relativo al working directory actual. Rutas absolutas y escapes `..` se ignoran con warnings.
- `memory_export` escribe un backup JSONL con un registro `meta`, `manifest` y registros de filas hasheados.
- Export se limita al contexto/proyecto memory actual para filas leídas de la DB: backups de proyecto contienen memorias, sesiones, prompts (cuando se incluyen sesiones) y entidades/links relacionados de ese proyecto.
- La telemetría de recuperación es metadata operativa solo local y nunca se exporta.
- `backups.mode="mirror"` reescribe el archivo desde el estado DB scoped actual, así que filas scoped removidas localmente también se remueven del backup.
- `backups.mode="merge"` preserva filas existentes del backup y actualiza/agrega filas actuales. Usar cuando el backup deba acumular filas restauradas/antiguas en vez de podarse por la DB actual. Usar `mirror` cuando se quiere reflejar intencionalmente borrados o limpieza de privacidad en el backup.
- `memory_export` default a JSONL e incluye memorias archivadas salvo que se pase `include_archived=false`.
- Export SQLite queda reservado para implementación futura.
- Las filas de prompts de sesión se incluyen solo cuando `backups.include_sessions=true` o la llamada a tool pasa explícitamente `include_sessions=true`.
- Soporte legacy: si solo existe `backups.include_prompts`, se usa como fallback con warning de deprecación.
- Import default a `dry_run` y valida formato/schema version del backup.
- El dry-run de import reporta colisiones de `project_profile` antes de cualquier escritura.
- El import merge mantiene un único `project_profile` activo canónico por proyecto. Según `on_conflict`, el perfil canónico conserva campos locales, se actualiza desde el perfil importado o preserva el importado como registro superseded marcado como conflicto.
- Los perfiles preservados duplicados/importados siguen siendo legibles como registros `superseded` linkeados al perfil canónico.
- Los proyectos pueden sobreescribir defaults de import omitidos en `.pi/memory.json`, por ejemplo:

  ```json
  {
    "import": {
      "mode": "merge",
      "on_conflict": "keep_local"
    }
  }
  ```

- Parámetros explícitos de modo/conflicto en `memory_import` siempre sobreescriben defaults de `.pi/memory.json`.

### Telemetría de recuperación (opt-in)

La telemetría de recuperación es opcional y solo local.

Ejemplo de opt-in:

```json
{
  "telemetry": {
    "retrieval": {
      "enabled": true,
      "retention_days": 30
    }
  }
}
```

Reglas:

- por defecto está deshabilitada;
- la retención default es `30` días y se limita a `1..365`;
- las escrituras ocurren solo en la tabla local SQLite `retrieval_telemetry`;
- la telemetría es best-effort y no rompe search, recall o startup si falla la escritura de telemetría.

Los campos almacenados son cerrados y solo de metadata:

- `timestamp`
- `operation`
- `trigger_category`
- `project_id`
- `session_id`
- `result_memory_ids`
- `result_ranks`
- `result_count`
- `latency_ms`
- `success`
- `error_category`

La extensión no almacena texto de prompts, texto de queries, hashes derivados de queries, títulos de memoria, resúmenes, contenidos, resultados renderizados, secretos ni payloads arbitrarios free-form de telemetría.

### Seguridad y privacidad

- No guardar secretos, tokens, passwords, private keys o logs crudos.
- Los flujos memory add, captura de prompts y session finish rechazan contenido obvio con apariencia de secreto antes de almacenar.
- `.pi/memory.json` no debe contener tokens cloud.
- Los prompts de sesión son registros de auditoría; incluir exports de sesiones solo intencionalmente.
- La telemetría de recuperación está off por defecto, es solo local y solo de metadata cuando se habilita.
- La extensión escribe la DB local fuera del repositorio por defecto para evitar commits accidentales.
- Cloud sync todavía no está implementado; la config cloud actualmente afecta status/readiness y metadata inicial de sync.

### Desarrollo

Instalar dependencias una vez:

```bash
cd extensions/memory
npm install
```

Ejecutar tests:

```bash
cd extensions/memory
npm test
```

Ejecutar typecheck:

```bash
cd extensions/memory
npm run typecheck
```

La extensión usa el módulo integrado `node:sqlite` de Node, así que debe correr con una versión de Node que provea esa API.

Los checks determinísticos de calidad usan fixtures locales SQLite sintéticas, clocks fijos para comportamiento de startup scoring/retención y ningún servicio externo.

### Docs relacionadas del proyecto

- `skills/persistent-memory/SKILL.md` — política operativa del agente para usar memoria.
- `skills/memory-configuration/SKILL.md` — política de configuración `.pi/memory.json`, backup, restore e import, incluida telemetría.
- `extensions/memory/src/config.ts` — parsing de config y defaults.
- `extensions/memory/src/export-import.ts` — formato de backup y comportamiento import.
- `extensions/memory/src/startup-selection.ts` — scoring y selección determinística de startup.
- `extensions/memory/src/retrieval-telemetry.ts` — comportamiento de telemetría local de recuperación.
