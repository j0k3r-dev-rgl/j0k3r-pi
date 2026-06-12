---
name: sdd-workflow
description: Operate the project's PRD/SDD/OpenSpec workflow, including PRD-first routing, existing-PRD handling, mode gates, discovery vs SDD routing, artifact stores, phase transitions, subagent orchestration, and approval checkpoints.
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# SDD Workflow

## Registry Contract

```json
{
  "category": "workflow",
  "domains": ["sdd", "prd", "openspec", "planning", "subagents", "workflow-routing"],
  "triggers": {
    "paths": [
      "openspec/**",
      "openspec/changes/**/prd.md",
      "subagents/sdd-*.md",
      "subagents/prd-review.md",
      ".pi/subagents/sdd-*.md",
      ".pi/subagents/prd-review.md",
      ".pi/skills/sdd-workflow/SKILL.md",
      ".agents/skills/sdd-workflow/SKILL.md",
      "~/.pi/agent/subagents/sdd-*.md",
      "~/.pi/agent/subagents/prd-review.md",
      "~/.pi/agent/skills/sdd-workflow/SKILL.md",
      "~/.agents/skills/sdd-workflow/SKILL.md"
    ],
    "keywords": [
      "sdd",
      "prd",
      "prd-first",
      "prd review",
      "product requirements",
      "existing prd",
      "use-existing-prd",
      "openspec",
      "proposal",
      "spec",
      "design",
      "tasks",
      "sdd apply",
      "sdd verify",
      "sdd archive",
      "apply",
      "verify",
      "archive"
    ]
  },
  "sdd_phases": ["explore", "proposal", "spec", "design", "task", "apply", "verify", "archive"],
  "related_skills": ["workflow-triage", "persistent-memory", "skill-authoring", "subagents-configuration"],
  "priority": 100
}
```

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `triggers.paths`: glob-like project paths that should activate this skill.
- `triggers.keywords`: user/request/code keywords that should activate this skill.
- `sdd_phases`: phases where this skill is usually useful: `explore`, `proposal`, `spec`, `design`, `task`, `apply`, `verify`, `archive`.
- `related_skills`: skills that should be considered when this skill is active.
- `priority`: routing priority from 0 to 100. Higher means consider earlier when multiple skills match.

## Activation Contract

Use this skill when formal PRD/SDD/OpenSpec work is requested, likely, active, being continued, validated, or closed. Use it for PRD-first planning, existing PRD handling, SDD phase orchestration, OpenSpec artifacts, SDD subagent delegation, apply/verify/archive flows, and recovery of active SDD state. For general workflow uncertainty, use `workflow-triage` first; `sdd-workflow` should not compete as the general-purpose router.

Load this skill before:

- creating a PRD, reviewing a PRD, proposal, spec, design, task plan, verification plan, or archive;
- starting or continuing a named SDD/OpenSpec change;
- deciding SDD details after `workflow-triage` or the current conversation indicates formal SDD may be warranted;
- launching any `sdd-*` or `prd-review` subagent;
- applying or verifying an existing SDD task;
- recovering the state of an active SDD flow.

Do not load this skill for:

- greetings;
- tiny inline answers;
- obvious one-line fixes;
- simple code inspections that do not affect workflow choice.

## Hard Rules

- Keep the user in control.
- Choose the lightest safe workflow.
- Do not create SDD/OpenSpec artifacts or launch SDD subagents for a new flow until the SDD mode gate is resolved.
- PRDs are optional, not mandatory for every SDD. If `openspec/changes/<change>/prd.md` exists, every SDD phase must read it completely, treat it as product/requirements source context, preserve PRD alignment in outputs, and flag conflicts, gaps, or scope drift.
- Use `workflow-triage` before discovery or SDD when the route is unclear. Use discovery only when the orchestrator lacks read-only evidence needed to decide whether formal SDD is warranted; discovery informs but does not decide the workflow.
- Treat investigation/discovery as read-only diagnosis, not permission to solve or implement.
- Use SDD subagents as phase executors only; the main agent remains the orchestrator.
- Strict TDD still applies to implementation work.
- Prefer `hybrid` artifact storage for named SDD features unless the user requests otherwise.

