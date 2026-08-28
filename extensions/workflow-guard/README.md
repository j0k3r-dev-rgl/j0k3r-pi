# Pi Workflow Guard Extension

MVP 1 global Pi extension for OpenSpec workflow state. It keeps Markdown artifacts as the semantic source of truth and writes only derived JSON under `openspec/`.

## Scope

- Detect active changes under `openspec/changes/<slug>/`.
- Classify Mini-SDD, Formal SDD, unknown, and mixed-signature conflict states.
- Parse the required `## Workflow Status` block from present workflow Markdown.
- Derive phase, status, blockers, warnings, next permitted action, artifact hashes, and freshness metadata.
- Generate `openspec/changes/<slug>/workflow.json` and `openspec/workflows.json`.

## Public tools

| Tool | Purpose |
|---|---|
| `workflow_state_get` | Return bounded state for one slug or a workspace summary when no slug is supplied. |
| `workflow_validate` | Validate derived state; with `repairDerivedJson: true`, regenerate only derived JSON. |

Tool output is bounded by compact summaries plus JSON capped for model context. For large workspaces, call with a specific `slug`.

## Sync hooks

- `session_start`: sync active changes when `openspec/changes/` exists.
- `tool_result`: sync only when a completed tool result mentions relevant `openspec/` content.
- `agent_settled`: final low-noise sync.

No `tool_call` blocking is implemented in this MVP.

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
