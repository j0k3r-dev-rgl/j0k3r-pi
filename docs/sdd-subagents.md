# SDD subagents for Pi

## Goal

Implement a Spec-Driven Development workflow as explicit Pi subagents. The orchestrator keeps control of delegation, while each SDD phase agent owns its phase artifact and updates a shared SDD flow state.

## Workflow selection

The SDD pipeline is not the default for every task. Use the lightest workflow that safely fits the request.

Use full SDD when the work is a named feature/change, has architecture risk, spans multiple modules, has unclear requirements, or needs durable artifacts and handoff between phases.

Do not use full SDD for simple questions, tiny one-file fixes, typos, quick inspections, or direct low-risk changes unless the user explicitly asks for SDD/OpenSpec.

For full named SDD features, the default artifact store is `hybrid`: OpenSpec files for long-form artifacts plus Pi Memory for compact active flow state. Use `memory`, `openspec`, or `none` when the user asks for that mode or the task clearly requires it.

Before launching an SDD phase, the orchestrator resolves: change slug, artifact_store, current phase/state, required prior artifacts, relevant skill registry entries, implementation approval, and validation expectations. For `openspec` or `hybrid`, ensure `openspec/changes/<feature>/` exists before asking a phase to write files; if `openspec/config.yaml` is missing, the first SDD phase may create a minimal config with project context.

Before creating PRD/OpenSpec artifacts or launching SDD subagents, run the skill registry preflight. Use the `skill_registry_generate` tool with `write=true` when the skill-registry extension is active. In interactive contexts, `/skill-registry generate` is the human command entrypoint. If neither is available, stop and report that the skill-registry extension must be loaded or reloaded.

Then read `.pi/skill-registry.json`, select relevant skills by intent, touched paths, keywords, phase, priority, and related skills, read the selected `SKILL.md` files, and pass the selected skill names/paths/applicability notes into delegated subagent context. The registry is generated from skill files and is an index for routing, not the source of truth; each `SKILL.md` remains authoritative.

## Autonomous workflow router

There are no slash commands required for SDD. The orchestrator decides the flow from the user's intent, risk, existing artifacts, and current SDD state.

| Situation | Preconditions | Flow | Subagents |
|---|---|---|---|
| Direct answer or tiny inspection | No code change or very low risk | Inline | none |
| Small localized code fix | Clear scope, cheap validation, no durable artifact value | Simple TDD | none by default |
| Explore an idea before committing | User asks to investigate/compare/understand a feature or risk before approving SDD | Discovery | `discovery` |
| Plan a named feature/change | Feature needs requirements/design/tasks, but implementation is not yet approved | SDD planning sequence | `sdd-explore` → `sdd-proposal` → `sdd-spec` → `sdd-design` → `sdd-task` |
| Implement a planned SDD change | Existing proposal/spec/design/tasks exist and user asks to implement or continue apply | SDD apply-only or apply batch | `sdd-apply` |
| Validate an implementation | Existing SDD artifacts and code changes exist, or user asks to verify | SDD verify-only | `sdd-verify` |
| Continue an active SDD flow | Active SDD memory/OpenSpec state exists or user says continue | SDD continue router | inspect state, then run the next missing phase |
| Close a verified SDD change | Verification passed and user wants closure/archive/source-of-truth sync | SDD archive-only | `sdd-archive` |
| Large/risky feature from scratch | Named feature, multi-module/risky/unclear requirements, or explicit SDD/OpenSpec intent | Full SDD feature sequence | planning sequence → approved `sdd-apply` → `sdd-verify` → optional `sdd-archive` |

### Investigation and SDD entry guard

Investigation is not implementation approval. When the user asks to investigate, inspect, analyze, diagnose, compare, or understand an issue, use read-only discovery by default, report findings/options, and wait for the user's decision before implementing or creating formal SDD artifacts.

Use `sdd-explore` only after the user approves a named SDD/OpenSpec flow and the execution mode is resolved. Pre-SDD research belongs to `discovery`.

### Apply-only guard

Do not run `sdd-apply` just because the user says "implement". Use `sdd-apply` only when an SDD task artifact exists, or the active SDD flow is already at apply phase. If artifacts are missing, route to the missing planning phase first or ask one concise clarification.

### Continue guard

When continuing, recover state from the current conversation first. If insufficient, inspect the active SDD flow memory (`type: sdd_feature_project_state`) and/or OpenSpec files. Then run the next missing or incomplete phase in order: proposal, spec, design, task, apply, verify, archive.

