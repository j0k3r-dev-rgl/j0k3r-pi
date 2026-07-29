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

## Mini-SDD Lifecycle

1. Optionally run `prd-review` only when product clarification was approved.
2. The orchestrator creates or updates `mini-sdd.md` from approved context, assigned skills, and optional discovery evidence. Mini-SDD is the workflow and does not introduce a dedicated planning subagent.
3. The orchestrator checks `mini-sdd.md`; if `BLOCKED`, consult the user and update the plan before continuing.
4. Run `sdd-apply`, using `mini-sdd.md` as the implementation contract and checklist.
5. The orchestrator reads `apply.md`; if `BLOCKED`, consult the user and resume `sdd-apply`.
6. Run `sdd-verify`, reading `mini-sdd.md` and `apply.md`.
7. The orchestrator reads `verify.md` and reports `PASS`, `ISSUES_FOUND`, or `BLOCKED`.

## Formal SDD Lifecycle

1. Optionally run `prd-review` only when product clarification was approved.
2. If current context is insufficient, obtain approval and run `discovery` with a bounded research scope.
3. Run `sdd-explore` to create `explore.md` from approved context and discovery evidence.
4. Run `sdd-proposal` to create `proposal.md` from `explore.md` and optional `prd.md`.
5. Run `sdd-spec` to create `spec.md` from ready prior artifacts.
6. Run `sdd-design` to create `design.md` from ready contracts and assigned skills.
7. Run `sdd-task` to create `tasks.md` with explicit TDD work and acceptance checks.
8. Run `sdd-apply` to implement `tasks.md`, update its checklist, and create `apply.md`.
9. Run `sdd-verify` to inspect `apply.md`, contracts, changed files, and tests, then create `verify.md`.
10. Run `sdd-archive` only when `verify.md` is ready and passing.

After every numbered artifact-producing phase, the orchestrator reads the artifact once, checks `Workflow Status`, and stops for the user when blocked.

## Skill Resolution & Prompt Contract

Before delegating a phase:

1. Resolve only skills relevant to the approved scope and current phase.
2. Read selected `SKILL.md` files before relying on them.
3. Provide the subagent with:
   - approved goal and exclusions;
   - change slug and exact output path;
   - known context and curated discovery evidence;
   - required prior artifact paths;
   - approved file scope;
   - exact assigned skill paths;
   - expected status and blocker behavior.
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
2. Confirm that the user issued a separate explicit instruction to start. If not, stop with status `WAITING`.
3. Identify existing artifacts already available in context; do not reread them without need.
4. Resolve phase-relevant skills and prepare explicit lean-mode prompts.
5. Delegate one phase at a time.
6. Read the produced artifact and enforce its status gate.
7. Resolve blockers with the user and resume the same phase when needed.
8. Continue through apply and independent verification.
9. Archive only a ready, passing Formal SDD change.

## Output Contract

Return:

- Selected workflow and change slug.
- Explicit start status: `WAITING` or `AUTHORIZED`.
- Current phase and artifact path.
- Skills assigned to the phase.
- Artifact status and blockers.
- TDD evidence for apply, when applicable.
- Verification result and next permitted phase.
- Any user decision required before continuing.

## References

- `AGENTS.md` — authoritative consent, context reuse, executor choice, and orchestration policy.
- `skills/workflow-triage/SKILL.md` — pre-authorization workflow selection.
- `skills/tdd/SKILL.md` — Strict TDD execution guidance.
- `subagents/*.md` — lean-mode phase contracts and artifact responsibilities.
