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

Extensión de seguridad in-process para permisos de tools y comandos bash.

### Resumen

Permission Guard hace visibles las acciones riesgosas, solicita aprobación cuando la política lo indica, bloquea accesos peligrosos por defecto y escribe auditoría local redactada. No es un sandbox del sistema operativo, sino una capa de control dentro de Pi.

### Herramientas y capacidades

- Hooks runtime para tools soportadas y bash del usuario.
- Políticas de workspace y rutas fuera del workspace.
- Detección de secretos y protección de rutas sensibles.
- Reglas para comandos bash, aprobaciones por proyecto y modo no interactivo.
- Auditoría local redactada.
- Integración con subagentes y handoff de aprobaciones.

### Uso recomendado

Úsalo para reducir riesgos operativos y hacer explícitas las acciones sensibles, especialmente en repositorios con secretos, infraestructura o comandos destructivos.

### Ver más

La sección en inglés contiene referencia completa de configuración, defaults, flujo de aprobación, auditoría, límites y validación.
