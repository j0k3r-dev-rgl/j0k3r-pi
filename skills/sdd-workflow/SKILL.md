---
name: sdd-workflow
description: "runs authorized Mini-SDD or Formal SDD execution requests with optional evidence synthesis, non-repetitive phase artifacts, change-type validation, blocker gates, and independent verification."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "13.0"
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
      "openspec/archive/**/*.md",
      "subagents/sdd-*.md",
      "subagents/prd-review.md",
      "skills/sdd-workflow/SKILL.md"
    ],
    "keywords": [
      "execute mini-sdd",
      "run mini-sdd",
      "start mini-sdd",
      "execute formal sdd",
      "run formal sdd",
      "start formal sdd",
      "ejecutar mini-sdd",
      "ejecutar sdd formal",
      "openspec change",
      "sdd phase",
      "workflow status",
      "apply.md",
      "verify.md",
      "sdd archive",
      "archivar mini-sdd",
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

Use this skill for a concrete request to execute Mini-SDD or Formal SDD, or when discussing an existing OpenSpec change. OpenSpec is the artifact namespace and convention used by these two SDD workflows; it is not a fourth workflow or an external source of authority. A concrete execution request begins the workflow without a second start instruction; discussion-only requests remain conversational. This skill governs active artifacts under `openspec/changes/<change-slug>/`, completed archives under `openspec/archive/YYYY-MM-DD/<change-slug>/`, and the handoff between SDD subagents.

Do not use it to select a workflow; use `workflow-triage`. Do not treat PRD or discovery as additional workflow tiers.

## Canonical Scope

This skill owns:

- the SDD artifact map and one-phase-at-a-time lifecycle;
- the exact visible `Workflow Status` block;
- dependency and blocker record placement for SDD artifacts;
- placement and timing of forecasts, candidate linkage, receipts, attempt exhaustion, and just-in-time delivery plans;
- the shared Mini-SDD and Formal SDD archive convention; and
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

## Artifact Economy and Traceability Contract

Each artifact contains only information owned by its phase and needed by its direct consumer. Do not add narrative introductions, repeat workflow rationale, copy upstream scope or risks, or reproduce prior requirements and decisions. Reference stable identifiers instead.

Formal SDD uses this chain:

```text
DELTA-### → REQ-### / SCENARIO-### → DES-### → TASK-### → VERIFY MATRIX
```

Required relationships:

- SDD identifiers are change-local three-digit IDs; durable lifecycle IDs remain canonical `<docs-path>#<stable-ID>` references and are never renumbered into SDD IDs.
- Every `DELTA-###` and `REQ-###` records `Canonical sources` with one or more durable references, or `None — change-local contract`.
- Every `REQ-###` names one or more source `DELTA-###` identifiers.
- Every `SCENARIO-###` verifies one or more `REQ-###` identifiers.
- Every `DES-###` satisfies one or more `REQ-###` identifiers.
- Every `TASK-###` implements one or more `DES-###` identifiers and verifies one or more `REQ-###` identifiers.
- Every requirement appears exactly once in the verification matrix with implementation evidence, a check command or result, and `PASS` or `ISSUES_FOUND`.

Identifiers are uppercase, zero-padded three-digit values, unique within their type, and never renumbered merely for presentation. Missing, duplicate, malformed, or unresolved identifiers make the active artifact `BLOCKED`.

## Minimal Phase Context

- `sdd-proposal`: approved request, optional `prd.md`, and curated discovery or optional `explore.md` only.
- `sdd-spec`: ready `proposal.md` and only unresolved approved product decisions.
- `sdd-design`: ready `spec.md`, exact technical constraints, and specific evidence identifiers needed for decisions.
- `sdd-task`: ready `spec.md` and `design.md` only.
- `sdd-apply`: ready `tasks.md`, `spec.md`, `design.md`, and exact authorized implementation paths.
- `sdd-verify`: `apply.md`, `tasks.md`, `spec.md`, `design.md`, and exact changed files.
- `sdd-archive`: passing `verify.md`, workflow identity, source/destination, and only triggered continuity safeguards.

Never pass the full conversation, discovery transcript, or all prior artifacts by default.

## Structural Gate

After each artifact is persisted, the orchestrator checks before delegating the next phase:

1. valid `Workflow Status` and blocker consistency;
2. required phase sections;
3. unique and correctly formatted identifiers;
4. references resolving to existing upstream identifiers;
5. complete requirements-to-tasks coverage before apply; and
6. complete requirement rows and evidence before verification may pass.

A structural check is deterministic gate evidence, not a substitute for semantic review. Any failure blocks advancement and is reported with the exact missing or invalid item.

## Artifact Map

```text
openspec/changes/<change-slug>/
├── prd.md         # Optional, user-approved product clarification by prd-review
├── mini-sdd.md    # Mini-SDD workflow plan maintained by the orchestrator
├── explore.md     # Optional durable synthesis for substantial Formal SDD discovery evidence
├── proposal.md    # Formal SDD delta and scope by sdd-proposal
├── spec.md        # Formal SDD normative contracts by sdd-spec
├── design.md      # Formal SDD architecture by sdd-design
├── tasks.md       # Formal SDD implementation checklist by sdd-task
├── apply.md       # Implementation and change-type validation evidence by sdd-apply
└── verify.md      # Independent verification by sdd-verify

openspec/archive/YYYY-MM-DD/<change-slug>/
└── ...            # Complete immutable tree after Mini-SDD or Formal SDD archive
```

`openspec/changes/` contains active changes only. Completed Mini-SDD and Formal SDD trees must be retired from that location and preserved only under `openspec/archive/`.

## Hard Rules

- A concrete request to perform a change with Mini-SDD or Formal SDD authorizes execution within its stated scope.
- Do not ask for a separate “start,” “go ahead,” or equivalent confirmation after receiving that request.
- A request that only discusses, compares, or recommends an SDD workflow does not authorize project inspection or execution.
- Use PRD only as an optional clarification artifact approved by the user.
- Use `discovery` for approved unknown research. Use `sdd-explore` only when substantial discovery evidence needs a durable synthesis artifact; otherwise pass curated discovery evidence directly to `sdd-proposal`.
- Each phase writes only its owned decisions and evidence under `Artifact Economy and Traceability Contract`. Reference prior artifact identifiers instead of restating content; do not turn proposal, spec, design, and tasks into successive summaries.
- Resolve relevant skills after workflow approval. Pass exact `SKILL.md` paths to lean-mode subagents.
- Subagents read assigned skills only; they do not inventory or scan `skills/`.
- Reuse current context and artifacts. Do not reread unchanged files or repeat discovery.
- Keep all work bounded to the approved change slug and scope.
- Before apply, require the compact Implementation Readiness packet from `startup-documentation` when lifecycle documentation is active, or equivalent approved inline evidence when it is not. Missing non-applicable lifecycle groups never block implementation.
- Apply the change-type validation protocol from `AGENTS.md`: RED → GREEN → REFACTOR for behavior changes and bug fixes; BASELINE → REFACTOR → REGRESSION for behavior-preserving refactors; BASELINE → CHANGE → DIFF/REGRESSION for mechanical or generated code; and structural validation for documentation or configuration.
- `sdd-verify` independently reads `apply.md`, applicable contracts, and exact changed files before testing.
- Never generate metadata bloat, lease IDs, phase locks, or hidden workflow state.

## Operational Lifecycle Placement

### Context, Workload, and Candidate Placement

- Use `AGENTS.md` as the canonical owner for proportional context assessment, workload factors, deterministic manifest grammar, and delivery safeguards.
- `sdd-task` records `## Delivery and Review Forecast`, including workload factors, coherent review units or explicit user exception evidence, and any known `## Just-in-Time Delivery Plan`.
- `sdd-apply` records the applicable change-type validation evidence, attempt evidence, and a candidate identity only when a concrete trigger requires one before final verification.
- `sdd-verify` independently derives the approved candidate set from the contracts, recomputes any triggered manifest, checks handoff and artifact consistency, and emits the canonical verification receipt when triggered.
- `sdd-archive` runs only after ready passing verification, preserves candidate or receipt continuity when triggered, and requires any triggered just-in-time delivery plan before irreversible archive or retirement effects.

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
10. The orchestrator reads `verify.md`; any result other than `PASS` stops the workflow and must be reported to the user with defects, evidence, affected files, failure class, attempts used, and the recommended next decision. Do not repair or rerun automatically.
11. Run `sdd-archive` only when `verify.md` is ready and passing, preserving candidate continuity when identity was triggered.
12. Report Mini-SDD completion only after archive reaches destination-only success under `openspec/archive/YYYY-MM-DD/<change-slug>/`.

### Formal SDD

1. Optionally run `prd-review` only when product clarification was approved.
2. If current context is insufficient, obtain approval and run `discovery` with a bounded research scope.
3. Run `sdd-explore` only when substantial discovery evidence needs a durable synthesis artifact. Otherwise provide curated context or the discovery handoff directly to `sdd-proposal`.
4. Run `sdd-proposal` to define only `DELTA-###` items, scope, non-goals, and risks from approved context, optional `explore.md`, and optional `prd.md`; then run the structural gate.
5. Run `sdd-spec` to define only `REQ-###` requirements, `SCENARIO-###` acceptance contracts, and compatibility constraints linked to deltas; then run the structural gate.
6. Run `sdd-design` to define only `DES-###` architecture, interfaces, and technical decisions linked to requirements; then run the structural gate.
7. Run `sdd-task` to define only `TASK-###` executable work linked to designs and requirements, validation evidence, ordering, and acceptance mapping; then run the structural gate. Always include a `## Delivery and Review Forecast` applicability entry and add a `## Just-in-Time Delivery Plan` only when already triggered.
8. Run `sdd-apply` to implement `tasks.md`, update its checklist, create `apply.md`, record change-type validation evidence, and capture candidate identity only when a concrete trigger applies.
9. If attempt exhaustion occurs, the active artifact remains or becomes `BLOCKED` and records the failure class, attempts used, last evidence, and needed decision or dependency.
10. Run `sdd-verify` to derive every `REQ-###` independently from `spec.md`, inspect `apply.md`, contracts, changed files, and checks, then create a complete requirement-evidence matrix in `verify.md`.
11. If verification returns anything other than `PASS`, stop, notify the user with the exact evidence and recommended next decision, and wait. Do not return automatically to `sdd-apply` or rerun verification.
12. If receipt triggers apply, `verify.md` includes the canonical verification receipt and repeats the exact candidate identity from `apply.md`.
13. When verification evidence informs a named durable product, learning, implementation-conformance, quality, or release decision, hand exact requirement-row links and canonical IDs to `product-validation`; otherwise keep verification evidence only in the SDD tree.
14. Run `sdd-archive` only when `verify.md` is ready and passing, preserving candidate continuity when identity was triggered.

## SDD Archive Convention

Archive is mandatory after ready passing verification for every authorized Mini-SDD and Formal SDD change. It moves the complete active change tree to `openspec/archive/YYYY-MM-DD/<change-slug>/` and uses either the normal path or the defensive path according to observed risk.

### Shared terminal invariant

`READY` requires destination-only proof:

1. the canonical archive destination exists as the complete workflow tree;
2. `openspec/changes/<change-slug>/` is absent;
3. no owned temporary or retirement residue remains; and
4. any triggered candidate identity, receipt, or delivery-plan continuity remains valid.

Capture the UTC date once, require a safe slug matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`, require ready passing `verify.md`, preserve the complete tree, and never overwrite, merge, repair, delete, or roll back a proven destination. Archive never implies Git, release, or delivery authorization.

### Normal archive path

Use the normal path only when all of these are true:

- the valid source exists and the destination is absent;
- no archive or retirement residue exists for the slug;
- there is no prior failed archive attempt, concurrency concern, delayed or external delivery boundary, or other ambiguity;
- no triggered candidate identity, verification receipt, or just-in-time delivery plan requires defensive continuity proof; and
- source and destination support one atomic no-clobber rename.

Procedure:

1. Validate the source, safe slug, fixed date, absent destination, absent residue, ready workflow-specific implementation contract, and ready passing verification.
2. Create only the canonical archive date parent when needed; prove the final destination remains absent.
3. Perform one atomic no-clobber rename from the exact active source to the exact archive destination.
4. Prove the source is absent, the destination is present and complete, and no residue exists.
5. Record archive result `NORMAL_COMPLETE` and return handoff `READY` only after that destination-only proof.

A failed or ambiguous normal rename stops as `BLOCKED`; it does not automatically fall back to defensive archive or retry.

### Defensive archive path

Use the defensive path when the destination already exists, residue or a prior failure exists, concurrency or drift is plausible, candidate or receipt continuity was triggered, delivery is delayed or external, or any normal-path precondition is not trustworthy.

The defensive path must:

1. classify source, destination, and every slug-matching residue before mutation;
2. reject unsafe slugs, symlinks, unsupported file types, conflicting or partial destinations, ambiguous ownership, and changed residue;
3. freeze a deterministic whole-tree proof plus any candidate, receipt, and delivery-plan continuity;
4. publish with same-filesystem staging and atomic no-clobber semantics when the destination is absent, or prove an existing destination exactly identical without mutating it;
5. revalidate the source immediately before retirement;
6. retire through one uniquely owned same-parent stage, prove exact equality, then perform one separately evidenced delete attempt; and
7. finish with destination-only proof and no residue.

A proven destination is immutable. On collision, drift, mismatch, source reappearance, residue, or ambiguous postconditions, stop as `BLOCKED`, preserve all evidence, and notify the user.

### Attempt policy

- Normal rename, defensive publication, retirement rename, and stage deletion each receive one initial destructive attempt and zero automatic destructive retries.
- Any retry or cleanup requires explicit user authorization, a new attempt record, and fresh path, ownership, equality, absence, and continuity proof.
- Never infer success from command exit status alone; use observed postconditions.

## Artifact and Handoff Consistency Gate

After every artifact-producing phase:

1. Read the persisted artifact once.
2. Run the deterministic structural gate for status, sections, identifiers, references, and applicable coverage.
3. Compare artifact status with the delegated handoff from `AGENTS.md`.
4. Advance only when:
   - structural checks pass;
   - artifact `READY` matches handoff `READY`;
   - handoff `Blockers` is `None` when the artifact is ready;
   - evidence cites the artifact path and structural result.
5. Stop advancement when:
   - structural checks fail;
   - artifact `BLOCKED` or handoff `BLOCKED` appears;
   - handoff `FAILED` appears;
   - labels are invalid or required evidence is missing;
   - artifact and handoff statuses do not agree.
6. Treat any structural or handoff mismatch as orchestration-level `BLOCKED` until corrected.

## Skill Resolution & Prompt Contract

Before delegating a phase:

1. Resolve only skills relevant to the approved scope and current phase.
2. Read selected `SKILL.md` files before relying on them.
3. Provide only the seven dynamic fields from `AGENTS.md`: goal; known context and missing facts; scope, paths, and exclusions; governing contracts and ready artifacts; assigned skills; expected output and evidence; blockers and next permitted action.
4. Stable status, blocker, handoff, phase-output, and validation rules live in the subagent definition. Do not repeat them in delegated prompts. Add a triggered candidate, receipt, delivery, or archive excerpt only when the role cannot act safely without exact change-specific values.
5. Lean-mode subagents do not receive `AGENTS.md`, prior conversation, startup memory, or skills automatically. Pass exact assigned skill paths and only the minimal phase context listed above.

## Decision Gates

- If the user requested concrete SDD execution, begin without a second start prompt; if they asked only for advice or comparison, remain conversational.
- If product intent is materially unclear, propose optional PRD and ask the user before creating it.
- If implementation context is unknown, ask for research depth and executor only when that choice materially affects scope or risk.
- If the user explicitly asks the orchestrator to research personally, honor that choice and pass the curated result to the phase agent.
- If any artifact is `BLOCKED`, do not delegate the next phase.
- If scope changes, return to the user and confirm whether to update the current workflow or re-triage.
- If verification returns `ISSUES_FOUND` or `BLOCKED`, stop and notify the user with evidence. Do not return to `sdd-apply`, modify contracts, or rerun verification until the user explicitly chooses the next action.

## Execution Steps

1. Confirm the selected workflow and change slug from current context without reading project files.
2. Classify the request as concrete execution or discussion-only. Begin immediately for concrete execution; remain conversational for discussion-only.
3. Identify existing artifacts already available in context; do not reread them without need.
4. Resolve phase-relevant skills and prepare lean-mode prompts with only the seven dynamic fields, minimal phase context, exact assigned skill paths, and triggered change-specific values.
5. Delegate one phase at a time.
6. Read the produced artifact and enforce its status gate.
7. Compare the artifact and handoff before advancing.
8. Resolve blockers with the user and resume the same phase when needed.
9. Continue through apply and independent verification; a non-passing verification stops for user notification and decision rather than entering an automatic repair loop.
10. Archive every ready, passing Mini-SDD or Formal SDD change, preserving verified candidate continuity when triggered, and report completion only after destination-only proof.

## Output Contract

Return:

- Selected workflow and change slug.
- Request mode: `EXECUTION_AUTHORIZED` or `ADVICE_ONLY`.
- Current phase and artifact path.
- Skills assigned to the phase.
- Artifact status and blockers.
- Handoff consistency result.
- TDD evidence for apply, when applicable.
- Verification result and next permitted phase.
- Any user decision required before continuing.

## References

- `AGENTS.md` — authoritative consent, authority, context, workload, handoff, candidate, attempt-budget, and delivery-safeguard policy.
- `skills/workflow-triage/SKILL.md` — request classification and workflow routing.
- `skills/tdd/SKILL.md` — change-type test and validation guidance.
- `subagents/*.md` — lean-mode phase contracts and artifact responsibilities.
- `docs/pi-workflow-regression-scenarios.md` — non-authoritative lifecycle and archive regression catalog for reviewer maintenance.
