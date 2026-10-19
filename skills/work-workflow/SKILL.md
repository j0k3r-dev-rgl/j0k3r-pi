---
name: work-workflow
description: "Run authorized Planned Workflow lifecycle with lightweight contracts. Trigger: multi-step implementation, complex changes, or bounded delegation across workers and verifiers."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "16.3"
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
- Use `openspec/changes/<change-slug>/` with optional `discovery.md`, `plan.md`, `apply.md`, and `verify.md`. Resolve material product questions with the user before marking the plan READY; record decisions or blockers in plan.md, without a separate PRD artifact or review phase.
- Local discovery writes only its assigned `discovery.md`; reuse its evidence IDs directly. Discovery may be the final deliverable of an investigation-only request.
- Keep one phase active at a time. Delegate contract creation to `01-planning`, implementation to `02-apply`, verification independently to `03-verify`. The orchestrator performs archive directly after user approval; archive is not a delegated phase.
- **Parallel Apply Units**: Within the apply phase, when `plan.md` defines `Parallel Units`, launch one `02-apply` worker per unit concurrently in the same orchestrator turn. Omit `mode` unless the user explicitly requested it; the manager selects execution mode. Never force background mode contrary to the tool contract. Each worker receives only its unit ID, its unit's Writable Paths, and its own `apply-<UNIT-ID>.md` output path. Units must have disjoint Writable Paths and no `Depends on` across units; otherwise run them sequentially. Never split work into units the plan did not define.
- **Parallel Discovery Fan-Out**: When pre-implementation questions are independent, launch several `00-discovery` workers concurrently, each with its own bounded question and `discovery-<topic>.md` path; read all before planning.
- Assign `skills/anti-overengineering/SKILL.md` alongside artifact contracts when delegating `01-planning` and `02-apply` to enforce simplest-sufficient design and implementation; do not assign it to `00-discovery` or `03-verify`.
- Assign `skills/tdd/SKILL.md` in Assigned skills when delegating `02-apply` for code/test changes, and to `01-planning` when defining validation strategy.
- Resolve and assign project-specific skills (from `.pi/skills/`, `.agents/skills/`, or `skill_registry_resolve`) in Assigned skills for delegated subagents whenever the task touches project code or domain logic.
- If a required subagent is unavailable, stop as `BLOCKED`; do not silently take over.
- **Circuit Breaker**: Stop dependent execution and phase advancement on a material unresolved decision. Subagents use the live-question/fallback rule in the assigned artifact contract; the orchestrator answers facts and approved decisions, and asks the user for unmade product/scope/architecture decisions under `AGENTS.md`. A factual answer is not new authority.
- The orchestrator supplies exact absolute artifact and skill paths, reads each returned artifact, and checks required fields before advancing. Do not assume lean subagents inherit global context.
- Follow AGENTS.md's compact seven-field delegation contract: reference existing artifact sections instead of repeating them, write each exact path once, and transmit only new decisions/context. Summarize applicable scope, Configuration Lock, Git limits, and user decisions not available in assigned contracts. Writable paths are not permission to make incidental configuration changes.
- **Pre-Mutation Summary Gate**: Before apply or any orchestrator mutation, summarize scope, planned changes, exclusions, validation, and risks; obtain explicit user authorization before mutating files. Artifacts do not grant authorization.
- Verify every `MINI-###` independently against current behavior and applicable code/scope constraints. Follow `AGENTS.md`'s TDD method-versus-reporting rule and the compact artifact contract; do not introduce a TDD-history review gate. Failed required verification stops advancement; return to apply only with applicable authorization and an explicit remediation next action.
- Archive only after passing verification, unchanged candidate evidence, and explicit user archive authorization. Move the complete tree to `openspec/archive/YYYY-MM-DD/<change-slug>/` without overwriting a destination.
- Preserve historical artifacts. Do not convert or delete old changes automatically; if asked to resume an incompatible historical contract, agree a bounded Planned Workflow contract before implementation.

## Execution Steps

