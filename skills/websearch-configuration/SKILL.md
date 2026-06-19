---
name: websearch-configuration
description: "configure and explain the Pi websearch extension, including optional environment variables, available tools, tool parameters, provider limits, reload needs, and validation commands."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Websearch Configuration

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "runtime",
  "domains": ["websearch", "extensions", "configuration", "community-search"],
  "triggers": {
    "paths": [
      "extensions/websearch/**",
      "skills/websearch-configuration/SKILL.md",
      ".pi/skills/websearch-configuration/SKILL.md",
      ".agents/skills/websearch-configuration/SKILL.md",
      "~/.pi/agent/skills/websearch-configuration/SKILL.md",
      "~/.agents/skills/websearch-configuration/SKILL.md"
    ],
    "keywords": [
      "websearch",
      "websearch extension",
      "search_stack_overflow",
      "stack_overflow_question_get",
      "stack_overflow_answers_get",
      "stack_overflow_comments_get",
      "search_github_issues",
      "github_issue_get",
      "search_devto_articles",
      "devto_comments_get",
      "search_hackernews",
      "hackernews_story_get",
      "STACK_EXCHANGE_KEY",
      "GITHUB_TOKEN",
      "react router search",
      "community search tools",
      "dev.to search",
      "hacker news search",
      "stack overflow search",
      "github issues search"
    ]
  },
  "sdd_phases": ["explore", "design", "task", "apply", "verify"],
  "related_skills": [
    "context7-configuration",
    "permission-guard-configuration",
    "sdd-workflow"
  ],
  "priority": 82
}
```

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `triggers.paths`: glob-like project paths that should activate this skill.
- `triggers.keywords`: concrete user phrases, tool names, env vars, and provider names that should activate this skill.
- `sdd_phases`: phases where this skill is useful when websearch is being planned, changed, applied, or verified.
- `related_skills`: skills future agents should consider when the request crosses documentation fetching, permissions, or formal SDD boundaries.
- `priority`: routing priority from 0 to 100. Keep below workflow-router skills and above generic extension/config help.

## Activation Contract

Use this skill when the user asks how to configure, enable, reload, troubleshoot, validate, or use the Pi `websearch` extension, especially questions like:

- "What do I need to use websearch?"
- "Do I need to do anything so websearch works reliably / without problems?"
- "Which env vars are required or optional?"
- "Do I need a GitHub token?"
- "What parameters do the websearch tools accept?"
- "Why do the tools not show up after editing the extension?"
- "How do I validate the websearch package?"
- "Can the agent search Stack Overflow, GitHub Issues, Dev.to, or Hacker News?"

Also use this skill before editing `extensions/websearch/**` or this skill file.

Do not load this skill for unrelated browser search, Context7 documentation lookup, YouTube research, or generic networking questions that do not involve the Pi `websearch` extension.

## Hard Rules

- The `websearch` extension is read-only. It must not post, vote, comment, edit, delete, moderate, scrape HTML, automate browsers, persist indexes, or background-crawl providers.
- No Reddit support is configured or implemented. Do not suggest Reddit setup, Reddit credentials, or `snoowrap`.
- Required environment variables: none for basic use.
- For direct setup, configuration, or usage-readiness questions, answer from this skill's current contract first. Do not read Pi extension docs, examples, package files, or source code by default.
- Inspect docs/source only when the user asks for implementation details, asks to troubleshoot a runtime mismatch, requests validation, or when the current contract is insufficient/contradicted by observed behavior.
- Optional environment variables:
  - `STACK_EXCHANGE_KEY`: optional, improves Stack Exchange / Stack Overflow quota.
  - `GITHUB_TOKEN`: optional, env-only, improves GitHub public API quota.
- Never ask the user to pass API keys or tokens as tool parameters. Credentials must come from environment variables only.
- Never store, print, or echo secrets. Secret-like strings returned by providers should be redacted as `[REDACTED_SECRET]`.
- Dev.to and Hacker News require no API keys and use native `fetch`.
- GitHub Issues uses the official `octokit` runtime dependency.
- After changing extension code, package dependencies, or tool registration, tell the user to reload/restart Pi before expecting new tools to appear.
- If asked whether the extension works after a reload, prefer a small live runtime smoke test with bounded queries rather than claiming success from static inspection only.

## Tool Inventory and Parameters

Current tools exposed by `extensions/websearch`:

| Tool | Required parameters | Optional parameters | Notes |
|---|---|---|---|
| `search_stack_overflow` | `query` | `limit` default 5, max 10 | Stack Overflow search via Stack Exchange API. |
| `stack_overflow_question_get` | `question` | none | `question` accepts a Stack Overflow question ID or URL. |
| `stack_overflow_answers_get` | `question` | `limit` default 10, max 30 | `question` accepts a Stack Overflow question ID or URL. |
| `stack_overflow_comments_get` | `question` | `commentsLimit` default 10, max 30; `commentsOffset` default 0 | Fetches bounded Stack Overflow question comments with offset-style pagination. |
| `search_github_issues` | `query` | `repo`, `state`, `limit` default 5, max 10 | `repo` is `owner/repo`; `state` is `open` or `closed`; search always forces `is:issue`. |
| `github_issue_get` | `issue` | `commentsLimit` default 5, max 20 | `issue` accepts a GitHub issue URL or `owner/repo#number`. |
| `search_devto_articles` | `tag` | `limit` default 5, max 10 | Dev.to / Forem article search is tag-first for MVP. |
| `devto_comments_get` | `article_id` | `topLevelLimit` default 10 | Returns at most 25 total comment nodes and max depth 2. |
| `search_hackernews` | `query` | `limit` default 5, max 10 | Uses Algolia HN Search API with `tags=story`. |
| `hackernews_story_get` | `story_id` | `commentsLimit` default 10, max 25 | Returns story details and best-effort nested comments up to depth 3. |

## Decision Gates

- If the user wants to add another provider, change auth handling, add write operations, or loosen output bounds, route through `workflow-triage` and likely formal SDD because this changes the extension trust boundary.
- If the user asks about installing or storing tokens, clarify that only environment variables are supported; do not edit repo config with secrets.
- If a tool works structurally but returned `content` is not useful enough for the agent to read, treat it as a usability bug and propose a small TDD follow-up.
- If runtime behavior differs from this skill, inspect `extensions/websearch/src/tools.ts`, `src/validation.ts`, `src/client.ts`, and `README.md` before answering; code wins over this guidance.
- If dependency or audit changes are needed, validate with the package commands before reporting success.

## Execution Steps

1. Identify whether the user is asking for configuration, usage, troubleshooting, validation, or implementation.
2. For direct configuration/usage-readiness questions, do not inspect files unless needed by a decision gate. Answer from the current contract with a short setup checklist:
   - no required setup or env vars for basic use;
   - optional `STACK_EXCHANGE_KEY` and `GITHUB_TOKEN` only improve quotas;
   - Dev.to and Hacker News need no credentials;
   - credentials must be environment variables only;
   - reload/restart Pi only after installing, enabling, or changing the extension;
   - if the websearch tools are already visible in the current session, the extension is already loaded.
3. When parameters matter, list only the relevant tool parameters and bounds from the table above.
4. For runtime validation, run bounded smoke tests using the websearch tools; avoid broad or unbounded searches.
5. For implementation changes, follow project workflow rules: choose the workflow first, use strict TDD, preserve no-Reddit and read-only constraints, and validate the package.
6. Run the narrowest relevant validation:
   - `cd extensions/websearch && npm run typecheck`
   - `cd extensions/websearch && npm run test`
   - `cd extensions/websearch && npm audit --omit=dev --json`
   - source grep for `reddit|snoowrap` when scope could affect provider inventory.

## Output Contract

Return:

- Skill applied: `websearch-configuration`.
- Whether the user needs any required setup: normally "none".
- Optional environment variables and why they help.
- Relevant tool names and parameters when the user asks about usage.
- Reload/restart advice when tools were just added or changed.
- Validation or smoke tests executed, or why they were not needed.
- Whether docs/source inspection was intentionally skipped for a direct configuration answer.
- Risks or follow-ups, especially quota limits, missing optional tokens, audit failures, or readability/usability gaps.

## References

- `extensions/websearch/README.md` — user-facing tool inventory, environment variables, provider notes, safety rules, and validation commands.
- `extensions/websearch/src/tools.ts` — registered tool names, parameter schemas, and output envelopes.
- `extensions/websearch/src/validation.ts` — defaults, max limits, IDs, URLs, and input parsing rules.
- `extensions/websearch/src/client.ts` — runtime env/fetch wiring and provider client construction.
- `extensions/websearch/package.json` — runtime dependencies and validation scripts.
