---
name: subagent-artifact-contracts
description: "define canonical discovery and Planned Workflow Markdown artifacts. Use when delegating to subagents, formatting discovery.md, plan.md, apply.md, or verify.md, defining Execution Scope boundaries, or producing compact READY/BLOCKED handoffs."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "2.4"
registry:
  category: "workflow"
  domains: "subagents, markdown-artifacts, openspec, handoff-contracts, execution-scope"
  paths: "subagents/**/*.md, openspec/changes/**/*.md, openspec/archive/**/*.md, skills/subagent-artifact-contracts/SKILL.md, skills/work-workflow/SKILL.md, AGENTS.md"
  keywords: "subagent artifact contract, compact handoff, handoff format, discovery.md, artifact path, next action, workflow status, execution scope, planned-workflow, apply.md, verify.md"
  phases: "apply, verify, archive"
  related: "work-workflow, skill-authoring"
  priority: 94
---

# Subagent Artifact Contracts

## Activation Contract

Use before producing or validating a governed Markdown artifact/handoff, or when editing definitions that consume these contracts.

## Canonical Scope

Own artifact structure, status, execution-scope fields, evidence, and handoffs. Routing, authorization, and phase advancement remain in `AGENTS.md` and `work-workflow`.

## Hard Rules

- Use English for reusable workflow artifacts and all handoffs. Research/news reports follow their explicitly assigned language.
- Reference these templates rather than copying them into agent definitions.
- `READY` requires concrete paths, IDs, evidence and commands required by the artifact; no placeholders or invented authority.
- **Circuit Breaker**: Missing material evidence, unresolved decisions, scope ambiguities, or required choices stop dependent work immediately. If `ask_orchestrator` is available, ask the exact question and wait in the same session; otherwise, or if the response does not resolve the blocker, return `BLOCKED`. Resume only within supplied authority; never guess, invent requirements, or treat a factual answer as new implementation/configuration permission. Actual failed/unexecuted required checks remain blockers until resolved.
- Each artifact-producing agent writes only its assigned artifact. `02-apply` additionally edits authorized implementation paths. Archive belongs to the orchestrator, not a subagent; its safety checks live in `work-workflow`.
- Discovery leaves project files unchanged except for its exact assigned `discovery.md` and creation of that artifact's parent directory.
- Artifact status and handoff status must agree. Successful handoffs contain no repeated evidence, file inventories, or summaries.
- `Configuration Lock` and Git authorization still apply even when a path appears in Execution Scope.

## Execution Steps

1. Read the exact authority artifacts and skills assigned by the delegation.
2. Confirm the output path and approved write boundary before mutation.
3. Apply the shared blocks and artifact-specific sections below.
4. Validate concrete evidence, scope, IDs, and status before returning.
5. Return only the canonical Handoff block.

## Output Contract

Delegated artifact-producing results return only the Handoff block below; do not append a skill-use report. Reviews of this contract itself use an ordinary concise review response.

## Shared Blocks

### Workflow Status

Every governed workflow artifact starts with this block, with no preceding text:

```markdown
## Workflow Status
- Status: READY | BLOCKED
- Blockers: None | <specific blocker>
```

`READY` requires `Blockers: None`. `BLOCKED` names the missing evidence, authority, or material decision.

### Execution Scope

`plan.md` includes this block before implementation:

```markdown
## Execution Scope
- Root: /absolute/workspace/root
- Allowed Paths:
  - /absolute/workspace/root/module/**
- Writable Paths:
  - /absolute/workspace/root/module/**
- Allowed Bash:
  - exact authorized command
- Notes: plain text boundary
```

