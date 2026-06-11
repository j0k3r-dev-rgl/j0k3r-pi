---
name: memory-configuration
description: "configure Pi Memory Extension project settings, especially .pi/memory.json identity, automatic mirror backups, prompt export, and safe import policy."
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
      "backups.include_prompts",
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

Use this skill when a user asks to configure Pi Memory Extension for a project, create or review `.pi/memory.json`, set backup/import defaults, include prompts in backups, or explain how project memory backup/restore should work. Prefer this skill before editing memory configuration in another project.

## Hard Rules

- Treat `.pi/memory.json` as project configuration, not as memory content.
- Keep `backups.path` relative to the current working directory; do not use absolute paths.
- Do not use `..` path escapes in `backups.path`.
- Prefer project-scoped mirror backups so exports contain only the current memory context/project.
- Never store secrets, tokens, passwords, private keys, or cloud tokens in `.pi/memory.json`.
- Use `backups.include_prompts=true` only when the project intentionally wants prompt audit records in backups.
- After changing `.pi/memory.json` or extension code, tell the user to `/reload` or restart Pi before relying on the new behavior.
- Use English for reusable configuration examples and skill content.

Recommended project config:

```json
{
  "project_name": "my-project",
  "aliases": [],
  "default_scope": "project",
  "session_end": {
    "semantic": false
  },
  "import": {
    "mode": "merge",
    "on_conflict": "keep_local"
  },
  "backups": {
    "path": ".pi/memory-backups/memory-backup.jsonl",
    "include_prompts": true
  },
  "cloud": {
    "enabled": false
  }
}
```

Field rules:

- `project_name`: canonical project identity; if present, it wins over git/folder inference.
- `aliases`: optional old names or IDs used by project migration helpers; keep small and intentional.
- `import.mode`: `dry_run` or `merge`; recommended restore policy is `merge`.
- `import.on_conflict`: `keep_local`, `keep_imported`, or `mark_conflict`; recommended restore policy is `keep_local`.
- `backups.path`: automatic mirror backup file path; default is `.pi/mempry-backups/memory-backup.jsonl` unless configured.
- `backups.include_prompts`: defaults to `false`; set `true` to export `memory_session_prompts` for the current project.
- `session_end.semantic`: keep `false` unless the project explicitly wants model-backed shutdown summaries/profile updates.
- `cloud`: readiness/metadata only unless a backend exists; use env var names for tokens, never raw token values.

## Decision Gates

- If the user asks for a global preference about always including prompts, ask for confirmation because prompts are audit data.
- If the project contains sensitive prompts, recommend `backups.include_prompts=false` unless the user explicitly wants complete backups.
- If the user asks to import with overwrite behavior, confirm whether `keep_imported` is acceptable before recommending it.
- If a backup contains another project's memories, verify the extension version/reload state and export context before changing project config.
- If configuring memory as part of a broader PRD/SDD workflow, also consider `persistent-memory` and `sdd-workflow`.

## Execution Steps

1. Identify the target project cwd and whether `.pi/memory.json` already exists.
2. Read the existing `.pi/memory.json` before editing.
3. Preserve existing valid fields unless the user asks to replace them.
4. Add or update `project_name`, `aliases`, `default_scope`, `session_end`, `import`, `backups`, and `cloud` using the hard rules above.
5. Validate the JSON syntax after edits.
6. Tell the user to `/reload` or restart Pi.
7. Use `memory_context` to confirm the expected project identity when practical.
8. Run or ask the user to run `memory_export` from the project cwd.
9. Inspect backup meta when validating:
   - `format` should be `pi-memory-backup`;
   - `version` should be `2`;
   - `mirror` should be `true`;
   - `includes_prompts` should match `backups.include_prompts`.
10. If comparing manually, verify exported `memories.project_name` contains only the current project.

## Output Contract

Return:

- Skill applied: `memory-configuration`.
- Target project/path configured or reviewed.
- Important `.pi/memory.json` fields set or preserved.
- Whether prompt export is enabled and why.
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
