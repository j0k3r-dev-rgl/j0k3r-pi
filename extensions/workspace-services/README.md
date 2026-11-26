# Workspace Services Extension

Pi extension for Linux-only management of declared local services and Docker Compose services.

## Configuration

1. Enable `"workspace-services": true` in `<cwd>/.pi/extensions.json` (toggleable via `/extension` or `/tools-manager`); without it, the extension does not register its tools.
2. Create a project-local config file at `.pi/workspace-services.json`:

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

### Configuration provenance and service `type`

- `.pi/workspace-services.json` declares manual local services (`type: "node"` or `"spring"`) or explicit Compose overrides (`type: "compose"`).
- `type` is a declared configuration/routing label (`"node"`, `"spring"`, or `"compose"`), **not** automatic runtime technology detection.
- Tools report real configuration provenance (`jsonExists` and/or `composeFile`) and never present an absent `.pi/workspace-services.json` path as a loaded configuration.
- Local Node and Spring services must be explicitly declared; they are not auto-discovered.

### Docker Compose discovery and `compose_file`

Set the optional top-level `compose_file` to a file path relative to the workspace root (not relative to `.pi`):

```json
{
  "compose_file": "infra/docker-compose.yml",
  "services": {}
}
```

Keep your existing entries under `services` when combining Compose with local Node or Spring services. An empty `services` object is valid for a Compose-only project.

- The configured `compose_file` takes precedence over standard Compose filenames in the root.
- The path must point to an existing regular file inside the project. Absolute paths, paths escaping the project, and symlinks pointing outside it are rejected; an invalid configured path never silently falls back to another file.
- If `compose_file` is omitted, the extension searches the workspace root in order: `compose.yaml`, `compose.yml`, `docker-compose.yaml`, `docker-compose.yml`.
- Compose services are discovered with `docker compose config --services`; explicit JSON service entries win on name collisions.
- Targets `all` and `compose` manage the selected Compose stack, not local Node/Spring services.

Run `/reload` or restart Pi after updating the extension or its configuration.

Rules:
- Only declared or Compose-discovered service keys can be managed, besides the Compose stack targets `all` and `compose`.
- Service keys are also log file names, so they may only contain letters, numbers, dots, underscores, and dashes.
- `env_file: true` loads `<service path>/.env` for the managed process and for known-secret redaction.
- Project trust is required before the extension reads config, state, or logs, or starts/stops processes. Untrusted projects return native failures (`isError: true`, `status: "trust_required"`) with remediation guidance.

## Runtime files

The extension writes workspace-local runtime files under `.pi/workspace-services/`:

- `logs/<service>.log`
- `state.json`
- `state.last-good.json`
- `transaction-owner.json`
- `quarantine/`

When starting or restarting a host service, the extension ensures `.pi/workspace-services/logs/`, `quarantine/`, and an idempotent `.pi/workspace-services/` entry in `.gitignore` exist before truncating or writing the managed log.

## Safety and lifecycle behavior

- Linux-only lifecycle semantics.
- Process identity uses procfs-backed PID, process-group, session, boot id, start-time, command-line, and cwd validation.
- On trusted Pi session start, the extension reconciles persisted runtime state against real processes without auto-starting services.
- Service startup enforces a 30s timeout by default (configurable via `timeout_ms`), kills partially spawned runners on timeout, and cleans up any pending state.
- Stop and restart require confirmed managed-group absence before state deletion or replacement start; restart prepares runtime directories and truncates the managed log before writing the new start header.
- Lifecycle operations are serialized across processes that share the same runtime-state path.
- Runtime state is schema-versioned, atomically replaced, and recovered from `state.last-good.json` when possible.
- Invalid state is quarantined and never silently treated as empty state.
- Cancellation via `AbortSignal` stays `status: "cancelled"` (`ok: false`, `isError: true`) rather than being converted into a Docker or success outcome.

