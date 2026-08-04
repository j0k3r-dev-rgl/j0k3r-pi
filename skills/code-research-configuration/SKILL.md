---
name: code-research-configuration
description: "configure Pi Code Research for a project's code graph. Use when enabling or changing .pi/code-research.json, graph.enable, addGitignore, workspace_graph_status verification, generated workspace code-graph handling, or troubleshooting code-research availability; do not perform unrelated code investigation."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.1"
---

# Code Research Configuration

## Activation Contract

Use this skill only when the user asks to configure the Pi Code Research workspace graph for a project.

Use cases:

- create or edit `.pi/code-research.json`;
- enable or disable `graph.enable`;
- set `graph.addGitignore`;
- verify graph configuration with `workspace_graph_status`;
- decide what to do with generated `.pi/workspace-code-graph` artifacts.

Do not use this skill for source-code research, symbol lookup, references, call trees, implementation, refactors, or debugging application behavior.

## Hard Rules

- Configuration only. Do not edit application source code, tests, SDD artifacts, or unrelated agent policy.
- Do not enable or disable the graph unless the user explicitly asks or approves it.
- Configure the project, not the extension source: use `<project>/.pi/code-research.json`.
- Preserve unrelated existing config keys.
- Minimal enabled config:

```json
{
  "graph": {
    "enable": true,
    "addGitignore": true
  }
}
```

- `.pi/workspace-code-graph` is generated data. Do not hand-edit it.
- Do not commit generated graph artifacts unless the user explicitly asks.

## Decision Gates

- If the project root is unclear, ask for it.
- If `.pi/code-research.json` already exists, read it before editing.
- Ask before deleting, ignoring, or committing `.pi/workspace-code-graph`.
- If the request stops being configuration-only, stop and route through `workflow-triage`.

## Execution Steps

1. Identify the target project root.
2. Read existing `.pi/code-research.json` if present.
3. Apply only the requested `graph` config change.
4. Validate JSON.
5. Run `workspace_graph_status` when available.
6. If status does not reflect the change, tell the user to restart/reload Pi from the project root.

## Output Contract

Return:

- Skill applied: `code-research-configuration`.
- Project config path changed or inspected.
- Final `graph.enable` and `graph.addGitignore` values.
- Whether `.pi/workspace-code-graph` was touched.
- `workspace_graph_status` result or why it was not run.
- Any reload step or open decision.

## References

- `~/.pi/agent/extensions/code-research/README.md` — source for `.pi/code-research.json`, graph enablement, generated graph path, and status behavior.
