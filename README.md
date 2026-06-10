# j0k3r-pi

Project-local Pi configuration, extensions, skills, subagents, and workflow documentation for a controlled coding-agent setup.

This repository is organized around four project extensions plus a Spec-Driven Development workflow:

- Context7 documentation lookup.
- Persistent memory.
- Permission guard.
- Markdown-defined subagents.
- PRD/SDD/OpenSpec workflow with explicit user approval gates.

## Repository layout

```txt
.
├── AGENTS.md                         # primary agent operating guide
├── docs/                             # product specs, task docs, workflow docs
├── openspec/                         # active and archived OpenSpec changes/specs
└── .pi/
    ├── extensions/                   # project-local Pi extensions
    │   ├── context7/
    │   ├── memory/
    │   ├── permission-guard/
    │   └── subagents/
    ├── skills/                       # project skills loaded by Pi on demand
    └── subagents/                    # markdown-defined subagent roles
```

Pi auto-discovers project-local extensions from `.pi/extensions/*/index.ts` after the project is trusted. Use `/reload` inside Pi after changing extensions, skills, prompts, or subagent definitions.

## Extensions

Each extension has its own README with setup, configuration, commands/tools, and validation details.

| Extension | Purpose | README |
|---|---|---|
| `context7` | Native Context7 SDK integration for current external docs. | `.pi/extensions/context7/README.md` |
| `memory` | Local-first SQLite persistent memory, session summaries, project profile, export/import. | `.pi/extensions/memory/README.md` |
| `permission-guard` | JSON-configurable in-process guard for built-in tools and user bash commands. | `.pi/extensions/permission-guard/README.md` |
| `subagents` | Markdown-defined delegated agents, SDD phase agents, task history, model profiles. | `.pi/extensions/subagents/README.md` |

### Extension validation commands

```bash
cd .pi/extensions/context7 && npm test && npm run typecheck
cd .pi/extensions/memory && npm test && npm run typecheck
cd .pi/extensions/permission-guard && npm test && npm run typecheck
cd .pi/extensions/subagents && npm test && npm run typecheck
```

## Configuration files

Common project-local config files:

| File | Owner | Purpose |
|---|---|---|
| `.pi/context7.json` | Context7 extension | Optional cache/defaults for Context7. Secrets must stay in `CONTEXT7_API_KEY`. |
| `.pi/memory.json` | Memory extension | Canonical project name, cloud metadata, and `session_end.semantic`. |
| `.pi/permissions.json` | Permission guard | Project-specific permission policy and safe bash commands. |
| `.pi/subagents.json` | Subagents extension | Project overrides for defaults and model profiles. |
| `.pi/subagents/*.md` | Subagents extension | Markdown-defined agents and SDD phases. |

Global user config may also live under `~/.pi/agent/` or `$PI_CODING_AGENT_DIR` depending on extension.

## Workflow principles

The main behavior policy is in `AGENTS.md`. The short version:

- Keep the user in control.
- Never assume hidden requirements.
- Investigation is read-only by default.
- Investigation, diagnosis, review, or discovery is not permission to implement.
- Report findings, evidence, uncertainty, risks, and options before changing code.
- The user chooses whether to implement, keep researching, defer, or choose another solution.
- Code changes follow strict TDD when non-trivial.
- Commits, tags, branches, rebases, and pushes require explicit user request in the current conversation.

## Workflow modes

### Inline workflow

Use for direct answers, tiny inspections, and very small low-risk changes.

### Simple TDD workflow

Use for small/medium fixes only when the user explicitly asks for a fix/change or approves an option after investigation.

Required shape:

1. State expected behavior and acceptance criteria.
2. Add/update the smallest failing test when a test harness exists.
3. Implement the minimal fix.
4. Run focused validation.
5. Summarize changes, validation, and remaining risk.

### Discovery workflow

Use for standalone/pre-SDD investigation:

- code/doc/API research;
- performance or behavior diagnosis;
- comparing options;
- deciding whether SDD is needed.

Discovery is read-only. It must end with a report and decision needed from the user.

### Full SDD/OpenSpec workflow

Use for named features/changes, architectural changes, risky refactors, multi-file work, unclear requirements, or work that benefits from durable artifacts.

Default planning/apply sequence:

1. `sdd-explore`
2. `sdd-proposal`
3. `sdd-spec`
4. `sdd-design`
5. `sdd-task`
6. `sdd-apply` for approved task slices only
7. `sdd-verify`
8. `sdd-archive` only after verification passes and the user wants closure

Before starting new PRD/SDD/OpenSpec work:

1. Run `git status --short`.
2. Resolve dirty worktree decision if needed.
3. Resolve execution mode: `interactive`, `normal`, or `defaults`.
4. Resolve change slug and artifact store.
5. Keep planning approval separate from implementation approval.

See `.pi/skills/sdd-workflow/SKILL.md` and `docs/sdd-subagents.md` for the detailed router and phase responsibilities.

## Current project subagents

| Subagent | Role |
|---|---|
| `discovery` | Read-only pre-SDD or standalone research. |
| `sdd-explore` | Formal exploration for an approved named SDD change. |
| `sdd-proposal` | Product/PRD proposal. |
| `sdd-spec` | Normative requirements/specs. |
| `sdd-design` | Technical design. |
| `sdd-task` | Implementation task plan and workload forecast. |
| `sdd-apply` | Approved implementation slices. |
| `sdd-verify` | Verification against artifacts and real evidence. |
| `sdd-archive` | Archive verified changes and sync source-of-truth specs. |

## Important docs

| Document | Purpose |
|---|---|
| `AGENTS.md` | Agent operating guide and workflow policy. |
| `.pi/skills/persistent-memory/SKILL.md` | Detailed memory usage policy. |
| `.pi/skills/sdd-workflow/SKILL.md` | Detailed SDD workflow router and gates. |
| `docs/sdd-subagents.md` | Subagent SDD architecture and policy. |
| `docs/memory-tool-spec.md` | Memory extension technical/product spec. |
| `docs/memory-task.md` | Memory implementation status and task notes. |
| `docs/prd-context7-extension.md` | Context7 extension PRD. |

## Security notes

- Never commit secrets, tokens, API keys, private keys, or local databases.
- `CONTEXT7_API_KEY` must come from the environment only.
- `.pi/memory.json` must not contain cloud tokens.
- Permission Guard is an in-process policy guard, not a hard sandbox.
- For strong isolation use container/micro-VM/sandbox runtime approaches.

## Git policy

The assistant must never create commits, tags, branches, rebases, or pushes unless the user explicitly requests that Git operation in the current conversation.

When a commit is requested, summarize pending changes and run `git status --short` first.
