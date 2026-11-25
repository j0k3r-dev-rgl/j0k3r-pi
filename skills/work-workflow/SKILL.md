---
name: work-workflow
description: "Run authorized Planned Workflow lifecycle with lightweight contracts. Trigger: multi-step implementation, complex changes, or bounded delegation across workers and verifiers."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "17.0"
registry:
  category: "workflow"
  domains: "openspec, planned-workflow, artifact-lifecycle"
  paths: "openspec/changes/**/*.md, openspec/archive/**/*.md, subagents/0*.md, skills/work-workflow/SKILL.md"
  keywords: "planned-workflow, openspec change, discovery.md, plan.md, apply.md, verify.md, archive workflow"
  phases: "apply, verify, archive"
  related: "workflow-triage, tdd"
  priority: 92
---

# Planned Workflow

## Activation Contract

Use after Planned Workflow selection or to inspect an existing lightweight change. Explicit no-delegation authorization selects Direct Orchestrator instead; this skill must not reintroduce delegated phases under that override.

## Canonical Scope

Own the lightweight lifecycle, phase gates, independent verification, and archive. `AGENTS.md` owns authorization and scope; `subagent-artifact-contracts` owns artifact and handoff formats.

## Hard Rules

- Keep one coherent contract, not a bundle of proposal/specification/design/task documents.
- Reuse prior research under the authorization and fast-path rules in `AGENTS.md` and `workflow-triage`; do not repeat discovery. Evidence does not authorize implementation or phase advancement.
- Use `openspec/changes/<change-slug>/` with optional `discovery.md`, `plan.md`, `apply.md`, and `verify.md`. New Planned changes also use the lightweight `flow.json` receipt described below; Markdown remains the contract. Resolve material product questions with the user before marking the plan READY; record decisions or blockers in plan.md, without a separate PRD artifact or review phase.
- Local discovery writes only its assigned `discovery.md`; reuse its evidence IDs directly. Discovery may be the final deliverable of an investigation-only request.
- Keep one phase active at a time. Delegate contract creation to `01-planning`, implementation to `02-apply`, verification independently to `03-verify`. Never overlap implementation edits with verification of that candidate. The orchestrator performs archive directly after user approval; archive is not a delegated phase.
- **Concurrent validation checks**: After their prerequisite candidate is fixed, independent checks may overlap only when dependencies are absent and isolation is established: no shared mutable ports, databases, fixtures, files, caches, or other resources; no candidate mutation or checker conflicts. Use sequential checks when isolation or side effects are unknown. Failed/missing prerequisites stop dependent work and prevent final PASS; preserve usable independent results with their actual status. This is not cross-phase execution, a new runtime capability, or provider retry permission. Do not manufacture Parallel Units for shared canonical files or assign a verifier per check/unit; retain one final independent `03-verify` over the complete candidate and MINI set after prerequisite results are available.
- **Context-aware Parallel Apply**: Planning explicitly assesses useful parallel implementation using project evidence and user decisions, not a fixed stack or backend/frontend template. Execute independent units concurrently whenever useful and safe unless the user prohibited it; otherwise record the concrete impediment. Before planning/dispatching parallel apply, read `references/parallel-apply.md`: it owns project-resident modular contracts, optional Preparation → Parallel Units → Integration within apply, exact-file/multi-root ownership, fan-in and live-question handling. No new phase, skill, sibling messaging or architecture rewrite is implied. Omit `mode` unless explicitly requested; never force background. Workers receive inherited user decisions and their bounded unit/stage, not blanket writable access. Never invent units outside the plan.
- **Parallel Discovery Fan-Out**: When pre-implementation questions are independent, launch several `00-discovery` workers concurrently, each with its own bounded question, `discovery-<topic>.md` path and disjoint EVID ID range; read all before planning. Evidence references must resolve unambiguously across those artifacts.
- Assign `skills/anti-overengineering/SKILL.md` alongside artifact contracts when delegating `01-planning` and `02-apply` to enforce simplest-sufficient design and implementation; do not assign it to `00-discovery` or `03-verify`.
- Assign `skills/tdd/SKILL.md` in Assigned skills when delegating `02-apply` for code/test changes, and to `01-planning` when defining validation strategy.
- Resolve and assign project-specific skills (from `.pi/skills/`, `.agents/skills/`, or `skill_registry_resolve`) in Assigned skills for delegated subagents whenever the task touches project code or domain logic. For non-trivial business rules or domain boundaries, resolve `domain-driven-design`; reuse project vocabulary and record only necessary domain decisions in plan.md. Do not impose DDD or domain documents on CRUD, infrastructure, UI-only, or mechanical work.
- If a required subagent is unavailable, stop as `BLOCKED`; do not silently take over.
- **Circuit Breaker**: Stop dependent execution and phase advancement on a material unresolved decision. Subagents use the live-question/fallback rule in the assigned artifact contract; the orchestrator answers facts and approved decisions, and asks the user for unmade product/scope/architecture decisions under `AGENTS.md`. A factual answer is not new authority. Provider/tool and task failures follow AGENTS.md's failure/recovery rule; preserve partial work, report uncertainty, and do not advance dependent phases or relaunch without applicable consent.
- The orchestrator supplies exact absolute artifact and skill paths, reads each returned artifact, and checks required fields before advancing. Do not assume lean subagents inherit global context.
- Follow AGENTS.md's compact seven-field delegation contract: reference existing artifact sections instead of repeating them, write each exact path once, and transmit only new decisions/context. Summarize applicable scope, Configuration Lock, Git limits, and user decisions not available in assigned contracts. Writable paths are not permission to make incidental configuration changes.
- **Pre-Mutation Summary Gate**: Before apply or any orchestrator mutation, read the ready plan and summarize exact mutation targets, planned changes, exclusions, validation, and risks. Reuse explicit user implementation authorization when still applicable to the action, scope, authority artifact, and candidate/change; obtain it only when absent or no longer applicable. Record the author and time/message reference in delegation/apply evidence. Artifacts, READY, findings, factual answers, cited inputs, and passing checks do not grant implementation authorization; advice/research-only requests stop before apply. Scope growth or new material decisions require a question; Configuration Lock, separate commit/push authorization, explicit archive approval, and provider-continuation consent remain intact.
- Verify every `MINI-###` independently against current behavior and applicable code/scope constraints. Follow `AGENTS.md`'s TDD method-versus-reporting rule and the compact artifact contract; do not introduce a TDD-history review gate. Failed required verification stops advancement; return to apply only with applicable authorization and an explicit remediation next action.
- Archive only after passing verification, unchanged candidate evidence, and explicit user archive authorization. Move the complete tree to `openspec/archive/YYYY-MM-DD/<change-slug>/` without overwriting a destination.
- Preserve historical artifacts. Do not convert or delete old changes automatically; if asked to resume an incompatible historical contract, agree a bounded Planned Workflow contract before implementation.

