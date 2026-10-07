# Workspace Services Extension

Pi extension for Linux-only management of configured local services and Docker Compose services.

## Configuration

Create a project-local config file at `.pi/workspace-services.json`:

```json
{
  "services": {
    "front": {
      "type": "node",
      "path": "front",
      "command": "npm run dev",
      "env_file": true
    }
  }
}
```

### Docker Compose file path

Set the optional top-level `compose_file` to a file path relative to the workspace root (not relative to `.pi`):

```json
{
  "compose_file": "infra/docker-compose.yml",
  "services": {}
}
```

Keep your existing entries under `services` when combining Compose with local Node or Spring services. An empty `services` object is valid for a Compose-only project.

- The configured file takes precedence over standard Compose filenames in the root.
- The path must point to an existing regular file inside the project. Absolute paths, paths escaping the project, and symlinks pointing outside it are rejected; an invalid configured path never silently falls back to another file.
- If `compose_file` is omitted, the extension searches the workspace root in order: `compose.yaml`, `compose.yml`, `docker-compose.yaml`, `docker-compose.yml`.
- Compose services are discovered with `docker compose config --services`; explicit JSON service entries win on name collisions.
- The selected file is used for discovery, status, logs, start, stop, and restart. Targets `all` and `compose` manage the selected Compose stack, not local Node/Spring services.
- If no file is available, Compose lifecycle tools report the reason and point to `compose_file`; the TUI displays a warning instead of crashing.

Run `/reload` or restart Pi after updating the extension or its configuration.

Rules:
- Node and Spring services must be explicitly configured; they are not auto-discovered.
- Only configured or Compose-discovered service keys can be managed, besides the Compose stack targets `all` and `compose`.
- Service keys are also log file names, so they may only contain letters, numbers, dots, underscores, and dashes.
- `env_file: true` loads `<service path>/.env` for the managed process.
- Project trust is required before the extension reads config, state, or logs, or starts/stops processes.

## Runtime files

The extension writes workspace-local runtime files under `.pi/workspace-services/`:

- `logs/<service>.log`
- `state.json`
- `state.last-good.json`
- `transaction-owner.json`
- `quarantine/`

When any service is started, the extension ensures `.gitignore` contains `.pi/workspace-services/`.

## Safety and lifecycle behavior

- Linux-only lifecycle semantics.
- Process identity uses procfs-backed PID, process-group, session, boot id, start-time, command-line, and cwd validation.
- On trusted Pi session start, the extension reconciles persisted runtime state against real processes without auto-starting services.
- Service startup enforces a 30s timeout by default (configurable via `timeout_ms`), kills partially spawned runners on timeout, and cleans up any pending state.
- Stop and restart require confirmed managed-group absence before state deletion or replacement start; restart truncates the managed log before writing the new start header.
- Lifecycle operations are serialized across processes that share the same runtime-state path.
- Runtime state is schema-versioned, atomically replaced, and recovered from `state.last-good.json` when possible.
- Invalid state is quarantined and never silently treated as empty state.
- Non-empty `.env` values are treated as secrets and redacted from managed logs, results, details, errors, and rendering.
- Log output defaults to the latest 100 lines, remains bounded, and includes continuation metadata when more data exists.
- `workspace_service_logs` supports older windows with `offset` and `until`, counted backward from the newest log line. Example: `offset=100, until=200` reads the previous 100-line window.

## Tools

- `workspace_services_list`
- `workspace_service_start`
- `workspace_service_stop`
- `workspace_service_logs`
- `workspace_services_status`
- `workspace_service_restart`

Each public tool has native collapsed/expanded rendering. `workspace_services_status` also returns concise model-facing service details so the agent can see whether config exists and which services are configured without reading the JSON manually.

## Development

```bash
npm install
npm test
npm run typecheck
```
