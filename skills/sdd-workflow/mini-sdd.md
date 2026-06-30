# Mini-SDD Companion

Load this companion when the selected route is `mini-sdd` or `minimal-delegated-apply`.

## Mini-SDD and Minimal Delegated Apply

Use mini-SDD for approved, taskable implementation that is too broad or risk-bearing for comfortable inline/simple TDD but too clear and bounded for full PRD/proposal/spec/design/tasks.

Minimal delegated apply is the tracker-backed or mechanical variant of mini-SDD.

### Preconditions

- The user explicitly approved implementation of a named slice or batch.
- Expected behavior is already designed, obvious from existing patterns, or captured in the task packet.
- Acceptance criteria, security applicability, and validation commands are explicit.
- No new product behavior, external contract, persistence model, security policy, or architecture decision is being invented.
- For minimal delegated apply specifically, a tracker/checklist exists in the repo or conversation and is cited by path or embedded in the prompt.

### OpenSpec Persistence

Mini-SDD and minimal delegated apply are OpenSpec-backed by default, without requiring the full formal proposal/spec/design/task sequence.

Use `artifact_store: openspec` unless the user explicitly requests `hybrid`. Do not use `artifact_store: none` for mini-SDD. Create or update a lightweight change folder:

- `openspec/changes/<change>/metadata.yaml` — slice metadata, approval state, allowed/forbidden surfaces, validation expectations, and PRD/SDD mode notes.
- `openspec/changes/<change>/mini-task-packet.md` — orchestrator-authored task packet and acceptance criteria.
- `openspec/changes/<change>/implementation-map.md` — operational handoff for touched files/symbols/validation commands when useful.
- `openspec/changes/<change>/apply-progress.md` — apply output and validations.
- `openspec/changes/<change>/verify-report.md` — lighter mini-SDD verification report.

### Task Packet Required from the Orchestrator

- `mini_sdd: true` or `minimal_apply: true`
- `artifact_store: openspec` or explicitly approved `hybrid`
- change or slice name and OpenSpec change slug
- metadata path and mini-task-packet path
- tracker/checklist path or embedded checklist when applicable
- allowed files or surfaces and forbidden files or surfaces
- exact task slice or range
- acceptance criteria
- security/privacy/auth/data applicability and any forbidden security-sensitive surfaces
- strict TDD expectations, or the user-selected validation strategy when no test framework exists
- validation commands
- selected skills and applicability notes
- local code inspection instructions requiring code-research tools first for source-code symbols, references, impact, and call flow, with any allowed fallback reason explicitly stated
- expected return envelope

### Rules

- Do not run the full formal SDD sequence solely because mini-SDD uses OpenSpec persistence.
- Do create/update the lightweight OpenSpec artifacts listed above for mini-SDD and minimal delegated apply.
- If no test framework exists for code changes, stop before implementation and ask the user which validation strategy to use; if the user does not know, present options with pros and cons and wait for a choice.
- Local workspace source-code lookup must use code-research tools first; `bash` search is allowed only for non-code surfaces, validation/file inventory, or an explicit fallback reason.
- If the subagent discovers an unresolved design, product, security, privacy, or API decision, it must stop and return `blocked`.
- After `sdd-apply` returns `success` or `partial`, the default next phase is `sdd-verify`.
- Mini-SDD verification is mandatory unless the user explicitly waives it; it is lighter than full SDD verification and checks the task packet, changed files, security applicability, and validation evidence.
- The orchestrator remains responsible for the final review, memory checkpoint, and any commit decision.
