---
name: subagents-configuration
description: "configure Pi Subagents Extension, including markdown subagent definitions, .pi/subagents.json, global model profiles, tool allowlists, history storage, and permission handoff."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Subagents Configuration

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "workflow",
  "domains": ["subagents", "delegation", "model-profiles", "tools", "history"],
  "triggers": {
    "paths": [
      ".pi/subagents/**/*.md",
      ".pi/subagents.json",
      "subagents/**/*.md",
      "subagents.json",
      "~/.pi/agent/subagents/**/*.md",
      "~/.pi/agent/subagents.json",
      "extensions/subagents/**"
    ],
    "keywords": [
      "subagent",
      "subagents.json",
      "subagent_run",
      "model profiles",
      "delegation",
      "tool allowlist",
      "subagent history"
    ]
  },
  "sdd_phases": ["explore", "design", "task", "apply", "verify"],
  "related_skills": [
    "permission-guard-configuration",
    "skill-authoring",
    "sdd-workflow"
  ],
  "priority": 88
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

Use this skill when configuring, creating, reviewing, or debugging Pi subagents, including markdown subagent files, project/global `subagents.json`, model profiles, allowed tools, task history, background tasks, or permission handoff between subagents and the main orchestrator.

## Hard Rules

- The main agent remains the orchestrator; subagents must not delegate to other subagents.
- Never allow `subagent_*` tools in subagent tool allowlists; the extension filters them, but configs should not include them.
- Prefer narrow tool allowlists per subagent. Do not grant write/bash tools unless the subagent purpose requires them.
- For SDD phase agents, memory write tools may be allowed only for active SDD flow memory/artifacts according to `sdd-workflow`.
- Project subagents live in `.pi/subagents/*.md`; global user subagents live in `$PI_CODING_AGENT_DIR/subagents/*.md` or `~/.pi/agent/subagents/*.md`.
- Project definitions override global definitions with the same normalized name.
- Project `subagents.json` overrides global scalar config; `model_profiles` are merged by agent name.
- Nested subagent sessions should use `session_resources: "lean"` by default so they do not auto-load workflow skills, prompt templates, themes, or context files; opt into `full` only for agents that intentionally need those resources.
- Subagent task history is stored globally under data storage, but rows remain project-scoped by `cwd`.
- After changing subagent markdown/config or extension code, tell the user to `/reload` or restart Pi.

Recommended `subagents.json` starter:

```json
{
  "timeout_ms": 600000,
  "stall_timeout_ms": 120000,
  "max_concurrency": 5,
  "session_resources": "lean",
  "default_tools": [
    "read",
    "memory_context",
    "memory_search",
    "memory_recall",
    "memory_get"
  ],
  "model_profiles": {}
}
```

Markdown subagent frontmatter pattern:

```md
---
name: discovery
description: investigates isolated ideas, code, documentation, and context7 before deciding next workflow
tools:
  - read
  - memory_search
model: anthropic/claude-sonnet-4-5
effort: low
---

# Discovery Subagent

Instructions...
```

## Decision Gates

- If the subagent will modify files, run bash, or write memory, ask whether a full SDD workflow or stricter review is required.
- If the subagent needs permission-sensitive tools, also consider `permission-guard-configuration`.
- If the subagent participates in PRD/SDD/OpenSpec, load `sdd-workflow` and preserve its phase responsibilities.
- If a project wants many subagents or broad tools, recommend starting with read-only discovery agents and expanding deliberately.
- If model profiles are global, confirm the user wants global behavior rather than project-only config.

## Execution Steps

1. Identify target scope: global subagent, project subagent, global config, or project config.
2. Read existing subagent markdown/config before editing.
3. For new subagents, choose lowercase kebab-case names and clear trigger-focused descriptions.
4. Set minimal tool allowlists; remove any `subagent_*` entries.
5. Configure `model_profiles`, `default_model`, and `default_effort` only when the user wants explicit routing.
6. Validate JSON syntax for `subagents.json` and frontmatter/body structure for markdown agents.
7. Tell the user to `/reload` or restart Pi.
8. Use `subagent_list_agents` to verify loading when practical.
9. Use a small read-only `subagent_run` smoke test only when the user approves execution.

## Output Contract

Return:

- Skill applied: `subagents-configuration`.
- Scope/path configured or reviewed.
- Subagents/config fields added, changed, or preserved.
- Tool allowlist and model/effort decisions.
- Related skills considered or loaded.
- Validation executed, or the concrete reason it was not run.
- Required reload/restart note and open risks.

## References

- `extensions/subagents/README.md` — Subagents configuration, commands, history, and model profiles.
- `extensions/subagents/src/config.ts` — subagent/config loading and tool filtering.
- `extensions/subagents/src/history.ts` — global history storage behavior.
- `extensions/subagents/src/runner.ts` — prompt building and execution behavior.
- `~/.pi/agent/skills/sdd-workflow/SKILL.md` or project-local equivalent selected by the skill registry — SDD phase responsibilities and subagent orchestration rules.
- `~/.pi/agent/skills/permission-guard-configuration/SKILL.md` or project-local equivalent selected by the skill registry — permission handoff and approval policy.
