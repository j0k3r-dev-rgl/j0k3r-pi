# Pi Permission Guard Extension

`permission-guard` is a project-local Pi extension that adds a JSON configurable, in-process permission guard for supported built-in tools and user bash commands. It makes risky actions visible, asks for user consent when policy says `ask`, denies known secret access by default, and writes a local redacted audit trail.

## What it provides

- Policy checks for supported built-in tool calls.
- Policy checks for user `!` and `!!` bash commands via `user_bash` events.
- Workspace and outside-workspace path policy.
- Secret path and secret-like command denial by default.
- Heuristic bash risk detection for network, install, destructive, privileged, shell-syntax, and secret-read commands.
- Interactive approval choices: `Allow once`, `Allow for session`, `Allow for project`, `Deny`.
- Session approval cache for repeated matching requests.
- Project-level safe bash command persistence for approved safe forms.
- Subagent permission routing back to the main user thread.
- Redacted local audit logs with rotation.

## Extension location

This is a project-local Pi extension:

```txt
.pi/extensions/permission-guard/index.ts
```

Pi auto-discovers project-local extensions from `.pi/extensions/*/index.ts` once the project is trusted. Use `/reload` after changing extension code or permission config during an interactive session.

## Security scope and limitations

This extension is an in-process guard, not a hard sandbox. It does not provide OS-level containment, syscall isolation, guaranteed network isolation, or guaranteed prevention of arbitrary host-process behavior.

Strong isolation requires a container, Docker/OpenShell-style environment, Gondolin or another micro-VM approach, or a sandbox-runtime such as `@anthropic-ai/sandbox-runtime`.

The bash policy is heuristic. It can flag common risky patterns such as network commands, package installs, destructive commands, remote script pipes, privilege escalation, and obvious secret reads, but it cannot prove what scripts, aliases, interpreters, shell expansions, or child processes will do.

MVP enforcement covers supported built-in tools and user bash events that pass through Pi runtime hooks. Custom and third-party tools are out of MVP scope unless they explicitly integrate with the guard.

## Runtime hooks

This extension does not register LLM tools or slash commands. It registers Pi event handlers:

| Event | What is guarded |
|---|---|
| `tool_call` | Supported built-in tool calls: `read`, `write`, `edit`, `grep`, `find`, `ls`, `bash`. |
| `user_bash` | User shell commands entered through `!` or `!!`. |

If policy denies a request, the extension blocks it. If policy requires approval, it prompts the main user when UI is available or fails closed according to non-interactive policy.

## Defaults

Built-in defaults are conservative:

- Permission guard is enabled.
- `bypassAll` is false.
- Workspace reads/writes/creates/lists/searches are allowed unless matched by ask/deny globs.
- Workspace `.git/**` and `node_modules/**` default to `ask`.
- Non-secret outside-workspace reads, lists, searches, writes, and creates default to `ask`.
- Non-interactive ask decisions fail closed by default.
- Secrets are denied by default.
- Default protected paths include `.env`, `.env.*`, key/certificate files, and common SSH/AWS/GPG credential locations.
- Bash defaults to `ask` unless the command matches a safe, ask, or deny rule.
- No project `.pi/permissions.json` file is created automatically.

## Configuration files

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

