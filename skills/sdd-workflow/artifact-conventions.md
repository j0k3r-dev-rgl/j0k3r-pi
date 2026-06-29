# Artifact Conventions Companion

Load this companion when the flow needs OpenSpec persistence, artifact-store decisions, change naming, or metadata/config handling.

## Artifact Store Policy

Default for named formal SDD features: `hybrid`.
Default for mini-SDD and minimal delegated apply: `openspec`.

- `hybrid`: OpenSpec files are source of truth; memory stores compact state and handoff.
- `openspec`: OpenSpec files are source of truth; memory may store a minimal pointer/index.
- `memory`: no files; active SDD memory must include enough detail for continuation.
- `none`: only for read-only discovery or explicitly non-persistent planning. Formal SDD, mini-SDD, and minimal delegated apply must block on `artifact_store: none` unless the user explicitly requested no persistence and the phase can safely return all needed context in conversation.

Canonical OpenSpec artifact names:

- Project-global config: `openspec/config.yaml`
- Change metadata: `openspec/changes/<change>/metadata.yaml`
- Optional PRD: `openspec/changes/<change>/prd.md`
- Optional PRD review: `openspec/changes/<change>/prd-review.md`
- Active change spec: `openspec/changes/<change>/spec.md`
- Implementation map: `openspec/changes/<change>/implementation-map.md`
- Active verification report: `openspec/changes/<change>/verify-report.md`
- Mini-SDD task packet: `openspec/changes/<change>/mini-task-packet.md`
- Archive may sync source-of-truth capability specs under `openspec/specs/<capability>/spec.md` when applicable.

Ask one concise question when artifact persistence materially affects the workflow.

## Change Slug Rules

Use a stable kebab-case slug, usually derived from the feature or change name.

Examples:

- `pi-sidebar-extension`
- `sdd-workflow-skill`
- `memory-command-validation`

Before reusing an existing slug, inspect current OpenSpec state or active SDD memory to avoid accidental overwrite.

## OpenSpec Config and Change Metadata

`openspec/config.yaml` is stable, minimal project-global configuration. It should contain only project name, default artifact store, SDD mode policy and last selected mode, PRD policy, and the canonical change metadata path. It must not contain active change-specific fields such as `context.change`, `context.summary`, `active_change`, feature-specific notes, PRD status, implementation plan, validation commands, source paths, or current task details.

Each named SDD change may have `openspec/changes/<change>/metadata.yaml` for change-specific context: slug, title, status, artifact store, mode, summary, relevant source paths, validation expectations, and notes. Do not add placeholder paths or status for artifacts that do not exist.

Each named formal SDD change should maintain a separate operational handoff artifact at `openspec/changes/<change>/implementation-map.md` when `artifact_store` is `openspec` or `hybrid`. The implementation map tracks explored files, relevant symbols, expected file operations, validation commands, risks, open questions, and handoff notes. It is operational context, not normative requirements.

Before starting or continuing a named SDD change:

1. Ensure `openspec/config.yaml` exists, is minimal, and is project-global only.
2. Always ask the user for SDD mode on a new flow; after selection, update `openspec/config.yaml` `sdd.last_selected_mode`, the change metadata mode when metadata exists, and active SDD memory.
3. If `openspec/config.yaml` contains change-specific fields, move them into `openspec/changes/<change>/metadata.yaml` or a phase artifact.
4. Create or update `openspec/changes/<change>/metadata.yaml` when change-specific context is needed for handoff, validation expectations, or subagent routing.
5. Treat `metadata.yaml` as context, not as a replacement for proposal/spec/design/tasks.
6. Keep implementation handoff detail out of metadata; use `implementation-map.md` instead.