- Keep exact labels; actual values are plain text, without code spans, quotes, or placeholder wrappers.
- Root is absolute. Keep Allowed Paths and Writable Paths as the stable labels, but express implementation scope as directory roots (with /** for the whole subtree), not predicted file inventories.
- Choose the narrowest common parent that covers the approved work. For example, module/controllers, module/services, and module/tests become module/**. Do not list children already covered by a parent.
- Explicit user restrictions to particular files or narrower paths take precedence over parent consolidation; never broaden them for brevity.
- Prefer one work area; use multiple roots only for genuinely separate areas. Do not silently broaden to the repository root when that materially exceeds the approved boundary; ask for clarification instead.
- Allowed Paths covers read access, including the writable work area and only necessary additional read-only roots. Writable Paths is the smaller modification boundary. Required artifacts and assigned skills remain exact, separately authorized inputs/outputs.
- The subagent selects files to inspect, create, edit, or delete within that boundary as needed for the approved behavior. Directory access does not authorize unrelated cleanup, configuration changes, or destructive work outside the goal. Stop and request expansion before leaving the boundary.
- Allowed Bash contains exact authorized commands, or the sole item `None` when no shell commands are permitted. `None` is not executable.
- Notes describe exclusions and constraints; writable configuration paths still require explicit configuration authorization.
- This is an authorization contract, not a claim that every tool is technically sandboxed.

### Handoff

Every governed delegated result returns exactly:

```markdown
## Handoff
- Status: READY | BLOCKED | FAILED
- Artifact: <exact artifact path or None>
- Blockers: None | <one concise blocker or failure>
- Next action: <one permitted action or None>
```

No text follows this block. Evidence belongs inside the artifact. If required output authority remains missing after the Circuit Breaker question/fallback, return `BLOCKED` with `Artifact: None`; do not invent a path. If multiple blockers exist, detail them in the artifact when possible and name the primary one here.

## Evidence-First File Access

- Scope paths are boundaries, not proof that files exist. Confirm inferred paths before reading.
- Treat `ENOENT` as `NOT_FOUND`; do not retry guessed filename variants.
- Use concrete file/line, symbol, command, revision, or source references. Distinguish observed facts from inference.
- Keep raw secrets, credentials, and unrelated private data out of artifacts.

## Artifact Templates

### `discovery.md`

The orchestrator assigns an exact absolute `openspec/changes/<change-slug>/discovery.md` path before delegation. Reuse the active change directory; otherwise assign a bounded topic slug. Do not overwrite another investigation. Update an existing discovery only when assigned to that same investigation; preserve stable evidence IDs and mark superseded findings.

Sections after Workflow Status:

1. Question & Scope — question, approved directory roots, exclusions, and inspected revision/date when available. Use the same parent consolidation rule; select relevant files during investigation, not in a preassigned inventory.
2. Findings — evidence items below.
3. Unknowns & Limits — unresolved facts, confidence limitations, graph/fallback limits when applicable.
4. Recommended Next Action — one recommendation, not an authorization.

```markdown
### EVID-001: <finding>
- Source: <exact file/line, symbol, command, or source locator>
- Fact: <observed fact; label inference explicitly>
- Relevance: <why this answers the question>
- Confidence: HIGH | MEDIUM | LOW
```

`READY` means the bounded investigation is complete and consumable, not that implementation is approved. Material missing evidence needed to answer the question means `BLOCKED`. Investigation-only work may stop here; do not create other workflow artifacts automatically.

### `plan.md`

Sections after Workflow Status:

1. Goal
2. Scope & Exclusions
3. Execution Scope
4. `MINI-###` items with Contract, Acceptance, Canonical sources, Validation, Depends on
5. Parallel Units (optional) — only when two or more independent MINI groups touch disjoint directories
6. Risks & Constraints
7. Open Decisions
8. Next Permitted Action

Parallel Units, when present, is one bullet per unit: `UNIT-A: MINI-001, MINI-002 | Writable: /abs/root/module-a/**`. Writable roots must be disjoint between units and inside Execution Scope Writable Paths; no MINI in one unit may depend on a MINI in another. Shared files (lockfiles, barrels, shared config, common test setup) belong to exactly one unit or keep the change sequential. Add one integrated validation command run after all units finish. Omit the section when work is not cleanly separable; never split only to create parallelism.

Resolve material product questions with the user; record approved decisions in the relevant contract item and unresolved questions under Open Decisions. Missing material decisions make the plan BLOCKED, not permission to invent acceptance or introduce another review phase. Existing product documents may be cited as inputs, never required solely to replace a removed phase.

Every item has concrete acceptance, validation, and dependencies (`None` when absent). Define tests and regression checks, not TDD-history deliverables; `AGENTS.md` owns the method-versus-reporting rule. Execution Scope owns the directory boundary once; do not require per-item file lists or repeat directory inventories. File/symbol references may be evidence or explicit user constraints, not an obligatory implementation prescription. Reference `discovery.md` evidence IDs directly when available. Include only technical decisions necessary to implement; do not recreate a multi-document specification lifecycle inside this file. Split or clarify excessive scope with the user.

### `apply.md`

Sections after Workflow Status:

1. Workflow & Authorization — change slug, authority plan, and who approved the action/scope with a time or message reference.
2. Implementation Summary — concise implemented outcome and covered `MINI-###` IDs; list actual created/modified/deleted files once.
3. Final Validation — commands actually run, aggregate outcomes including failures/skips, and required checks still pending with their assigned phase/owner.
4. Deviations & Residual Risks — only actual deviations, unresolved risks, or blockers; `None` when absent.
5. Candidate Identity — base revision and current candidate identity needed to verify the implementation.
6. Next Permitted Action

Keep the artifact compact. With Parallel Units, each worker writes its own `apply-<UNIT-ID>.md` with the same sections, covering only its unit; it never writes another unit's artifact or files. Do not create per-scenario implementation evidence matrices, TDD-cycle histories, raw logs, transcript excerpts, or routine attempt records. Reference existing test reports only when needed to explain a failure or limitation. Acceptance-level proof belongs to independent `verify.md` and, where required, the live acceptance artifact—not a second copy in apply.

`READY` means the approved implementation is complete and the required apply-phase validation has passed, so the candidate can enter acceptance/verification; it is not final delivery approval or a claim that later HTTP/independent verification already passed. Missing TDD history is not a blocker under `AGENTS.md`. Actual defects, unmet implementation acceptance, and failed/unexecuted required apply checks remain blockers. Previously written artifacts remain consumable without a formatting-only rewrite.

### `verify.md`

Sections after Workflow Status:

1. Verification Result
2. Contracts & Candidate Reviewed
3. Evidence Matrix — one row per `MINI-###`, acceptance checks, evidence, PASS or issue
4. Acceptance Coverage — gaps or exceptions only; otherwise reference the matrix
5. Implementation & Final Validation Review — validation outcome and discrepancies, not copied acceptance proof
6. Issues & Required User Decision
7. Applicable Code & Scope Compliance — relevant scope findings only
8. Post-Verification Continuity Snapshot

Only `Verification Result: PASS` can produce READY. Independently verify every `MINI-###` against `plan.md` using current code, tests, and applicable live acceptance; do not rely only on apply's claims. Review final validation and relevant code/scope compliance, not the implementer's TDD chronology or whether it was recorded. Any incomplete/failed required functional check blocks advancement. The evidence matrix owns acceptance proof; do not duplicate it in the remaining sections.

The continuity snapshot records exact verified deliverables, excluding the verification artifact itself and unrelated files. For new snapshots, use this deterministic encoding:

- Each record is a three-string array `[absolutePath, state, hash]`: normalized absolute path, `present` with lowercase SHA-256 of raw file bytes, or `absent` with an empty hash for a required deletion. Reject duplicate paths, unreadable files, directories, and unexpected symlinks; absence means ENOENT, not any read error. If a symlink is an approved deliverable, define its explicit identity/encoding before verification rather than silently hashing its target.
- Sort by `absolutePath` using JavaScript string comparison (`a < b`, not locale-dependent sorting). The aggregate is SHA-256 of the UTF-8 bytes of `JSON.stringify(sortedRecords)`, with no indentation, BOM, or trailing newline. Include the records and aggregate once; counts are derived, not separately maintained evidence.
- Include the complete read-only command actually executed, with concrete deliverable paths and all calculation code (or an existing versioned script plus its exact invocation). It must reproduce every record and the aggregate without parsing prose, ellipses, omitted code, or locale assumptions. Rerun that same command immediately before archive/delivery; any record/aggregate drift invalidates continuity and blocks that boundary.

Preserve historical snapshots and their recorded encoding; do not rewrite or reverify them solely to adopt this format. If their original calculation cannot safely be reproduced, report the missing evidence and stop at the continuity boundary. A matching snapshot is not functional acceptance. If safe snapshot evidence cannot be obtained, return BLOCKED.

## References

- `~/.pi/agent/AGENTS.md` — authorization and delegation.
- `~/.pi/agent/skills/work-workflow/SKILL.md` — lifecycle.
- `~/.pi/agent/subagents/` — consuming agent definitions.