## Execution Steps

1. Resolve the exact change directory and next permitted action from approved context.
2. If local facts are missing, assign `discovery.md`; read its evidence before planning. Do not duplicate research or add a separate synthesis phase.
3. Delegate a compact `plan.md` with concrete acceptance, directory-based scope, validation, and `MINI-###` items. Pass the user's parallelism/file-organization choices and project context; require a parallelism assessment and assign `references/parallel-apply.md` for potential parallel work. Use the narrowest common parent for sibling areas; do not prescribe files or enumerate its child directories. Narrow excessive scope with the user. For new changes, explicitly authorize `workflow_check` on the assigned absolute change directory with phase plan. Direct `01-planning` to use the artifact contract's syntax example, fix structural errors and recheck within the same invocation, and return READY only after PASS. Workers receive only the read-only tool; `workflow_record` remains orchestrator-only. Explicitly identify historical exemptions rather than migrating old artifacts.
4. Independently run the read-only plan check below for new changes; check status, required sections, unique IDs, evidence references, and parseable Execution Scope. A completed task whose plan fails this check is a task/acceptance failure, not a successful delivery or a reason for an unbounded formatting loop; apply AGENTS.md's existing recovery limits before any continuation. `BLOCKED` stops advancement.
5. Read the ready plan, announce the exact implementation/validation summary, and reuse applicable explicit apply authorization; obtain authorization only if absent or no longer applicable. Record the existing consent and run the apply check below. Capture the Surface Check baseline below before delegation. Delegate `02-apply` with the author/time or message, action, scope, authority artifact, change identity, and exact scope-source path. With `Parallel Units`, one applicable authorization covers the planned preparation, units and integration. Complete declared preparation first, then dispatch every independent unit at once and consume completion notifications without polling. Follow `references/parallel-apply.md` for stage baselines, shared contract identities and safe pauses; decisions absent from worker context must be relayed, not guessed.
6. Read `apply.md` or every declared preparation/unit/integration summary and run the baseline-relative Surface Check below. Perform the planned integration work only after all prerequisite writers settle; its assigned worker runs integrated validation, or the orchestrator does when there is no integration worker. Run the required integrated command once on the joined candidate, not once per unit. An unexplained delta, overlap, contract drift, out-of-surface change, failed prerequisite, or missing baseline blocks verification until resolved. Arrange required live acceptance with its assigned owner, then delegate one independent verification against all MINI items and project contracts; mock-only tests do not prove integration. Do not request formatting-only rewrites or retrospective TDD evidence.
7. Read `verify.md`; require PASS, evidence for every item, and a continuity snapshot before reporting verified completion. Record the independent verification receipt and run the delivery check below. Never claim an independent review for Direct Orchestrator self-validation.
8. Ask for archive authorization only when verification passed. The orchestrator then performs the Archive Safety Checks below directly; do not launch a subagent.