## Decision Gates

Ask or stop when any of these are unresolved and material to the SDD route:

- execution mode for a new PRD/SDD/OpenSpec flow (`interactive`, `normal`, or `defaults`);
- artifact store when it is not obvious or the user requested memory-only/no-artifact behavior;
- change slug when multiple named changes could be affected;
- dirty worktree scope when pending changes may be unrelated;
- whether a PRD should be created first when requirements are unclear;
- whether existing `prd.md` conflicts with proposed/spec/design/task artifacts;
- implementation approval, which is separate from PRD approval and SDD planning approval;
- archive/closure approval after verification.

## Required preflight for PRD/SDD

Before creating PRD/OpenSpec artifacts or launching any SDD subagent:

1. Run `git status --short`.
2. If the worktree has uncommitted changes, apply the dirty worktree overlap rule:
   - if the user is clearly continuing/refining/verifying the same pending SDD/change scope, continue and mention the related dirty state;
   - if starting a new unrelated SDD/change or the relationship is unclear, ask whether to commit, stash, discard, or explicitly continue with a mixed worktree.
3. Run the skill registry preflight:
   - use the `skill_registry_generate` tool with `write=true` when available; generated `.pi/skill-registry.json` and `.pi/skill-registry.md` must be added to an existing `.gitignore` when missing, and no `.gitignore` should be created when absent;
   - in interactive contexts, `/skill-registry generate` is the human command entrypoint;
   - if neither is available, stop and report that the skill-registry extension must be loaded/reloaded instead of using ad hoc fallback scripts;
   - read `.pi/skill-registry.json` after generation;
   - treat the registry as the routing index for both project-local skills (`.pi/skills`, `.agents/skills`) and global/user skills (`~/.pi/agent/skills`, `~/.agents/skills`);
   - select relevant skills by request intent, touched paths, keywords, SDD phase, priority, and related skills;
   - read each selected `SKILL.md` from the path reported by the registry before relying on it; do not assume a fixed `.pi/skills/...` location;
   - pass selected skill names, paths, and applicability notes into any delegated SDD subagent context.
4. Resolve the SDD execution mode.
5. Resolve the change slug and artifact store if needed.
6. Confirm implementation approval separately from planning approval.

The git gate does not apply to tiny inline answers or low-risk inspections that do not create artifacts or change code.

This preflight is not permission to run Git write operations. Never create commits, checkpoint commits, tags, branches, rebases, or pushes unless the user explicitly asks for that exact Git operation in the current conversation. Completing an SDD phase/slice/batch, passing tests, or updating artifacts is not approval to commit.

## Execution Steps

1. If the route is unclear, load/apply `workflow-triage` first.
2. Run the required PRD/SDD preflight before creating artifacts or launching SDD/PRD-review subagents.
3. Resolve execution mode, change slug, artifact store, and approval scope.
4. Check for `openspec/changes/<change>/prd.md`; if present, make it mandatory context for every downstream phase.
5. Choose the next phase from the flow selection table or continue router.
6. Prepare focused subagent instructions with selected skills, artifacts, allowed/forbidden actions, and expected return envelope.
7. Stop before implementation unless an approved task artifact exists and the user explicitly approved apply.
8. After meaningful work, update active SDD state/memory and report validation, risks, and next recommended step.

## Execution modes

For every new PRD/SDD/OpenSpec flow, ask which mode to use unless the user already stated it:

- `interactive`: ask before each SDD phase and before writing/updating artifacts.
- `normal`: proceed phase-by-phase with concise checkpoints at major transitions.
- `defaults`: use project defaults and ask only when blocked or when a decision materially affects scope, persistence, or implementation approval.