## Example project policy

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
    "safeCommands": [
      "git status",
      "git diff",
      "npm test",
      "npm run typecheck",
      "npm --prefix .pi/extensions/permission-guard test -- --run",
      "regex:^npm\\s+--prefix\\s+\.pi/extensions/[a-z0-9._/-]+\\s+run\\s+typecheck$"
    ],
    "askCommands": ["rm *", "mv *", "cp *", "git clean *", "git reset *", "npm install *"],
    "denyCommands": ["sudo *", "su *", "chmod 777 *", "chown *", "rm -rf /", "rm -rf ~"]
  },
  "audit": {
    "enabled": true
  }
}
```

## Config reference

### Top-level

| Field | Values | Default | Description |
|---|---|---:|---|
| `enabled` | boolean | `true` | Disable/enable policy enforcement. Disabled means supported requests are allowed. |
| `bypassAll` | boolean | `false` | Emergency all-access bypass. Allows every supported permission check immediately. |

### `workspace`

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

### `outsideWorkspace`

| Field | Values | Default | Description |
|---|---|---:|---|
| `read` | `allow`/`ask`/`deny` | `ask` | Outside-workspace read decision. |
| `list` | `allow`/`ask`/`deny` | `ask` | Outside-workspace list decision. |
| `search` | `allow`/`ask`/`deny` | `ask` | Outside-workspace search decision. |
| `write` | `allow`/`ask`/`deny` | `ask` | Outside-workspace write/edit decision. |
| `create` | `allow`/`ask`/`deny` | `ask` | Outside-workspace create decision. |
| `rememberApprovals` | `none`/`session` | `session` | Reserved mode for outside-workspace approvals. |

### `secrets`

| Field | Values | Default | Description |
|---|---|---:|---|
| `mode` | `deny` | `deny` | Secret handling mode. Only deny is supported. |
| `denyPaths` | string[] | see defaults | Globs for secret/credential paths. |
| `denyKeyPatterns` | string[] | token/secret/password/etc. | Secret-like key patterns. |
| `maxPreviewBytesForPrompt` | `0` | `0` | Secret previews are disabled. |

### `tools`

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

`policy` means normal path/bash policy applies. `allow` or `deny` bypasses normal policy for that tool mode.

### `bash`

| Field | Values | Default | Description |
|---|---|---:|---|
| `default` | `allow`/`ask`/`deny` | `ask` | Fallback for commands that match no specific rule. |
| `safeCommands` | string[] | `git status`, `git diff`, `npm test`, `npm run typecheck` | Commands allowed before ask heuristics. |
| `denyCommands` | string[] | privilege/destructive defaults | Commands denied after hard-coded critical denials. |
| `askCommands` | string[] | state-changing defaults | Commands that require approval. |
| `network` | `allow`/`ask`/`deny` | `ask` | Network command policy. |
| `outsideWorkspaceFilesystem` | `allow`/`ask`/`deny` | `ask` | Absolute path references outside workspace. |
| `envSecretExposure` | `deny`/`ask` | `deny` | Environment secret exposure. Hard-coded obvious exposure is denied. |
| `maxCommandPreviewChars` | number | `240` | Max command preview length in prompts/audit. |

`bash.safeCommands`, `bash.askCommands`, and `bash.denyCommands` support:

- exact commands;
- `*` wildcards;
- `regex:<pattern>` entries.

Configured safe commands are allowed before normal ask heuristics such as network, shell syntax, default ask, or state-changing prompts. Hard denials still win first, including privilege escalation, obvious secret reads, configured deny commands, and destructive root/home deletes.

A simple `cd <workspace-relative-dir> && <safeCommand>` form is allowed when the `cd` target stays inside the workspace and `<safeCommand>` matches `bash.safeCommands`.

### `nonInteractive`

| Field | Values | Default | Description |
|---|---|---:|---|
| `onAsk` | `deny`/`allow` | `deny` | Fallback when approval cannot be collected. |
| `allowSessionApprovals` | boolean | `false` | Whether non-interactive flows can use session approvals. |

### `approvals`

| Field | Values | Default | Description |
|---|---|---:|---|
| `sessionCache` | boolean | `true` | Enable scoped in-memory session approval cache. |
| `allowForSession` | boolean | `true` | Allow the `Allow for session` approval option to cache matching requests. |

### `audit`

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

## Approval flow

Interactive approval choices are English and intentionally stable:

- `Allow once`
- `Allow for session`
- `Allow for project`
- `Deny`

`Allow once` applies only to the current request.

`Allow for session` creates an in-memory, session-scoped approval only for the matching action, tool, target or command, and policy identity.

`Allow for project` is available for recognized safe bash forms and persists a project-level `bash.safeCommands` entry in `.pi/permissions.json` so matching variants can run without repeated prompts. If no safe project pattern can be derived, it falls back to a one-time approval.

`Deny` blocks the current request.

## Subagent approvals

Subagent approvals route to the main thread. If a subagent-originated request needs approval, the subagent cannot approve itself. The guard surfaces a `permission_required` payload for the orchestrator/user thread so the main user can decide.

Background subagent tasks cannot complete interactive approval by themselves; rerun in task mode when approval is needed.

## Audit

Audit is local and redacted. Denials and explicit approval decisions are written to an extension-owned NDJSON audit file when audit is enabled.

Default audit path:

```txt
$XDG_STATE_HOME/pi/permission-guard/audit.ndjson
```

Fallback:

```txt
~/.local/state/pi/permission-guard/audit.ndjson
```

Audit safety rules:

- paths and commands are redacted by default;
- secret paths are hashed/redacted;
- environment values are redacted;
- edit replacement text is not written;
- tokens, passwords, and private keys must not be written to audit logs;
- audit files use mode `0600`; directories use mode `0700`;
- audit rotates when `audit.maxBytes` is exceeded.

## Emergency bypass

Emergency/all-access bypass:

```json
{
  "bypassAll": true
}
```

When `bypassAll` is `true`, every supported permission check is allowed immediately without prompts, including outside-workspace reads/writes and risky bash commands. Keep it `false` by default and enable it only when you intentionally trust the current session and environment.

## Development

Install dependencies once:

```bash
cd .pi/extensions/permission-guard
npm install
```

Run tests:

```bash
cd .pi/extensions/permission-guard
npm test
```

Run typecheck:

```bash
cd .pi/extensions/permission-guard
npm run typecheck
```

## Related project docs

- `openspec/changes/archive/2026-06-09-pi-permission-system/` — archived SDD artifacts for this extension.
- `.pi/extensions/subagents/README.md` — subagent permission handoff integration.
- Pi extension docs: session/tool/user bash events and in-process extension limitations.