## Executable Checks (New Planned Changes)

Use the globally installed `workflow_check` and `workflow_record` tools; resolve the actual absolute change directory and runtime identities before calling. Examples below show field shapes, not literal placeholder inputs.

```text
workflow_check({ change_dir, phase: "plan" })
workflow_record({ change_dir, action: "authorize", author, reference, plan_sha256 })
workflow_check({ change_dir, phase: "apply" })
# Capture metadata-only pre-apply baseline in flow.json (zero /tmp/ files):
workflow_record({ change_dir, action: "baseline", label })
# After apply, attribute baseline-relative deltas and obtain exact candidate_files:
workflow_check({ change_dir, phase: "surface", baseline_id })
# After Surface Check and integrated validation, include every deliverable/deletion and implementation session:
workflow_record({ change_dir, action: "candidate", executors: [implementation_session], files: [absolute_deliverable] })
workflow_check({ change_dir, phase: "verify" })
# Independent verifier (or pre-archive continuity check) computes canonical continuity snapshot via workflow_check:
workflow_check({ change_dir, phase: "snapshot" })
# After the independent reviewer produces PASS and its continuity snapshot:
workflow_record({ change_dir, action: "verify", executor: verification_session })
workflow_check({ change_dir, phase: "deliver" })
# After explicit user archive approval:
workflow_record({ change_dir, action: "archive", author, reference })
```

Each result names the next permitted action, never executes it automatically. Stop on BLOCKED or tool failure. If a required tool is unavailable, report the blocker instead of silently falling back to long shell commands. The existing scripts/flow-check.mjs CLI remains available for explicit maintenance/automation and shares the extension-owned engine.

- `workflow_check` is read-only and available to the orchestrator and authorized workers (phases: `plan`, `apply`, `verify`, `deliver`, `snapshot`, `surface`). `workflow_record` actions `authorize`, `baseline`, `candidate`, `verify`, and `archive` are orchestrator-only: `authorize`/`baseline`/`candidate`/`verify` atomically update only `flow.json` in the supplied change directory, and `archive` executes all Archive Safety Checks before atomically moving the verified change directory to `openspec/archive/YYYY-MM-DD/<change-slug>/`. Keep `workflow_record` out of worker allowlists. Receipt and archive mutations use the host file-mutation queue and sequential execution; atomic replacement is not a multi-process transaction. They record evidence and execute approved archive moves, never create user consent or perform implementation. Announce these writes under the mutation gate.
- Supply the `plan_sha256` returned by the actual reviewed plan check when recording authorization; a digest mismatch blocks the write. The authorization binds the raw SHA-256 of plan.md to the author's approval reference. Any byte change stops reuse: inspect the diff. Existing consent can be recorded again for editorial-only changes still covered by the original action/scope; a material scope/intent change requires renewed user approval. Never auto-renew a stale receipt or ask again solely because a hash changed.
- Candidate identity uses sorted `[absolutePath, state, hash]` records and the same JSON/SHA-256 encoding as the artifact contract. Obtain the complete deliverable list from `workflow_check({ change_dir, phase: "surface" })` against the captured `flow.json` baseline, not ad-hoc shell diff scripts; include required deletions. The checker rejects duplicates, redirects, non-files and paths outside Writable Paths, but cannot discover an omitted deliverable outside scanned roots or authenticate an approval.
- Capture one integrated candidate after every declared preparation/unit/integration item and integrated check passes; the script requires all corresponding READY summaries (`apply-preparation.md`, `apply-UNIT-*.md`, `apply-integration.md` when declared). Include every implementing session. Project Contracts are exact project-resident canonical files, including relevant modular fragments; candidate capture hashes them, including unchanged read-only inputs, and subsequent checks reject drift. This is continuity, not semantic validation or automatic prerequisite scheduling. A new candidate clears the previous verification receipt while preserving `baselines`. An edited apply/verify artifact or candidate drift stops its corresponding boundary.
- Use the real nested session identity from runtime metadata for each executor, not an agent name, preset or model. Different models are not required. For parallel implementation, supply every unit session in the candidate action's `executors` array; preserve each unit's task/session identity in its apply artifact. The script rejects a verifier matching any recorded implementation session. Recorded identities remain auditable declarations, not cryptographic identity proof.
- The script checks structure and content continuity, not business correctness, permission isolation, live HTTP acceptance or write provenance. Tests, Surface Check, independent review and explicit archive approval remain mandatory where applicable. Rerun `workflow_check` with phase `deliver` (and `snapshot` when needed) immediately before delivery/archive; `workflow_record action="archive"` enforces the Archive Safety Checks below fail-closed.
- Existing changes keep their recorded evidence/encoding; do not migrate or block historical delivery just because flow.json is absent. Explicit no-delegation work stays Direct Orchestrator: no mandatory plan/receipt/independent worker or added lifecycle is introduced.

