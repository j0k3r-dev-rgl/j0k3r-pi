---
name: sdd-workflow
description: "runs Mini-SDD or Formal SDD only after a separate explicit start instruction, with phase artifacts, assigned skills, blocker gates, Strict TDD evidence, and orchestrator review."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "10.0"
---

# OpenSpec SDD Workflow

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "workflow",
  "domains": ["openspec", "mini-sdd", "formal-sdd", "artifact-lifecycle", "phase-gates"],
  "triggers": {
    "paths": [
      "openspec/changes/**/*.md",
      "subagents/sdd-*.md",
      "subagents/prd-review.md",
      "skills/sdd-workflow/SKILL.md"
    ],
    "keywords": [
      "mini-sdd",
      "formal sdd",
      "openspec change",
      "sdd phase",
      "workflow status",
      "apply.md",
      "verify.md",
      "sdd completo",
      "bloqueo sdd"
    ]
  },
  "sdd_phases": ["explore", "proposal", "spec", "design", "task", "apply", "verify", "archive"],
  "related_skills": ["workflow-triage", "tdd", "skill-authoring"],
  "priority": 92
}
```

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `triggers.paths`: glob-like project paths that should activate this skill.
- `triggers.keywords`: user/request terms that should activate this skill.
- `sdd_phases`: phases governed by this skill.
- `related_skills`: skills that should be considered one hop away.
- `priority`: routing priority from 0 to 100.

## Activation Contract

Use this skill after the user has selected Mini-SDD or Formal SDD, or when discussing an existing OpenSpec change. Selection permits planning the conversation, but execution starts only after a separate explicit user instruction. This skill governs artifacts under `openspec/changes/<change-slug>/` and the handoff between SDD subagents.

Do not use it to select a workflow; use `workflow-triage`. Do not treat PRD or discovery as additional workflow tiers.

## Canonical Scope

This skill owns:

- the SDD artifact map and one-phase-at-a-time lifecycle;
- the exact visible `Workflow Status` block;
- dependency and blocker record placement for SDD artifacts;
- placement and timing of forecasts, candidate linkage, receipts, attempt exhaustion, and just-in-time delivery plans;
- the Formal SDD archive convention; and
- the artifact and handoff consistency gate before phase advancement.

This skill consumes, and must not redefine, the shared semantics in `AGENTS.md` sections `Authority and Conflict Escalation`, `Delegated Handoff Contract`, `Candidate Identity and Attempt Budgets`, and `Verification and Delivery Safeguards`.

## Artifact Contract

Every phase artifact starts with a visible status section:

```markdown
## Workflow Status
- Status: READY | BLOCKED
- Blockers: None | <specific unresolved decisions or dependencies>
```

Rules:

- `READY` means the artifact contains enough approved information for the next phase.
- `BLOCKED` means the current phase needs a user decision, missing contract, or approved research result.
- A blocked artifact states precise questions and must not hide assumptions in later sections.
- The orchestrator reads the relevant artifact after each phase and before delegating the next one.
- The flow never advances while a required prior artifact is `BLOCKED`.
- `FAILED` is handoff-only and never a valid artifact status.

## Dependency and Blocker Records

When a material required dependency or blocker affects the next action, the artifact or handoff adds this compact record for each item:

```markdown
- Item: <dependency or blocker>
- Owner/source: <responsible decision-maker, system, or evidence source>
- Resolution: <condition required to resolve it>
- Affected next action: <action that cannot proceed or is constrained>
```

`READY` requires every dependency necessary for the next phase to be satisfied. Optional follow-ups may be listed only when clearly labeled optional and when they do not affect next-phase validity.

## Artifact Map

```text
openspec/changes/<change-slug>/
├── prd.md         # Optional, user-approved product clarification by prd-review
├── mini-sdd.md    # Mini-SDD workflow plan maintained by the orchestrator
├── explore.md     # Formal SDD evidence synthesis by sdd-explore
├── proposal.md    # Formal SDD delta and scope by sdd-proposal
├── spec.md        # Formal SDD normative contracts by sdd-spec
├── design.md      # Formal SDD architecture by sdd-design
├── tasks.md       # Formal SDD implementation checklist by sdd-task
├── apply.md       # Implementation and TDD evidence by sdd-apply
└── verify.md      # Independent verification by sdd-verify
```

## Hard Rules

- Selecting Mini-SDD or Formal SDD does not authorize execution.
- Before the explicit start instruction, do not read project artifacts, resolve implementation context, delegate phases, write artifacts, or run commands.
- Begin only after the user gives a contextually clear instruction to start the selected workflow.
- Use PRD only as an optional clarification artifact approved by the user.
- Use `discovery` for approved unknown research; `sdd-explore` synthesizes known context and discovery evidence rather than performing broad research.
- Resolve relevant skills after workflow approval. Pass exact `SKILL.md` paths to lean-mode subagents.
- Subagents read assigned skills only; they do not inventory or scan `skills/`.
- Reuse current context and artifacts. Do not reread unchanged files or repeat discovery.
- Keep all work bounded to the approved change slug and scope.
- Apply Strict TDD to code changes and record RED → GREEN → REFACTOR evidence in `apply.md`.
- `sdd-verify` independently reads `apply.md`, applicable contracts, and exact changed files before testing.
- Never generate metadata bloat, lease IDs, phase locks, or hidden workflow state.

## Operational Lifecycle Placement

### Context, Workload, and Candidate Placement

- Use `AGENTS.md` as the canonical owner for proportional context assessment, workload factors, deterministic manifest grammar, and delivery safeguards.
- `sdd-task` records `## Delivery and Review Forecast`, including workload factors, coherent review units or explicit user exception evidence, and any known `## Just-in-Time Delivery Plan`.
- `sdd-apply` preserves Strict TDD for code work, uses structural validation for docs or configuration only, records attempt evidence, and freezes the candidate before applicable final verification.
- `sdd-verify` independently derives the approved candidate set from the contracts, recomputes any triggered manifest, checks handoff and artifact consistency, and emits the canonical verification receipt when triggered.
- `sdd-archive` runs only after ready passing verification on the same candidate identity, checks candidate or receipt continuity before publication, and requires any triggered just-in-time delivery plan before irreversible archive or retirement effects.

