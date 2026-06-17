---
name: permission-guard-configuration
description: "configure Pi Permission Guard policies, especially .pi/permissions.json safety rules, workspace/outside-workspace access, bash approvals, secrets, and audit behavior."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Permission Guard Configuration

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "security",
  "domains": ["permissions", "security", "bash-policy", "path-policy", "audit"],
  "triggers": {
    "paths": [
      ".pi/permissions.json",
      "permissions.json",
      "extensions/permission-guard/**",
      ".pi/subagents-debug.log"
    ],
    "keywords": [
      "permission guard",
      "permissions.json",
      "allow once",
      "allow for project",
      "bash policy",
      "path approval",
      "outside workspace",
      "secrets policy"
    ]
  },
  "sdd_phases": ["explore", "design", "task", "apply", "verify"],
  "related_skills": [
    "subagents-configuration",
    "skill-authoring"
  ],
  "priority": 90
}
```

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `triggers.paths`: glob-like project paths that should activate this skill.
- `triggers.keywords`: user/request/code keywords that should activate this skill.
- `sdd_phases`: phases where this skill is usually useful: `explore`, `proposal`, `spec`, `design`, `task`, `apply`, `verify`, `archive`.
- `related_skills`: skills that should be considered when this skill is active.
- `priority`: routing priority from 0 to 100. Higher means consider earlier when multiple skills match.

## Activation Contract

Use this skill when configuring, reviewing, or explaining Permission Guard policy for a project or global agent setup, especially `.pi/permissions.json`, `$PI_CODING_AGENT_DIR/extensions/permission-guard.json`, bash approvals, outside-workspace access, secret denial, audit behavior, or subagent permission handoff.

## Hard Rules

- Treat Permission Guard as a safety layer, not a sandbox. Do not promise OS-level containment.
- Never recommend `bypassAll=true` except as an explicit temporary emergency choice by the user.
- Keep secret handling deny-by-default. Do not allow `.env`, private keys, SSH, AWS, GPG, tokens, passwords, or credential paths.
- Prefer `ask` for outside-workspace access unless the user explicitly accepts broader access.
- Prefer structured `bash.workspaceReadOnly="allow"` for safe read-only workspace commands instead of broad `safeCommands` patterns.
- Keep destructive or privilege-escalating commands denied or approval-gated: `sudo`, `su`, `rm -rf /`, `rm -rf ~`, unsafe `chmod`, unsafe `chown`.
- Do not store secrets or secret previews in config or audit examples.
- After editing `.pi/permissions.json` or global permission config, tell the user to `/reload` or restart Pi.

Recommended conservative project policy:

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

## Decision Gates

- If the user asks to allow outside-workspace write/create by default, stop and confirm scope, risk, and alternatives.
- If the user asks to allow network commands globally, ask whether per-command approval is safer.
- If a permission denial involves secrets, do not help bypass it; suggest non-secret alternatives.
- If the request is for subagent approvals, also consider `subagents-configuration` because permission prompts are routed back to the main user thread.
- If non-interactive execution is required, explain that ask decisions fail closed unless policy is made explicit.

## Execution Steps

1. Identify target config: project `.pi/permissions.json` or global `$PI_CODING_AGENT_DIR/extensions/permission-guard.json`.
2. Read the existing config before editing.
3. Preserve existing valid approvals unless the user asks to reset them.
4. Apply deny/ask/allow policy from most restrictive to least restrictive: secrets, tools, workspace, outsideWorkspace, bash.
5. Prefer narrow scoped approvals over broad allow rules.
6. Validate JSON syntax after editing.
7. Tell the user to `/reload` or restart Pi.
8. When validating behavior, use safe read-only commands first, then controlled ask cases if needed.

## Output Contract

Return:

- Skill applied: `permission-guard-configuration`.
- Config path reviewed or changed.
- Main policies set or preserved.
- Any risky approvals added, with reason and scope.
- Validation executed, or the concrete reason it was not run.
- Required reload/restart note.
- Risks, drift, or open decisions.

## References

- `extensions/permission-guard/README.md` — Permission Guard behavior, defaults, and config reference.
- `extensions/permission-guard/src/config.ts` — config loading and validation.
- `extensions/permission-guard/src/defaults.ts` — default safety policy.
- `extensions/permission-guard/src/bash-policy.ts` — bash policy behavior.
- `extensions/permission-guard/src/path-policy.ts` — workspace/outside-workspace path policy.
