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

Gateway para controlar sesiones Pi sobre Telegram con defaults estrictos y authorization-first.

### Alcance (implementación actual)

- Parsear y autorizar updates de Telegram.
- Validar allowlists de usuarios Telegram y raíces exactas de confianza Pi.
- Derivar workspaces seleccionables exclusivamente desde entradas exactas `true` en `~/.pi/agent/trust.json`.
- Resolver y exponer workspaces confiables con sus rutas de filesystem.
- Ejecutar Pi mediante el SDK de Pi, no mediante `pi --mode rpc` ni un binario `pi` desde `PATH`.
- Mantener binding por chat y gating de comandos sensible a arm mediante `CommandRouter`.
- Iniciar/adjuntar long polling de Telegram desde el entrypoint CLI.
- Persistir offsets de updates de Telegram entre reinicios.
- Proveer `/close`, comandos remotos de aprobación de permisos, shutdown limpio y comportamiento de emergency disable.

### Configuración

El uso normal de `gateway:start` soporta solo dos variables de entorno:

- `PI_TELEGRAM_CONTROL_BOT_TOKEN` — token requerido del bot Telegram.
- `PI_TELEGRAM_CONTROL_USER_ID` — id(s) requeridos de usuarios Telegram permitidos, separados por coma o espacio.

Todas las demás variables de entorno de workspace/config/path se ignoran en `gateway:start`. El control de workspaces está centralizado intencionalmente en el estado de confianza de Pi.

Los workspaces se cargan solo desde raíces exactas `true` en:

```text
~/.pi/agent/trust.json
```

La confianza de un padre no autoriza directorios anidados/no listados para control por Telegram; cada workspace seleccionable debe estar presente como su propia key `true` en `trust.json`.

Ejemplo:

```json
{
  "/home/j0k3r": true,
  "/home/j0k3r/.pi/agent": true,
  "/home/j0k3r/j0k3r-pi": true
}
```

`/workspaces` muestra selector y ruta para que el operador elija la raíz correcta.

#### Política sin secretos

- El bot token se carga **solo** desde la variable de entorno `PI_TELEGRAM_CONTROL_BOT_TOKEN` o el archivo env local opcional.
- El archivo env local debe contener solo `PI_TELEGRAM_CONTROL_BOT_TOKEN` y `PI_TELEGRAM_CONTROL_USER_ID`.
- Archivos env reales, `node_modules/`, `dist/`, audit logs, estado runtime y `trust.json` están ignorados por Git.
- Archivos de audit/output/state se mantienen solo bajo el directorio de estado de usuario; no se escribe nada con secretos runtime en configuración commiteada.

### Comandos (comportamiento MVP)

El gateway registra estos comandos con la Telegram Bot API `setMyCommands` durante startup para que aparezcan en el menú de comandos del bot.

| Comando | Comportamiento |
| --- | --- |
| `/start` | muestra texto básico de readiness |
| `/status` | muestra estado del binding actual |
| `/workspaces` | lista workspaces exactos confiables con sus rutas de filesystem |
| `/open <workspace-id> [session-id]` | abre un workspace y opcionalmente cambia a una sesión |
| `/sessions [workspace-id]` | lista sesiones para un workspace |
| `/new [workspace-id] [name]` | crea una sesión para un workspace |
| `/arm [seconds]` | arma una ventana de control completo |
| `/disarm` | limpia el estado armado |
| `/close` | cierra el binding activo de sesión SDK para el chat |
| `/prompt` (o texto plano) | envía prompt cuando está armado |
| `/steer <text>` | mensaje de steering cuando está armado |
| `/followup <text>` | mensaje follow-up cuando está armado |
| `/abort` | aborta el run activo cuando está armado |
| `/permissions` | lista requests pendientes de aprobación de Permission Guard para el binding activo |
| `/approve <id> [once\|session\|project\|file\|folder]` | aprueba un request pendiente para el chat/workspace/session activo |
| `/deny <id>` | deniega un request pendiente para el chat/workspace/session activo |

### Shutdown y comportamiento de emergencia

