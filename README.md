# j0k3r Pi Agent Configuration

Personal/global Pi agent configuration used from `~/.pi/agent`. It contains the agent operating guide, workflow skills, markdown subagents, and local development copies of Pi extensions used by the coding agent.

## Layout

| Path | Purpose |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Primary orchestrator instructions, workflow gates, TDD/commit policy, memory behavior, and safety rules. |
| [`skills/`](skills/) | Global/user skills used by the skill registry. These are routing-aware `SKILL.md` files for SDD, memory, permissions, subagents, Context7, and skill authoring. |
| [`subagents/`](subagents/) | Markdown-defined global/user subagents. SDD phase agents live here along with the read-only `discovery` agent. |
| [`extensions/`](extensions/) | Agent-dir extension implementations and their READMEs. In project-local installs these map to `.pi/extensions/*`. |
| [`docs/`](docs/) | Supporting docs for this agent configuration, such as [keyboard shortcuts](docs/keyboard-shortcuts.md). |
| [`subagents.json`](subagents.json) | Global/user subagent configuration and model profile defaults. |
| [`permissions.json`](permissions.json) | Global/user Permission Guard configuration. Project-local config may also live at `.pi/permissions.json`. |
| [`.pi/`](.pi/) | Project-local runtime/config data for this agent-dir repository, including memory backup config. |

## Core workflow

The agent is expected to be conservative and user-controlled:

1. Answer simple questions directly.
2. Treat investigation/review/diagnosis as read-only until the user approves a concrete implementation path.
3. Use the lightest safe workflow: inline, simple TDD, discovery, or full SDD/OpenSpec.
4. Treat policy-sensitive files (`AGENTS.md`, skills, subagents, permissions, memory/context config, workflow extensions) as higher-risk.
5. Use strict TDD for non-trivial code changes.
6. Never commit, branch, tag, rebase, or push unless the user explicitly asks in the current conversation.
7. Use memory as a curated persistent brain, not as a transcript dump.

See [`AGENTS.md`](AGENTS.md) for the full policy.

## Skill registry

[`extensions/skill-registry`](extensions/skill-registry/) generates `.pi/skill-registry.json` and `.pi/skill-registry.md` from both project-local and global/user skills.

Scanned skill roots:

- `.pi/skills`
- `.agents/skills`
- `~/.pi/agent/skills`
- `~/.agents/skills`

Use the registry as the routing index. Agents should load selected skills from the path reported by the registry rather than assuming a fixed `.pi/skills/...` location.

Useful command/tool:

```text
/skill-registry generate
```

```json
{"write": false}
```

See [`extensions/skill-registry/README.md`](extensions/skill-registry/README.md) for behavior details.

## Extensions

| Extension | README | Purpose |
|---|---|---|
| Agent Todo | [`extensions/agent-todo/README.md`](extensions/agent-todo/README.md) | Single active task checklist for the current conversation branch, plus widget/provider integration. |
| Context7 | [`extensions/context7/README.md`](extensions/context7/README.md) | Safe, bounded Context7 library documentation tools without MCP. |
| Memory | [`extensions/memory/README.md`](extensions/memory/README.md) | Local-first project-aware persistent memory backed by SQLite/FTS5. |
| Permission Guard | [`extensions/permission-guard/README.md`](extensions/permission-guard/README.md) | In-process permission policy for supported tools and user bash commands. |
| Sidebar | [`extensions/sidebar/README.md`](extensions/sidebar/README.md) | HUD-style sidebar with chat, subagents, todo, and git status. |
| Skill Registry | [`extensions/skill-registry/README.md`](extensions/skill-registry/README.md) | Routing index generator for global and project skills. |
| Subagents | [`extensions/subagents/README.md`](extensions/subagents/README.md) | Markdown-defined subagent delegation, history, TUI panel, model profiles, and permission handoff. |

After changing extension code, markdown subagents, skills, or config during an interactive Pi session, run `/reload` or restart Pi when the relevant README/skill says so.

## Validation commands

Run validation from each extension directory as needed:

```bash
cd extensions/<extension-name>
npm test
npm run typecheck
```

Examples:

```bash
cd extensions/memory
npm test
npm run typecheck
```

```bash
cd extensions/subagents
npm test
npm run typecheck
```

The Memory extension requires a Node version with built-in `node:sqlite` support.

## Security notes

- Do not store secrets in skills, README files, memories, `.pi/*.json`, or extension config.
- Live Context7 calls require `CONTEXT7_API_KEY` in the Pi process environment, not in repository files.
- Memory/cloud token fields should use environment variable names, never raw token values.
- Permission Guard is an in-process guard, not an OS sandbox.
- Emergency `bypassAll` settings disable normal guard behavior; inspect active config before enforcement validation.

## Subagents

Current global/user subagents are under [`subagents/*.md`](subagents/):

- [`discovery`](subagents/discovery.md) — read-only standalone/pre-SDD research.
- [`prd-review`](subagents/prd-review.md) — PRD readiness, ambiguity, and requirement debt review.
- [`sdd-explore`](subagents/sdd-explore.md) — formal SDD exploration.
- [`sdd-proposal`](subagents/sdd-proposal.md) — PRD/product proposal.
- [`sdd-spec`](subagents/sdd-spec.md) — normative requirements/spec.
- [`sdd-design`](subagents/sdd-design.md) — technical design.
- [`sdd-task`](subagents/sdd-task.md) — implementation task plan.
- [`sdd-apply`](subagents/sdd-apply.md) — approved implementation tasks.
- [`sdd-verify`](subagents/sdd-verify.md) — verification without fixing.
- [`sdd-archive`](subagents/sdd-archive.md) — archive verified SDD changes.

The main agent remains the orchestrator. Subagents must not delegate to other subagents.

## Documentation maintenance

Extension READMEs should describe the implementation in this checkout using repo-relative paths like `extensions/<name>`. When useful, also mention the project-local equivalent `.pi/extensions/<name>`. Keep related-doc links limited to files that exist in this repository unless intentionally referencing external Pi docs.
