---
name: memory-configuration
description: "configure Pi Memory Extension project settings, especially .pi/memory.json opt-in enablement, session-backed mirror backups, and safe import policy."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Memory Configuration

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "workflow",
  "domains": ["memory", "project-configuration", "backups", "import-export"],
  "triggers": {
    "paths": [
      ".pi/memory.json",
      ".pi/memory-backups/**",
      ".pi/mempry-backups/**",
      "extensions/memory/README.md",
      "extensions/memory/src/config.ts",
      "extensions/memory/src/export-import.ts"
    ],
    "keywords": [
      "memory.json",
      "memory configuration",
      "memory backup",
      "memory export",
      "memory import",
      "backups.include_sessions",
      "enabled",
      "import defaults",
      "project memory"
    ]
  },
  "sdd_phases": ["explore", "design", "task", "apply", "verify"],
  "related_skills": [
    "persistent-memory",
    "skill-authoring"
  ],
  "priority": 85
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

Use this skill when a user asks to configure Pi Memory Extension for a project, create or review `.pi/memory.json`, enable or disable memory for a repo, set backup/import defaults, include sessions in backups, or explain how project memory backup/restore should work. Prefer this skill before editing memory configuration in another project.

## Hard Rules

- Treat `.pi/memory.json` as project configuration, not as memory content.
- `enabled` defaults to `false`; the extension should be considered off unless the project explicitly opts in with `enabled: true`.
- Keep `backups.path` relative to the current working directory; do not use absolute paths.
- Do not use `..` path escapes in `backups.path`.
- Prefer project-scoped mirror backups so exports contain only the current memory context/project.
- Keep memory export/import operational guidance in this skill and memory-extension docs, not in `AGENTS.md`.
- Run `memory_export` or `memory_import` only when the user asks for backup/restore/export/import work, or when explicitly validating memory backup configuration.
- Never store secrets, tokens, passwords, private keys, or cloud tokens in `.pi/memory.json`.
- Use `backups.include_sessions=true` only when the project intentionally wants session and linked prompt rows in mirror backups.
- Legacy `backups.include_prompts` is fallback-only compatibility; prefer `backups.include_sessions` in all new configs.
- Keep `debug=false` by default; enable it only for temporary lifecycle auditing because it writes local session identity logs.
- After changing `.pi/memory.json` or extension code, tell the user to `/reload` or restart Pi before relying on the new behavior.
- Use English for reusable configuration examples and skill content.

Recommended project config:

```json
{
  "enabled": true,
  "project_name": "my-project",
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
  "backups": {
    "path": ".pi/memory-backups/memory-backup.jsonl",
    "include_sessions": true
  },
  "cloud": {
    "enabled": false
  }
}
```

Field rules:

- `enabled`: defaults to `false`; set `true` to let the extension open the DB and register its runtime surfaces for the project.
- `project_name`: canonical project identity; if present, it wins over git/folder inference.
- `aliases`: optional legacy project-name aliases kept for compatibility; keep small and intentional.
- `import.mode`: `dry_run` or `merge`; recommended restore policy is `merge`.
- `import.on_conflict`: `keep_local`, `keep_imported`, or `mark_conflict`; recommended restore policy is `keep_local`.
- `backups.path`: automatic mirror backup file path; default is `.pi/mempry-backups/memory-backup.jsonl` unless configured.
- `backups.include_sessions`: defaults to `false`; set `true` to export `memory_sessions` and linked `memory_session_prompts` for the current project.
- `debug`: defaults to `false`; set `true` only while auditing memory lifecycle/session identity behavior. It writes local `memory-session-debug.log` entries without prompt text.
- `session_end.semantic`: keep `false` unless the project explicitly wants model-backed shutdown summaries/profile updates.
- `cloud`: readiness/metadata only unless a backend exists; use env var names for tokens, never raw token values.

## Decision Gates

- If the user wants memory available in the project at all, confirm whether `enabled: true` is intentional, because disabled is now the safe default.
- If the user asks for prompt export, explain that prompts travel with sessions; recommend `backups.include_sessions=false` unless the project intentionally wants session audit data in backups.
- If the user asks to import with overwrite behavior, confirm whether `keep_imported` is acceptable before recommending it.
- If a backup contains another project's memories, verify the extension version/reload state and export context before changing project config.
- If configuring memory as part of a broader PRD/SDD workflow, also consider `persistent-memory` and `sdd-workflow`.

## Execution Steps

1. Identify the target project cwd and whether `.pi/memory.json` already exists.
2. Read the existing `.pi/memory.json` before editing.
3. Preserve existing valid fields unless the user asks to replace them.
4. Add or update `enabled`, `project_name`, `aliases`, `default_scope`, `debug`, `session_end`, `import`, `backups`, and `cloud` using the hard rules above.
5. Validate the JSON syntax after edits.
6. Tell the user to `/reload` or restart Pi.
7. Use `memory_context` to confirm the expected project identity when practical.
8. If the user requested backup validation, run or ask the user to run `memory_export` from the project cwd; otherwise do not export/import automatically.
9. Inspect backup meta when validating:
   - `format` should be `pi-memory-backup`;
   - `version` should be `2`;
   - `mirror` should be `true`;
   - `includes_sessions` should match `backups.include_sessions`.
10. If comparing manually, verify exported `memories.project_name` contains only the current project.

## Import troubleshooting notes

- If `memory_import` reports `0 inserted, 0 conflicts` in `dry_run` mode, do not assume the backup is empty. Current import accounting only increments `inserted` during `merge`; dry runs may still have importable rows visible in the detailed `seen` count.
- When `.pi/memory.json` omits `import.mode`, `memory_import` defaults to `dry_run`. To make no-argument imports apply automatically after reload, configure:

  ```json
  {
    "import": {
      "mode": "merge",
      "on_conflict": "keep_local"
    }
  }
  ```

- When diagnosing a surprising dry run, inspect the backup row counts and compare backup row ids with the active SQLite DB before changing code or config.
- Legacy backups/configs that still mention `include_prompts` are tolerated only as fallback compatibility. Prefer updating them to `include_sessions`.
- After adding or changing import defaults in `.pi/memory.json`, tell the user to `/reload` or restart Pi before relying on omitted tool parameters. Explicit `memory_import` parameters still work immediately.

## Output Contract

Return:

- Skill applied: `memory-configuration`.
- Target project/path configured or reviewed.
- Important `.pi/memory.json` fields set or preserved.
- Whether memory is enabled and why.
- Whether session export is enabled and why.
- Backup path and whether it is relative/safe.
- Reload/export validation performed, or the concrete reason it was not run.
- Risks, drift, or open decisions.

## References

- `.pi/memory.json` — project memory configuration file.
- `extensions/memory/README.md` — Memory Extension configuration, backup, and import/export documentation.
- `extensions/memory/src/config.ts` — config parsing and defensive validation.
- `extensions/memory/src/export-import.ts` — mirror backup format and project-scoped export behavior.
- `.pi/agent/skills/persistent-memory/SKILL.md` — memory operating policy and durable save rules.
- `.pi/agent/skills/skill-authoring/SKILL.md` — canonical skill authoring format.