Do not launch SDD subagents or create/update PRD/OpenSpec artifacts for a new flow until the mode is resolved.

Suggested prompt:

> ¿Quieres que este SDD sea `interactive`, `normal`, o `defaults`?

## Flow selection

Choose the lightest workflow that safely fits the request, but treat policy-sensitive agent behavior changes as higher risk than ordinary docs/config edits.

Policy-sensitive paths include `AGENTS.md`; project-local skills/subagents such as `.pi/skills/**`, `.agents/skills/**`, and `.pi/subagents/**`; global/user agent skills/subagents such as `~/.pi/agent/skills/**`, `~/.agents/skills/**`, and `~/.pi/agent/subagents/**`; `.pi/permissions.json`; `.pi/memory.json`; `.pi/context7.json`; `.pi/subagents.json` and `~/.pi/agent/subagents.json`; and workflow/memory/permission/skill-registry/subagent extension code.

| Situation | Preconditions | Flow | Subagents |
|---|---|---|---|
| Direct answer | no code change, no durable artifact value | Inline | none |
| Tiny inspection | one obvious file/answer, low risk | Inline read-only | none |
| Investigation/review/diagnosis | user asks to investigate, compare, inspect code/docs/apis, or understand risk before implementation | Read-only investigation; use `workflow-triage` when routing is unclear; use Discovery only when delegated research adds value | `discovery` only when useful |
| Small localized code fix | clear behavior, cheap validation | Simple TDD | none by default |
| One-extension or one-module change | existing tests, limited architecture risk, no durable artifact value | Simple TDD | none by default |
| Documentation-only cleanup | no behavior change, no durable spec value, not policy-sensitive | Inline edit with focused validation | none by default |
| Policy-sensitive agent behavior change | touches agent instructions, skills, subagents, permissions, memory/config, workflow extension behavior, or future agent behavior | Use `workflow-triage` first; inline/docs-only for small clear fixes; discovery only when evidence is missing; formal SDD only when risk or artifact value warrants it | `discovery` only for needed evidence; SDD phase agents only after formal planning is approved |
| PRD-first SDD planning | complex product/integration/UX/auth/security/architecture work needs requirements definition before SDD | PRD discovery/draft/review, then SDD planning after PRD approval | `discovery` as needed → `prd-review` → SDD phase agents |
| Existing PRD SDD planning | `openspec/changes/<change>/prd.md` exists | PRD-aware SDD planning sequence; every phase reads the PRD | `prd-review` when not already reviewed → SDD phase agents |
| New named PRD/SDD planning | user wants PRD/spec/design/tasks, mode resolved, planning approved | SDD planning sequence; PRD optional unless requested or warranted | `sdd-explore` → `sdd-proposal` → `sdd-spec` → `sdd-design` → `sdd-task` |
| Multi-file/cross-cutting feature from scratch | unclear requirements, new API/contract, architecture risk, or handoff value | Full SDD feature sequence | planning sequence → approved `sdd-apply` → `sdd-verify` → optional `sdd-archive` |
| Formal SDD exploration only | mode resolved and user approved named SDD exploration | SDD explore-only | `sdd-explore` |
| Implement existing SDD tasks | task artifact exists and implementation approved | SDD apply-only | `sdd-apply` |
| Verify existing implementation | code changes exist or user asks to verify SDD | SDD verify-only | `sdd-verify` |
| Continue active SDD | active memory/OpenSpec state exists or user says continue | Continue router | inspect state, then next missing phase |
| Close verified SDD | verification passed and user wants closure | Archive-only | `sdd-archive` |

When uncertain between simple TDD and SDD, prefer the lighter workflow unless the risk or artifact value is clear. Ask one concise clarification if scope, persistence, or approval is unclear.

Routing guardrails:

- Investigation/discovery is read-only by default. It must give the orchestrator enough evidence to present options or questions to the user and wait for the user's decision.
- Do not convert investigation into implementation unless the user explicitly approves the selected path.
- For localized extension/module changes with tests, use Simple TDD rather than full SDD unless there is new API/contract or cross-cutting architecture risk.
- Do not downshift policy-sensitive, cross-cutting, or future-agent-behavior changes to inline/simple TDD just because they look like docs/config edits.
- Before editing policy-sensitive files, state the selected workflow and why it is safe; use `workflow-triage` first when impact is unclear, use discovery only for missing evidence, and use SDD only when risk or artifact value warrants it.
- For broad or ambiguous work, use `workflow-triage` before deciding whether discovery or SDD is needed; do not delegate discovery just because the request is ambiguous.
- For full SDD, implementation approval is separate from planning approval; do not use `sdd-apply` until tasks exist and apply is approved.

## Investigation and decision gate

When the user asks to investigate, inspect, review, analyze, diagnose, compare, "look at", or "see what happens", default to read-only investigation.

Rules:

- Investigation/discovery/exploration is not implementation approval.
- Do not edit files, add tests, refactor, change configuration, update OpenSpec artifacts, or save durable memory unless that action is explicitly part of the approved workflow.
- After investigation, report the cause or likely cause, evidence, uncertainty, impact, and viable options. The orchestrator chooses and presents the next step; discovery does not own workflow routing.
- Ask the user to choose whether to implement an option, keep researching, defer, or pick another solution.
- Never move from discovery/exploration into `sdd-apply` or simple TDD implementation without explicit user approval for the selected path.

## Discovery vs sdd-explore

Use `discovery` when research is standalone or pre-SDD and the orchestrator needs read-only evidence:

- no OpenSpec artifacts;
- no SDD memory update;
- no source code edits;
- output is a bounded research report with requested facts, constraints, options, risks, and unknowns;
- the orchestrator must interpret the report, choose the next workflow, present options/questions to the user, and wait for the user's decision before implementation.

Use `sdd-explore` only after the user approved a named SDD flow and the execution mode is resolved:

- may create/update `openspec/changes/<change>/exploration.md`;
- may create/update active SDD flow memory;
- output feeds proposal/spec/design/tasks.

For large Pi documentation work:

- before SDD approval, use `discovery`;
- after SDD approval, use `sdd-explore`;
- the orchestrator should avoid loading long Pi docs directly except for narrow inline answers.

## Artifact store policy

Default for named SDD features: `hybrid`.

- `hybrid`: OpenSpec files are source of truth; memory stores compact state and handoff.
- `openspec`: OpenSpec files are source of truth; memory may store minimal pointer/index.
- `memory`: no files; active SDD memory must include enough detail for continuation.
- `none`: only for discovery or non-persistent planning; not for formal SDD unless explicitly requested.

Canonical OpenSpec artifact names:

- Active change spec: `openspec/changes/<change>/spec.md`.
- Active verification report: `openspec/changes/<change>/verify-report.md`.
- Archive may sync source-of-truth capability specs under `openspec/specs/<capability>/spec.md` from the change artifacts when applicable.

Ask one concise question when artifact persistence materially affects the workflow.

## Change slug rules

Use a stable kebab-case slug, usually derived from the feature/change name.

Examples:

- `pi-sidebar-extension`
- `sdd-workflow-skill`
- `memory-command-validation`

Before using an existing slug, inspect current OpenSpec state or active SDD memory to avoid accidental overwrite.

## Optional PRD flow

Use a PRD-first route when the user asks for a PRD or when complex product, UX, integration, OAuth/auth, security, or architecture work needs requirements definition before formal proposal/spec/design/tasks.

PRD creation expectations:

1. Gather enough evidence to write a strong PRD: user goals, local files, project docs, Pi docs, installed package/node_modules sources, Context7 docs, internet/web references when available, and temporary external repository clones when useful.
2. Ask the user only decision-critical questions; do not invent hidden requirements.
3. Write or update `openspec/changes/<change>/prd.md` when artifact storage is `openspec` or `hybrid`; otherwise store the PRD content in active SDD flow memory.
4. Run `prd-review` before downstream SDD unless the user explicitly waives review.
5. Resolve CRITICAL PRD debts, contradictions, untestable requirements, or open product decisions before implementation.

Existing PRD rule:

- If `openspec/changes/<change>/prd.md` exists, it is mandatory context for `sdd-explore`, `sdd-proposal`, `sdd-spec`, `sdd-design`, `sdd-task`, `sdd-apply`, `sdd-verify`, and `sdd-archive`.
- Each phase output should include a concise `PRD Alignment` section or equivalent notes covering relevant PRD requirements, assumptions, gaps, and conflicts.
- If an SDD artifact conflicts with the PRD, the phase must report `blocked` or flag the conflict clearly instead of silently overriding the PRD.

## Default SDD planning sequence

For a new named feature where planning is approved but implementation is not:

1. Optional PRD draft/review when requested, warranted, or already present.
2. `sdd-explore`
3. `sdd-proposal`
4. `sdd-spec`
5. `sdd-design`
6. `sdd-task`

Stop before implementation unless the user explicitly approves apply.

## Phase responsibilities

### prd-review

Purpose: review an existing or newly drafted PRD before downstream SDD planning or implementation.

Inputs:

- change slug;
- artifact store;
- `openspec/changes/<change>/prd.md` or supplied PRD text;
- relevant user constraints and supporting context.

Outputs:

- `openspec/changes/<change>/prd-review.md` or memory equivalent;
- readiness verdict (`ready_for_sdd: yes/no/with warnings`);
- critical debts, warnings, testability gaps, contradictions, and user/orchestrator questions;
- recommended next step.

Critical PRD debts should block implementation until the orchestrator/user resolves them.

### sdd-explore

Purpose: understand current state, affected areas, approaches, risks, and recommendation.

Inputs:

- change slug;
- artifact store;
- user request;
- relevant docs/code paths;
- prior discovery report if any.

Outputs:

- exploration artifact or memory section;
- recommendation;
- open questions;
- readiness for proposal.

### sdd-proposal

Purpose: product/PRD-level proposal.

Outputs should include:

- problem statement;
- goals and non-goals;
- users/personas;
- MVP scope;
- user stories;
- acceptance criteria;
- UX/product behavior;
- risks;
- open questions;
- rollout/validation notes.

### sdd-spec

Purpose: normative requirements and scenarios.

Outputs should include:

- capabilities or requirements changed;
- SHALL-style requirements;
- scenarios/examples;
- edge cases;
- compatibility constraints.

### sdd-design

Purpose: technical design.

Outputs should include:

- architecture;
- affected modules/files;
- data flow;
- APIs/interfaces;
- testing strategy;
- risk mitigations;
- alternatives considered.

### sdd-task

Purpose: implementation task breakdown.

Outputs should include:

- ordered tasks;
- dependencies;
- acceptance checks per task;
- TDD/test-first expectations;
- validation commands;
- apply slices suitable for approval.

### sdd-apply

Purpose: implement approved task slices only.

Rules:

- use strict TDD;
- do not expand scope beyond approved tasks;
- report changed files and validations;
- stop and ask if a new product/design decision appears.

### sdd-verify

Purpose: verify implementation against artifacts.

Rules:

- report issues; do not fix unless orchestrator starts a new apply task;
- run relevant tests/validation;
- compare implementation to PRD/spec/design/tasks;
- identify residual risks.

### sdd-archive

Purpose: close verified SDD work.

Rules:

- only after verification passes and user wants closure;
- sync source-of-truth artifacts;
- update compact memory/project state if appropriate;
- summarize decisions, validations, and remaining follow-ups.

