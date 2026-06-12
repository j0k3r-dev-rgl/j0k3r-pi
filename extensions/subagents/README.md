# Pi Subagents Extension

Pi extension for delegating work to markdown-defined subagents. It registers tools for the orchestrator, runs subagents in isolated in-memory Pi sessions, tracks task history, provides a TUI history panel, and supports per-subagent model/thinking-effort profiles.

## What it provides

- Markdown-defined subagents loaded from global and project directories.
- `subagent_run` for task-mode or background delegation to one or many agents.
- Status/result/list/cancel tools for delegated tasks.
- Isolated in-memory agent sessions for each subagent run.
- Project-scoped task history in a global SQLite data/cache location.
- TUI history panel via `/subagents` or `ctrl+,`.
- TUI execution rendering can expand/collapse tool and rendered component output with `ctrl+o`.
- Model profile UI via `/subagent-models`.
- Per-agent/default model and thinking-effort configuration.
- Tool allowlist filtering that prevents subagents from delegating to other subagents.
- Permission-guard handoff so main-thread user approval stays in control.

## Extension location

In this agent-dir checkout the extension lives at:

```txt
extensions/subagents/index.ts
```

When copied into a project-local Pi setup, the equivalent path is:

```txt
.pi/extensions/subagents/index.ts
```

Pi auto-discovers project-local extensions from `.pi/extensions/*/index.ts` once the project is trusted. Use `/reload` after changing extension code or markdown subagent files during an interactive session.

## Subagent definitions

Subagents are markdown files with optional YAML-like frontmatter.

Load order:

1. Global user subagents from `$PI_CODING_AGENT_DIR/subagents/*.md`.
2. Project subagents from `.pi/subagents/*.md`.

Project definitions override global definitions with the same normalized name.

Default global agent directory:

```txt
~/.pi/agent
```

Override with:

```bash
PI_CODING_AGENT_DIR=/path/to/pi-agent-dir
```

### Definition format

Example:

```md
---
name: discovery
description: investigates isolated ideas, code, documentation, and context7 before deciding whether to start prd/sdd
tools:
  - read
  - bash
  - context7_status
  - context7_search_library
model: anthropic/claude-sonnet-4-5
effort: low
---

# Discovery Subagent

You are an isolated research executor...
```

Supported frontmatter:

