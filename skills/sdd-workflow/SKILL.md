---
name: sdd-workflow
description: "run an authorized Mini-SDD or Formal SDD workflow for a software change. Use when creating or advancing OpenSpec artifacts, enforcing phase gates, or coordinating apply, verify, and archive."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "14.0"
registry:
  category: "workflow"
  domains: "openspec, mini-sdd, formal-sdd, artifact-lifecycle"
  paths: "openspec/changes/**/*.md, openspec/archive/**/*.md, subagents/sdd-*.md, subagents/prd-review.md, skills/sdd-workflow/SKILL.md"
  keywords: "mini-sdd, formal sdd, openspec change, sdd phase, apply.md, verify.md, archive workflow"
  phases: "explore, proposal, spec, design, task, apply, verify, archive"
  related: "workflow-triage, tdd"
  priority: 92
---

# OpenSpec SDD Workflow

## Activation Contract

Use this skill only after workflow selection when the active workflow is Mini-SDD or Formal SDD, or when the user asks about an existing OpenSpec change.

Do not use it to choose the workflow.

## Canonical Scope

This skill owns:

- the SDD artifact map;
- one-phase-at-a-time lifecycle rules;
- the required `Workflow Status` block;
- pre-apply, verify, and archive gates; and
- structural checks between phases.

Global authorization, delegation, and validation policy live in `AGENTS.md`.

## Shared Artifact Rule

Every SDD artifact starts with:

```markdown
## Workflow Status
- Status: READY | BLOCKED
- Blockers: None | <specific unresolved decisions or dependencies>
```

`READY` means the next phase can proceed without guessing. `BLOCKED` stops advancement.

## Mini-SDD Lifecycle

Files under `openspec/changes/<change-slug>/`:

- optional `prd.md`
- `mini-sdd.md`
- `apply.md`
- `verify.md`

Rules:

1. `mini-sdd.md` is the implementation contract.
2. The orchestrator checks it before apply.
3. `sdd-apply` requires an implementation summary plus explicit user authorization.
4. `sdd-verify` independently verifies every `MINI-###` item.
5. `sdd-archive` requires passing verification plus explicit user authorization.

### Mini-SDD contract shape

Each approved outcome is one `MINI-###` item with:

- Contract
- Acceptance
- Canonical sources
- Paths
- Validation
- Depends on

## Formal SDD Lifecycle

Files under `openspec/changes/<change-slug>/`:

- optional `prd.md`
- optional `explore.md`
- `proposal.md`
- `spec.md`
- `design.md`
- `tasks.md`
- `apply.md`
- `verify.md`

Rules:

1. `proposal.md` defines `DELTA-###` only.
2. `spec.md` defines `REQ-###` and `SCENARIO-###` only.
3. `design.md` defines `DES-###` only.
4. `tasks.md` defines `TASK-###` only.
5. `sdd-apply` requires an implementation summary plus explicit user authorization.
6. `sdd-verify` independently verifies requirements from `spec.md`.
7. `sdd-archive` requires passing verification plus explicit user authorization.

## Structural Gate

Before advancing, the orchestrator checks:

1. valid `Workflow Status`;
2. required sections for the current artifact;
3. unique and correctly formatted IDs;
4. references resolving to upstream IDs;
5. complete coverage before apply;
6. complete evidence rows before a verify pass.

## Hard Rules

- Use exactly one active phase at a time.
- Do not advance from a `BLOCKED` artifact.
- Do not restate upstream artifacts; reference IDs instead.
- Use `discovery` only for approved unknown research.
- Use `sdd-explore` only when discovery needs a durable synthesis artifact.
- Read only exact assigned skills; subagents do not scan `skills/`.
- `apply.md` records implementation evidence only.
- `verify.md` records independent verification evidence only.
- Archive moves the complete finished tree to `openspec/archive/YYYY-MM-DD/<change-slug>/`.

## Execution Steps

1. Create or update the next owned artifact only.
2. Run the structural gate.
3. Stop on `BLOCKED` and ask the user only for the missing decision.
4. Before apply, summarize planned implementation, scope, exclusions, validation, and risks.
5. Delegate apply only after explicit authorization.
6. Delegate verify independently.
7. Ask for archive authorization only after passing verification.

## Output Contract

Return:

- active workflow: Mini-SDD or Formal SDD;
- current phase;
- artifact(s) read or written;
- structural-gate result;
- blocker status; and
- next permitted phase.

## References

- `AGENTS.md`
- `subagents/prd-review.md`
- `subagents/sdd-explore.md`
- `subagents/sdd-proposal.md`
- `subagents/sdd-spec.md`
- `subagents/sdd-design.md`
- `subagents/sdd-task.md`
- `subagents/sdd-apply.md`
- `subagents/sdd-verify.md`
- `subagents/sdd-archive.md`
