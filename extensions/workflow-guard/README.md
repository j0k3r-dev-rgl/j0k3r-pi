# Pi Workflow Guard Extension

Global Pi extension for OpenSpec workflow state and declared execution-scope enforcement. It keeps Markdown artifacts as the semantic source of truth and writes only derived JSON under `openspec/`.

## Scope

- Detect active changes under `openspec/changes/<slug>/`.
- Classify Mini-SDD, Formal SDD, unknown, and mixed-signature conflict states.
- Parse the required `## Workflow Status` block from present workflow Markdown.
- Parse `## Execution Scope` from Mini-SDD `mini-sdd.md` or Formal SDD `tasks.md`.
- Derive phase, status, blockers, warnings, next permitted action, artifact hashes, freshness metadata, and normalized execution scope.
- Generate `openspec/changes/<slug>/workflow.json` and `openspec/workflows.json`.

## Public tools

| Tool | Purpose |
|---|---|
| `workflow_state_get` | Return a compact state summary by default for one slug or the workspace; pass `verbose: true` to include full bounded JSON detail, including `execution_scope` when available. |
| `workflow_validate` | Return a compact validation summary by default; pass `verbose: true` to include full bounded validation JSON, and use `repairDerivedJson: true` to regenerate only derived JSON. |
| `workflow_scope_get` | Return normalized execution scope, authority artifact, readiness, blockers, and compact examples for one slug. |
| `workflow_scope_check` | Preflight a proposed `read`, `write`, `edit`, or `bash` action against the declared scope without executing it. |

Tool output is compact by default for model context. For full bounded details, call `workflow_state_get` or `workflow_validate` with `verbose: true`; for large workspaces, prefer a specific `slug`.

## Hooks

- `session_start`: sync active changes when `openspec/changes/` exists.
- `tool_call`: for subagent calls, check `read`, `write`, `edit`, and `bash` against the active change execution scope before execution when a unique scope is resolvable. The main orchestrator agent is not execution-scope limited by this hook. `/tmp/**` is always allowed for scoped subagent checks. Read-only access to Pi runtime guidance is also always allowed, limited to `/home/j0k3r/.pi/agent/AGENTS.md` and `/home/j0k3r/.pi/agent/skills/**/SKILL.md`; this does not exempt writes, edits, or bash. Python-related bash (`python`, `python3`, `uv run python`, `pytest`, `pip`, `poetry`, `tox`) is risky and must match an explicit `Allowed Bash` pattern.
- `tool_result`: sync only when a completed tool result mentions relevant `openspec/` content.
- `agent_settled`: final low-noise sync.

Block messages use the workflow-guard format with reason, evidence, and next permitted action.

## Generated files

- `openspec/changes/<slug>/workflow.json`
- `openspec/workflows.json`

These are derived and repairable; do not edit them as semantic source.

## Development

```bash
cd extensions/workflow-guard
npm test
npm run typecheck
```

After changing this global extension during an interactive Pi session, run `/reload`.