## Agents

- `sdd-explore`: investigates current state, affected areas, approaches, risks, and recommendation.
- `sdd-proposal`: writes proposal with intent, scope, capabilities, approach, risks, rollback, and success criteria.
- `sdd-spec`: writes the canonical requirement/spec artifact from proposal capabilities.
- `sdd-design`: writes technical design, architecture decisions, file changes, contracts, and test strategy.
- `sdd-task`: writes implementation task plan and review workload forecast.
- `sdd-apply`: implements assigned tasks and updates cumulative apply progress.
- `sdd-verify`: verifies implementation against specs/design/tasks with real command evidence.
- `sdd-archive`: archives a completed change and syncs OpenSpec source-of-truth specs.

## Delegation boundary

Only the orchestrator delegates. SDD subagents must not call `subagent_*` tools, and the subagents extension filters those tools from all subagent allowlists.

## Memory model

All SDD phase agents may use project memory, including `memory_add` and `memory_update`, but only for the active SDD flow or an explicitly delegated memory-maintenance task.

The shared memory is a compact state/index/handoff, not the long-form source of truth:

```md
type: sdd_feature_project_state
change: <feature-slug>
artifact_store: memory | openspec | hybrid | none
current_phase: <phase>
status: in_progress | blocked | complete
artifacts:
  exploration: openspec/changes/<feature>/exploration.md
  proposal: openspec/changes/<feature>/proposal.md
  spec: openspec/changes/<feature>/spec.md
  design: openspec/changes/<feature>/design.md
  tasks: openspec/changes/<feature>/tasks.md
  apply_progress: openspec/changes/<feature>/apply-progress.md
  verify_report: openspec/changes/<feature>/verify-report.md
phase_summaries:
  explore: ...
open_questions:
  - ...
next_phase: sdd-proposal
```

Rules:

- Search for existing active SDD flow memory before writing.
- Update existing flow memory instead of creating duplicates.
- Do not save unrelated project-wide decisions, secrets, raw logs, or speculative findings from SDD phase agents.
- Report created/updated memory ids in the phase response.

## OpenSpec model

OpenSpec files hold the full, human-readable, team-shareable SDD artifacts. Active changes use a single canonical `spec.md`:

```txt
openspec/
  config.yaml
  specs/
  changes/
    <feature-slug>/
      exploration.md
      proposal.md
      spec.md
      design.md
      tasks.md
      apply-progress.md
      verify-report.md
    archive/
      YYYY-MM-DD-<feature-slug>/
```

## Context7 documentation workflow

Use Context7 during SDD only when current external dependency documentation materially affects a requirement, design decision, implementation detail, or verification judgment.

Initial Context7 use is orchestrator-mediated: the orchestrator calls Context7 tools when needed and passes concise documentation summaries plus source records into `sdd-design`, `sdd-apply`, or `sdd-verify` tasks. SDD subagents must not assume direct Context7 tool access until a later explicit allowlist and security policy change approves it.

SDD artifacts must not store full Context7 documentation dumps. Record only concise citations, summaries, or source tables needed for review. Pi Memory also must not store full Context7 documentation dumps or secrets; active SDD flow memory should contain only compact source summaries or artifact path references.

When Context7 influences SDD work, record these fields in the relevant artifact:

| Field | Required content |
|-------|------------------|
| Library ID | Context7 library identifier, for example `/org/project`. |
| Query | The focused documentation query used. |
| Source | Source title, URL, or Context7/source identifier. |
| Retrieval date | Date the Context7 information was retrieved. |
| Relevance summary | Concise note explaining how the source affected the SDD work. |

Context7 authentication is environment-only. The API key must come from `CONTEXT7_API_KEY`; do not read, write, cache, log, or record API keys in `.pi/context7.json`, SDD artifacts, Pi Memory, tests, or tool output. Status/tool outputs may report key presence or absence only, never the value.

## Artifact store modes

- `memory`: use Pi Memory only; do not create OpenSpec files. Because there are no files, the single active SDD flow memory must contain enough phase artifact detail for downstream phases, not only a tiny pointer.
- `openspec`: write OpenSpec files as the source of truth. Memory may hold only a minimal active-flow pointer/index when useful.
- `hybrid`: write OpenSpec files as the source of truth and keep Pi Memory updated with compact phase summaries/handoff for recovery.
- `none`: return inline only; no memory/file persistence.

## Validation

Subagents extension validation:

```bash
cd .pi/extensions/subagents
npm test
npm run typecheck
```
