# Pi Permission Guard Extension

[English](#english) | [Español](#español)

## English

`permission-guard` is a project-local Pi extension that adds a JSON configurable, in-process permission guard for supported built-in tools and user bash commands. It makes risky actions visible, asks for user consent when policy says `ask`, denies known secret access by default, and writes a local redacted audit trail.

### What it provides

- Policy checks for supported built-in tool calls.
- Policy checks for user `!` and `!!` bash commands via `user_bash` events.
- Workspace and outside-workspace path policy.
- Default read-only passthrough for valid Pi skill files in recognized global and project skill locations.
- Default read-only passthrough for Pi's installed README, docs, and examples documentation.
- Optional `bypassWorkspace` mode for provably workspace-contained operations only.
- Secret path and secret-like command denial by default.
- Conservative safe-subset bash analysis for simple commands, quoted literals, environment assignments, `&&`, `||`, `;`, newlines, safe `cd`, basic redirections, and narrowly recognized read-only pipelines.
- Structured bash path-effect extraction and classification through the same workspace/path policy used for file tools.
- Configurable workspace read-only bash policy through `bash.workspaceReadOnly`.
- Interactive approval choices: `Allow once`, `Allow for session`, bash-only `Allow for project`, `Allow this file for project`, `Allow this folder for project`, `Deny`.
- Session approval cache for repeated matching requests.
- Project-scoped external path approvals for `read`, `ls`, `find`, and `grep` through `pathApprovals.scopedApprovals`.
- Project-scoped bash approval persistence for explicitly approved outside-workspace or otherwise risky forms.
- Subagent permission routing back to the main user thread.
- Redacted local audit logs with rotation.

### Extension location

In this agent-dir checkout the extension lives at:

```txt
extensions/permission-guard/index.ts
```

When copied into a project-local Pi setup, the equivalent path is:

```txt
.pi/extensions/permission-guard/index.ts
```

Pi auto-discovers project-local extensions from `.pi/extensions/*/index.ts` once the project is trusted. Use `/reload` after changing extension code or permission config during an interactive session.

### Security scope and limitations

This extension is an in-process guard, not a hard sandbox. It does not provide OS-level containment, syscall isolation, guaranteed network isolation, or guaranteed prevention of arbitrary host-process behavior.

Strong isolation requires a container, Docker/OpenShell-style environment, Gondolin or another micro-VM approach, or a sandbox-runtime such as `@anthropic-ai/sandbox-runtime`.

The bash policy is a conservative safe subset, not a full shell parser or sandbox. It supports common validation forms such as simple commands, quoted literals, environment assignments, `&&`, `||`, `;`, newlines, safe `cd`, basic redirections, and narrowly recognized read-only pipelines. With the conservative defaults, unsupported syntax such as background jobs, command/process substitution, glob/env expansion, sourced scripts, malformed quotes, or unrecognized pipe forms fails closed to approval unless an earlier hard deny applies; permissive configuration such as `bash.outsideWorkspaceFilesystem="allow"` or non-interactive allow fallback can intentionally broaden behavior. `~` and `~/...` are expanded for bash path-effect classification before workspace/outside-workspace decisions are made.

MVP enforcement covers supported built-in tools and user bash events that pass through Pi runtime hooks. Custom and third-party tools are out of MVP scope unless they explicitly integrate with the guard.

Skill loading passthrough covers read-only access to loadable skill markdown files in recognized Pi skill roots only. It does not allow writes, bash execution, arbitrary skill scripts, malformed skill files, or symlink escapes outside the skill root.

Pi documentation passthrough covers read-only access to the installed `@earendil-works/pi-coding-agent` package `README.md`, `docs/**`, and `examples/**` paths under a package root whose `package.json` declares that package name. It does not allow package internals, lookalike folders without the matching package identity, writes, bash execution, or symlink escapes outside the package root.

### Runtime hooks

This extension does not register LLM tools or slash commands. It registers Pi event handlers:

| Event | What is guarded |
|---|---|
| `tool_call` | Supported built-in tool calls: `read`, `write`, `edit`, `grep`, `find`, `ls`, `bash`. |
| `user_bash` | User shell commands entered through `!` or `!!`. |

If policy denies a request, the extension blocks it. If policy requires approval, it prompts the main user when UI is available or fails closed according to non-interactive policy.

### Defaults

Built-in defaults are conservative. Project or global config can override them, including emergency `bypassAll`; inspect the active config when validating enforcement:

- Permission guard is enabled.
- `bypassAll` is false.
- `bypassWorkspace` is false.
- Workspace reads/writes/creates/lists/searches are allowed unless matched by ask/deny globs.
- Workspace `.git/**` and `node_modules/**` default to `ask`.
- Non-secret outside-workspace reads, lists, searches, writes, and creates default to `ask`.
- Valid skill file reads from recognized global and project skill roots are allowed by default without project configuration.
- Pi's installed README, docs, and examples documentation reads are allowed by default without project configuration.
- Non-interactive ask decisions fail closed by default.
- Secrets are denied by default.
- Default protected paths include `.env`, `.env.*`, key/certificate files, and common SSH/AWS/GPG credential locations.
- Bash defaults to `ask` unless the command matches a safe, ask, deny, scoped approval, or workspace read-only rule.
- Analyzed read-only bash commands and narrow read-only pipelines inside the workspace default to `allow` through `bash.workspaceReadOnly`.
- No project `.pi/permissions.json` file is created automatically.

### Configuration files

Effective config is loaded in this order:

1. Built-in safe defaults.
2. User-global config:

   ```txt
   $PI_CODING_AGENT_DIR/extensions/permission-guard.json
   ```

   Default global agent dir:

   ```txt
   ~/.pi/agent/extensions/permission-guard.json
   ```

3. Nearest project config found from the current working directory upward:

   ```txt
   .pi/permissions.json
   ```

Project relative paths are resolved against the active workspace, not the extension install directory.

Unknown keys are ignored with warnings. Secret-like config keys such as `apiKey`, `token`, `secret`, `password`, and `credential` are also ignored with warnings.

### Example project policy

```json
{
  "outsideWorkspace": {
    "read": "ask",
    "list": "ask",
    "search": "ask",
    "write": "ask",
    "create": "ask"
  },
  "workspace": {
    "ask": [".git/**", "node_modules/**"],
    "deny": []
  },
  "bash": {
    "network": "ask",
    "workspaceReadOnly": "allow",
    "outsideWorkspaceFilesystem": "ask",
    "safeCommands": [],
    "scopedApprovals": [],
    "askCommands": ["rm *", "mv *", "cp *", "git clean *", "git reset *", "npm install *"],
    "denyCommands": ["sudo *", "su *", "chmod 777 *", "chown *", "rm -rf /", "rm -rf ~"]
  },
  "pathApprovals": {
    "scopedApprovals": []
  },
  "audit": {
    "enabled": true
  }
}
```

### Config reference

#### Top-level

| Field | Values | Default | Description |
|---|---|---:|---|
| `enabled` | boolean | `true` | Disable/enable policy enforcement. Disabled means supported requests are allowed. |
| `bypassAll` | boolean | `false` | Emergency all-access bypass. Allows every supported permission check immediately. |
| `bypassWorkspace` | boolean | `false` | Auto-allows supported operations only when every classified effect is proven inside the active workspace and no stricter deny/secret/destructive/ask rule applies. Outside-workspace, path-context-changing, ambiguous, or unsupported effects still ask/deny. |

#### `workspace`

| Field | Values | Default | Description |
|---|---|---:|---|
| `root` | path | current `ctx.cwd` | Optional workspace root override. Relative paths resolve against cwd. |
| `allowRead` | `allow`/`ask`/`deny` | `allow` | Default read decision inside workspace. |
| `allowWrite` | `allow`/`ask`/`deny` | `allow` | Default write/edit decision inside workspace. |
| `allowCreate` | `allow`/`ask`/`deny` | `allow` | Default create decision inside workspace. |
| `list` | `allow`/`ask`/`deny` | `allow` | Default `ls`/`find` list decision inside workspace. |
| `search` | `allow`/`ask`/`deny` | `allow` | Default `grep` search decision inside workspace. |
| `followSymlinks` | `realpath`/`lexical` | `realpath` | Whether symlink resolution affects workspace containment. |
| `ask` | string[] | `[".git/**", "node_modules/**"]` | Workspace globs that require approval. |
| `deny` | string[] | `[]` | Workspace globs that are denied. |

#### `outsideWorkspace`

| Field | Values | Default | Description |
|---|---|---:|---|
| `read` | `allow`/`ask`/`deny` | `ask` | Outside-workspace read decision. |
| `list` | `allow`/`ask`/`deny` | `ask` | Outside-workspace list decision. |
| `search` | `allow`/`ask`/`deny` | `ask` | Outside-workspace search decision. |
| `write` | `allow`/`ask`/`deny` | `ask` | Outside-workspace write/edit decision. |
| `create` | `allow`/`ask`/`deny` | `ask` | Outside-workspace create decision. |
| `rememberApprovals` | `none`/`session` | `session` | Reserved mode for outside-workspace approvals. |

#### `secrets`

| Field | Values | Default | Description |
|---|---|---:|---|
| `mode` | `deny` | `deny` | Secret handling mode. Only deny is supported. |
| `denyPaths` | string[] | see defaults | Globs for secret/credential paths. |
| `denyKeyPatterns` | string[] | token/secret/password/etc. | Secret-like key patterns. |
| `maxPreviewBytesForPrompt` | `0` | `0` | Secret previews are disabled. |

#### `tools`

Each supported tool can be set to `policy`, `allow`, or `deny`:

```json
{
  "tools": {
    "read": "policy",
    "write": "policy",
    "edit": "policy",
    "grep": "policy",
    "find": "policy",
    "ls": "policy",
    "bash": "policy"
  }
}
```

`policy` means normal path/bash policy applies. `allow` or `deny` bypasses normal policy for that tool mode. Be careful with `allow`: it bypasses the normal path policy, including secret-path denial for that tool.

#### `bash`

| Field | Values | Default | Description |
|---|---|---:|---|
| `default` | `allow`/`ask`/`deny` | `ask` | Fallback for commands that match no specific rule. |
| `safeCommands` | string[] | `git status`, `git diff`, `npm test`, `npm run typecheck` | Legacy allow candidates for commands that still pass structured shell and scope checks. Prefer structured rules such as `workspaceReadOnly` when possible. |
| `scopedApprovals` | object[] | `[]` | Additive project-scoped reusable bash approvals for outside-workspace or root-scoped bash approvals written by `Allow for project`. Workspace-only command approvals are persisted to `safeCommands` instead. |
| `denyCommands` | string[] | privilege/destructive defaults | Commands denied after hard-coded critical denials. |
| `askCommands` | string[] | state-changing defaults | Commands that require approval. |
| `network` | `allow`/`ask`/`deny` | `ask` | Network command policy. |
| `workspaceReadOnly` | `allow`/`ask`/`deny` | `allow` | Policy for analyzed read-only bash commands whose classified path effects stay inside the workspace. |
| `outsideWorkspaceFilesystem` | `allow`/`ask`/`deny` | `ask` | Bash path effects outside the workspace. |
| `envSecretExposure` | `deny`/`ask` | `deny` | Environment secret exposure. Hard-coded obvious exposure is denied; `ask` is accepted for compatibility but reserved for less obvious future cases. |
| `maxCommandPreviewChars` | number | `240` | Max command preview length in prompts/audit. |

`bash.safeCommands`, `bash.askCommands`, and `bash.denyCommands` support:

- exact commands;
- `*` wildcards;
- `regex:<pattern>` entries.

Configured safe commands are allow candidates only after structured analysis confirms supported syntax, complete path-effect extraction, and in-scope paths. Hard denials still win first, including privilege escalation, obvious secret reads, configured deny commands, and destructive root/home deletes.

`bash.workspaceReadOnly` controls bash commands that the analyzer proves are read-only and limited to workspace paths. This avoids needing broad text patterns such as `find *` or `cat *` in `safeCommands`.

Examples allowed by `"workspaceReadOnly": "allow"` when their paths are inside the workspace:

```bash
find extensions/permission-guard/src -maxdepth 1 -mindepth 1 -print | sort
grep -R -n "workspaceReadOnly" extensions/permission-guard/src | head
rg "workspaceReadOnly" extensions/permission-guard/src | head -n 5
find extensions/permission-guard/src -type f | head
grep -R -n "workspaceReadOnly" extensions/permission-guard/src | wc -l
cat extensions/permission-guard/package.json
```

Recognized read-only simple commands include `find`, `ls`, `cat`, `grep`, `head`, `tail`, `less`, and `more`. `rg` is recognized as a source in narrowly supported two-stage read-only pipelines, not as a standalone simple workspace-read-only command. Recognized two-stage read-only pipeline sources include `find`, `grep`, `rg`, `ls`, `cat`, `head`, and `tail`; recognized sinks include `sort`, `head`, `tail`, `wc`, and `uniq`. The pipeline allow rule is intentionally narrow and still requires all classified path effects to be read-only and inside the workspace.

Examples that are not allowed by `workspaceReadOnly` and must ask or be denied by other policy:

```bash
find ~/sias/app -maxdepth 1 -mindepth 1 -print | sort
cat extensions/permission-guard/package.json | sh
find extensions/permission-guard/src -type f | xargs rm
```

A structured safe compound such as `cd <workspace-relative-dir> && npm test` can be allowed when every segment is proven safe and every classified path effect remains inside the approved roots.

`Allow for project` persists workspace-only bash command approvals to `bash.safeCommands` using reusable per-segment patterns rather than the full compound command. Safe `cd` segments inside the workspace are skipped because workspace directory changes are already covered by policy. For example, approving `cd extensions/subagents && npm run typecheck && npm test` can add reusable patterns for `npm run typecheck` and `npm test`, not the full `cd ... && ...` string.

`bash.scopedApprovals` entries store a normalized command/effect signature plus allowed workspace or directory roots for approvals that need root scoping, especially outside-workspace commands. They are additive and backward compatible with legacy `bash.safeCommands`, but they do not grant arbitrary command access to a directory. Reuse requires a compatible command/effect shape and roots that contain all classified path effects.

Folder-scoped approvals work for outside-workspace paths too. For example, if the user approves this command for the project:

```bash
find ~/sias/app -maxdepth 1 -mindepth 1 -print | sort
```

then the persisted approval root is the expanded directory:

```txt
/home/<user>/sias/app
```

A later command with the same command/effect shape can reuse that approval for a child directory:

```bash
find ~/sias/app/back -maxdepth 1 -mindepth 1 -print | sort
```

However, the folder approval does not authorize unrelated commands in that same directory. These still require their own policy decision or approval:

```bash
cat ~/sias/app/REACT_ROUTER_MIGRATION_NOTES.md
find ~ -maxdepth 1 -mindepth 1 -print | sort
```

In other words, directory inheritance is scoped by both the approved root and the analyzed command/effect shape. Approving a directory is not equivalent to adding it to `safeCommands`, and it is not a blanket outside-workspace allowlist.

#### `nonInteractive`

| Field | Values | Default | Description |
|---|---|---:|---|
| `onAsk` | `deny`/`allow` | `deny` | Fallback when approval cannot be collected. |
| `allowSessionApprovals` | boolean | `false` | Whether non-interactive flows can use session approvals. |

#### `approvals`

| Field | Values | Default | Description |
|---|---|---:|---|
| `sessionCache` | boolean | `true` | Enable scoped in-memory session approval cache. |
| `allowForSession` | boolean | `true` | Allow the `Allow for session` approval option to cache matching requests. |

#### `audit`

| Field | Values | Default | Description |
|---|---|---:|---|
| `enabled` | boolean | `true` | Enable local redacted audit. |
| `logAllowed` | boolean | `false` | Log allowed requests. |
| `logDenied` | boolean | `true` | Log denied requests. |
| `logApprovals` | boolean | `true` | Log explicit approval decisions. |
| `redactPaths` | boolean | `true` | Redact paths in audit events. |
| `path` | path | user state dir | Optional audit file path. |
| `maxBytes` | number | `5242880` | Rotation threshold. |
| `maxFiles` | number | `5` | Number of rotated files to retain. |

### Approval flow

Interactive approval choices are English and intentionally stable:

- `Allow once`
- `Allow for session`
- `Allow for project` for bash approvals
- `Allow this file for project`
- `Allow this folder for project`
- `Deny`

`Allow once` applies only to the current request.

`Allow for session` creates an in-memory scoped approval for the matching command/effect signature within the approved workspace or directory roots.

`Allow for project` persists a reusable project-level approval in `.pi/permissions.json` under the current working directory. Config loading can discover the nearest `.pi/permissions.json` upward, so be aware of the cwd used when persisting approvals:

- workspace-only bash approvals are written to `bash.safeCommands` as reusable per-segment command strings or conservative regex patterns;
- outside-workspace or root-scoped bash approvals are written to `bash.scopedApprovals`.

For supported external path tools (`read`, `ls`, `find`, `grep`), prompts with safe explicit path approval options omit the generic `Allow for project` choice. The explicit project choices persist project-scoped external path approvals in `pathApprovals.scopedApprovals`:

- `Allow this file for project` stores one exact normalized file path;
- `Allow this folder for project` stores one normalized folder root and applies recursively to existing and future descendants in the current project;
- path approvals do not apply to unsupported tools such as `write`, `edit`, `bash`, or custom tools.

Scoped approval reuse stays limited to the approved command/effect signature and roots; out-of-scope paths ask again.

`Deny` blocks the current request.

### Subagent approvals

Subagent approvals route to the main thread. If a subagent-originated request needs approval, the subagent cannot approve itself. The guard surfaces a `permission_required` payload for the orchestrator/user thread so the main user can decide. For supported external path tools, the payload carries explicit file/folder project approval options so the main thread can persist the same `pathApprovals.scopedApprovals` entry that a direct request would save.

Background subagent tasks cannot complete interactive approval by themselves; rerun in task mode when approval is needed.

### Audit

Audit is local and redacted. Denials, explicit approval decisions, and subagent `permission_required` handoff events are written to an extension-owned NDJSON audit file when audit is enabled.

Default audit path:

```txt
$XDG_STATE_HOME/pi/permission-guard/audit.ndjson
```

Fallback:

```txt
~/.local/state/pi/permission-guard/audit.ndjson
```

Audit safety rules:

- subagent tool-call permission handoff events use decision `permission_required` and include the normal redacted target/command metadata when available;
- paths and commands are redacted by default;
- secret paths are hashed/redacted;
- environment values are redacted;
- edit replacement text is not written;
- tokens, passwords, and private keys must not be written to audit logs;
- audit files use mode `0600`; directories use mode `0700`;
- audit rotation is checked before appending a new event when the existing file is already over `audit.maxBytes`; a single write can exceed the threshold until the next audit event.

### Workspace bypass

Workspace-only bypass:

```json
{
  "bypassWorkspace": true
}
```

When `bypassWorkspace` is `true`, Permission Guard may auto-allow supported file operations and bash commands only when all effects are fully classified and contained inside the active workspace. This is not `bypassAll` and not a sandbox.

Still asks or denies:

- outside-workspace paths;
- parent/sibling/symlink/traversal escapes;
- secret or credential paths;
- explicit deny rules;
- destructive or privilege-escalating commands;
- path-context-changing commands such as `cd`, `pushd`, `popd`, `git -C`, and `npm --prefix`;
- unsupported or ambiguous shell syntax.

### Emergency bypass

Emergency/all-access bypass:

```json
{
  "bypassAll": true
}
```

When `bypassAll` is `true`, every supported permission check is allowed immediately without prompts, including outside-workspace reads/writes and risky bash commands. Keep it `false` by default and enable it only when you intentionally trust the current session and environment.

### Enforcement validation

For enforcement tests and manual validation, make sure any local permission config used for validation sets `bypassAll: false`. A temporary `bypassAll: true` setting will hide real policy behavior. To validate `bypassWorkspace`, set it explicitly to `true` in a temporary project config and verify outside-workspace and path-context-changing commands still ask.

Persisted `pathApprovals.scopedApprovals` entries reveal local filesystem paths in project config. Remove an entry manually from `.pi/permissions.json` to revoke it. To roll back the feature completely, remove the `pathApprovals.scopedApprovals` collection and revert the extension/subagent changes.

Suggested manual checks:

- run an in-workspace compound such as `cd extensions/permission-guard && npm test`;
- try an outside-workspace path like `cat /tmp/outside.txt` and confirm approval is required;
- choose `Allow this file for project` and confirm only that exact file is reused later in the same project;
- choose `Allow this folder for project` and confirm `read`, `ls`, `find`, and `grep` reuse the approval for descendants and future child paths, but not for prefix siblings such as `/tmp/outside-private`;
- verify secret or symlink-escape paths under an approved folder still do not bypass stricter policy;
- approve a bash request for session or project, then confirm reuse works only inside the approved roots;
- verify recognized read-only workspace pipelines such as `grep -R -n "workspaceReadOnly" extensions/permission-guard/src | head` pass when `bash.workspaceReadOnly` is `allow`;
- verify unsafe or outside-workspace pipes such as `cat extensions/permission-guard/package.json | sh` or `find ~/sias/app -maxdepth 1 -mindepth 1 -print | sort` still ask;
- verify subagent-origin permission prompts remain marker-free on user-visible surfaces.

### Development

Install dependencies once:

```bash
cd extensions/permission-guard
npm install
```

Run tests:

```bash
cd extensions/permission-guard
npm test
```

Run typecheck:

```bash
cd extensions/permission-guard
npm run typecheck
```

### Related project docs

- `extensions/subagents/README.md` — subagent permission handoff integration.
- `skills/permission-guard-configuration/SKILL.md` — agent-facing permission configuration policy.
- Pi extension docs: session/tool/user bash events and in-process extension limitations.

## Español

`permission-guard` es una extensión local de proyecto para Pi que agrega un guard de permisos in-process, configurable por JSON, para tools built-in soportadas y comandos bash del usuario. Hace visibles las acciones riesgosas, solicita consentimiento del usuario cuando la política dice `ask`, deniega por defecto acceso a secretos conocidos y escribe una auditoría local redactada.

### Qué proporciona

- Checks de política para llamadas a tools built-in soportadas.
- Checks de política para comandos bash del usuario con `!` y `!!` mediante eventos `user_bash`.
- Política de rutas dentro y fuera del workspace.
- Passthrough read-only por defecto para archivos válidos de skills Pi en ubicaciones globales y de proyecto reconocidas.
- Passthrough read-only por defecto para README, docs y examples instalados de Pi.
- Modo opcional `bypassWorkspace` solo para operaciones demostrablemente contenidas en el workspace.
- Denegación por defecto de rutas secretas y comandos con apariencia de secreto.
- Análisis conservador de subconjunto seguro de bash para comandos simples, literales quoted, asignaciones de entorno, `&&`, `||`, `;`, newlines, `cd` seguro, redirecciones básicas y pipelines read-only estrechamente reconocidos.
- Extracción y clasificación estructurada de efectos de path en bash usando la misma política workspace/path que las tools de archivo.
- Política configurable para bash read-only en workspace mediante `bash.workspaceReadOnly`.
- Opciones interactivas de aprobación: `Allow once`, `Allow for session`, `Allow for project` solo para bash, `Allow this file for project`, `Allow this folder for project`, `Deny`.
- Caché de aprobaciones de sesión para requests repetidos compatibles.
- Aprobaciones project-scoped de paths externos para `read`, `ls`, `find` y `grep` mediante `pathApprovals.scopedApprovals`.
- Persistencia project-scoped de aprobaciones bash para formas explícitamente aprobadas fuera del workspace o riesgosas.
- Routing de permisos de subagentes de vuelta al hilo principal de usuario.
- Logs de auditoría locales redactados con rotación.

### Ubicación de la extensión

En este checkout de agent-dir la extensión vive en:

```txt
extensions/permission-guard/index.ts
```

Cuando se copia a una configuración Pi local de proyecto, la ruta equivalente es:

```txt
.pi/extensions/permission-guard/index.ts
```

Pi autodetecta extensiones locales de proyecto desde `.pi/extensions/*/index.ts` una vez que el proyecto es confiable. Usa `/reload` después de cambiar código de extensión o configuración de permisos durante una sesión interactiva.

### Alcance y limitaciones de seguridad

Esta extensión es un guard in-process, no un sandbox fuerte. No provee contención a nivel sistema operativo, aislamiento de syscalls, aislamiento garantizado de red ni prevención garantizada de comportamiento arbitrario del proceso host.

Aislamiento fuerte requiere un contenedor, un entorno estilo Docker/OpenShell, Gondolin u otra micro-VM, o un runtime sandbox como `@anthropic-ai/sandbox-runtime`.

La política bash es un subconjunto seguro conservador, no un parser completo de shell ni un sandbox. Soporta formas comunes de validación como comandos simples, literales quoted, asignaciones de entorno, `&&`, `||`, `;`, newlines, `cd` seguro, redirecciones básicas y pipelines read-only estrechamente reconocidos. Con defaults conservadores, sintaxis no soportada como background jobs, command/process substitution, expansión glob/env, scripts sourced, quotes malformadas o pipelines no reconocidos falla cerrado a aprobación salvo que aplique antes una denegación fuerte; configuración permisiva como `bash.outsideWorkspaceFilesystem="allow"` o fallback allow no interactivo puede ampliar intencionalmente el comportamiento. `~` y `~/...` se expanden para clasificación de efectos de path bash antes de tomar decisiones workspace/fuera-workspace.

La aplicación MVP cubre tools built-in soportadas y eventos bash de usuario que pasan por hooks runtime de Pi. Tools custom o third-party quedan fuera del scope MVP salvo que integren explícitamente con el guard.

El passthrough de skills cubre acceso read-only a archivos Markdown de skills cargables en raíces reconocidas de skills Pi. No permite escrituras, ejecución bash, scripts arbitrarios de skills, archivos de skill malformados ni escapes por symlink fuera de la raíz de skills.

El passthrough de documentación Pi cubre acceso read-only al `README.md`, `docs/**` y `examples/**` del paquete instalado `@earendil-works/pi-coding-agent` bajo una raíz de paquete cuyo `package.json` declara ese nombre. No permite internals del paquete, carpetas lookalike sin identidad de paquete coincidente, escrituras, ejecución bash ni escapes symlink fuera de la raíz de paquete.

### Hooks runtime

Esta extensión no registra tools LLM ni comandos slash. Registra handlers de eventos Pi:

| Evento | Qué se protege |
|---|---|
| `tool_call` | Llamadas a tools built-in soportadas: `read`, `write`, `edit`, `grep`, `find`, `ls`, `bash`. |
| `user_bash` | Comandos shell del usuario ingresados mediante `!` o `!!`. |

Si la política deniega un request, la extensión lo bloquea. Si la política requiere aprobación, pregunta al usuario principal cuando hay UI disponible o falla cerrado según la política no interactiva.

### Defaults

Los defaults integrados son conservadores. Config de proyecto o global puede sobreescribirlos, incluido el bypass de emergencia `bypassAll`; inspeccionar config activa al validar enforcement:

- Permission guard está habilitado.
- `bypassAll` es false.
- `bypassWorkspace` es false.
- Lecturas/escrituras/creates/lists/searches dentro del workspace se permiten salvo match con globs ask/deny.
- Workspace `.git/**` y `node_modules/**` default a `ask`.
- Lecturas, lists, searches, writes y creates no-secret fuera del workspace default a `ask`.
- Lecturas de archivos válidos de skills desde raíces globales/de proyecto reconocidas se permiten por defecto sin config de proyecto.
- Lecturas de README/docs/examples instalados de Pi se permiten por defecto sin config de proyecto.
- Decisiones `ask` en modo no interactivo fallan cerrado por defecto.
- Secretos se deniegan por defecto.
- Rutas protegidas por defecto incluyen `.env`, `.env.*`, archivos key/certificate y ubicaciones comunes de credenciales SSH/AWS/GPG.
- Bash default a `ask` salvo que el comando matchee una regla safe, ask, deny, scoped approval o workspace read-only.
- Comandos bash read-only analizados y pipelines read-only estrechos dentro del workspace default a `allow` mediante `bash.workspaceReadOnly`.
- No se crea automáticamente ningún archivo `.pi/permissions.json` de proyecto.

### Archivos de configuración

La configuración efectiva se carga en este orden:

1. Defaults seguros integrados.
2. Config global de usuario:

   ```txt
   $PI_CODING_AGENT_DIR/extensions/permission-guard.json
   ```

   Agent dir global default:

   ```txt
   ~/.pi/agent/extensions/permission-guard.json
   ```

3. Config de proyecto más cercana encontrada desde el current working directory hacia arriba:

   ```txt
   .pi/permissions.json
   ```

Las rutas relativas de proyecto se resuelven contra el workspace activo, no contra el directorio de instalación de la extensión.

Keys desconocidas se ignoran con warnings. Keys con apariencia de secreto como `apiKey`, `token`, `secret`, `password` y `credential` también se ignoran con warnings.

### Ejemplo de política de proyecto

```json
{
  "outsideWorkspace": {
    "read": "ask",
    "list": "ask",
    "search": "ask",
    "write": "ask",
    "create": "ask"
  },
  "workspace": {
    "ask": [".git/**", "node_modules/**"],
    "deny": []
  },
  "bash": {
    "network": "ask",
    "workspaceReadOnly": "allow",
    "outsideWorkspaceFilesystem": "ask",
    "safeCommands": [],
    "scopedApprovals": [],
    "askCommands": ["rm *", "mv *", "cp *", "git clean *", "git reset *", "npm install *"],
    "denyCommands": ["sudo *", "su *", "chmod 777 *", "chown *", "rm -rf /", "rm -rf ~"]
  },
  "pathApprovals": {
    "scopedApprovals": []
  },
  "audit": {
    "enabled": true
  }
}
```

### Referencia de configuración

#### Top-level

| Campo | Valores | Default | Descripción |
|---|---|---:|---|
| `enabled` | boolean | `true` | Deshabilita/habilita enforcement de política. Deshabilitado significa que requests soportados se permiten. |
| `bypassAll` | boolean | `false` | Bypass all-access de emergencia. Permite inmediatamente cada check de permisos soportado. |
| `bypassWorkspace` | boolean | `false` | Auto-permite operaciones soportadas solo cuando cada efecto clasificado está probado dentro del workspace activo y no aplica regla más estricta deny/secret/destructive/ask. Efectos fuera-workspace, con cambio de contexto de ruta, ambiguos o no soportados siguen preguntando/denegando. |

#### `workspace`

| Campo | Valores | Default | Descripción |
|---|---|---:|---|
| `root` | path | `ctx.cwd` actual | Override opcional de raíz de workspace. Rutas relativas resuelven contra cwd. |
| `allowRead` | `allow`/`ask`/`deny` | `allow` | Decisión default de lectura dentro del workspace. |
| `allowWrite` | `allow`/`ask`/`deny` | `allow` | Decisión default de write/edit dentro del workspace. |
| `allowCreate` | `allow`/`ask`/`deny` | `allow` | Decisión default de create dentro del workspace. |
| `list` | `allow`/`ask`/`deny` | `allow` | Decisión default de list con `ls`/`find` dentro del workspace. |
| `search` | `allow`/`ask`/`deny` | `allow` | Decisión default de search con `grep` dentro del workspace. |
| `followSymlinks` | `realpath`/`lexical` | `realpath` | Si la resolución de symlinks afecta containment de workspace. |
| `ask` | string[] | `[".git/**", "node_modules/**"]` | Globs de workspace que requieren aprobación. |
| `deny` | string[] | `[]` | Globs de workspace denegados. |

#### `outsideWorkspace`

| Campo | Valores | Default | Descripción |
|---|---|---:|---|
| `read` | `allow`/`ask`/`deny` | `ask` | Decisión de lectura fuera del workspace. |
| `list` | `allow`/`ask`/`deny` | `ask` | Decisión de list fuera del workspace. |
| `search` | `allow`/`ask`/`deny` | `ask` | Decisión de búsqueda fuera del workspace. |
| `write` | `allow`/`ask`/`deny` | `ask` | Decisión de write/edit fuera del workspace. |
| `create` | `allow`/`ask`/`deny` | `ask` | Decisión de create fuera del workspace. |
| `rememberApprovals` | `none`/`session` | `session` | Modo reservado para aprobaciones fuera del workspace. |

#### `secrets`

| Campo | Valores | Default | Descripción |
|---|---|---:|---|
| `mode` | `deny` | `deny` | Modo de manejo de secretos. Solo deny está soportado. |
| `denyPaths` | string[] | ver defaults | Globs para rutas de secretos/credenciales. |
| `denyKeyPatterns` | string[] | token/secret/password/etc. | Patrones de keys con apariencia de secreto. |
| `maxPreviewBytesForPrompt` | `0` | `0` | Previews de secretos deshabilitados. |

#### `tools`

Cada tool soportada puede configurarse como `policy`, `allow` o `deny`:

```json
{
  "tools": {
    "read": "policy",
    "write": "policy",
    "edit": "policy",
    "grep": "policy",
    "find": "policy",
    "ls": "policy",
    "bash": "policy"
  }
}
```

`policy` significa que se aplica la política normal de path/bash. `allow` o `deny` saltean la política normal para ese modo de tool. Cuidado con `allow`: saltea la política normal de rutas, incluida denegación de rutas secretas para esa tool.

#### `bash`

| Campo | Valores | Default | Descripción |
|---|---|---:|---|
| `default` | `allow`/`ask`/`deny` | `ask` | Fallback para comandos que no matchean regla específica. |
| `safeCommands` | string[] | `git status`, `git diff`, `npm test`, `npm run typecheck` | Candidatos legacy de allow para comandos que igualmente pasan análisis estructurado de shell y scope. Preferir reglas estructuradas como `workspaceReadOnly`. |
| `scopedApprovals` | object[] | `[]` | Aprobaciones reutilizables project-scoped para approvals bash fuera-workspace o root-scoped escritas por `Allow for project`. Approvals workspace-only se persisten en `safeCommands`. |
| `denyCommands` | string[] | defaults privilege/destructive | Comandos denegados después de denegaciones críticas hard-coded. |
| `askCommands` | string[] | defaults state-changing | Comandos que requieren aprobación. |
| `network` | `allow`/`ask`/`deny` | `ask` | Política de comandos de red. |
| `workspaceReadOnly` | `allow`/`ask`/`deny` | `allow` | Política para comandos bash read-only analizados cuyos efectos de path clasificados permanecen dentro del workspace. |
| `outsideWorkspaceFilesystem` | `allow`/`ask`/`deny` | `ask` | Efectos de path bash fuera del workspace. |
| `envSecretExposure` | `deny`/`ask` | `deny` | Exposición de secretos de entorno. Exposición obvia hard-coded se deniega; `ask` se acepta por compatibilidad pero queda reservado para casos futuros menos obvios. |
| `maxCommandPreviewChars` | number | `240` | Largo máximo del preview de comando en prompts/audit. |

`bash.safeCommands`, `bash.askCommands` y `bash.denyCommands` soportan comandos exactos, wildcards `*` y entradas `regex:<pattern>`.

Los comandos safe configurados son candidatos a allow solo después de que el análisis estructurado confirme sintaxis soportada, extracción completa de efectos de path y paths dentro del scope. Las denegaciones fuertes ganan primero, incluyendo privilege escalation, lecturas obvias de secretos, comandos deny configurados y borrados destructivos de root/home.

`bash.workspaceReadOnly` controla comandos bash que el analizador prueba como read-only y limitados a rutas del workspace. Esto evita necesitar patrones amplios como `find *` o `cat *` en `safeCommands`.

Ejemplos permitidos por `"workspaceReadOnly": "allow"` cuando sus paths están dentro del workspace:

```bash
find extensions/permission-guard/src -maxdepth 1 -mindepth 1 -print | sort
grep -R -n "workspaceReadOnly" extensions/permission-guard/src | head
rg "workspaceReadOnly" extensions/permission-guard/src | head -n 5
find extensions/permission-guard/src -type f | head
grep -R -n "workspaceReadOnly" extensions/permission-guard/src | wc -l
cat extensions/permission-guard/package.json
```

Comandos simples read-only reconocidos incluyen `find`, `ls`, `cat`, `grep`, `head`, `tail`, `less` y `more`. `rg` se reconoce como source en pipelines read-only de dos etapas estrechamente soportados, no como comando simple standalone workspace-read-only. Fuentes reconocidas de pipeline read-only de dos etapas incluyen `find`, `grep`, `rg`, `ls`, `cat`, `head` y `tail`; sinks reconocidos incluyen `sort`, `head`, `tail`, `wc` y `uniq`. La regla de allow de pipeline es intencionalmente estrecha y exige que todos los efectos de path clasificados sean read-only y dentro del workspace.

Ejemplos no permitidos por `workspaceReadOnly` y que deben preguntar o denegarse por otra política:

```bash
find ~/sias/app -maxdepth 1 -mindepth 1 -print | sort
cat extensions/permission-guard/package.json | sh
find extensions/permission-guard/src -type f | xargs rm
```

Un compound seguro estructurado como `cd <workspace-relative-dir> && npm test` puede permitirse cuando cada segmento está probado como seguro y cada efecto de path clasificado permanece dentro de raíces aprobadas.

`Allow for project` persiste approvals bash workspace-only en `bash.safeCommands` usando patrones reutilizables por segmento en vez del comando compuesto completo. Segmentos `cd` seguros dentro del workspace se omiten porque los cambios de directorio dentro del workspace ya están cubiertos por la política. Por ejemplo, aprobar `cd extensions/subagents && npm run typecheck && npm test` puede agregar patrones reutilizables para `npm run typecheck` y `npm test`, no el string completo `cd ... && ...`.

Las entradas `bash.scopedApprovals` guardan una firma normalizada de comando/efecto más raíces permitidas de workspace o directorios para approvals que necesitan scope por raíz, especialmente comandos fuera-workspace. Son aditivas y compatibles con `bash.safeCommands` legacy, pero no otorgan acceso arbitrario de comando a un directorio. La reutilización requiere forma compatible de comando/efecto y raíces que contengan todos los efectos de path clasificados.

Las aprobaciones por carpeta funcionan también para paths fuera-workspace. Por ejemplo, si el usuario aprueba este comando para el proyecto:

```bash
find ~/sias/app -maxdepth 1 -mindepth 1 -print | sort
```

la raíz persistida de approval es el directorio expandido:

```txt
/home/<user>/sias/app
```

Un comando posterior con la misma forma de comando/efecto puede reutilizar esa approval para un directorio hijo:

```bash
find ~/sias/app/back -maxdepth 1 -mindepth 1 -print | sort
```

Sin embargo, la approval de carpeta no autoriza comandos no relacionados en ese mismo directorio. Estos siguen requiriendo su propia decisión de política o aprobación:

```bash
cat ~/sias/app/REACT_ROUTER_MIGRATION_NOTES.md
find ~ -maxdepth 1 -mindepth 1 -print | sort
```

En otras palabras, la herencia de directorio está scoped por la raíz aprobada y por la forma analizada de comando/efecto. Aprobar un directorio no equivale a agregarlo a `safeCommands` ni a una allowlist general fuera-workspace.

#### `nonInteractive`

| Campo | Valores | Default | Descripción |
|---|---|---:|---|
| `onAsk` | `deny`/`allow` | `deny` | Fallback cuando no se puede recolectar aprobación. |
| `allowSessionApprovals` | boolean | `false` | Si los flujos no interactivos pueden usar approvals de sesión. |

#### `approvals`

| Campo | Valores | Default | Descripción |
|---|---|---:|---|
| `sessionCache` | boolean | `true` | Habilita caché scoped en memoria para approvals de sesión. |
| `allowForSession` | boolean | `true` | Permite que la opción `Allow for session` cachee requests compatibles. |

#### `audit`

| Campo | Valores | Default | Descripción |
|---|---|---:|---|
| `enabled` | boolean | `true` | Habilita auditoría local redactada. |
| `logAllowed` | boolean | `false` | Loguea requests permitidos. |
| `logDenied` | boolean | `true` | Loguea requests denegados. |
| `logApprovals` | boolean | `true` | Loguea decisiones explícitas de aprobación. |
| `redactPaths` | boolean | `true` | Redacta paths en eventos de audit. |
| `path` | path | user state dir | Ruta opcional del archivo audit. |
| `maxBytes` | number | `5242880` | Umbral de rotación. |
| `maxFiles` | number | `5` | Cantidad de archivos rotados a retener. |

### Flujo de aprobación

Las opciones interactivas de aprobación están en inglés y son intencionalmente estables:

- `Allow once`
- `Allow for session`
- `Allow for project` para approvals bash
- `Allow this file for project`
- `Allow this folder for project`
- `Deny`

`Allow once` aplica solo al request actual.

`Allow for session` crea una aprobación scoped en memoria para la firma de comando/efecto compatible dentro de las raíces aprobadas de workspace o directorio.

`Allow for project` persiste una approval reutilizable de nivel proyecto en `.pi/permissions.json` bajo el current working directory. La carga de config puede descubrir el `.pi/permissions.json` más cercano hacia arriba, así que hay que considerar el cwd usado al persistir approvals:

- approvals bash workspace-only se escriben en `bash.safeCommands` como strings de comandos por segmento reutilizables o patrones regex conservadores;
- approvals bash fuera-workspace o root-scoped se escriben en `bash.scopedApprovals`.

Para tools de path externo soportadas (`read`, `ls`, `find`, `grep`), prompts con opciones seguras explícitas de aprobación de path omiten la opción genérica `Allow for project`. Las opciones explícitas project persisten approvals project-scoped de paths externos en `pathApprovals.scopedApprovals`:

- `Allow this file for project` guarda una ruta de archivo exacta normalizada;
- `Allow this folder for project` guarda una raíz de carpeta normalizada y aplica recursivamente a descendientes existentes y futuros en el proyecto actual;
- approvals de path no aplican a tools no soportadas como `write`, `edit`, `bash` o custom tools.

La reutilización de approvals scoped permanece limitada a la firma de comando/efecto aprobada y sus raíces; paths fuera de scope vuelven a preguntar.

`Deny` bloquea el request actual.

### Aprobaciones de subagentes

Las aprobaciones de subagentes se enrutan al hilo principal. Si un request originado en subagente requiere aprobación, el subagente no puede aprobarse a sí mismo. El guard expone un payload `permission_required` para el hilo orquestador/usuario, de modo que el usuario principal decida. Para tools de path externo soportadas, el payload lleva opciones explícitas de aprobación project de archivo/carpeta para que el hilo principal persista la misma entrada `pathApprovals.scopedApprovals` que guardaría un request directo.

Tareas de subagente en background no pueden completar aprobación interactiva por sí mismas; volver a ejecutar en modo task cuando se requiere aprobación.

### Auditoría

La auditoría es local y redactada. Denegaciones, decisiones explícitas de aprobación y eventos handoff `permission_required` de subagentes se escriben en un archivo audit NDJSON propio de la extensión cuando audit está habilitado.

Ruta audit default:

```txt
$XDG_STATE_HOME/pi/permission-guard/audit.ndjson
```

Fallback:

```txt
~/.local/state/pi/permission-guard/audit.ndjson
```

Reglas de seguridad de audit:

- eventos de handoff de permisos de tool-call de subagente usan decisión `permission_required` e incluyen metadata normal redactada de target/comando cuando está disponible;
- paths y comandos se redactan por defecto;
- rutas secretas se hashean/redactan;
- valores de entorno se redactan;
- texto de reemplazo de edit no se escribe;
- tokens, passwords y private keys no deben escribirse en audit logs;
- archivos audit usan modo `0600`; directorios usan `0700`;
- la rotación audit se chequea antes de appendear un nuevo evento cuando el archivo existente ya supera `audit.maxBytes`; una sola escritura puede superar el umbral hasta el próximo evento audit.

### Bypass de workspace

Bypass solo-workspace:

```json
{
  "bypassWorkspace": true
}
```

Cuando `bypassWorkspace` es `true`, Permission Guard puede auto-permitir operaciones de archivo y comandos bash soportados solo cuando todos los efectos están completamente clasificados y contenidos dentro del workspace activo. Esto no es `bypassAll` ni un sandbox.

Sigue preguntando o denegando:

- paths fuera-workspace;
- escapes por parent/sibling/symlink/traversal;
- rutas secretas o de credenciales;
- reglas deny explícitas;
- comandos destructivos o de privilege escalation;
- comandos que cambian contexto de path como `cd`, `pushd`, `popd`, `git -C` y `npm --prefix`;
- sintaxis shell no soportada o ambigua.

### Bypass de emergencia

Bypass de emergencia/all-access:

```json
{
  "bypassAll": true
}
```

Cuando `bypassAll` es `true`, cada check de permisos soportado se permite inmediatamente sin prompts, incluyendo lecturas/escrituras fuera-workspace y comandos bash riesgosos. Mantenerlo `false` por defecto y habilitarlo solo cuando se confía intencionalmente en la sesión y el entorno actuales.

### Validación de enforcement

Para tests de enforcement y validación manual, asegurate de que cualquier config local de permisos usada para validar tenga `bypassAll: false`. Un `bypassAll: true` temporal ocultará el comportamiento real de política. Para validar `bypassWorkspace`, setearlo explícitamente a `true` en una config temporal de proyecto y verificar que comandos fuera-workspace y que cambian contexto de path sigan preguntando.

Las entradas persistidas `pathApprovals.scopedApprovals` revelan rutas locales de filesystem en config de proyecto. Remover una entrada manualmente de `.pi/permissions.json` para revocarla. Para rollback completo de la feature, remover la colección `pathApprovals.scopedApprovals` y revertir cambios de extensión/subagentes.

Checks manuales sugeridos:

- ejecutar un compound dentro del workspace como `cd extensions/permission-guard && npm test`;
- probar un path fuera-workspace como `cat /tmp/outside.txt` y confirmar que requiere aprobación;
- elegir `Allow this file for project` y confirmar que luego solo se reutiliza ese archivo exacto en el mismo proyecto;
- elegir `Allow this folder for project` y confirmar que `read`, `ls`, `find` y `grep` reutilizan la approval para descendientes y futuros child paths, pero no para siblings por prefijo como `/tmp/outside-private`;
- verificar que rutas secretas o symlink-escape bajo una carpeta aprobada no salteen política más estricta;
- aprobar un request bash para sesión o proyecto y confirmar que la reutilización funciona solo dentro de raíces aprobadas;
- verificar que pipelines read-only de workspace reconocidos como `grep -R -n "workspaceReadOnly" extensions/permission-guard/src | head` pasen cuando `bash.workspaceReadOnly` es `allow`;
- verificar que pipes inseguros o fuera-workspace como `cat extensions/permission-guard/package.json | sh` o `find ~/sias/app -maxdepth 1 -mindepth 1 -print | sort` sigan preguntando;
- verificar que prompts de permisos originados en subagentes permanezcan sin markers crudos en superficies visibles al usuario.

### Desarrollo

Instalar dependencias una vez:

```bash
cd extensions/permission-guard
npm install
```

Ejecutar tests:

```bash
cd extensions/permission-guard
npm test
```

Ejecutar typecheck:

```bash
cd extensions/permission-guard
npm run typecheck
```

### Docs relacionadas del proyecto

- `extensions/subagents/README.md` — integración de handoff de permisos de subagentes.
- `skills/permission-guard-configuration/SKILL.md` — política agent-facing de configuración de permisos.
- Docs de extensiones Pi: eventos session/tool/user bash y limitaciones de extensiones in-process.
