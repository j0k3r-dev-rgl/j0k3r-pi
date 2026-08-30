---
name: pi-configuration
description: "Use when the user asks to configure, enable, review, or troubleshoot Pi or extension configuration: API Tools, Code Research, Context7, Skill Registry, Websearch, Workspace Services, reload/restart behavior, credentials, tokens, or local .pi config files. Routes to one internal module only; configuration topics are not separate skills."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.1"
registry:
  category: "runtime"
  domains: "pi-configuration, extension-configuration, local-config, agent-config"
  paths: ".pi/api.json, .pi/code-research.json, .pi/context7.json, .pi/skill-registry.config.json, .pi/workspace-services.json, websearch.json, ~/.pi/agent/websearch.json"
  keywords: "configure pi, pi configuration, extension configuration, configure extension, api tools configuration, .pi/api.json, code research configuration, .pi/code-research.json, workspace graph config, context7 configuration, .pi/context7.json, skill registry configuration, .pi/skill-registry.config.json, websearch configuration, websearch.json, workspace services configuration, .pi/workspace-services.json, reload pi, restart pi after config, credentials config, token config, configurar pi, configurar extension, configuracion de pi, configuracion de extension"
  related: "anti-overengineering"
  priority: 95
---

# Pi Configuration

## Activation Contract

Use this skill when the user asks to configure, enable, review, troubleshoot, or explain Pi runtime, extension, or project-local agent configuration.

This is the one lightweight configuration router. It selects exactly one internal configuration module for the current topic and then stops. It does not implement extension code, change tool behavior, run broad workflow planning, or load every configuration topic.

Prefer exact config path ownership when a path is supplied. Prefer intent ownership when no path is supplied. Read only the selected internal module and mandatory guardrails needed for the task.

## Canonical Scope

This skill owns only:

- configuration intent classification;
- extension configuration module selection;
- safe handling boundaries for local config, reloads, generated state, and secrets; and
- avoiding configuration-topic fanout.

It does not own:

- implementation changes under extension source directories;
- ordinary use of configured tools;
- project application configuration unrelated to Pi; or
- secret creation, disclosure, or persistence.

## Hard Rules

- Load and follow `anti-overengineering` whenever this skill is active.
- Select one current configuration module. Do not load every configuration module.
- Treat files under `references/modules/` as internal reference modules, not skills.
- Do not print, store, commit, or memorize real secrets, tokens, passwords, private keys, `.env` contents, or credential material.
- Preserve unrelated config keys when editing JSON.
- After changing Pi or extension configuration, tell the user when `/reload` or restart is required before behavior changes take effect.
- If the request changes extension implementation, tool contracts, generated artifacts, or application source, stop configuration routing and use the normal software-change workflow.
- Generated runtime/cache outputs are not source configuration; do not hand-edit them unless the selected module explicitly says it is safe.

## Routing Table

| User intent or path | Internal module to read next |
|---|---|
| REST/GraphQL local API tools, `.pi/api.json`, login auth, persisted API token behavior | `references/modules/api-tools-configuration.md` |
| Workspace graph, Code Research, `.pi/code-research.json`, `.pi/workspace-code-graph` | `references/modules/code-research-configuration.md` |
| Context7 docs lookup config, cache/defaults, `.pi/context7.json`, `CONTEXT7_API_KEY` readiness | `references/modules/context7-configuration.md` |
| Skill Registry opt-in, `.pi/skill-registry.config.json`, generated registry cache behavior | `references/modules/skill-registry-configuration.md` |
| Websearch providers, `websearch.json`, GitHub provider mode, search credentials/env vars | `references/modules/websearch-configuration.md` |
| Workspace Services, `.pi/workspace-services.json`, service commands, `env_file`, local service logs/state | `references/modules/workspace-services-configuration.md` |
| Subagents extension configuration from the external package | Use the installed `subagents-configuration` skill if available; otherwise ask to inspect that package docs. |

## Execution Steps

1. Identify whether the task is Pi/extension configuration or an implementation/tool-usage request.
2. Match the request by explicit config path first, then by the routing table.
3. Read exactly one selected internal module plus `anti-overengineering` when not already loaded.
4. Apply only the selected module's configuration rules to the current path/topic.
5. Validate changed JSON or config structure with the narrowest safe check.
6. Mention reload/restart requirements and secret-handling status.
7. Regenerate the skill registry and run routing checks only when skill definitions or routing metadata changed.

## Output Contract

Return:

- Skill applied: `pi-configuration`.
- Selected configuration module and why.
- Other configuration modules deliberately not loaded.
- Config path inspected or changed.
- Secret handling confirmation.
- Validation executed and reload/restart requirement.
- Blockers or user-owned decisions, or `None`.

## References

- `references/modules/api-tools-configuration.md` — API Tools project-local REST/GraphQL config.
- `references/modules/code-research-configuration.md` — Code Research graph config.
- `references/modules/context7-configuration.md` — Context7 lookup config.
- `references/modules/skill-registry-configuration.md` — Skill Registry opt-in config.
- `references/modules/websearch-configuration.md` — Websearch global provider config.
- `references/modules/workspace-services-configuration.md` — Workspace Services project config.
- `~/.pi/agent/skills/anti-overengineering/SKILL.md` — mandatory scope control.
- `~/.pi/agent/AGENTS.md` — Pi workflow boundaries and skill loading policy.
