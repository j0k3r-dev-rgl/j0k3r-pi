# Workspace Services Extension

Pi extension for Linux-only management of manually configured workspace services.

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

Rules:
- No service auto-discovery is performed.
- Only configured service keys can be managed.
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
- Process identity uses procfs-backed PID, process-group, session, start-time, command-line, and cwd validation.
- Stop and restart require confirmed managed-group absence before state deletion or replacement start.
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

Each public tool has native collapsed/expanded rendering.

## Development

```bash
npm install
npm test
npm run typecheck
```
