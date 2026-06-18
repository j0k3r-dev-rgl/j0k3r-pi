# Mini-SDD Companion

Load this companion when the selected route is `mini-sdd` or `minimal-delegated-apply`.

## Mini-SDD and Minimal Delegated Apply

Use mini-SDD for approved, taskable implementation that is too broad or risk-bearing for comfortable inline/simple TDD but too clear and bounded for full PRD/proposal/spec/design/tasks.

Minimal delegated apply is the tracker-backed or mechanical variant of mini-SDD.

### Preconditions

- The user explicitly approved implementation of a named slice or batch.
- Expected behavior is already designed, obvious from existing patterns, or captured in the task packet.
- Acceptance criteria and validation commands are explicit.
- No new product behavior, external contract, persistence model, security policy, or architecture decision is being invented.
- For minimal delegated apply specifically, a tracker/checklist exists in the repo or conversation and is cited by path or embedded in the prompt.

### Task Packet Required from the Orchestrator

- `mini_sdd: true` or `minimal_apply: true`
- change or slice name
- tracker/checklist path or embedded checklist when applicable
- allowed files or surfaces and forbidden files or surfaces
- exact task slice or range
- acceptance criteria
- strict TDD expectations or a reason tests are not needed for docs-only or mechanical edits
- validation commands
- selected skills and applicability notes
- expected return envelope

### Rules

- Do not create OpenSpec artifacts solely for mini-SDD or minimal delegated apply.
- Use `artifact_store: none` unless the task packet explicitly asks for a lightweight progress file.
- If the subagent discovers an unresolved design, product, security, or API decision, it must stop and return `blocked`.
- After `sdd-apply` returns `success` or `partial`, the default next phase is `sdd-verify`.
- The orchestrator may skip verification only when the user explicitly waives it or the task packet is docs-only and the orchestrator performs an explicit review checklist.
- The orchestrator remains responsible for the final review, memory checkpoint, and any commit decision.