### Mini-SDD

1. Optionally run `prd-review` only when product clarification was approved.
2. The orchestrator creates or updates `mini-sdd.md` from approved context, assigned skills, and optional discovery evidence.
3. If a forecast trigger already applies, include `## Delivery and Review Forecast` in `mini-sdd.md`; otherwise omit it.
4. The orchestrator checks `mini-sdd.md`; if `BLOCKED`, consult the user and update the plan before continuing.
5. Run `sdd-apply`, using `mini-sdd.md` as the implementation contract and checklist.
6. If candidate-freeze or delivery-plan triggers emerge, record them in the active implementation handoff or artifact before final verification or the risky boundary.
7. The orchestrator reads `apply.md`; if `BLOCKED`, consult the user and resume `sdd-apply`.
8. Run `sdd-verify`, reading `mini-sdd.md` and `apply.md`.
9. If receipt triggers apply, `verify.md` includes the canonical verification receipt from `AGENTS.md`.
10. The orchestrator reads `verify.md` and reports `PASS`, `ISSUES_FOUND`, or `BLOCKED`.

### Formal SDD

1. Optionally run `prd-review` only when product clarification was approved.
2. If current context is insufficient, obtain approval and run `discovery` with a bounded research scope.
3. Run `sdd-explore` to create `explore.md` from approved context and discovery evidence.
4. Run `sdd-proposal` to create `proposal.md` from `explore.md` and optional `prd.md`.
5. Run `sdd-spec` to create `spec.md` from ready prior artifacts.
6. Run `sdd-design` to create `design.md` from ready contracts and assigned skills.
7. Run `sdd-task` to create `tasks.md`, always including a `## Delivery and Review Forecast` applicability entry and adding a `## Just-in-Time Delivery Plan` there when the trigger is already known.
8. Run `sdd-apply` to implement `tasks.md`, update its checklist, create `apply.md`, and record candidate identity before applicable final verification.
9. If attempt exhaustion occurs, the active artifact remains or becomes `BLOCKED` and records the failure class, attempts used, last evidence, and needed decision or dependency.
10. Run `sdd-verify` to inspect `apply.md`, contracts, changed files, and tests, then create `verify.md`.
11. If receipt triggers apply, `verify.md` includes the canonical verification receipt and repeats the exact candidate identity from `apply.md`.
12. Run `sdd-archive` only when `verify.md` is ready, passing, and tied to the same candidate identity.

## Formal SDD Archive Convention

Archive operates only for an authorized Formal SDD change and preserves the whole `openspec/changes/<change-slug>/` tree.

### Terminal invariant and immutable destination

`READY` archive completion requires a destination-only final proof:

1. `openspec/archive/YYYY-MM-DD/<change-slug>/` exists as a complete supported tree with exact workflow bytes;
2. the archived-workflow candidate identity and verification receipt remain continuous at that destination;
3. `openspec/changes/<change-slug>/` is absent;
4. no owned retirement-stage residue remains under `openspec/changes/`; and
5. the archive handoff cites the final proof.

A valid destination with a present source is not terminal success. A valid destination with owned undeleted retirement-stage residue is preserved but remains `BLOCKED`. The destination is immutable after proof: do not overwrite, merge, repair, partially resume, delete, or roll back the destination.

### Fixed inputs and proof boundaries

- Capture the UTC calendar date once at archive-operation start and reuse that recorded date for the same operation.
- Archive only to `openspec/archive/YYYY-MM-DD/<change-slug>/`.
- Reject an empty or unsafe slug. The slug must match `^[a-z0-9]+(?:-[a-z0-9]+)*$` and must not resolve outside the canonical archive date directory.
- Preflight source resolution, destination resolution, ready `tasks.md`, ready passing `verify.md`, verbatim candidate or receipt continuity, and any triggered just-in-time delivery plan before irreversible effects.
- Preserve the complete source tree with the same repository-relative names and exact file bytes. Do not omit phase artifacts or supporting files under the change tree.
- Whole-tree proof must fail closed on unsupported file types, including symlinks, or on missing, partial, mutated, ambiguous, or stale evidence.

### State classifier and residue precedence

With no retirement-stage residue, classify exactly one base state:

- `SOURCE_ONLY`: valid source, absent destination. Eligible for publication, then mandatory retirement.
- `DUPLICATE_IDENTICAL`: valid source and valid identical destination. Destination mutation is forbidden and source retirement is still mandatory.
- `CONFLICTING_OR_PARTIAL`: both paths exist but differ or either path is invalid. `BLOCKED`.
- `DESTINATION_ONLY_VALID`: source absent and destination has exact candidate or receipt continuity. `READY` only after final proof.
- `DESTINATION_ONLY_INVALID`: source absent but destination is partial, invalid, or unverifiable. `BLOCKED`.
- `NEITHER`: source and destination absent. `BLOCKED`.

Retirement-stage residue takes precedence over base-state success:

- `RETIREMENT_DELETE_PENDING`: exactly one operation-owned `openspec/changes/__sdd-retirement-stage--<change-slug>--<operation-id>/`, source absent, valid destination, and exact equality with the frozen proof. `BLOCKED` unless a separately authorized delete attempt is in scope.
- `SOURCE_REAPPEARED_OR_MIXED_RESIDUE`: source present with any stage residue. `BLOCKED`.
- `UNSAFE_OR_ORPHAN_RESIDUE`: one stage residue exists but the destination is absent or invalid. `BLOCKED`.
- `AMBIGUOUS_OR_CHANGED_RESIDUE`: one stage residue is unowned, changed, mismatched, or unexpectedly populated. `BLOCKED`.
- `MULTIPLE_RESIDUES`: more than one stage-like residue matches the slug. `BLOCKED`.

A stage name match alone does not prove ownership.

### Publication to retirement sequence

For `SOURCE_ONLY` and `DUPLICATE_IDENTICAL`, archive follows this order and does not skip proof boundaries:

1. Freeze the complete source inventory, bytes, ready `tasks.md`, ready passing `verify.md`, and candidate or receipt continuity.
2. Publish or prove the destination. For `SOURCE_ONLY`, use same-filesystem staging and atomic no-clobber publication. For `DUPLICATE_IDENTICAL`, mutate no destination and prove exact equality.
3. Immediately revalidate the source against the frozen proof and destination before retirement.
4. Create a destructive attempt context with the fixed date, safe slug, exact source, exact destination, planned retirement stage, frozen proof, candidate or receipt references, and remaining budget.
5. Use one atomic same-parent no-clobber rename from `openspec/changes/<change-slug>/` to `openspec/changes/__sdd-retirement-stage--<change-slug>--<operation-id>/`, where `<operation-id>` is exactly 32 lowercase hexadecimal characters and the retirement stage is proven absent first.
6. Prove the renamed state: source absent, retirement stage present, and exact equality among the retirement stage, frozen proof, and immutable destination.
7. Create a separate delete attempt context, freshly prove ownership and equality again, and perform one delete attempt against the exact retirement stage only.
8. Run final proof: source absent, retirement stage absent, destination complete, and continuity evidence intact.

