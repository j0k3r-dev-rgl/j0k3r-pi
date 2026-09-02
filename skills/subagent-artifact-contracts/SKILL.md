---
name: subagent-artifact-contracts
description: "define canonical Markdown artifact and handoff formats for Pi subagents, including OpenSpec SDD artifacts, PRD artifacts, Execution Scope, Workflow Status, and READY/BLOCKED output rules."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
registry:
  category: "workflow"
  domains: "subagents, markdown-artifacts, openspec, handoff-contracts, execution-scope"
  paths: "subagents/**/*.md, openspec/changes/**/*.md, openspec/archive/**/*.md, skills/subagent-artifact-contracts/SKILL.md, skills/sdd-workflow/SKILL.md, AGENTS.md"
  keywords: "subagent artifact contract, compact handoff, handoff format, artifact path, next action, workflow status, execution scope, mini-sdd, apply.md, verify.md, tasks.md"
  phases: "explore, proposal, spec, design, task, apply, verify, archive"
  related: "sdd-workflow, skill-authoring"
  priority: 94
---

# Subagent Artifact Contracts

## Activation Contract

Use this skill before any subagent creates, updates, validates, or returns `READY` for a Markdown artifact or handoff governed by Pi workflow contracts.

Use it when editing subagent definitions that mention artifact formats, handoff formats, `Workflow Status`, `Execution Scope`, or OpenSpec SDD artifacts.

## Canonical Scope

This skill owns:

- canonical Markdown blocks shared by subagents;
- generated artifact section order and required parseable fields;
- the exact handoff block returned by subagents;
- the exact `Execution Scope` block consumed by workflow tooling; and
- READY/BLOCKED consistency rules for artifacts and handoffs.

It does not own:

- workflow routing or phase advancement;
- product, architecture, or implementation decisions;
- tool runtime parsing implementation; or
- repository-specific validation commands beyond preserving exact commands supplied by authority artifacts.

## Hard Rules

- Use English for reusable artifacts and all subagent handoffs.
- Do not duplicate these templates in subagent definitions; reference this skill instead.
- Do not invent labels, reorder required status fields, or use placeholders in `READY` artifacts.
- A `READY` artifact must contain concrete paths, commands, IDs, and evidence required by its artifact type.
- If required content is missing, contradictory, placeholder-based, or outside scope, write or return `BLOCKED` instead of guessing.
- Handoff status must match the produced artifact status when an artifact exists.
- Artifact-producing workflow subagents must write only their assigned artifact unless this contract explicitly grants an exception.
- `sdd-apply` is the only SDD subagent allowed to modify implementation files, and only inside the approved `Execution Scope`; it also writes `apply.md`.
- `sdd-archive` does not create Markdown artifacts; it only moves the verified change tree to the approved archive destination.
- Successful SDD and Mini-SDD handoffs must be compact: status, generated artifact path, and next action only.
- Do not repeat artifact content, edited files, scanned files, validation matrices, or implementation details in a successful handoff; the orchestrator reads the generated `.md`.
- Parseable values in `Execution Scope` must be plain text: no Markdown code spans, quotes, bullets with alternative labels, or placeholder wrappers.
- Markdown code fences are allowed for documentation examples only, not for actual parseable values in generated workflow artifacts.

## Execution Steps

1. Identify the artifact or handoff type to produce.
2. Read the authority artifacts and assigned skills named in the delegated prompt.
3. Apply the shared blocks exactly.
4. Apply the artifact-specific section order exactly.
5. Before returning `READY`, check that required sections, IDs, paths, commands, evidence, and next action are concrete and parseable.
6. Return the canonical handoff exactly.

## Output Contract

Return:

- Skill applied: `subagent-artifact-contracts`.
- Artifact or handoff type governed.
- Contract template applied.
- Any missing required content that forced `BLOCKED`, or `None`.

## Shared Blocks

### Workflow Status

Every governed artifact must start with this exact block:

```markdown
## Workflow Status
- Status: READY | BLOCKED
- Blockers: None | <specific unresolved decision, missing evidence, or dependency>
```

Rules:

- `READY` requires `Blockers: None`.
- `BLOCKED` requires a specific blocker.
- Do not add text before `## Workflow Status`.

### Execution Scope

`mini-sdd.md` and `tasks.md` must include this exact parseable block before implementation can proceed:

```markdown
## Execution Scope
- Root: /absolute/workspace/root
- Allowed Paths:
  - relative/or/absolute/path/**
- Writable Paths:
  - relative/or/absolute/path/**
- Allowed Bash:
  - exact command
- Notes: plain text note
```

Rules for actual generated artifacts:

- `Root` must be the absolute workspace root.
- `Allowed Paths`, `Writable Paths`, and `Allowed Bash` must contain at least one concrete item.
- Values must be plain text, not wrapped in backticks or quotes.
- Use only the labels shown above.
- Do not use alternatives such as `Proposed implementation paths`, `Commands`, `Validation Commands`, or `Scope paths`.
- `Notes` must be present and must describe the intended boundary in plain text.

### Handoff

Every workflow-relevant subagent result must return exactly this block and nothing after it:

```markdown
## Handoff
- Status: READY | BLOCKED | FAILED
- Artifact: <generated artifact path, archive destination, or “None”>
- Blockers: None | <one concise blocker>
- Next action: <one permitted next action or “None”>
```

Rules:

- For `READY`, keep the handoff minimal: artifact path, `Blockers: None`, and one next action.
- For `READY`, do not list edited files, scanned files, checks, matrices, summaries, or artifact contents.
- For `READY`, validation evidence belongs inside the generated artifact, not in the handoff.
- For `BLOCKED`, include one concise blocker and the one next permitted action.
- For `FAILED`, include one concise failure reason and the one next permitted action or `None`.
- If multiple blockers exist, write the detailed list in the artifact when possible and put only the primary blocker in the handoff.
- Return one next action only.

## Evidence-First File Access

- Treat delegated paths as the allowed boundary, not proof that every listed file exists.
- Read only paths confirmed by the delegation, an existing artifact, directory evidence, or a successful symbol/reference lookup.
- Never invent likely filenames or split a confirmed module into assumed files.
- Before reading an inferred path, confirm it exists with an approved lookup.
- Interpret `ENOENT` as `NOT_FOUND`, not as a permission failure.
- After a path is confirmed missing, do not retry guessed variants; continue from confirmed files or return a concise `BLOCKED` handoff.
- Prefer the confirmed parent/module over conventional but unverified files.
- Keep failed-path details out of a successful handoff; record them in the artifact only when relevant to the phase evidence.

## Artifact Templates

### `prd.md`

Sections after `Workflow Status`:

1. Product Goal & User Value
2. User Stories & Functional Requirements
3. Acceptance Scenarios
4. Out of Scope
5. Open Questions

### `explore.md`

Use durable evidence items only:

```markdown
### EVID-001: <short finding>
- Source: <path, symbol, URL, or delegated evidence>
- Fact: <confirmed fact>
- Relevance: <affected decision>
- Confidence: HIGH | MEDIUM | LOW
```

Then include only when applicable:

1. Constraints
2. Unknowns & Required Decisions
3. Assigned Skills

### `proposal.md`

Sections after `Workflow Status`:

1. Change Intent
2. `DELTA-###` items with Kind, Canonical sources, Evidence, Outcome
3. Scope & Non-Goals
4. Risks & Compatibility
5. Open Decisions
6. Assigned Skills & Constraints

### `spec.md`

Sections after `Workflow Status`:

1. `REQ-###` items
2. `SCENARIO-###` items
3. Schemas & Interfaces when required
4. Compatibility & Migration Requirements when required
5. Out of Scope
6. Open Decisions
7. Assigned Skills & Constraints

### `design.md`

Sections after `Workflow Status`:

1. `DES-###` items
2. Control & Data Flow
3. Error, State & Compatibility Strategy
4. Skill Constraints Applied
5. Open Decisions & Risks

### `tasks.md`

Sections after `Workflow Status`:

1. Scope & Inputs
2. Execution Scope
3. `TASK-###` checklist items with Status, Implements, Verifies, Paths, Depends on, Evidence
4. Skill-Guided Constraints mapped to tasks
5. Delivery and Review Forecast
6. Just-in-Time Delivery Plan only when already triggered
7. Open Decisions
8. Next Permitted Action

Every `REQ-###` and every `SCENARIO-###` must be covered before `READY`. Each `TASK-###` must name the exact upstream IDs it implements and verifies; no orphan requirement or scenario may remain.

### `mini-sdd.md`

Sections after `Workflow Status`:

1. Goal
2. Scope & Exclusions
3. Execution Scope
4. `MINI-###` items with Contract, Acceptance, Canonical sources, Paths, Validation, Depends on
5. Risks & Constraints
6. Open Decisions
7. Next Permitted Action

Every `MINI-###` item must have acceptance, paths, validation, and dependencies before `READY`.

### `apply.md`

Sections after `Workflow Status`:

1. Workflow & Contracts
2. Authorization Record
3. One evidence record per `MINI-###` or `TASK-###`
4. Approved Deviations
5. Attempt Record
6. Candidate Identity
7. Residual Risks
8. Verification Inputs
9. Next Permitted Action

`Authorization Record` must include who authorized apply, when or by which session/message reference, authorized action, authorized scope, authority artifact, and candidate/change slug. `READY` means implementation is complete and independently verifiable.

### `verify.md`

Sections after `Workflow Status`:

1. Verification Result
2. Contracts & Candidate Reviewed
3. Evidence Matrix
4. Acceptance Coverage
5. Implementation Evidence Review
6. Issues & Required User Decision
7. Skill Compliance
8. Post-Verification Continuity Snapshot

Only `Verification Result: PASS` may produce artifact and handoff `READY`. For Formal SDD, PASS requires evidence for every `REQ-###` and every `SCENARIO-###` from `spec.md`, linked through `TASK-###` and `apply.md` evidence where applicable; for Mini-SDD, PASS requires evidence for every `MINI-###` from `mini-sdd.md`.

## References

- `AGENTS.md` — global delegation and authority rules.
- `skills/sdd-workflow/SKILL.md` — SDD lifecycle and phase gates.
- `subagents/*.md` — subagent definitions that consume these contracts.
