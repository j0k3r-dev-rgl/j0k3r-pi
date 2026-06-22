---
name: websearch-configuration
description: "configure the Pi websearch extension global settings, credentials, GitHub provider mode, and reload expectations only."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.2"
---

# Websearch Configuration

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "runtime",
  "domains": ["websearch-configuration", "websearch-config", "websearch-credentials", "websearch-github-provider-config"],
  "triggers": {
    "paths": [
      "websearch.json",
      "~/.pi/agent/websearch.json"
    ],
    "keywords": [
      "websearch configuration",
      "configure websearch",
      "configurar websearch",
      "configuro websearch",
      "como configurar websearch",
      "cómo configurar websearch",
      "como configuro websearch",
      "cómo configuro websearch",
      "como se configura websearch",
      "cómo se configura websearch",
      "configuracion websearch",
      "configuración websearch",
      "websearch config",
      "websearch extension setup",
      "websearch reload",
      "~/.pi/agent/websearch.json",
      "github provider",
      "github provider api",
      "github provider gh",
      "github cli provider",
      "websearch environment variables",
      "websearch env vars",
      "websearch credentials",
      "websearch api keys",
      "websearch variables de entorno",
      "variables de entorno websearch",
      "credenciales websearch"
    ]
  },
  "sdd_phases": [],
  "related_skills": [
    "permission-guard-configuration"
  ],
  "priority": 82
}
```

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `triggers.paths`: glob-like project paths that should activate this skill.
- `triggers.keywords`: configuration-only setup terms, config paths, provider configuration terms, and environment variable names that should activate this skill.
- `sdd_phases`: keep empty for configuration-only skills so phase routing alone does not load them.
- `related_skills`: configuration-adjacent skills only; do not add usage, implementation, or workflow skills.
- `priority`: routing priority from 0 to 100. Keep below workflow-router skills and above generic extension/config help.

## Activation Contract

Use this skill only when the user asks how to configure, enable, reload, or troubleshoot configuration for the Pi `websearch` extension, especially questions like:

- "What do I need to configure websearch?"
- "Where is the websearch config file?"
- "Should GitHub websearch use the API or `gh`?"
- "Do I need `GITHUB_TOKEN`, `STACK_EXCHANGE_KEY`, or `gh auth login`?"
- "Why do config changes not affect the running tools?"

Also use this skill when editing/reviewing `~/.pi/agent/websearch.json` or repo-root `websearch.json` in an agent-root checkout.

Do not load this skill for ordinary web search, individual websearch tool usage, public tool parameter questions, research workflows, extension implementation work under `extensions/websearch/**`, package validation, Context7 documentation lookup, YouTube research, generic networking questions, or editing this skill file; those are not configuration questions.

## Hard Rules

- The `websearch` extension is read-only. It must not post, vote, comment, edit, delete, moderate, scrape HTML, automate browsers, persist indexes, or background-crawl providers.
- No Reddit support is configured or implemented. Do not suggest Reddit setup, Reddit credentials, or `snoowrap`.
- Required setup for the default configuration: none.
- Websearch configuration is global/agent-root only: `~/.pi/agent/websearch.json`.
- In this repository checkout, when the checkout itself is `~/.pi/agent`, the same config appears as repo-root `websearch.json`.
- `install.sh` does not install or overwrite `websearch.json`; users should create or edit `~/.pi/agent/websearch.json` manually when they need non-default behavior.
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
- Credentials and tokens must not be stored in `~/.pi/agent/websearch.json`, repo files, memories, or tool parameters.
- Supported environment variables:
  - `EXA_API_KEY`: optional; enables authenticated/higher-quota Exa hosted search.
  - `PARALLEL_API_KEY`: optional; enables authenticated/higher-quota Parallel hosted fallback search.
  - `STACK_EXCHANGE_KEY`: optional; improves Stack Exchange / Stack Overflow quota.
  - `GITHUB_TOKEN`: optional for general GitHub API quota with `github.provider = "api"`; required for GitHub Discussions with the API provider because GitHub GraphQL requires authentication.
  - `OPENALEX_MAILTO`: optional polite-pool/contact metadata for OpenAlex; also used as Crossref fallback mailto when `CROSSREF_MAILTO` is absent.
  - `CROSSREF_MAILTO`: optional polite-pool/contact metadata for Crossref; also used as OpenAlex fallback mailto when `OPENALEX_MAILTO` is absent.
  - `SEMANTIC_SCHOLAR_API_KEY`: optional; improves Semantic Scholar Graph API quota.
- Dev.to and Hacker News require no credentials.
- Never store, print, or echo secrets. Secret-like strings returned by providers should be redacted as `[REDACTED_SECRET]`.
- After changing `~/.pi/agent/websearch.json` or repo-root `websearch.json`, tell the user to reload/restart Pi before expecting runtime behavior to change.

## Decision Gates

- If the user wants to add another provider, change auth handling, add write operations, or loosen output bounds, route through `workflow-triage` because this can change the extension trust boundary.
- If the user asks to install or store tokens, clarify that credentials must use environment variables or provider-native auth (`gh auth login`), never repo files or tool parameters.
- If the user asks for tool usage, research workflows, package validation, or source-code changes, stop using this skill and route to the appropriate non-configuration workflow.

## Execution Steps

1. Identify whether the user is asking for configuration, configuration troubleshooting, or reload behavior.
2. For direct configuration/readiness questions, answer from this contract first without inspecting files unless a decision gate applies.
3. Provide only the relevant setup checklist:
   - no required setup for the default configuration;
   - global config path is `~/.pi/agent/websearch.json`;
   - when this repo is checked out as `~/.pi/agent`, the path is repo-root `websearch.json`;
   - `install.sh` does not install or overwrite this config file;
   - missing config defaults GitHub to `api`;
   - `github.provider` may be `api` or `gh`;
   - `request.timeoutMs` defaults to `120000` and `request.maxRetries` defaults to `1`;
   - `gh` mode requires installed/authenticated GitHub CLI;
   - optional env vars are `EXA_API_KEY`, `PARALLEL_API_KEY`, `STACK_EXCHANGE_KEY`, `GITHUB_TOKEN`, `OPENALEX_MAILTO`, `CROSSREF_MAILTO`, and `SEMANTIC_SCHOLAR_API_KEY`;
   - `GITHUB_TOKEN` is required for GitHub Discussions with `github.provider = "api"`;
   - credentials are env-only or provider-native auth, never config-file secrets;
   - reload/restart Pi after config changes.
4. Validate config by checking JSON syntax and allowed values only, unless the user explicitly asks for runtime verification.

## Output Contract

Return:

- Skill applied: `websearch-configuration`.
- Whether the default configuration needs required setup: normally "none".
- Global config path, repo-root equivalent when applicable, effective GitHub provider behavior, timeout, and retry behavior.
- Optional environment variables/auth setup relevant to the selected provider or feature, explicitly noting when no variable is required.
- Reload/restart advice when config was just changed.
- Config validation executed, or why it was not needed.
- Whether docs/source inspection was intentionally skipped for a direct configuration answer.
- Risks or follow-ups, especially quota limits, missing `gh` auth, invalid config, audit failures, or runtime drift.

Do not include a catalog of individual websearch tools or their parameters.

## References

- `~/.pi/agent/websearch.json` — global user configuration for the websearch extension.
- `websearch.json` — repo-root equivalent when this checkout is the Pi agent root (`~/.pi/agent`).
- `install.sh` — installer intentionally copies extension/skill/subagent files, not local runtime config like `websearch.json`.
- `extensions/websearch/README.md` — configuration path, environment variables, and credential policy.
- `extensions/websearch/src/config.ts` — global config loading, defaults, and validation.