- `runTelegramControlGateway` conecta handlers de shutdown para `SIGINT`, `SIGTERM`, `SIGQUIT`.
- La ruta de emergency stop limpia bindings armados y detiene handles runtime SDK gestionados.
- Los offsets de updates se guardan después de cada update procesado y se restauran al iniciar.

### Ejecutar con npm

Para uso normal, exporta las dos variables requeridas en tu shell/sesión/profile e inicia con un comando:

```bash
export PI_TELEGRAM_CONTROL_BOT_TOKEN='123456:replace-with-your-bot-token'
export PI_TELEGRAM_CONTROL_USER_ID='6744546050'

cd /home/j0k3r/.pi/agent/extensions/telegram-pi-control
npm install
npm run gateway:start
```

`npm run gateway:start` lee primero el entorno del proceso actual, construye el entrypoint TypeScript e inicia long polling. Un archivo en `/home/j0k3r/.pi/agent/telegram-pi-control.env` es solo fallback opcional para usuarios que no quieran exportar variables en el shell; los valores de shell/system environment siempre tienen prioridad sobre los del archivo. El gateway usa directamente el SDK de Pi, por lo que no depende del binario `pi` en `PATH`.

Variables de entorno soportadas:

- `PI_TELEGRAM_CONTROL_BOT_TOKEN`
- `PI_TELEGRAM_CONTROL_USER_ID`

Otras variables de entorno de workspace/config/path se ignoran en `gateway:start`; editar `~/.pi/agent/trust.json` para cambiar workspaces seleccionables.

Formato opcional del archivo env local:

```env
PI_TELEGRAM_CONTROL_BOT_TOKEN=123456:replace-with-your-bot-token
PI_TELEGRAM_CONTROL_USER_ID=6744546050
```

No commitees un archivo env real.

Para mantenerlo corriendo manualmente en background:

```bash
mkdir -p "$HOME/.local/state/pi/telegram-pi-control"
nohup npm run gateway:start > "$HOME/.local/state/pi/telegram-pi-control/gateway.log" 2>&1 &
```

Luego usa comandos de Telegram: `/workspaces`, `/sessions agent`, `/new agent smoke`, `/open agent <session-id>`, `/arm 300`, prompts en texto plano, `/disarm`, `/close`, `/abort`, `/permissions`, `/approve <id>` y `/deny <id>`.

Al crear o abrir una sesión, el runtime SDK fuerza el cwd al workspace seleccionado. Archivos de sesión existentes con headers stale se abren con override de cwd para que el control por Telegram permanezca en el workspace elegido por el operador.

### Flujo de aprobación Permission Guard

Cuando Permission Guard requiere aprobación dentro de una sesión respaldada por SDK desde Telegram, el gateway envía un prompt formateado solo al chat Telegram ligado a ese workspace/sesión. Los marcadores internos crudos `permission_required:` se filtran de la salida normal del assistant.

Responder con:

```text
/approve <request-id> once
/approve <request-id> session
/approve <request-id> project
/approve <request-id> file
/approve <request-id> folder
/deny <request-id>
```

Solo se aceptan choices ofrecidas por Permission Guard para ese request. Los requests están scoped al binding activo de chat, workspace y sesión; respuestas stale, expiradas, de chat incorrecto o binding incorrecto se rechazan.

`bypassWorkspace` se configura en Permission Guard, no en el gateway Telegram. Puede reducir prompts para operaciones probadamente contenidas en el workspace, pero sigue siendo un guard in-process, no un sandbox del sistema operativo.

### Pasos de validación

```bash
cd extensions/telegram-pi-control
npm run test
npm run typecheck
npm run build
```

### Notas de deployment y operación

- El runtime actualmente está diseñado solo para long polling; webhooks y extensiones admin helper dedicadas quedan fuera de este slice.
- Un launch dedicado con service-manager (systemd/pm2/gestión manual de procesos) queda intencionalmente para documentación de operador fuera de esta extensión.

### No commitear

No commitear:

- tokens reales de bot Telegram;
- archivos locales `telegram-pi-control.env`;
- `node_modules/`;
- `dist/`;
- logs runtime/audit;
- `trust.json` u otro estado local de Pi.
