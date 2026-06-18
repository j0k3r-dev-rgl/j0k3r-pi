# Pi Skill Registry Extension

Agent-dir development version of a future Pi skill registry extension. It generates a routing index for global/user and project-local skills so agents can select and load the right `SKILL.md` without assuming a fixed path.

## What it provides

- Generates a stack-agnostic registry from global and project skills.
- Reads Pi skill locations:
  - `.pi/skills`
  - `.agents/skills`
  - `~/.pi/agent/skills`
  - `~/.agents/skills`
- Respects Pi discovery rules:
  - root `.md` files are allowed only in `.pi/skills` and `~/.pi/agent/skills`;
  - nested skills are discovered as `SKILL.md`;
  - root markdown under `.agents/skills` is ignored.
- Writes generated routing indexes:
  - `.pi/skill-registry.json`
  - `.pi/skill-registry.md`
- Adds generated registry files to an existing `.gitignore` when missing; it does not create `.gitignore` if none exists.
- Exposes an LLM-callable tool and human slash command.

### Enable gate

The extension only registers when `.pi/skill-registry.config.json` exists with `{"enabled": true}` in project scope. Missing or invalid config defaults to disabled.

Example config:

```json
{
  "enabled": true
}
```

The registry is an index for routing. The source of truth remains each `SKILL.md`.

A dedicated agent skill for configuring this extension is available as `skill-registry-configuration`.

## Tool

| Tool | Purpose |
|---|---|
| `skill_registry_generate` | Generate the registry and optionally write output files. Defaults to write. |
| `skill_registry_resolve` | Resolve candidate skills from the live registry using intent/path/sdd-phase with optional stale-check semantics and one-hop related expansion. Read-only. |

### `skill_registry_generate`

Parameters:

```ts
{
  write?: boolean; // default: true
}
```

Use `write: false` for validation or dry-run routing checks.

### `skill_registry_resolve`

Parameters:

```ts
{
  intent?: string;
  paths?: string[]; // project paths; accepts '\\' or '/' and duplicate slashes are normalized
  sdd_phase?: 'explore' | 'proposal' | 'spec' | 'design' | 'task' | 'apply' | 'verify' | 'archive';
  include_related?: boolean; // default: true
  stale_check?: boolean; // default: true
  max_results?: number; // 1..50, default: 10
}
```

Behavior:

- Resolves against a **live in-memory registry** generated for the call (no writes).
- If `stale_check` is enabled:
  - compares live `content_hash` against `.pi/skill-registry.json`,
  - reports `fresh`, `stale`, `missing`, or `invalid` cache state,
  - does not write or refresh cache files.
- Ranking is deterministic: score desc, then priority desc, then name asc.
- Returns direct matches and one-hop related matches (separated).
- Output is routing-only guidance:
  - no `SKILL.md` content is included,
  - response guidance always recommends reading each returned `SKILL.md` before acting.
- Interactive TUI rendering is compact by default: the detailed routing result is kept for the agent in tool content/details, but the visible tool row shows only a summary until the user expands tool output with Pi's native tool-expand keybinding (default `ctrl+o`).

Response shape includes:

```ts
{
  query: {
    intent?: string,
    paths: string[],
    sdd_phase?: string,
    include_related: boolean,
    stale_check: boolean,
    max_results: number,
  },
  registry_status: {
    source: 'live',
    cache: 'fresh' | 'stale' | 'missing' | 'invalid' | 'not_checked',
    live_hash: string,
    cached_hash?: string,
    cache_path: string,
  },
  matches: Array<{
    name: string,
    path: string,
    scope: 'project' | 'global',
    priority: number,
    score: number,
    reasons: Array<{ signal: string; detail: string; weight: number }>;
    routing: {
      category: string | null,
      domains: string[],
      triggers: Record<string, unknown>,
      sdd_phases: string[],
      related_skills: string[],
    },
    read_before_acting: string,
  }>,
  related_matches: Array<{
    name: string,
    path: string,
    scope: 'project' | 'global',
    routing: Record<string, unknown>,
    read_before_acting: string,
    related_from: string[],
    relation_reasons: string[],
  }>,
  warnings: string[],
  guidance: string[],
}
```

### Command parity note

The `/skill-registry` command set remains unchanged in this MVP (`generate`, `refresh`, `write`, `status`, `list` only). There is **no** `/skill-registry resolve` command parity yet.


## Command

```text
/skill-registry generate
/skill-registry refresh
/skill-registry write
/skill-registry status
/skill-registry list
```

Command behavior:

- no args defaults to `generate`;
- `generate`, `refresh`, and `write` regenerate and write the registry;
- `status` reads the existing `.pi/skill-registry.json` and does not regenerate;
- `list` reads the existing registry when present, otherwise generates in memory without writing.

## Registry behavior

- Registry output is ordered by priority descending, then skill name ascending.
- Missing or invalid registry contracts do not exclude a skill; the skill remains present with empty routing metadata and a warning.
- Duplicate skill names produce a warning; later duplicates are ignored.
- The registry contract heading must be exactly `## Registry Contract` followed by a fenced `json` block.

## Registry Contract convention

Skills should include a valid JSON block:

````md
## Registry Contract

```json
{
  "category": "base",
  "domains": ["frontend", "forms"],
  "triggers": {
    "paths": ["front/app/routes/**/*.tsx"],
    "keywords": ["useFetcher", "fetcher.Form"]
  },
  "sdd_phases": ["explore", "design", "task", "apply", "verify"],
  "related_skills": ["project-testing"],
  "priority": 50
}
```
````

Use `templates/skill-template.md` from this extension while this is agent-dir local. Later this extension and its templates may move to global Pi agent configuration or a package.

## Development

```bash
cd extensions/skill-registry
npm test
npm run typecheck
```
