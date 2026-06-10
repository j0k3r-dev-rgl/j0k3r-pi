---
name: sdd-workflow
description: Operate the project's PRD/SDD/OpenSpec workflow, including flow selection, mode gates, discovery vs SDD routing, artifact stores, phase transitions, subagent orchestration, and approval checkpoints.
---

# SDD Workflow

Use this skill when starting, continuing, validating, or closing PRD/SDD/OpenSpec work, or when deciding whether a request should use inline, simple TDD, discovery, or the formal SDD pipeline.

## Core principles

- Keep the user in control.
- Choose the lightest safe workflow.
- Do not create SDD/OpenSpec artifacts or launch SDD subagents for a new flow until the SDD mode gate is resolved.
- Use discovery for isolated research before deciding to start formal SDD.
- Use SDD subagents as phase executors only; the main agent remains the orchestrator.
- Strict TDD still applies to implementation work.
- Prefer `hybrid` artifact storage for named SDD features unless the user requests otherwise.

## When to load this skill

Load this skill before:

- creating a PRD, proposal, spec, design, task plan, verification plan, or archive;
- starting or continuing a named SDD/OpenSpec change;
- deciding whether to route a substantial request to discovery or SDD;
- launching any `sdd-*` subagent;
- applying or verifying an existing SDD task;
- recovering the state of an active SDD flow.

Do not load this skill for:

- greetings;
- tiny inline answers;
- obvious one-line fixes;
- simple code inspections that do not affect workflow choice.

## Required preflight for PRD/SDD

Before creating PRD/OpenSpec artifacts or launching any SDD subagent:

1. Run `git status --short`.
2. If the worktree has uncommitted changes, ask the user how they want to resolve it: they may commit, stash, discard, or explicitly approve continuing dirty.
3. Resolve the SDD execution mode.
4. Resolve the change slug and artifact store if needed.
5. Confirm implementation approval separately from planning approval.

The git gate does not apply to tiny inline answers or low-risk inspections that do not create artifacts or change code.

This preflight is not permission to run Git write operations. Never create commits, checkpoint commits, tags, branches, rebases, or pushes unless the user explicitly asks for that exact Git operation in the current conversation. Completing an SDD phase/slice/batch, passing tests, or updating artifacts is not approval to commit.

## Execution modes

For every new PRD/SDD/OpenSpec flow, ask which mode to use unless the user already stated it:

- `interactive`: ask before each SDD phase and before writing/updating artifacts.
- `normal`: proceed phase-by-phase with concise checkpoints at major transitions.
- `defaults`: use project defaults and ask only when blocked or when a decision materially affects scope, persistence, or implementation approval.

Do not launch SDD subagents or create/update PRD/OpenSpec artifacts for a new flow until the mode is resolved.

Suggested prompt:

> ¿Quieres que este SDD sea `interactive`, `normal`, o `defaults`?

## Flow selection

Choose the lightest workflow that safely fits the request.

| Situation | Preconditions | Flow | Subagents |
|---|---|---|---|
| Direct answer | no code change, no durable artifact value | Inline | none |
| Tiny inspection | one obvious file/answer, low risk | Inline | none |
| Small localized code fix | clear behavior, cheap validation | Simple TDD | none by default |
| Isolated research | user asks to investigate, compare, inspect code/docs/apis, or understand risk before PRD/SDD | Discovery | `discovery` |
| New named PRD/SDD planning | user wants PRD/spec/design/tasks, mode resolved, planning approved | SDD planning chain | `sdd-explore` → `sdd-proposal` → `sdd-spec` → `sdd-design` → `sdd-task` |
| Formal SDD exploration only | mode resolved and user approved named SDD exploration | SDD explore-only | `sdd-explore` |
| Implement existing SDD tasks | task artifact exists and implementation approved | SDD apply-only | `sdd-apply` |
| Verify existing implementation | code changes exist or user asks to verify SDD | SDD verify-only | `sdd-verify` |
| Continue active SDD | active memory/OpenSpec state exists or user says continue | Continue router | inspect state, then next missing phase |
| Close verified SDD | verification passed and user wants closure | Archive-only | `sdd-archive` |

When uncertain between simple TDD and SDD, prefer the lighter workflow unless the risk or artifact value is clear. Ask one concise clarification if scope, persistence, or approval is unclear.

## Discovery vs sdd-explore

Use `discovery` when research is standalone or pre-SDD:

- no OpenSpec artifacts;
- no SDD memory update;
- no source code edits;
- output is a bounded research report and next-workflow recommendation.

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

Ask one concise question when artifact persistence materially affects the workflow.

## Change slug rules

Use a stable kebab-case slug, usually derived from the feature/change name.

Examples:

- `pi-sidebar-extension`
- `sdd-workflow-skill`
- `memory-command-validation`

Before using an existing slug, inspect current OpenSpec state or active SDD memory to avoid accidental overwrite.

## Default SDD planning chain

For a new named feature where planning is approved but implementation is not:

1. `sdd-explore`
2. `sdd-proposal`
3. `sdd-spec`
4. `sdd-design`
5. `sdd-task`

Stop before implementation unless the user explicitly approves apply.

## Phase responsibilities

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

- permission to research;
- permission to start formal PRD/SDD;
- execution mode;
- artifact store when not obvious;
- implementation approval;
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
- options;
- suggested_next_workflow;
- open_questions_for_user.

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