| Field | Description |
|---|---|
| `name` | Subagent name. Defaults to filename stem. Normalized to lowercase. |
| `description` | Short description shown by `subagent_list_agents`. |
| `tools` | Tool allowlist for the subagent. When omitted, the definition gets the built-in default tool list. Configured `default_tools` is used by the runner when a definition has an empty tool list. |
| `model` | Optional model as `provider/model-id`. |
| `effort`, `thinking_level`, `thinkingLevel` | Optional thinking effort: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`. |

The markdown body becomes the subagent instructions.

## Project and global config

Config files:

```txt
~/.pi/agent/subagents.json      # global
.pi/subagents.json              # project
```

Project config overrides global scalar values. Model profiles are merged by normalized lowercase agent name, with project profile fields overriding global profile fields.

Example:

```json
{
  "default_model": "anthropic/claude-sonnet-4-5",
  "default_effort": "medium",
  "timeout_ms": 600000,
  "stall_timeout_ms": 120000,
  "max_concurrency": 5,
  "session_resources": "full",
  "default_tools": [
    "read",
    "memory_context",
    "memory_search",
    "memory_recall",
    "memory_get"
  ],
  "model_profiles": {
    "discovery": {
      "model": "anthropic/claude-haiku-4-5",
      "effort": "low"
    },
    "sdd-apply": {
      "model": "anthropic/claude-sonnet-4-5",
      "effort": "medium"
    }
  }
}
```

### Config fields

| Field | Default | Description |
|---|---:|---|
| `default_model` | current orchestrator model | Fallback model for all subagents. Format: `provider/model-id`. |
| `default_effort` | current orchestrator effort | Fallback thinking effort. Also accepts `default_thinking_level` or `thinkingLevel`. |
| `model_profiles` | `{}` | Per-agent model/effort overrides. |
| `timeout_ms` | `600000` | Total timeout per subagent task. |
| `stall_timeout_ms` | `120000` | Inactivity timeout for a subagent session. |
| `max_concurrency` | `5` | Max concurrent subagent tasks per cwd/config pair. |
| `session_resources` | `full` | SDK resource loading mode. Use `lean` to skip skills, prompt templates, themes, and context files in nested subagent sessions while keeping extensions/tools available. Also accepts camelCase `sessionResources`. |
| `default_tools` | see below | Fallback tool allowlist used by the runner when an agent definition has an empty tool list. Omitted frontmatter `tools` uses the built-in default list. |

Default tools:

```json
["read", "memory_context", "memory_search", "memory_recall", "memory_get"]
```

Subagent delegation tools are always blocked from subagent tool allowlists, even if listed:

```txt
subagent_run
subagent_list_agents
subagent_status
subagent_result
subagent_list_tasks
subagent_cancel
any tool starting with subagent_
```

## Model profile resolution

Effective model resolution order:

1. `model_profiles[agent].model`
2. subagent frontmatter `model`
3. `default_model`
4. current orchestrator model
5. unresolved

Effective effort resolution order:

1. `model_profiles[agent].effort`
2. subagent frontmatter `effort` / `thinking_level` / `thinkingLevel`
3. `default_effort`
4. current orchestrator thinking level
5. unresolved

If a configured model cannot be resolved, the runner reports an error. If a selected model fails or stalls and the current orchestrator model is different, the runner falls back to the current model.

## Debug and permission bridge logs

Debug logging is disabled by default. Enable it with:

```bash
PI_SUBAGENTS_DEBUG=1
```

When enabled, subagents write local debug/audit breadcrumbs to:

```txt
.pi/subagents-debug.log
```

The log is intended for runtime debugging of delegated sessions and permission handoff issues. Permission bridge entries include safe metadata such as task id, agent name, request id, tool/action, reason code, risk level, scope presence, and whether a structured permission payload was detected. They intentionally avoid storing raw permission payloads, file contents, or unredacted target/command strings.

Useful event names:

- `runner_event` — compact SDK event shape observed by the subagent runner.
- `permission_bridge_payload_detected` — runner found a structured permission request.
- `permission_bridge_payload_missing` — tool output looked like a permission handoff but no structured payload was found.
- `permission_bridge_request_detected` — manager received a permission request from the runner.
- `permission_bridge_prompt_main_thread` — manager is prompting the main user.
- `permission_bridge_user_choice` — main user chose an approval/deny option.

This debug log is separate from `permission-guard`'s redacted NDJSON audit log.

## Tools exposed to the orchestrator

| Tool | Purpose |
|---|---|
| `subagent_list_agents` | List loaded markdown-defined subagents. |
| `subagent_run` | Delegate a task to one or more subagents. Supports `task` and `background` mode. |
| `subagent_status` | Get status for a delegated task. |
| `subagent_result` | Read the result for a delegated task. |
| `subagent_list_tasks` | List active and persisted delegated tasks for the current cwd. |
| `subagent_cancel` | Cancel a running delegated task. |

Only the main orchestrator should call these tools. Subagents are explicitly prevented from calling `subagent_*` tools.

### `subagent_run`

Parameters:

```ts
{
  agent?: string;
  agents?: string[];
  task: string;
  context?: string;
  mode?: "task" | "background";
}
```

Behavior:

- `mode: "task"` waits for completion and returns compact task summaries.
- `mode: "background"` returns task IDs immediately; use status/result tools later.
- Multiple agents can run from one request with `agents`.
- Double Escape during task-mode execution cancels running subagents and aborts the main turn.

## Commands and shortcut

| Entry point | Description |
|---|---|
| `/subagents` | Open the session-focused TUI subagent history panel. |
| `/subagent-models` | Configure global subagent and SDD phase model profiles. |
| `ctrl+,` | Open the TUI subagent history panel. |

`/subagent-models` writes global profile changes to:

```txt
~/.pi/agent/subagents.json
```

or `$PI_CODING_AGENT_DIR/subagents.json` when `PI_CODING_AGENT_DIR` is set.

In non-TUI environments, edit `model_profiles` manually in that JSON file.

## Task history

Task history is stored in a global data/cache location, while each row remains scoped by project `cwd`:

```txt
$XDG_DATA_HOME/pi/subagents/subagents-history.sqlite
```

Fallback:

```txt
~/.local/share/pi/subagents/subagents-history.sqlite
```

Environment overrides:

```bash
PI_SUBAGENTS_HISTORY_DB_PATH=/absolute/path/to/subagents-history.sqlite
PI_SUBAGENTS_HISTORY_HOME=/absolute/path/to/subagents-history-home
```

The history DB stores:

- task metadata;
- status and timestamps;
- model/effort used;
- usage stats when available;
- result/error/output preview;
- compact thread snapshots;
- task events.

When `PI_SUBAGENTS_DEBUG=1` is set, the extension also may write debug diagnostics to:

```txt
.pi/subagents-debug.log
```

History is best-effort: failures to persist task history should not break delegation.

## Permission handling

Subagents run in isolated sessions, but permission-sensitive operations must still be approved by the main user.

If a subagent emits a structured permission-required request from Permission Guard:

1. The manager surfaces the request to the main thread.
2. The user can choose `Allow once`, `Allow for session`, `Allow for project`, `Allow this file for project`, `Allow this folder for project`, or `Deny`, depending on request type.
3. Session approvals are stored in a main-thread approval registry.
4. Project approvals can update `.pi/permissions.json`, including `bash.safeCommands`, `bash.scopedApprovals`, and `pathApprovals.scopedApprovals`.
5. The subagent is retried after approval.

Background subagent tasks cannot request interactive permission approval. Rerun in `task` mode if approval is needed.

## Memory behavior

The runner injects memory constraints into every subagent prompt.

If the subagent does not have memory write tools, it must use memory read-only and report memory candidates to the orchestrator.

If the subagent has memory write tools (`memory_add`, `memory_update`, `memory_archive`, `memory_project_profile`), it may write memory only for the active SDD flow or when explicitly delegated memory maintenance.

## Current project subagents

This project currently defines:

| Subagent | Purpose |
|---|---|
| `discovery` | Read-only standalone/pre-SDD research and option reporting. |
| `sdd-explore` | Formal SDD exploration for an approved named change. |
| `sdd-proposal` | Product/PRD proposal artifact. |
| `sdd-spec` | Normative requirement/spec artifact. |
| `sdd-design` | Technical design artifact. |
| `sdd-task` | Implementation task plan and workload forecast. |
| `sdd-apply` | Approved SDD task implementation. |
| `sdd-verify` | Verification report without applying fixes. |
| `sdd-archive` | Archive verified SDD changes and sync specs. |

See `subagents/*.md`, `AGENTS.md`, and `skills/sdd-workflow/SKILL.md` for the workflow policy in this checkout. In project-local installs, subagent definitions live under `.pi/subagents/*.md`.

## Development

Install dependencies once:

```bash
cd extensions/subagents
npm install
```

Run tests:

```bash
cd extensions/subagents
npm test
```

Run typecheck:

```bash
cd extensions/subagents
npm run typecheck
```

## Related project docs

- `AGENTS.md` — orchestrator behavior and approval gates.
- `skills/sdd-workflow/SKILL.md` — SDD workflow and subagent phase policy.
- `skills/subagents-configuration/SKILL.md` — subagent configuration policy.
- `subagents/*.md` — concrete global/user subagent definitions in this checkout.
- `extensions/permission-guard/README.md` — permission policy integration used by subagent approval handoff.
