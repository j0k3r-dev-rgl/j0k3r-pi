# Pi Skill Registry Extension

Project-local development version of a future global Pi skill registry extension.

## What it provides

- Generates a stack-agnostic registry from global and project skills.
- Reads Pi skill locations:
  - `.pi/skills`
  - `.agents/skills`
  - `~/.pi/agent/skills`
  - `~/.agents/skills`
- Respects Pi discovery rules for direct root markdown files.
- Writes generated routing indexes:
  - `.pi/skill-registry.json`
  - `.pi/skill-registry.md`
- Exposes an LLM-callable tool and human slash command.

The registry is an index for routing. The source of truth remains each `SKILL.md`.

## Tool

| Tool | Purpose |
|---|---|
| `skill_registry_generate` | Generate the registry and optionally write output files. Defaults to write. |

## Command

```text
/skill-registry generate
/skill-registry status
/skill-registry list
```

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

Use `templates/skill-template.md` from this extension while this is project-local. Later this extension and its templates should move to global Pi agent configuration or a package.

## Development

```bash
cd .pi/extensions/skill-registry
npm test
npm run typecheck
```
