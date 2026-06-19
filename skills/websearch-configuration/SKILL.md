---
name: websearch-configuration
description: "configure the Pi websearch extension global settings, credentials, GitHub provider mode, reload expectations, and package validation without teaching individual tool usage."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.1"
---

# Websearch Configuration

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "runtime",
  "domains": ["websearch", "extensions", "configuration", "github-provider"],
  "triggers": {
    "paths": [
      "extensions/websearch/**",
      "skills/websearch-configuration/SKILL.md",
      ".pi/skills/websearch-configuration/SKILL.md",
      ".agents/skills/websearch-configuration/SKILL.md",
      "~/.pi/agent/websearch.json",
      "~/.pi/agent/skills/websearch-configuration/SKILL.md",
      "~/.agents/skills/websearch-configuration/SKILL.md"
    ],
    "keywords": [
      "websearch configuration",
      "configure websearch",
      "websearch config",
      "websearch extension setup",
      "websearch reload",
      "websearch validation",
      "~/.pi/agent/websearch.json",
      "github provider",
      "github provider api",
      "github provider gh",
      "github cli provider",
      "STACK_EXCHANGE_KEY",
      "GITHUB_TOKEN"
    ]
  },
  "sdd_phases": ["explore", "design", "task", "apply", "verify"],
  "related_skills": [
    "permission-guard-configuration",
    "skill-authoring",
    "sdd-workflow"
  ],
  "priority": 82
}
```

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `triggers.paths`: glob-like project paths that should activate this skill.
- `triggers.keywords`: concrete setup/configuration terms, config paths, provider names, and environment variable names that should activate this skill.
- `sdd_phases`: phases where this skill is useful when websearch configuration or implementation is being planned, changed, applied, or verified.
- `related_skills`: skills future agents should consider when the request crosses permissions, skill editing, or formal SDD boundaries.
- `priority`: routing priority from 0 to 100. Keep below workflow-router skills and above generic extension/config help.

## Activation Contract

Use this skill when the user asks how to configure, enable, reload, troubleshoot, or validate the Pi `websearch` extension, especially questions like:

- "What do I need to configure websearch?"
- "Where is the websearch config file?"
- "Should GitHub websearch use the API or `gh`?"
- "Do I need `GITHUB_TOKEN`, `STACK_EXCHANGE_KEY`, or `gh auth login`?"
- "Why do config changes not affect the running tools?"
- "How do I validate the websearch package after a change?"

Also use this skill before editing `extensions/websearch/**`, `~/.pi/agent/websearch.json`, or this skill file.

Do not load this skill for unrelated browser search, Context7 documentation lookup, YouTube research, or generic networking questions that do not involve the Pi `websearch` extension.

Do not use this skill to teach individual websearch tool parameters or research workflows. Pi registers the tools and their schemas automatically; the live tool schema and implementation are the source of truth for tool usage.

## Hard Rules

- The `websearch` extension is read-only. It must not post, vote, comment, edit, delete, moderate, scrape HTML, automate browsers, persist indexes, or background-crawl providers.
- No Reddit support is configured or implemented. Do not suggest Reddit setup, Reddit credentials, or `snoowrap`.
- Required setup for basic use: none.
- Websearch configuration is global only: `~/.pi/agent/websearch.json`.
- Project-level websearch configuration is not supported. Do not create or recommend `.pi/websearch.json` or project overrides.
- If `~/.pi/agent/websearch.json` is missing, the effective default is:

```json
{
  "github": {
    "provider": "api"
  },
  "request": {
    "timeoutMs": 120000,
    "maxRetries": 1
  }
}
```

- The only supported GitHub provider values are:
  - `api`: use the GitHub API client; this is the default.
  - `gh`: use GitHub CLI via `gh api`.
- `github.provider = "gh"` requires `gh` installed in `PATH` and authenticated with `gh auth login`.
- Request runtime options are optional:
  - `request.timeoutMs`: default `120000`, valid range `1000` to `300000`.
  - `request.maxRetries`: default `1`, valid range `0` to `5`.
- Credentials must not be stored in `~/.pi/agent/websearch.json` or passed as tool parameters.
- Optional environment variables:
  - `STACK_EXCHANGE_KEY`: optional; improves Stack Exchange / Stack Overflow quota.
  - `GITHUB_TOKEN`: optional and env-only; improves GitHub public API quota when `github.provider = "api"`.
- Dev.to and Hacker News require no credentials.
- Never store, print, or echo secrets. Secret-like strings returned by providers should be redacted as `[REDACTED_SECRET]`.
- After changing `~/.pi/agent/websearch.json`, extension code, package dependencies, or tool registration, tell the user to reload/restart Pi before expecting runtime behavior to change.
- If asked whether the extension works after a reload, prefer bounded live runtime smoke tests over static inspection only.

## Decision Gates

- If the user wants to add another provider, change auth handling, add write operations, or loosen output bounds, route through `workflow-triage` because this can change the extension trust boundary.
- If the user asks to install or store tokens, clarify that credentials must use environment variables or provider-native auth (`gh auth login`), never repo files or tool parameters.
- If runtime behavior differs from this skill, inspect the implementation before answering; code wins over this guidance.
- If a requested answer requires individual tool usage details, do not expand this skill into a usage guide. Use the live tool schema, implementation, or runtime smoke tests instead.
- If dependency or audit changes are needed, validate with the package commands before reporting success.

## Execution Steps

1. Identify whether the user is asking for configuration, troubleshooting, reload behavior, validation, or implementation.
2. For direct configuration/readiness questions, answer from this contract first without inspecting files unless a decision gate applies.
3. Provide only the relevant setup checklist:
   - no required setup for basic use;
   - global config path is `~/.pi/agent/websearch.json`;
   - missing config defaults GitHub to `api`;
   - `github.provider` may be `api` or `gh`;
   - `request.timeoutMs` defaults to `120000` and `request.maxRetries` defaults to `1`;
   - `gh` mode requires installed/authenticated GitHub CLI;
   - optional `STACK_EXCHANGE_KEY` and `GITHUB_TOKEN` improve quotas;
   - credentials are env-only or provider-native auth, never config-file secrets;
   - reload/restart Pi after config or extension changes.
4. For runtime validation, run bounded smoke tests using the registered websearch tools only after reload when needed.
5. For implementation changes, follow project workflow rules: choose the workflow first, preserve read-only/no-Reddit/no-secret constraints, use strict TDD for code, and validate the package.
6. Run the narrowest relevant validation:
   - `cd extensions/websearch && npm run typecheck`
   - `cd extensions/websearch && npm run test`
   - `cd extensions/websearch && npm audit --omit=dev --json` when dependencies or security posture changed
   - `gh --version` and `gh auth status` when validating `github.provider = "gh"`

## Output Contract

Return:

- Skill applied: `websearch-configuration`.
- Whether the user needs required setup: normally "none".
- Global config path, effective GitHub provider behavior, timeout, and retry behavior.
- Optional credentials/auth setup relevant to the selected provider.
- Reload/restart advice when config or extension behavior was just changed.
- Validation or smoke tests executed, or why they were not needed.
- Whether docs/source inspection was intentionally skipped for a direct configuration answer.
- Risks or follow-ups, especially quota limits, missing `gh` auth, invalid config, audit failures, or runtime drift.

Do not include a catalog of individual websearch tools or their parameters unless the user explicitly asks for implementation inspection or the live tool schema is unavailable.

## References

- `~/.pi/agent/websearch.json` — global user configuration for the websearch extension.
- `extensions/websearch/README.md` — user-facing extension overview and validation commands.
- `extensions/websearch/src/config.ts` — global config loading, defaults, and validation.
- `extensions/websearch/src/tools.ts` — registered tool schemas and runtime wiring when implementation inspection is needed.
- `extensions/websearch/src/validation.ts` — input validation when behavior differs from this skill.
- `extensions/websearch/package.json` — package scripts and dependencies.
