---
name: subagents-configuration
description: "configure Pi Subagents Extension, including markdown subagent definitions, .pi/subagents.json, model profiles, tool allowlists, background handoff shortcuts, history storage, and permission handoff."
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
  "domains": ["subagents-configuration", "subagent-config", "model-profile-config", "tool-allowlist-config", "subagent-history-config", "subagent-shortcut-config"],
  "triggers": {
    "paths": [
      ".pi/subagents/**/*.md",
      ".pi/subagents.json",
      "subagents/**/*.md",
      "subagents.json",
      "~/.pi/agent/subagents/**/*.md",
      "~/.pi/agent/subagents.json"
    ],
    "keywords": [
      "subagents configuration",
      "configure subagents",
      "configurar subagents",
      "configuro subagents",
      "como configurar subagents",
      "cómo configurar subagents",
      "como configuro subagents",
      "cómo configuro subagents",
      "como se configura subagents",
      "cómo se configura subagents",
      "configurar subagentes",
      "configuro subagentes",
      "como configurar subagentes",
      "cómo configurar subagentes",
      "como configuro subagentes",
      "cómo configuro subagentes",
      "como se configura subagentes",
      "cómo se configura subagentes",
      "configuracion subagents",
      "configuración subagents",
      "configuracion subagentes",
      "configuración subagentes",
      "subagent config",
      "subagents.json",
      "model profiles configuration",
      "tool allowlist configuration",
      "subagent history configuration",
      "background handoff shortcut",
      "background_handoff_shortcut",
      "permission handoff configuration"
    ]
  },
  "sdd_phases": [],
  "related_skills": [
    "permission-guard-configuration"
  ],
  "priority": 88
}
```

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `triggers.paths`: glob-like project paths that should activate this skill.
- `triggers.keywords`: configuration-only keywords that should activate this skill.
- `sdd_phases`: keep empty for configuration-only skills so phase routing alone does not load them.
- `related_skills`: configuration-adjacent skills only; do not add usage, implementation, or workflow skills.
- `priority`: routing priority from 0 to 100. Higher means consider earlier when multiple skills match.

## Activation Contract

Use this skill only when the user asks how to configure Pi Subagents or when editing/reviewing subagent configuration files: markdown subagent definitions and project/global `subagents.json`. Cover model profiles, allowed tools, history settings, background task config, background handoff shortcuts, lean resources, and permission handoff as configuration topics only.

Do not load this skill for ordinary subagent delegation/use (`subagent_run`, task status/result polling), extension implementation work, task history browsing, or editing this skill file; those are not configuration questions.

## Hard Rules

- The main agent remains the orchestrator; subagents must not delegate to other subagents.
- Never allow `subagent_*` tools in subagent tool allowlists; the extension filters them, but configs should not include them.
- Prefer narrow tool allowlists per subagent. Do not grant write/bash tools unless the subagent purpose requires them.
- For SDD/PRD phase agents, prefer deterministic active-flow memory tools only: `memory_search`, `memory_get`, `memory_add`, and `memory_update`; avoid `memory_context` and `memory_recall` in subagent allowlists unless there is a specific reviewed need.
- For SDD phase agents, memory write tools may be allowed only for active SDD flow memory/artifacts according to `sdd-workflow`.
- Project subagents live in `.pi/subagents/*.md`; global user subagents live in `$PI_CODING_AGENT_DIR/subagents/*.md` or `~/.pi/agent/subagents/*.md`.
- Project definitions override global definitions with the same normalized name.
- Project `subagents.json` overrides global scalar config; `model_profiles` are merged by agent name.
- Nested subagent sessions should use `session_resources: "lean"` by default so the subagent markdown body becomes the nested session system prompt, the delegated user prompt contains only orchestrator context/task, and workflow skills, prompt templates, themes, context files, and startup context injections are not auto-loaded.
- In lean mode, extensions are loaded for allowlisted tools and tool-safety hooks only; prompt/context lifecycle hooks such as `before_agent_start` and `context` must not inject hidden messages into subagent turns.
- Subagent task history is stored globally under data storage, but rows remain project-scoped by `cwd`; history stores delegated prompt and subagent system prompt separately.
- After changing subagent markdown/config or extension code, tell the user to `/reload` or restart Pi.

Recommended `subagents.json` starter:

```json
{
  "timeout_ms": 600000,
  "stall_timeout_ms": 120000,
  "max_concurrency": 5,
  "session_resources": "lean",
  "background_handoff_shortcut": "ctrl+h",
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
- If a project wants many subagents or broad tools, recommend starting with read-only discovery agents and expanding deliberately.
- If model profiles are global, confirm the user wants global behavior rather than project-only config.

## Execution Steps

1. Identify target scope: global subagent, project subagent, global config, or project config.
2. Read existing subagent markdown/config before editing.
3. For new subagents, choose lowercase kebab-case names and clear trigger-focused descriptions.
4. Set minimal tool allowlists; remove any `subagent_*` entries.
5. Configure `model_profiles`, `default_model`, and `default_effort` only when the user wants explicit routing.
6. Validate JSON syntax for `subagents.json` and frontmatter/body structure for markdown agents.
7. When configuring Claude-mode background handoff, prefer `background_handoff_shortcut` with `ctrl+<letter>` values and document any built-in shortcut conflicts.
8. Tell the user to `/reload` or restart Pi.
9. If validating configuration after reload, use `subagent_list_agents` only when the user asks for runtime verification; do not run delegated tasks just to validate configuration.

## Output Contract

Return:

- Skill applied: `subagents-configuration`.
- Scope/path configured or reviewed.
- Subagents/config fields added, changed, or preserved.
- Tool allowlist, system-prompt isolation, Context7 scope, memory-tool scope, and model/effort decisions.
- Related configuration skills considered or loaded.
- Validation executed, or the concrete reason it was not run.
- Required reload/restart note and open risks.

## References

- `extensions/subagents/README.md` — Subagents configuration, shortcuts, history settings, and model profiles.
- `extensions/subagents/src/config.ts` — subagent/config loading and tool filtering.
- `extensions/subagents/src/history.ts` — global history storage behavior.
- `~/.pi/agent/skills/permission-guard-configuration/SKILL.md` or project-local equivalent selected by the skill registry — permission handoff configuration.
