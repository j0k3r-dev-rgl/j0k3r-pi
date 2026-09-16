---
name: work-workflow
description: "run the authorized Planned Workflow across 00-discovery, 01-planning, 02-apply, and 03-verify. Use when creating or tracking discovery.md, plan.md, apply.md, and verify.md artifacts, independent verification, or change archival."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "16.0"
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
- Use `openspec/changes/<change-slug>/` with optional `discovery.md`, `plan.md`, `apply.md`, and `verify.md`. Resolve material product questions with the user before marking the plan READY; record decisions or blockers in plan.md, without a separate PRD artifact or review phase.
- Local discovery writes only its assigned `discovery.md`; reuse its evidence IDs directly. Discovery may be the final deliverable of an investigation-only request.
- Keep one phase active at a time. Delegate contract creation to `01-planning`, implementation to `02-apply`, verification independently to `03-verify`. The orchestrator performs archive directly after user approval; archive is not a delegated phase.
- Assign `skills/anti-overengineering/SKILL.md` alongside artifact contracts when delegating `01-planning` and `02-apply` to enforce simplest-sufficient design and implementation; do not assign it to `00-discovery` or `03-verify`.
- Assign `skills/tdd/SKILL.md` in Assigned skills when delegating `02-apply` for code/test changes, and to `01-planning` when defining validation strategy.
- Resolve and assign project-specific skills (from `.pi/skills/`, `.agents/skills/`, or `skill_registry_resolve`) in Assigned skills for delegated subagents whenever the task touches project code or domain logic.
- If a required subagent is unavailable, stop as `BLOCKED`; do not silently take over.
- **Circuit Breaker**: If an open decision, ambiguity, or missing user choice is encountered at any phase, the circuit breaker trips immediately. Stop execution, surface the exact decision to the user, and do not advance or mutate until answered.
- The orchestrator supplies exact absolute artifact and skill paths, reads each returned artifact, and checks required fields before advancing. Do not assume lean subagents inherit global context.
- Follow AGENTS.md's compact seven-field delegation contract: reference existing artifact sections instead of repeating them, write each exact path once, and transmit only new decisions/context. Summarize applicable scope, Configuration Lock, Git limits, and user decisions not available in assigned contracts. Writable paths are not permission to make incidental configuration changes.
- **Pre-Mutation Summary Gate**: Before apply or any orchestrator mutation, summarize scope, planned changes, exclusions, validation, and risks; obtain explicit user authorization before mutating files. Artifacts do not grant authorization.
- Verify every `MINI-###` independently. Failed verification stops advancement; return to apply only with applicable authorization and an explicit remediation next action.
- Archive only after passing verification, unchanged candidate evidence, and explicit user archive authorization. Move the complete tree to `openspec/archive/YYYY-MM-DD/<change-slug>/` without overwriting a destination.
- Preserve historical artifacts. Do not convert or delete old changes automatically; if asked to resume an incompatible historical contract, agree a bounded Planned Workflow contract before implementation.

## Execution Steps

1. Resolve the exact change directory and next permitted action from approved context.
2. If local facts are missing, assign `discovery.md`; read its evidence before planning. Do not duplicate research or add a separate synthesis phase.
3. Delegate a compact `plan.md` with concrete acceptance, directory-based scope, validation, and `MINI-###` items. Use the narrowest common parent for sibling areas; do not prescribe files or enumerate its child directories. Narrow excessive scope with the user.
4. Check status, required sections, unique IDs, evidence references, and parseable Execution Scope. `BLOCKED` stops advancement.
5. Summarize the implementation and obtain apply authorization; delegate `02-apply` with its authorization evidence and exact scope-source path.
6. Read `apply.md`; delegate independent verification against the complete `MINI-###` set.
7. Read `verify.md`; require PASS, evidence for every item, and a continuity snapshot before reporting verified completion.
8. Ask for archive authorization only when verification passed. The orchestrator then performs the Archive Safety Checks below directly; do not launch a subagent.

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