1. Resolve the exact change directory and next permitted action from approved context.
2. If local facts are missing, assign `discovery.md`; read its evidence before planning. Do not duplicate research or add a separate synthesis phase.
3. Delegate a compact `plan.md` with concrete acceptance, directory-based scope, validation, and `MINI-###` items. Use the narrowest common parent for sibling areas; do not prescribe files or enumerate its child directories. Narrow excessive scope with the user.
4. Check status, required sections, unique IDs, evidence references, and parseable Execution Scope. `BLOCKED` stops advancement.
5. Summarize the implementation and obtain applicable apply authorization; capture the Surface Check baseline below before delegation. Delegate `02-apply` with its authorization evidence and exact scope-source path. With `Parallel Units`, one authorization covers all units; dispatch every independent unit at once and consume completion notifications without polling.
6. Read the compact implementation summary and final validation in `apply.md` (or every `apply-<UNIT-ID>.md`), then run the baseline-relative Surface Check below. An unexplained delta, overlap, out-of-surface change, failed unit, or missing baseline blocks verification until attribution/remediation is resolved. Then run the plan's integrated validation command once, arrange any contract-required live acceptance with its assigned owner, and delegate one independent verification against the complete `MINI-###` set. Do not request formatting-only rewrites or retrospective TDD evidence.
7. Read `verify.md`; require PASS, evidence for every item, and a continuity snapshot before reporting verified completion.
8. Ask for archive authorization only when verification passed. The orchestrator then performs the Archive Safety Checks below directly; do not launch a subagent.

## Baseline-relative Surface Check

- Before apply, capture a read-only baseline: base revision, index/worktree status, and content identities for tracked and non-ignored untracked paths. Include explicitly authorized ignored deliverables separately; exclude known runtime/secret material. Store only path/state/hash metadata in existing change evidence, never raw contents. For a retry or later unit, capture its own pre-delegation baseline.
- Within Writable Paths, record each file's state and SHA-256 (or symlink target identity), including pre-existing modifications/untracked files; absence is explicit and newly created paths must be detected. Keep index identity separate so staging or unstaging cannot masquerade as no change. Name/status comparisons alone are insufficient.
- Compare the post-apply state to this baseline, not to HEAD or the entire dirty status list. Attribute only newly created/deleted/changed records to apply. Each implementation delta belongs to exactly one assigned writable surface and matches that worker's reported files; separately assigned output artifacts are expected orchestrator evidence, not another unit's implementation surface. Pre-existing unchanged paths are not worker changes.
- New changes outside assigned surfaces, shared/overlapping ownership, or concurrent edits to a worker's surface require attribution before proceeding; a baseline alone cannot prove who wrote a file. Preserve all pre-existing work: never clean, stash, reset, stage, or require a commit to satisfy this check. If no trustworthy pre-apply baseline exists, stop rather than reconstruct it retrospectively.
- This is change attribution, not acceptance or sandboxing; integrated tests and independent verification still assess the resulting candidate.

## Archive Safety Checks

1. Read ready plan.md and verify.md with Verification Result: PASS. Confirm explicit user archive approval for this verified change and resolve the exact source and destination under openspec/archive/YYYY-MM-DD/<change-slug>/.
2. Recompute the post-verification continuity snapshot immediately before mutation. Missing evidence or drift blocks archive; do not silently reverify or repair.
3. Validate resolved paths and slug: source must be the intended active change directory, destination must be outside the source and absent, and neither path may redirect through an unexpected symlink. Never overwrite or merge an existing destination.
4. Preserve the complete change tree, including discovery and evidence. Prefer a same-filesystem atomic rename. If that cannot be performed safely, stop and request a separately approved transfer procedure rather than inventing a copy/delete fallback.
5. Confirm destination exists and contains the complete moved tree, source is absent, and no owned temporary residue remains before reporting success. On partial or uncertain results, report the actual paths and stop; do not retry destructively.
6. Report the archive destination to the user. Do not create a new phase artifact, perform Git operations, release, deploy, or clean unrelated files.

## Output Contract

Report only the relevant phase, result/blocker, artifact path, and next action or user decision. Successful delegated results use the canonical handoff; evidence stays in the artifact.

## References

- `~/.pi/agent/AGENTS.md`
- `~/.pi/agent/skills/subagent-artifact-contracts/SKILL.md`
- `~/.pi/agent/subagents/00-discovery.md`
- `~/.pi/agent/subagents/01-planning.md`
- `~/.pi/agent/subagents/02-apply.md`
- `~/.pi/agent/subagents/03-verify.md`