## Baseline-relative Surface Check

- For new Planned changes, capture the pre-apply baseline with `workflow_record({ change_dir, action: "baseline", label? })` rather than writing `/tmp/` baseline files or ad-hoc Node diff scripts. It scans `Writable Paths`, bounded `Allowed Paths`, and `Project Contracts` without following symlinks, excludes `.git`, `node_modules`, change artifacts, and secret patterns (`.env`, `.env.local`, `.env.*.local`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`), and stores only path/state/hash metadata under `flow.json` `baselines` (never raw contents or secrets). For a retry or later stage/unit, capture an additional labeled baseline in `flow.json`.
- After apply, run `workflow_check({ change_dir, phase: "surface", baseline_id? })` (paging via `diagnostic_offset` when `next_offset` is returned for large change sets). It compares current workspace state against the selected baseline (not HEAD or the entire dirty status list), ignores unchanged pre-existing dirty files and unchanged pre-existing symlinks, attributes newly created/modified/deleted records to `Writable Paths`, `UNIT-*`, or `Preparation/Integration`, flags out-of-surface edits, overlaps, unassigned writable edits, created/modified symlinks, and read-only Project Contract drift as violations, and outputs exact sorted `candidate_files` ready for `workflow_record action="candidate"`.
- New changes outside assigned surfaces, shared/overlapping ownership, read-only Project Contract drift, or concurrent edits to a worker's surface require attribution/resolution before proceeding; a baseline alone cannot prove who wrote a file. Preserve all pre-existing work: never clean, stash, reset, stage, or require a commit to satisfy this check. If no trustworthy pre-apply baseline exists (or `plan.md` changed since baseline capture), stop rather than reconstruct it retrospectively.
- For historical changes without `flow.json`, retain read-only pre-apply baseline metadata in existing change evidence without `/tmp/` files or raw secret contents. This is change attribution, not acceptance or sandboxing; integrated tests and independent verification still assess the resulting candidate.

## Archive Safety Checks

1. Read ready `plan.md` and `verify.md` with `Verification Result: PASS`. Confirm explicit user archive approval (`author` and `reference`) for this verified change and resolve the exact source `openspec/changes/<change-slug>` and destination `openspec/archive/YYYY-MM-DD/<change-slug>/`.
2. For new Planned changes, execute archive through `workflow_record({ change_dir, action: "archive", author, reference, date? })` instead of manual shell/Node move scripts. It fail-closed enforces every check below before any mutation: runs the full `deliver` gate and fresh post-verification continuity recomputation (`snapshot`), rejecting missing evidence or candidate/contract/artifact drift without silently reverifying or repairing.
3. Validates resolved paths and slug: source must be the intended active `openspec/changes/<change-slug>` directory matching `flow.json`, destination must be outside the source and strictly absent (`ENOENT`), and neither source, destination, nor internal files may redirect through an unexpected symlink. Never overwrite or merge an existing destination.
4. Preserves the complete change tree (including discovery and evidence) via a same-filesystem atomic rename (`renameSync`). Cross-device (`dev` mismatch / `EXDEV`) fails closed with an actionable error and never falls back to copy/delete; request a separately approved transfer procedure instead.
5. Confirms post-move that destination exists as a regular directory, source is absent, every pre-move file matches size and SHA-256, archive approval metadata is saved in `flow.json`, zero owned `.tmp` residue remains, and `deliver` still passes on the archived directory. On partial or uncertain results, report the actual paths and stop; do not retry destructively.
6. Report the archive destination to the user. Do not create a new phase artifact, perform Git operations, release, deploy, or clean unrelated files.

## Output Contract

Report only the relevant phase, result/blocker, artifact path, and next action or user decision. Successful delegated results use the canonical handoff; evidence stays in the artifact.

## References

- `references/parallel-apply.md` — context-aware splitting, project contracts, staged apply and question handling.
- `~/.pi/agent/AGENTS.md`
- `~/.pi/agent/skills/subagent-artifact-contracts/SKILL.md`
- `~/.pi/agent/subagents/00-discovery.md`
- `~/.pi/agent/subagents/01-planning.md`
- `~/.pi/agent/subagents/02-apply.md`
- `~/.pi/agent/subagents/03-verify.md`
