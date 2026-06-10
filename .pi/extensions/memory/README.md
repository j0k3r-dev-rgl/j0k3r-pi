# Pi Memory Extension

Local-first persistent memory for Pi agents. This extension gives the agent a project-aware memory brain backed by SQLite + FTS5, exposes memory tools to the LLM, adds slash commands for humans, captures session prompts for audit, and summarizes sessions at shutdown.

## What it provides

- Project/general/global memory records with kinds such as `decision`, `command`, `workflow`, `todo`, `learning`, and `project_profile`.
- Local SQLite storage with FTS5 search, WAL, foreign keys, and `busy_timeout`.
- Automatic project context resolution from `.pi/memory.json`, git remote/root, folder name, or home directory.
- Startup memory context injection once per session.
- Prompt/session audit records.
- Fast local session summaries on shutdown by default.
- Optional semantic session summary and semantic project-profile update.
- Export/import to JSONL.
- Duplicate-memory consolidation support.
- Interactive `/memory-browser`.
- Cloud-sync-ready metadata and status fields; no real cloud push/pull backend yet.

## Extension location

This is a project-local Pi extension:

```txt
.pi/extensions/memory/index.ts
```

Pi auto-discovers project-local extensions from `.pi/extensions/*/index.ts` once the project is trusted. Use `/reload` after changing extension code during an interactive session.

## Configuration

Project configuration lives in `.pi/memory.json` at the project root or an ancestor directory.

Minimal config:

```json
{
  "project_name": "j0k3r-pi"
}
```

Full supported shape:

```json
{
  "project_name": "j0k3r-pi",
  "aliases": ["pi-agent-workflow"],
  "default_scope": "project",
  "session_end": {
    "semantic": false
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

### Config fields

| Field | Default | Description |
|---|---:|---|
| `project_name` | inferred | Canonical project name. If present, it wins over git/folder inference. |
| `aliases` | `[]` | Previous project names used by migration helpers. |
| `default_scope` | parsed only | Reserved config field for `general`, `project`, or `global`; currently parsed for compatibility but not used by context resolution. |
| `session_end.semantic` | `false` | Enables model-backed shutdown summary/profile update. Off by default for fast exit. |
| `cloud.enabled` | `false` | Marks project rows as cloud-sync pending and enables cloud readiness checks. |
| `cloud.organization_id` | `null` | Required only when cloud is enabled. |
| `cloud.actor_id` | `null` | Required only when cloud is enabled. |
| `cloud.remote_project_id` | `null` | Required only when cloud is enabled. |
| `cloud.url_env` | `PI_MEMORY_CLOUD_URL` | Environment variable name for cloud URL. |
| `cloud.token_env` | `PI_MEMORY_CLOUD_TOKEN` | Environment variable name for cloud token. |

Never store cloud tokens directly in `.pi/memory.json`.

## Storage

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

## Context resolution

The extension resolves the active memory context in this order:

1. If `cwd` is the user's home directory, scope is `general`.
2. If `.pi/memory.json` contains `project_name`, scope is `project` with `project:<slug(project_name)>`.
3. If inside a git repo with a parseable `remote.origin.url`, scope is `project` with `git:<host>/<owner>/<repo>`.
4. If inside a git repo without parseable remote, scope is `project` from git root folder name.
5. Otherwise scope is `project` from current folder name.

Use `/memory-context` or the `memory_context` tool to inspect the resolved context.

## Session lifecycle

Registered lifecycle events:

- `session_start`: creates or resumes a memory session and sets footer status.
- `before_agent_start`: captures the user prompt and injects startup brain context once.
- `session_shutdown`: closes the memory session unless shutdown reason is `reload`.

Shutdown behavior:

- Default: fast heuristic local summary and heuristic project-profile update.
- With `session_end.semantic=true`: tries semantic summary and semantic project-profile update with the active model, then falls back to heuristic behavior on error or missing auth.

## Tools exposed to the agent

| Tool | Purpose |
|---|---|
| `memory_context` | Resolve current memory scope/project identity. |
| `memory_add` | Store durable memories. |
| `memory_search` | Search compact local memories/session summaries. |
| `memory_get` | Read a complete memory by id. |
| `memory_list` | List compact memories by filters. |
| `memory_update` | Update memory content/tags/status. |
| `memory_archive` | Archive a memory without deleting it. |
| `memory_session_start` | Create/register a memory session. |
| `memory_session_prompt_add` | Store a relevant session prompt for audit. |
| `memory_session_finish` | Finish a memory session and optionally extract durable memories. |
| `memory_start_chat` | Start a memory session and return compact startup context. |
| `memory_recall` | Recall compact workflow-moment context. Aliases: `task`, `edit`, `test`, `commit`, `end`. |
| `memory_project_profile` | Get/ensure/update the current project profile. |
| `memory_consolidate` | Find or apply duplicate-memory consolidation. Dry-run defaults to true. |
| `memory_sync_status` | Show local sync-aware status counts. |
| `memory_migrate_project` | Dry-run/apply migration to the current canonical project identity. |
| `memory_export` | Export memory to JSONL. |
| `memory_import` | Import memory from JSONL. Dry-run by default. |

## Slash commands

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
| `/memory-migrate-project [--apply]` | Dry-run/apply project canonical migration. |
| `/memory-browser` | Open the interactive memory browser. |

## Memory browser

`/memory-browser` opens an interactive browser with nvim-style navigation. It lists memories and sessions and supports filter commands such as:

```txt
:query=npm kind=command scope=project status=active project=app
:clear
```

## Export and import

Export JSONL:

```json
{
  "path": "./memory-backup.jsonl",
  "include_archived": true,
  "include_prompts": false
}
```

Notes:

- `memory_export` defaults to JSONL.
- SQLite export is reserved for future implementation.
- Prompt rows are excluded unless `include_prompts=true`.
- Import defaults to `dry_run` and validates schema version.
- `merge` mode can keep local records, keep imported records, or mark conflicts.

## Security and privacy

- Do not store secrets, tokens, passwords, private keys, or raw logs.
- `.pi/memory.json` must not contain cloud tokens.
- Session prompts are audit records; include prompts in exports only intentionally.
- The extension writes the local DB outside the repository by default to avoid accidental commits.
- Cloud sync is not implemented yet; cloud config currently affects status/readiness and initial sync metadata.

## Development

Install dependencies once:

```bash
cd .pi/extensions/memory
npm install
```

Run tests:

```bash
cd .pi/extensions/memory
npm test
```

Run typecheck:

```bash
cd .pi/extensions/memory
npm run typecheck
```

Current expected validation:

```txt
2 test files pass
41 tests pass
typecheck passes
```

## Related project docs

- `docs/memory-tool-spec.md` — full product/technical spec.
- `docs/memory-task.md` — implementation status and task history.
- `.pi/skills/persistent-memory/SKILL.md` — agent operating policy for using memory.
