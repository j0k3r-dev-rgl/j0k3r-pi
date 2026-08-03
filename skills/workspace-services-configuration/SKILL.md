---
name: workspace-services-configuration
description: "configure Pi Workspace Services Extension, including manual .pi/workspace-services.json services, env_file opt-in, service commands, local logs/state, gitignore, and safe reload guidance."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.1"
---

# Workspace Services Configuration

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "runtime",
  "domains": ["workspace-services-configuration", "monorepo-service-config", "local-service-runtime"],
  "triggers": {
    "paths": [
      ".pi/workspace-services.json",
      ".pi/workspace-services/**",
      "**/.pi/workspace-services.json",
      "**/.pi/workspace-services/**",
      "workspace-services.json",
      "extensions/workspace-services/README.md",
      "skills/workspace-services-configuration/SKILL.md",
      "~/.pi/agent/skills/workspace-services-configuration/SKILL.md"
    ],
    "keywords": [
      "workspace services configuration",
      "workspace services config",
      "workspace-services.json",
      "configure workspace services",
      "configurar workspace services",
      "configurar servicios del workspace",
      "configuracion workspace services",
      "configuración workspace services",
      "monorepo services",
      "servicios del monorepo",
      "workspace_services_list",
      "workspace_service_start",
      "workspace_service_restart",
      "workspace_service_logs",
      "workspace_services_status",
      "workspace_service_stop",
      "env_file",
      ".pi/workspace-services",
      "service logs"
    ]
  },
  "sdd_phases": [],
  "related_skills": [],
  "priority": 70
}
```

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `triggers.paths`: configuration and runtime paths that should activate this skill, including nested project workspaces outside the agent root.
- `triggers.keywords`: configuration-only phrases, tool names, and field names that should activate this skill.
- `sdd_phases`: keep empty for configuration-only skills so phase routing alone does not load it.
- `related_skills`: configuration-adjacent skills only; do not add implementation or SDD skills for normal config help.
- `priority`: route similarly to other extension configuration skills.

## Activation Contract

Use this skill only when the user asks how to configure, enable, review, troubleshoot, or explain the Pi Workspace Services Extension configuration for a workspace, especially `.pi/workspace-services.json`, configured service names, `env_file`, service commands, local logs/state under `.pi/workspace-services/`, or Git ignore handling for local runtime files.

Use this skill when editing or creating a project-local `.pi/workspace-services.json` file for a monorepo.

Do not load this skill for implementation work under `extensions/workspace-services/**`, adding new tools, changing process-management behavior, or broad workflow planning. Those are code/change tasks and must route through `workflow-triage`.

## Hard Rules

- The extension is manual-config only. Do not imply that it auto-discovers services from `package.json`, `pom.xml`, Gradle files, Docker Compose, or folder names.
- The extension reads exactly `<ctx.cwd>/.pi/workspace-services.json` for the current workspace.
- Only services declared under the top-level `services` object can be listed, started, stopped, restarted, or have logs read.
- Service keys are also log file base names. Use only letters, numbers, dots, underscores, and dashes in service names.
- Supported service `type` values are currently `node` and `spring`.
- Each service must declare `type`, `path`, `command`, and boolean `env_file`.
- `path` must be relative to the workspace root and must not escape it.
- `command` is executed from the service `path`; keep it explicit and project-local, for example `npm run dev`, `pnpm run dev`, `bun run dev`, or `./mvnw spring-boot:run`.
- `env_file: true` loads `<service path>/.env` only for that service process. `env_file: false` never loads `.env`, even if it exists.
- Never print, store, or commit real `.env` contents, tokens, passwords, private keys, or service secrets.
- Runtime logs and state are local-only and live under `.pi/workspace-services/`.
- Ensure `.pi/workspace-services/` is ignored by Git before treating runtime logs/state as safe local files.
- After changing `.pi/workspace-services.json` or installing/updating the global extension, tell the user to `/reload` or restart Pi before expecting tool registration or config changes to be visible.

Recommended project config:

```json
{
  "services": {
    "front": {
      "type": "node",
      "path": "front",
      "command": "npm run dev",
      "env_file": true
    },
    "back": {
      "type": "spring",
      "path": "back",
      "command": "./mvnw spring-boot:run",
      "env_file": true
    }
  }
}
```

Runtime files created by the extension:

```txt
.pi/workspace-services/logs/<service>.log
.pi/workspace-services/state.json
```

Recommended `.gitignore` entry:

```gitignore
.pi/workspace-services/
```

## Decision Gates

- If the target workspace root is unclear, ask for it before creating or editing `.pi/workspace-services.json`.
- If the service command is unclear or multiple package managers are plausible, ask the user which command to use instead of guessing.
- If a service needs `.env` but the user has not confirmed whether it should be loaded, ask before setting `env_file: true`.
- If `.pi/workspace-services.json` already exists, read it first and preserve unrelated configured services.
- If `.gitignore` has local edits or the worktree is dirty in unrelated areas, follow the normal dirty-worktree overlap rule before editing.
- If the request changes extension behavior, tool schemas, runtime process handling, security policy, or generated code, stop treating it as configuration-only and route through `workflow-triage`.
- If the user wants to start, stop, or restart a service after configuration, confirm the target service name and use the dedicated workspace service tool rather than running arbitrary shell commands.

## Execution Steps

1. Identify whether the task is configuration help, config editing, runtime troubleshooting, or extension implementation.
2. Identify the target workspace root and verify `.pi/workspace-services.json` location.
3. If editing config, read the existing config first and preserve unrelated service entries.
4. Add or update only explicitly approved services; do not infer services from the repository.
5. Validate each service entry has `type`, `path`, `command`, and boolean `env_file`.
6. Validate service names are safe log names and service paths stay inside the workspace.
7. Ensure `.pi/workspace-services/` is ignored by Git when runtime files may be created.
8. Tell the user to `/reload` or restart Pi after config or extension changes.
9. Use `workspace_services_list` to confirm configured service visibility after reload when practical.
10. Use `workspace_services_status` and `workspace_service_logs` for runtime troubleshooting instead of ad hoc `ps` or `tail` commands when the service is managed by this extension.

## Output Contract

Return:

- Skill applied: `workspace-services-configuration`.
- Workspace root and config path reviewed or changed.
- Services added, updated, or preserved, with commands and `env_file` booleans but no secret values.
- Git ignore handling for `.pi/workspace-services/`.
- Validation executed, such as JSON syntax check, `workspace_services_list`, or why it was not run.
- Required `/reload` or restart note.
- Risks, drift, or open decisions such as unknown commands, env-file choice, dirty worktree overlap, or service names.

## References

- `extensions/workspace-services/README.md` — user-facing setup, runtime files, config shape, and tool list.
- `extensions/workspace-services/src/config.ts` — exact config path, service validation, env-file parsing, runtime directories, and Git ignore entry.
- `extensions/workspace-services/src/manager.ts` — service lifecycle behavior, logs, state, restart truncation, and managed PID handling.
- `extensions/workspace-services/src/tools.ts` — registered tool names, tool descriptions, prompt snippets, and usage boundaries.