## Continue router

When the user says continue, recover state in this order:

1. Current conversation.
2. Active SDD flow memory if needed.
3. OpenSpec files under `openspec/changes/<change>/`.

Then choose next missing phase:

- no discovery/exploration and request unclear → discovery or `sdd-explore` depending on SDD approval;
- no proposal → `sdd-proposal`;
- no spec → `sdd-spec`;
- no design → `sdd-design`;
- no tasks → `sdd-task`;
- tasks incomplete and implementation approved → `sdd-apply`;
- implementation complete but not verified → `sdd-verify`;
- verification passed and closure requested → `sdd-archive`.

## Approval checkpoints

Always separate these approvals:

- permission to research/read-only investigate;
- permission to start formal PRD/SDD;
- execution mode;
- artifact store when not obvious;
- permission to persist artifacts or durable memory when not already part of the approved workflow;
- implementation/remediation approval for the selected option;
- archive/closure approval.

In `interactive` mode, ask before every phase and artifact write/update.
In `normal` mode, provide concise status checkpoints between major phases. A checkpoint is a conversational progress update, not a Git commit.
In `defaults` mode, ask only for blockers or material decisions.

## Subagent orchestration checklist

Before launching a subagent, prepare a focused task with:

- phase name and goal;
- change slug;
- artifact store;
- execution mode implications;
- current known state;
- required prior artifact paths/summaries;
- relevant skills loaded from the skill registry, including skill name, `SKILL.md` path, why it applies, and any related skills deliberately loaded or discarded;
- allowed and forbidden actions;
- expected return envelope;
- validation expectations, when relevant.

Do not run dependent phases in parallel. Run phases sequentially unless they are genuinely independent.

## Expected subagent return envelope

Require:

- status: `success`, `partial`, or `blocked`;
- executive_summary;
- artifacts written/updated;
- memory ids written/updated;
- risks/issues;
- validations, when relevant;
- next_recommended.

Discovery may additionally return:

- research_question;
- sources_inspected;
- findings;
- options, when the orchestrator asked for option comparison;
- workflow_relevant_observations, when useful;
- open_questions_or_missing_info.

Discovery does not choose the workflow; the orchestrator interprets the evidence and decides the route.

## Output Contract

When this skill affects the answer, return a concise SDD workflow decision or phase report:

- Skill applied: `sdd-workflow`.
- Change slug and artifact store.
- Execution mode and approval state.
- PRD status: absent, present/read, review needed, or blocking conflict.
- Selected phase/next phase and why.
- Subagents launched or explicitly not needed.
- Artifacts/memory updated.
- Validation, risks, blockers, and next recommended step.

## References

- `AGENTS.md` — primary orchestrator policy, SDD gates, dirty worktree rules, TDD, memory, and Git policy.
- `skills/workflow-triage/SKILL.md` — route selection before formal SDD when workflow is unclear.
- `skills/skill-authoring/SKILL.md` — canonical skill format and registry contract conventions.
- `skills/subagents-configuration/SKILL.md` — subagent definition and configuration policy.
- `subagents/prd-review.md` — PRD review executor.
- `subagents/sdd-*.md` — SDD phase executors.
- `openspec/changes/<change>/prd.md` — optional but mandatory context when present.

## Memory rules for SDD

- Subagents may update only the active SDD flow memory and only as compact index/state/handoff.
- Long-form artifacts belong in OpenSpec when artifact store is `openspec` or `hybrid`.
- The orchestrator owns durable non-SDD memories, project profile updates, and consolidation.
- Save only durable, non-sensitive decisions, constraints, commands, learnings, todos, and progress.

## End-of-work checkpoint

After meaningful SDD/discovery work, summarize:

- what changed;
- confirmed decisions;
- progress;
- validations;
- open todos/questions;
- accepted risks;
- reusable learnings.

Save only durable non-sensitive items to memory when useful.
