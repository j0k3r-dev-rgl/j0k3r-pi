# Telegram Pi Control Extension

[English](#english) | [Español](#español)

## English

Gateway for controlling Pi sessions over Telegram with strict, authorization-first defaults.

### Scope (current implementation)

- Parse and authorize Telegram updates.
- Validate Telegram user allowlists and exact Pi trust roots.
- Derive selectable workspaces exclusively from exact `true` entries in `~/.pi/agent/trust.json`.
- Resolve and expose trusted workspaces with their filesystem paths.
- Run Pi through the Pi SDK, not through `pi --mode rpc` or a `pi` binary from `PATH`.
- Maintain per-chat binding and arm-aware command gating via `CommandRouter`.
- Start/attach Telegram long polling through the CLI entrypoint.
- Persist Telegram update offsets between restarts.
- Provide `/close`, remote permission approval commands, clean shutdown, and emergency disable behavior.

### Configuration

Normal `gateway:start` usage supports only two environment variables:

- `PI_TELEGRAM_CONTROL_BOT_TOKEN` — required Telegram bot token.
- `PI_TELEGRAM_CONTROL_USER_ID` — required allowed Telegram user id(s), comma or space separated.

All other workspace/config/path environment variables are ignored by `gateway:start`. Workspace control is intentionally centralized in Pi trust state.

Workspaces are loaded only from exact `true` roots in:

```text
~/.pi/agent/trust.json
```

Parent trust does not authorize nested/non-listed directories for Telegram control; each selectable workspace must be present as its own `true` key in `trust.json`.

Example:

```json
{
  "/home/j0k3r": true,
  "/home/j0k3r/.pi/agent": true,
  "/home/j0k3r/j0k3r-pi": true
}
```

`/workspaces` displays both selector and path so the operator can choose the intended root.

#### No-secrets policy

- Bot token is loaded **only** from environment variable `PI_TELEGRAM_CONTROL_BOT_TOKEN` or the optional local env file.
- The local env file must contain only `PI_TELEGRAM_CONTROL_BOT_TOKEN` and `PI_TELEGRAM_CONTROL_USER_ID`.
- Real env files, `node_modules/`, `dist/`, audit logs, runtime state, and `trust.json` are ignored by Git.
- Audit/output/state files are kept under user state directory only; nothing is written to committed config for runtime secrets.

### Commands (MVP behavior)

The gateway registers these commands with Telegram Bot API `setMyCommands` during startup so they appear in the bot command menu.

| Command | Behavior |
| --- | --- |
| `/start` | show basic readiness text |
| `/status` | show current binding status |
| `/workspaces` | list exact trusted workspaces with their filesystem paths |
| `/open <workspace-id> [session-id]` | open a workspace and optionally switch to session |
| `/sessions [workspace-id]` | list sessions for workspace |
| `/new [workspace-id] [name]` | create session for workspace |
| `/arm [seconds]` | arm full-control window |
| `/disarm` | clear armed state |
| `/close` | close the active SDK session binding for the chat |
| `/prompt` (or plain text) | send prompt when armed |
| `/steer <text>` | steering message when armed |
| `/followup <text>` | follow-up message when armed |
| `/abort` | abort active run when armed |
| `/permissions` | list pending Permission Guard approval requests for the active binding |
| `/approve <id> [once\|session\|project\|file\|folder]` | approve a pending request for the active chat/workspace/session |
| `/deny <id>` | deny a pending request for the active chat/workspace/session |

### Shutdown and emergency behavior

- `runTelegramControlGateway` wires shutdown handlers for `SIGINT`, `SIGTERM`, `SIGQUIT`.
- Emergency stop path clears armed bindings and stops managed SDK runtime handles.
- Update offsets are saved after each processed update and restored on startup.

### Running with npm

For normal use, export the two required variables in your shell/session/profile and start with one command:

```bash
export PI_TELEGRAM_CONTROL_BOT_TOKEN='123456:replace-with-your-bot-token'
export PI_TELEGRAM_CONTROL_USER_ID='6744546050'

cd /home/j0k3r/.pi/agent/extensions/telegram-pi-control
npm install
npm run gateway:start
```

`npm run gateway:start` reads the current process environment first, builds the TypeScript entrypoint, and starts long polling. A file at `/home/j0k3r/.pi/agent/telegram-pi-control.env` is only an optional fallback for users who do not want to export variables in their shell; shell/system environment values always override file values. The gateway uses the Pi SDK directly, so it does not depend on the `pi` binary in `PATH`.

Supported environment variables:

- `PI_TELEGRAM_CONTROL_BOT_TOKEN`
- `PI_TELEGRAM_CONTROL_USER_ID`

Other workspace/config/path environment variables are ignored by `gateway:start`; edit `~/.pi/agent/trust.json` to change selectable workspaces.

Optional local env file format:

```env
PI_TELEGRAM_CONTROL_BOT_TOKEN=123456:replace-with-your-bot-token
PI_TELEGRAM_CONTROL_USER_ID=6744546050
```

Do not commit a real env file.

To keep it running manually in the background:

```bash
mkdir -p "$HOME/.local/state/pi/telegram-pi-control"
nohup npm run gateway:start > "$HOME/.local/state/pi/telegram-pi-control/gateway.log" 2>&1 &
```

Then use Telegram commands: `/workspaces`, `/sessions agent`, `/new agent smoke`, `/open agent <session-id>`, `/arm 300`, plain prompts, `/disarm`, `/close`, `/abort`, `/permissions`, `/approve <id>`, and `/deny <id>`.

When creating or opening a session, the SDK runtime is forced to the selected workspace cwd. Existing session files with stale headers are opened with a cwd override so Telegram control stays in the workspace selected by the operator.

### Permission Guard approval flow

When Permission Guard requires approval inside an SDK-backed Telegram session, the gateway sends a formatted prompt only to the Telegram chat bound to that workspace/session. Raw internal `permission_required:` markers are filtered from normal assistant output.

Respond with:

```text
/approve <request-id> once
/approve <request-id> session
/approve <request-id> project
/approve <request-id> file
/approve <request-id> folder
/deny <request-id>
```

Only choices offered by Permission Guard for that request are accepted. Requests are scoped to the active chat binding, workspace, and session; stale, expired, wrong-chat, or wrong-binding answers are rejected.

`bypassWorkspace` is configured in Permission Guard, not in the Telegram gateway. It can reduce prompts for provably workspace-contained operations, but it is still an in-process policy guard, not an OS sandbox.

### Validation steps

```bash
cd extensions/telegram-pi-control
npm run test
npm run typecheck
npm run build
```

### Deployment and operational notes

- Runtime is currently designed for long polling only; webhooks and dedicated helper admin extensions are out of this slice.
- A dedicated service-manager launch (systemd/pm2/manual process management) is intentionally left to operator docs outside this extension.

### Do not commit

Do not commit:

- real Telegram bot tokens;
- local `telegram-pi-control.env` files;
- `node_modules/`;
- `dist/`;
- runtime logs/audit files;
- `trust.json` or other local Pi state.

## Español

Gateway de Telegram para controlar sesiones Pi de forma autorizada.

### Resumen

Telegram Pi Control permite interactuar con Pi desde Telegram bajo defaults estrictos de autorización. Está pensado para control remoto explícito, no para exponer sesiones sin restricciones.

### Capacidades

- Validación de bot token y usuario autorizado.
- Comandos MVP para iniciar, enviar prompts y controlar sesiones.
- Comportamiento de shutdown/emergencia.
- Integración con Permission Guard para aprobaciones.

### Requisitos

Requiere variables de entorno de bot y usuario de Telegram. No se deben commitear tokens ni archivos runtime con secretos.

### Ver más

La sección en inglés detalla configuración, comandos, ejecución, validación y notas operativas.
