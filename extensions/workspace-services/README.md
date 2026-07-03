# Workspace Services Extension

Pi extension for managing manually configured services in a monorepo workspace.

## Configuration

Create a project-local config file:

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

Path:

```txt
.pi/workspace-services.json
```

Rules:

- No service auto-discovery is performed.
- Only configured service keys can be managed.
- Service keys are also log file names, so they may only contain letters, numbers, dots, underscores, and dashes.
- `env_file: true` loads `<service path>/.env` for that service process.
- `env_file: false` never loads `.env`, even if the file exists.
- `.env` contents are never returned in tool output.

## Runtime files

The extension writes local runtime files under:

```txt
.pi/workspace-services/
```

Logs:

```txt
.pi/workspace-services/logs/<service>.log
```

State:

```txt
.pi/workspace-services/state.json
```

When any service is started, the extension ensures `.gitignore` contains:

```gitignore
.pi/workspace-services/
```

## Tools

- `workspace_services_list` — list configured services.
- `workspace_service_start` — start one configured service.
- `workspace_service_stop` — stop one managed service.
- `workspace_service_logs` — read bounded service logs.
- `workspace_services_status` — show managed service status.
- `workspace_service_restart` — stop, truncate log, then start one service.

## Development

```bash
npm install
npm test
npm run typecheck
```
