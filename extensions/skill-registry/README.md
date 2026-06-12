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

The registry is an index for routing. The source of truth remains each `SKILL.md`.

## Tool

| Tool | Purpose |
|---|---|
| `skill_registry_generate` | Generate the registry and optionally write output files. Defaults to write. |

Parameters:

```ts
{
  write?: boolean; // default: true
}
```

Use `write: false` for validation or dry-run routing checks.

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