## Model-facing output, status semantics, and logs

- Every public tool puts its useful model-facing data directly in `content` (service names, observed states, PIDs/container metadata, bounded log text, range/limits, lifecycle outcome, warnings, and `nextAction`) while keeping structured metadata in `details`.
- Operation `status` is distinct from per-service state:
  - Complete `workspace_services_list`, `workspace_services_status`, and `workspace_service_logs` reads return `ok: true`, `status: "ok"`. Missing or empty host log files also return `status: "ok"` (an absent log file does not prove a process is stopped).
  - Incomplete Compose discovery or `docker compose ps` observation returns `ok: true`, `status: "partial"` (`isError: false`) with explicit sanitized warnings and `nextAction`, preserving confirmed local service states and marking unobserved Compose services `status: "unknown"` (without inventing services or falsely labeling them `stopped`).
  - Successful `docker compose ps` maps `running` to `running`, `exited`/`dead`/absent-container to `stopped`, and other observed states (such as `paused`, `restarting`, `created`, `removing`) to `status: "unknown"` with the actual Docker state preserved in `compose_state`.
  - Domain failures (`ok: false`) set native `isError: true`.
- **Host logs (`workspace_service_logs`)**:
  - Defaults to `lines=100` (max `2000`) and `max_bytes=51200` (max `204800`), counting backward from the newest line including blank lines.
  - Supports older windows via `offset` (0..2000) and `until`, with deterministic continuation on unchanged files up to the supported offset/byte reach. Logs are live: appends or truncation between calls can shift newest-relative offsets.
  - `truncation.total` is reported only when the entire file fit inside the inspected byte window; otherwise counts are labeled as the inspected byte window.
- **Compose logs (`workspace_service_logs`)**:
  - Supports a bounded recent window only (`lines` up to `2000` and `max_bytes` up to `204800`), bounded on capture, redacted when known secrets apply, and mirrored to `.pi/workspace-services/logs/<service>.log`.
  - Explicitly rejects `offset` (including `0`) and `until` with a native error (`ok: false`, `isError: true`) before fetching Compose logs (`docker compose logs`) or writing mirror files (configuration load and Compose service discovery may already have run), and does not claim historical totals or older-window pagination.

## Secret redaction scope and limitations

- Non-empty values loaded from an authorized `env_file: true` service `.env` file are treated as known secrets and redacted (`[REDACTED]`) before model content, `details`, rendering, diagnostics, and persisted log mirrors.
- For Compose lifecycle operations (`workspace_service_start`, `workspace_service_stop`, `workspace_service_restart`):
  - A named Compose target loads and redacts only that service's own authorized `env_file: true` values from failure diagnostics (`summary`, `stderr`, `error`).
  - Stack targets (`all` / `compose`) load and redact the union of non-empty values from configured `env_file: true` services solely for stack lifecycle failure diagnostics (over-redaction of matching text in stack diagnostics is an accepted safety trade-off).
- Identifiable structured secret fields (`secret`, `token`, `password`, `passwd`, `authorization`, `api_key`, `cookie`, `session`) in structured outcomes are masked recursively.
- `workspace_services_list` and `workspace_services_status` remain metadata-only (`env_file_present` check) and do not read `.env` contents.
- **Limitation (Compose / unknown secrets)**: Compose-discovered services have `env_file: false` and the extension does not perform new environment/root/Compose secret discovery. Unknown secret values appearing in free-text Docker Compose logs or stderr cannot be guaranteed redacted; useful bounded Compose logs are preserved rather than silently emptied.

## Tools

- `workspace_services_list`
- `workspace_service_start`
- `workspace_service_stop`
- `workspace_service_logs`
- `workspace_services_status`
- `workspace_service_restart`

Each tool uses compact single-row collapsed rendering and lossless unboxed expanded rendering without duplicate content/details payloads or expansion hints.

## Development

```bash
npm install
npm test
npm run typecheck
```
