---
name: workspace-services-configuration
description: "configure the Pi Workspace Services extension for local and Docker Compose services. Use when defining .pi/workspace-services.json services, setting a project-relative compose_file, opting into env_file usage, checking logs or state, or safely reloading Pi after configuration changes."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.2"
---

# Workspace Services Configuration

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `paths`: configuration and runtime paths that should route to this module, including nested project workspaces outside the agent root.
- `keywords`: configuration-only phrases, tool names, and field names that should route to this module.
- `phases`: keep empty for configuration-only skills so phase routing alone does not load it.
- `related`: configuration-adjacent skills only; do not add implementation or workflow skills for normal config help.
- `priority`: route similarly to other extension configuration skills.

## Activation Contract

Use this module only when the user asks how to configure, enable, review, troubleshoot, or explain the Pi Workspace Services Extension configuration for a workspace, especially `.pi/workspace-services.json`, project-relative `compose_file`, configured service names, `env_file`, service commands, local logs/state under `.pi/workspace-services/`, or Git ignore handling for local runtime files.

Use this module when editing or creating a project-local `.pi/workspace-services.json` file for a monorepo.

Do not read this module for implementation work under `extensions/workspace-services/**`, adding new tools, changing process-management behavior, or broad workflow planning. Those are code/change tasks and must route through `workflow-triage`.

## Hard Rules

- Node and Spring services require manual configuration; do not infer them from `package.json`, `pom.xml`, Gradle files, or folder names. Compose services are discovered with `docker compose config --services`.
- The extension reads exactly `<ctx.cwd>/.pi/workspace-services.json` for the current workspace.
- Optional top-level `compose_file` selects a Docker Compose file relative to the workspace root, not relative to `.pi` or a service directory. Example: `infra/docker-compose.yml`.
- `compose_file` must be a non-empty relative path to an existing regular file inside the project; absolute paths, workspace escapes, and symlinks pointing outside the project are rejected before running Docker.
- A configured `compose_file` overrides root autodetection. An invalid explicit value is reported, never silently replaced with another file.
- When `compose_file` is omitted, the extension searches the workspace root in order: `compose.yaml`, `compose.yml`, `docker-compose.yaml`, `docker-compose.yml`; this also works without a JSON config.
- The selected file is used consistently for discovery, status, logs, start, stop, and restart. Explicit entries under `services` take precedence over discovered Compose services with the same name.
- In JSON config, the top-level `services` object is required; use `{}` for a Compose-only workspace. Only explicitly configured or Compose-discovered service keys can be managed, besides stack targets `all` and `compose`.
- Targets `all` and `compose` start, stop, or restart the selected Compose stack only, not local Node/Spring services. If no file is found, the tool reports a warning directing the user to `compose_file` or a standard root file.
- Service keys are also log file base names. Use only letters, numbers, dots, underscores, and dashes in service names.
- Supported service `type` values are `node`, `spring`, and `compose`. An explicitly configured Compose service uses the selected file; its declared command does not replace the extension's Docker Compose lifecycle commands.
- Each service must declare `type`, `path`, `command`, and boolean `env_file`.
- `path` must be relative to the workspace root and must not escape it.
- For Node/Spring services, `command` is executed from the service `path`; keep it explicit and project-local, for example `npm run dev`, `pnpm run dev`, `bun run dev`, or `./mvnw spring-boot:run`.
- For Node/Spring services, `env_file: true` loads `<service path>/.env` only for that service process; `false` disables this extension loader. Compose environment loading follows Docker Compose's own file and CLI semantics; do not imply that this flag disables Docker's `.env` behavior.
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

For a Compose file outside the root, preserve existing services and add the top-level field:

```json
{
  "compose_file": "infra/docker-compose.yml",
  "services": {}
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
- If the Compose file location is unclear, ask for the project-relative path rather than inventing it. Do not change global configuration or replace unrelated services.
- If a service needs `.env` but the user has not confirmed whether it should be loaded, ask before setting `env_file: true`.
- If `.pi/workspace-services.json` already exists, read it first and preserve unrelated configured services.
- If `.gitignore` has local edits or the worktree is dirty in unrelated areas, follow the normal dirty-worktree overlap rule before editing.
- If the request changes extension behavior, tool schemas, runtime process handling, security policy, or generated code, stop treating it as configuration-only and route through `workflow-triage`.
- If the user wants to start, stop, or restart a service after configuration, confirm the target service name and use the dedicated workspace service tool rather than running arbitrary shell commands.

## Execution Steps

1. Identify whether the task is configuration help, config editing, runtime troubleshooting, or extension implementation.
2. Identify the target workspace root and verify `.pi/workspace-services.json` location.
3. If editing config, read the existing config first and preserve unrelated service entries.
4. Add or update only explicitly approved service entries and `compose_file`; do not infer Node/Spring services from the repository.
5. Validate each explicit service entry has `type`, `path`, `command`, and boolean `env_file`; `services: {}` is valid for Compose-only configuration.
6. Validate service names are safe log names, service paths stay inside the workspace, and any `compose_file` is project-relative, contained, and an existing regular file.
7. Ensure `.pi/workspace-services/` is ignored by Git when runtime files may be created.
8. Tell the user to `/reload` or restart Pi after config or extension changes.
9. Use `workspace_services_list` to confirm configured service visibility after reload when practical.
10. Use `workspace_services_status` and `workspace_service_logs` for runtime troubleshooting instead of ad hoc `ps` or `tail` commands when the service is managed by this extension.

## Output Contract

Return:

- Configuration module applied: `workspace-services-configuration`.
- Workspace root and config path reviewed or changed.
- Services added, updated, or preserved, with commands and `env_file` booleans but no secret values.
- Configured project-relative `compose_file`, or root autodetection when omitted; explain stack target scope.
- Git ignore handling for `.pi/workspace-services/`.
- Validation executed, such as JSON syntax check, `workspace_services_list`, or why it was not run.
- Required `/reload` or restart note.
- Risks, drift, or open decisions such as unknown commands, env-file choice, dirty worktree overlap, or service names.

## References

- `extensions/workspace-services/README.md` — user-facing setup, runtime files, config shape, and tool list.
- `extensions/workspace-services/src/config.ts` — exact config path, service validation, env-file parsing, runtime directories, and Git ignore entry.
- `extensions/workspace-services/src/core/manager.ts` — service lifecycle behavior, selected Compose file, logs, state, and managed PID handling.
- `extensions/workspace-services/src/core/docker-compose.ts` — standard filename order, service discovery, and Compose execution.
- `extensions/workspace-services/src/tools/index.ts` — registered tool names, descriptions, and usage boundaries.
