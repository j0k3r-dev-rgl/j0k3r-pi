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
  "domains": ["memory-configuration", "memory-backup-config", "memory-import-defaults", "git-memory-config"],
  "triggers": {
    "paths": [
      ".pi/memory.json"
    ],
    "keywords": [
      "memory configuration",
      "configure memory",
      "configurar memory",
      "configuro memory",
      "como configurar memory",
      "cómo configurar memory",
      "como configuro memory",
      "cómo configuro memory",
      "como se configura memory",
      "cómo se configura memory",
      "configurar memoria",
      "configuro memoria",
      "como configurar memoria",
      "cómo configurar memoria",
      "como configuro memoria",
      "cómo configuro memoria",
      "como se configura memoria",
      "cómo se configura memoria",
      "configuracion memory",
      "configuración memory",
      "configuracion memoria",
      "configuración memoria",
      "memory config",
      "memory.json",
      "enable memory",
      "disable memory",
      "memory backup configuration",
      "memory import defaults",
      "backups.include_sessions",
      "git memory configuration",
      "git.enabled",
      "git.sync.cloud",
      "git.sync.export",
      "git.sync.import"
    ]
  },
  "sdd_phases": [],
  "related_skills": [
    "persistent-memory"
  ],
  "priority": 85
}
```

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `triggers.paths`: glob-like project paths that should activate this skill.
- `triggers.keywords`: configuration-only keywords that should activate this skill.
- `sdd_phases`: keep empty for configuration-only skills so phase routing alone does not load them.
- `related_skills`: configuration-adjacent skills only; do not add usage, implementation, or workflow skills.
- `priority`: routing priority from 0 to 100. Higher means consider earlier when multiple skills match.

## Activation Contract

Use this skill only when the user asks how to configure Pi Memory Extension for a project or when editing/reviewing `.pi/memory.json`. Cover opt-in enablement, project identity, backup/import defaults, session backup settings, debug flags, cloud token variable names, and git-memory config fields as configuration topics only.

Do not load this skill for ordinary memory recall/search/save usage, memory import/export operation requests, extension implementation work, generated backup files, or editing this skill file; those are not configuration questions.

## Hard Rules

- Treat `.pi/memory.json` as project configuration, not as memory content.
- `enabled` defaults to `false`; the extension should be considered off unless the project explicitly opts in with `enabled: true`.
- Keep `backups.path` relative to the current working directory; do not use absolute paths.
- Do not use `..` path escapes in `backups.path`.
- Prefer project-scoped mirror backups so exports contain only the current memory context/project.
- Keep backup/import default guidance focused on `.pi/memory.json` fields, not on ordinary Memory tool usage.
- Never store secrets, tokens, passwords, private keys, or cloud tokens in `.pi/memory.json`.
- Keep `git.enabled=false` by default; set it to `true` only when the project intentionally wants git commit/changelog memory tools available.
- Keep `git.sync.cloud=false`, `git.sync.export=false`, and `git.sync.import=false` by default. `git.sync.export` controls whether configured memory exports include git memory records; `git.sync.import` controls whether configured memory imports apply git memory records. None of these flags authorize Git commits, tags, pushes, cloud calls, or automatic release/changelog generation.
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
  },
  "git": {
    "enabled": false,
    "sync": {
      "cloud": false,
      "export": false,
      "import": false
    }
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
- `git.enabled`: defaults to `false`; set `true` to enable git-oriented memory surfaces such as commit/changelog memory tools for the project.
- `git.sync.cloud`: defaults to `false`; when `true`, records project intent to include git memory in future cloud sync flows. It does not perform cloud sync by itself.
- `git.sync.export`: defaults to `false`; when `true`, configured backups may include git memory records (`commit_record`, `changelog_entry`, `release_record`) plus their links/entities. It does not create backups by itself.
- `git.sync.import`: defaults to `false`; when `true`, configured imports may apply git memory records (`commit_record`, `changelog_entry`, `release_record`) plus their links/entities. When false, imports skip those git memory rows while still importing ordinary memories. It does not run imports by itself.

## Decision Gates

- If the user wants memory available in the project at all, confirm whether `enabled: true` is intentional, because disabled is now the safe default.
- If the user asks for prompt export, explain that prompts travel with sessions; recommend `backups.include_sessions=false` unless the project intentionally wants session audit data in backups.
- If the user asks to import with overwrite behavior, confirm whether `keep_imported` is acceptable before recommending it.
- If a backup contains another project's memories, verify the extension version/reload state and export context before changing project config.
- If configuring memory as part of a broader PRD/SDD workflow, also consider `persistent-memory` and `sdd-workflow`.
- If the user wants commit/changelog/release tools but `.pi/memory.json` omits `git.enabled`, explain that git memory is off by default and ask whether to enable it.
- If the user expects commit/tag/release memories to travel through backup files, confirm `git.sync.export=true` on the exporting project and `git.sync.import=true` on the importing project.

## Execution Steps

1. Identify the target project cwd and whether `.pi/memory.json` already exists.
2. Read the existing `.pi/memory.json` before editing.
3. Preserve existing valid fields unless the user asks to replace them.
4. Add or update `enabled`, `project_name`, `aliases`, `default_scope`, `debug`, `session_end`, `import`, `backups`, `cloud`, and `git` using the hard rules above.
5. Validate the JSON syntax after edits.
6. Tell the user to `/reload` or restart Pi.
7. If the user requested backup configuration validation, inspect configured paths and expected metadata without running backup/restore operations unless explicitly asked.
8. If reviewing an existing backup file only to validate config expectations, check metadata without teaching restore/export usage:
   - `format` should be `pi-memory-backup`;
   - `version` should be `2`;
   - `mirror` should be `true`;
   - `includes_sessions` should match `backups.include_sessions`;
   - `includes_git` should match `git.enabled && git.sync.export` for configured exports.

## Import-default configuration notes

- `import.mode` configures the default import policy only; keep it at `dry_run` unless the project intentionally wants no-argument imports to apply.
- `import.on_conflict` configures conflict policy only; prefer `keep_local` unless the user explicitly accepts overwrite behavior.
- Legacy configs that still mention `include_prompts` are tolerated only as fallback compatibility. Prefer updating them to `include_sessions`.
- After adding or changing import defaults in `.pi/memory.json`, tell the user to `/reload` or restart Pi before relying on omitted parameters.

## Output Contract

Return:

- Skill applied: `memory-configuration`.
- Target project/path configured or reviewed.
- Important `.pi/memory.json` fields set or preserved, including `git.enabled` and `git.sync.*` when relevant.
- Whether memory is enabled and why.
- Whether session export is enabled and why.
- Backup path and whether it is relative/safe.
- Reload/config validation performed, or the concrete reason it was not run.
- Risks, drift, or open decisions, especially whether git memory should remain disabled by default.

## References

- `.pi/memory.json` — project memory configuration file.
- `extensions/memory/README.md` — Memory Extension configuration and backup/import defaults.
- `extensions/memory/src/config.ts` — config parsing and defensive validation.