`DESTINATION_ONLY_VALID` enters directly at final proof and performs no filesystem mutation.

### Failure containment and attempt policy

- Do not overwrite, merge, repair, restore, or otherwise mutate a previously proven destination.
- If publication collision, source mutation, pre-rename drift, rename failure, post-rename mismatch, source reappearance, stage deletion failure, or final-proof drift appears, stop with `BLOCKED`, preserve the immutable destination, and report the exact last successful state plus any residue.
- Cleanup is limited to the exact single owned retirement stage freshly proven equal to the frozen proof and destination. No partial subtree, ambiguous stage, extra child, sibling path, or multiply matched residue may be deleted.
- Archive uses one initial attempt for each destructive rename or delete with zero automatic destructive retries. Any retry needs explicit user authorization, a new attempt context, and fresh ownership, equality, absence, candidate, receipt, and just-in-time proof.
- Archive completion records workflow preservation only. It never implies Git, release, or delivery authorization.

## Artifact and Handoff Consistency Gate

After every artifact-producing phase:

1. Read the persisted artifact once.
2. Compare artifact status with the delegated handoff from `AGENTS.md`.
3. Advance only when:
   - artifact `READY` matches handoff `READY`;
   - handoff `Blockers` is `None` when the artifact is ready;
   - evidence cites the artifact path and any required checks.
4. Stop advancement when:
   - artifact `BLOCKED` or handoff `BLOCKED` appears;
   - handoff `FAILED` appears;
   - labels are invalid or required evidence is missing;
   - artifact and handoff statuses do not agree.
5. Treat any mismatch as orchestration-level `BLOCKED` until corrected.

## Skill Resolution & Prompt Contract

Before delegating a phase:

1. Resolve only skills relevant to the approved scope and current phase.
2. Read selected `SKILL.md` files before relying on them.
3. Provide the subagent with the ordered canonical delegation input contract from `AGENTS.md`, including approved goal, known evidence, missing facts, scope and paths, exclusions, governing contracts, prior decisions and ready artifacts, exact assigned skill paths, expected output and evidence, blocker criteria, and the one next permitted action.
4. Remember that lean-mode subagents do not receive `AGENTS.md`, prior conversation, startup memory, or skills automatically.

## Decision Gates

- If the workflow is selected but no explicit start instruction has been received, remain idle and ask whether the user wants to start; do not read or delegate.
- If product intent is materially unclear, propose optional PRD and ask the user before creating it.
- If implementation context is unknown after starting, ask for research depth and executor before research.
- If the user explicitly asks the orchestrator to research personally, honor that choice and pass the curated result to the phase agent.
- If any artifact is `BLOCKED`, do not delegate the next phase.
- If scope changes, return to the user and confirm whether to update the current workflow or re-triage.
- If verification finds implementation defects inside approved scope, return to `sdd-apply`; do not silently change product contracts.

## Execution Steps

1. Confirm the selected workflow and change slug from current context without reading project files.
2. Confirm that the user issued a separate explicit instruction to start, unless the same message already provided unambiguous combined consent. If not, stop with status `WAITING`.
3. Identify existing artifacts already available in context; do not reread them without need.
4. Resolve phase-relevant skills and prepare explicit lean-mode prompts.
5. Delegate one phase at a time.
6. Read the produced artifact and enforce its status gate.
7. Compare the artifact and handoff before advancing.
8. Resolve blockers with the user and resume the same phase when needed.
9. Continue through apply and independent verification.
10. Archive only a ready, passing Formal SDD change tied to the verified candidate.

## Output Contract

Return:

- Selected workflow and change slug.
- Explicit start status: `WAITING` or `AUTHORIZED`.
- Current phase and artifact path.
- Skills assigned to the phase.
- Artifact status and blockers.
- Handoff consistency result.
- TDD evidence for apply, when applicable.
- Verification result and next permitted phase.
- Any user decision required before continuing.

## References

- `AGENTS.md` — authoritative consent, authority, context, workload, handoff, candidate, attempt-budget, and delivery-safeguard policy.
- `skills/workflow-triage/SKILL.md` — pre-authorization workflow selection.
- `skills/tdd/SKILL.md` — Strict TDD execution guidance.
- `subagents/*.md` — lean-mode phase contracts and artifact responsibilities.
- `docs/pi-workflow-regression-scenarios.md` — non-authoritative lifecycle and archive regression catalog for reviewer maintenance.
