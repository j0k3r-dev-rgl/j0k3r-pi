# Pi Permission Guard

`permission-guard` is a Pi extension that adds a JSON configurable, in-process guard for supported built-in tools and user bash commands. It is intended to make risky actions visible, ask for consent when policy says `ask`, deny known secrets by default, and write a local redacted audit trail.

## Security scope and limitations

This extension is an in-process guard, not a hard sandbox. It does not provide OS-level containment, syscall isolation, guaranteed network isolation, or guaranteed prevention of arbitrary host-process behavior. Strong isolation requires a container, Docker/OpenShell-style environment, Gondolin or another micro-VM approach, or a sandbox-runtime such as `@anthropic-ai/sandbox-runtime`.

The bash policy is heuristic. It can flag common risky patterns such as network commands, package installs, destructive commands, remote script pipes, privilege escalation, and obvious secret reads, but it cannot prove what scripts, aliases, interpreters, shell expansions, or child processes will do.

MVP enforcement covers the supported built-in tools (`read`, `write`, `edit`, `grep`, `find`, `ls`, agent `bash`) and user `!` / `!!` bash events that pass through Pi runtime hooks. Custom and third-party tools are out of MVP scope unless they explicitly integrate with the guard.

## Defaults

- Secrets are denied by default. Default protected paths include `.env`, `.env.*`, key/certificate files, and common SSH/AWS/GPG credential locations.
- Workspace access is based on the active `ctx.cwd` unless JSON policy sets `workspace.root`.
- Non-secret outside-workspace reads, lists, writes, and creates default to `ask` in interactive modes.
- Non-interactive ask decisions fail closed by default.
- No project `.pi/permissions.json` file is created automatically.

## Configuration

Policy is JSON configurable. Effective config is loaded from built-in defaults, then a user-global permission JSON, then the active workspace/project override at `.pi/permissions.json` when present. Project relative paths are resolved against the active workspace, not the extension install directory.

Example project override:

```json
{
  "outsideWorkspace": { "read": "ask", "write": "ask", "create": "ask" },
  "bash": {
    "network": "ask",
    "safeCommands": ["git status", "npm --prefix .pi/extensions/permission-guard test -- --run", "ls openspec/*"]
  },
  "audit": { "enabled": true }
}
```

Emergency/all-access bypass:

```json
{
  "bypassAll": true
}
```

When `bypassAll` is `true`, every supported permission check is allowed immediately without prompts, including outside-workspace reads/writes and risky bash commands. Keep it `false` by default and enable it only when you intentionally trust the current session and environment.

`bash.safeCommands` entries support exact commands, `*` wildcards, and `regex:<pattern>` entries. Configured safe commands are allowed before normal ask heuristics such as network, shell syntax, default ask, or state-changing prompts. A simple `cd <workspace-relative-dir> && <safeCommand>` form is also allowed when the `cd` target stays inside the workspace and `<safeCommand>` matches `bash.safeCommands`. Hard denials still win first, including privilege escalation, obvious secret reads, configured deny commands, and destructive root/home deletes.

## Approval flow

Interactive approval choices are English and intentionally stable:

- `Allow once`
- `Allow for session`
- `Allow for project`
- `Deny`

`Allow once` applies only to the current request. `Allow for session` creates an in-memory, session-scoped approval only for the matching action, tool, target or command, and policy identity. `Allow for project` is available for recognized safe bash forms and persists a project-level `bash.safeCommands` entry in `.pi/permissions.json` so matching variants can run without repeated prompts. `Deny` blocks the current request.

Subagent approvals route to the main thread. If a subagent-originated request needs approval, the subagent cannot approve itself; the guard surfaces a `permission_required` payload for the orchestrator/user thread so the main user can decide.

## Audit

Audit is local and redacted. Denials and explicit approval decisions are written to an extension-owned NDJSON audit file when audit is enabled. Paths and commands are redacted by default, secret paths are hashed/redacted, and file contents, environment values, edit replacement text, tokens, passwords, and private keys must not be written to audit logs.
