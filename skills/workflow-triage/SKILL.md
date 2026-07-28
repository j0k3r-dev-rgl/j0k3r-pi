---
name: workflow-triage
description: "Mandatory routing gate before any non-trivial edit (including user-ordered fixes, corrections, and refactors). Determines whether to ask clarifying questions, stay inline, use simple TDD, delegate read-only discovery, or start mini-sdd or formal SDD."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.6"
---

# Workflow Triage

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "workflow",
  "domains": ["workflow", "triage", "intake", "routing", "clarification", "discovery", "sdd"],
  "triggers": {
    "paths": [
      "AGENTS.md",
      "skills/workflow-triage/SKILL.md",
      "skills/sdd-workflow/SKILL.md",
      "subagents/discovery.md",
      "subagents/prd-review.md",
      "subagents/sdd-*.md",
      "~/.pi/agent/skills/workflow-triage/SKILL.md",
      "~/.pi/agent/subagents/discovery.md"
    ],
    "keywords": [
      "workflow",
      "triage",
      "intake",
      "route",
      "routing",
      "clarify",
      "ambiguous",
      "unclear",
      "investigate",
      "discovery",
      "code research",
      "code-research",
      "evidence packet",
      "subagent delegation",
      "orchestrator evidence",
      "prd",
      "product requirements",
      "prd-first",
      "prd-first-sdd",
      "use-existing-prd-sdd",
      "prd review",
      "simple tdd",
      "minimal delegated apply",
      "mini-sdd",
      "mini sdd",
      "delegated batch apply",
      "tracker-based apply",
      "sdd",
      "openspec",
      "which workflow",
      "best workflow",
      "fix",
      "fix it",
      "corrige",
      "arregla",
      "refactor",
      "cambia",
      "modify",
      "update code",
      "bug fix",
      "patch",
      "correct"
    ]
  },
  "sdd_phases": ["explore", "proposal", "spec", "design", "task", "apply", "verify", "archive"],
  "related_skills": [
    "sdd-workflow",
    "skill-authoring"
  ],
  "priority": 95
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

Use this skill as the **mandatory routing gate before any non-trivial edit**, including user-ordered fixes, corrections, and refactors. Load it whenever the next workflow could plausibly be anything other than a truly trivial single-file change, and whenever the work is non-trivial enough that choosing the wrong route could waste time or change behavior incorrectly.

Typical triggers:

- the user asks to investigate, compare, analyze, diagnose, plan, design, or choose an approach;
- the request could plausibly be inline, simple TDD, discovery, mini-SDD, PRD-first, or formal SDD;
- the work touches agent behavior, skills, subagents, permissions, memory/config, workflow extensions, or future-agent behavior;
- the assistant is about to delegate or create artifacts mainly because of uncertainty.

Do not load this skill only for greetings or obvious direct answers. A user-ordered fix or correction does NOT count as "route already clear": load this skill and state the chosen route before editing, even when implementation was explicitly requested.

## Hard Rules

- The orchestrator owns workflow selection. Subagents do not load this skill, ask the user's workflow questions, or make the final workflow decision.
- Choose the lightest safe workflow.
- Never invent hidden requirements. Ask a concise clarifying question when intent, success criteria, scope, constraints, or approval are unclear.
- Investigation and diagnosis are read-only by default.
- Implementation approval is separate from investigation, planning, verification, and commit approval.
- Apply the hard workspace, context-cache, command-economy, and user-specified inspection boundaries from `AGENTS.md`. Routing never invalidates already-current context, never triggers mechanical rereads, repository inventories, or routine Git commands, and must not broaden requested surfaces. Only explicitly approved discovery/documentation research may widen research scope.
- Do not call `discovery` before applying triage when routing is unclear or before resolving the session-scoped executor choice required by `AGENTS.md`.
- When investigation is needed, route it through the executor selected by the user: bounded direct inspection by the orchestrator or bounded read-only `discovery`. Investigation output is not implementation approval.
- Use formal SDD only when the change is genuinely cross-cutting, high-risk, contract-changing, architecture-bearing, or needs durable artifacts; formal SDD phases are delegated to `sdd-*` subagents by default.
- Let the orchestrator handle direct implementation only when it already has enough context, the change is localized and low-risk, and inline execution is the lightest safe path; otherwise choose `mini-sdd` or SDD phase agents. Missing investigation context is resolved separately through the user-selected executor from `AGENTS.md`.
- PRDs are optional. Use PRD-first only when the user asks for a PRD or when product requirements genuinely need clarification before downstream SDD.
- When the user's implementation instruction, scope, expected behavior, and execution preference are already explicit, select the lightest safe matching route and proceed without offering redundant workflow choices. Ask only for a material missing decision.
- Multi-file or policy-sensitive scope affects route safety, but it does not authorize unrelated inspection or repeated ceremony. Recommend mini-SDD/formal SDD only when it adds necessary control; honor explicit direct execution when allowed by `AGENTS.md` and report its review requirements.
- For user-requested commits, follow the Git commit policy in `AGENTS.md`; triage is not commit permission.
- Every non-trivial or risk-bearing code-writing route must load `skills/sdd-workflow/executor-contract.md`. Route selection never waives exact mechanism fidelity, risk-based slices, first-class remediation packets, negative evidence, or the pre-return success gate.
- Security, secrets, authorization, persistence, process lifecycle, concurrency, migrations, permissions, or destructive behavior cannot use ordinary `simple-tdd`. Use `simple-tdd-with-review` only when the change is genuinely bounded and has an independent review path; otherwise select mini-SDD or formal SDD.
- Before every new formal SDD or mini-SDD, ask both flow-selection questions: artifact store (`openspec`, `engram`, or `hybrid`) and execution mode (`interactive` or `auto`). Apply the same gate to a minimal delegated apply that starts a new lifecycle. Ask even after PRD approval or a prior flow. For continuation, reuse the locked active-flow snapshot and do not ask again.

## Policy-Sensitive Gate

Treat changes to agent behavior as higher risk than ordinary docs/config edits.

Policy-sensitive surfaces include:

- `AGENTS.md`
- skills and subagents under project-local or global agent directories
- `.pi/permissions.json`, `.pi/memory.json`, `.pi/context7.json`, `.pi/subagents.json`
- workflow, memory, permission, skill-registry, or subagent extension code

Rules:

- if the user asked to investigate, stay read-only and report options first;
- if implementation is approved, state the chosen workflow before editing;
- inline/docs-only is acceptable only for small explicit localized fixes with low future-behavior risk.

## Code Evidence Packet

Use the compact evidence-packet contract from `AGENTS.md` for workspace investigation. Triage consumes that packet to choose a route; it must not repeat the underlying investigation.

When delegating subsequent work, pass only the relevant packet facts, constraints, unknowns, and acceptance checks to the selected investigation executor or SDD phase subagent so it does not rediscover known context.

## Change-kind classification

Record the applicable development context before routing; multiple kinds may apply:

- `greenfield`: new code from zero;
- `legacy-continuation`: resume or extend old code;
- `migration`: move state, API, data, runtime, or architecture between source and target;
- `feature`: add behavior;
- `bugfix`: correct reproducible behavior;
- `refactor`: preserve behavior while changing structure;
- `removal`: delete behavior, compatibility surfaces, or obsolete code.

Change kind determines required evidence and validation, not workflow weight. A localized migration or legacy fix may remain small; a greenfield feature may still require formal planning when its contracts are broad.

## Route Catalog

Choose and state one route before editing non-trivial scope:

1. `inline-answer` — direct explanation or opinion.
2. `inline-readonly` — tiny inspection with no edits.
3. `inline-docs-only` — small approved wording/config/doc edit with low behavior risk.
4. `simple-tdd` — localized low-risk code change with clear behavior and cheap validation; must end with focused tests, executor-contract success checks, and a lightweight scope review.
5. `simple-tdd-with-review` — bounded risk-bearing change implemented by the main agent with focused validation, executor-contract compliance, and a mandatory independent final review. It is not valid for broad security/persistence/process/concurrency work.
6. `mini-sdd` — medium taskable multi-file work using the lightweight `sdd-explore → approved sdd-apply → sdd-verify → approved sdd-archive` lifecycle.
7. `minimal-delegated-apply` — tracker-backed mechanical variant that may skip explore when its evidence is complete, while retaining approved apply, verify, summary, and approved archive.
8. `discovery` — bounded read-only delegated research when the user selected `discovery` under the session-scoped executor choice in `AGENTS.md`.
9. `prd-first-sdd` — product requirements need clarification before formal SDD artifacts.
10. `use-existing-prd-sdd` — an existing PRD must be approved, revised, reviewed, or explicitly continued as-is, then returned to triage for a separate downstream route decision.
11. `formal-sdd` — substantial or cross-cutting work needing proposal/spec/design/tasks, delegated to SDD phase subagents by default.
12. `sdd-explore`, `sdd-apply`, `sdd-verify`, `sdd-archive` — continue an approved SDD lifecycle under the mode and mandatory approval gates defined by `sdd-workflow`.
13. `blocked-ask-user` — a required decision is missing.

## Routing Table

| Situation | Default route | Notes |
|---|---|---|
| simple question, explanation, opinion | `inline-answer` | no tools unless investigation is requested |
| tiny inspection of one obvious file/path | `inline-readonly` | inspect minimally |
| missing source-code context before route choice | resolve the `AGENTS.md` executor choice, then use bounded direct inspection or `discovery` | consume a compact evidence packet without repeating the investigation |
| user asks to investigate, compare, diagnose, analyze | resolve the `AGENTS.md` executor choice and keep the selected path read-only | report findings, then wait for the next decision |
| small localized implementation with clear behavior | `simple-tdd` | ask route first unless truly trivial; if context is missing, resolve it through the investigation executor selected under `AGENTS.md` |
| medium taskable multi-file change that does not need formal specification phases | `mini-sdd` | run explore → approved apply → verify → summary → approved archive |
| tracker-backed mechanical migration | `minimal-delegated-apply` | may skip explore only when prior evidence is complete; retain apply and archive gates |
| policy-sensitive but still localized edit | `simple-tdd-with-review` or `inline-docs-only` | only if scope is explicit, bounded, and independently reviewable |
| security, secrets, persistence, process lifecycle, concurrency, migrations, permissions, or destructive code | `mini-sdd` or `formal-sdd` | require executor-contract slices and independent review; never ordinary simple-TDD |
| product requirements unclear or PRD requested | `prd-first-sdd` | orchestrator drafts PRD with the user |
| existing PRD in scope | `use-existing-prd-sdd` | resolve approval/review state first, then return to triage |
| approved PRD ready for downstream work | route again from approved requirements | user chooses mini-SDD, formal SDD, another route, or defer; PRD approval is not implementation approval |
| cross-cutting, new API/contract, durable handoff value | `formal-sdd` | load `sdd-workflow` core plus needed companions; delegate phases by default |
| existing approved SDD lifecycle to continue | `sdd-explore` / `sdd-apply` / `sdd-verify` / `sdd-archive` | recover locked flow-local state without re-asking and enforce apply/archive approval gates |

Interpretation rules:

- “investigate/analyze/review” is not implementation approval;
- PRD approval does not select mini-SDD, formal SDD, or implementation; return to triage for that decision;
- do not upshift a clear localized fix to formal SDD just because it is non-trivial;
- however, always offer `mini-sdd` or proposal-first as an option when the user did not explicitly choose a route, even for localized fixes; "do not upshift" does not mean "default to `simple-tdd` silently";
- do not downshift a cross-cutting or future-agent-behavior change to inline work just because it looks like docs/config.

## Decision Gates

Ask one concise question when any of these materially affect the route:

- desired outcome or success criteria;
- investigation only vs implementation;
- selected option when multiple materially different options exist;
- execution mode for every new formal SDD or mini-SDD (`interactive` or `auto`), regardless of prior selections;
- artifact store for every new formal SDD or mini-SDD (`openspec`, `engram`, or `hybrid`), regardless of prior selections;
- whether a PRD is needed, already approved, needs `prd-review`, needs revision, or is waived;
- dirty worktree scope when overlap is unclear;
- whether future agent behavior should change globally or only project-locally.

## Follow-On Skill Loading

After choosing the route:

- load `sdd-workflow` core when formal SDD/OpenSpec work is likely or requested, when `mini-sdd` / `minimal-delegated-apply` will use their explore/apply/verify/archive lifecycle, or when continuing an SDD phase;
- load `skills/sdd-workflow/phase-commit-contract.md` for every `prd-review` or `sdd-*` phase transition;
- load `skills/sdd-workflow/executor-contract.md` for every non-trivial or risk-bearing code-writing route, including direct/simple TDD and remediation;
- use `discovery` for missing bounded read-only evidence only when the user selected it under the session-scoped rule in `AGENTS.md`; otherwise inspect directly within the agreed scope;
- consider `skill-authoring` when creating or changing skills;
- for durable decisions, consolidation, migration, or session-end memory behavior, follow `AGENTS.md` and the current Engram tool contract directly.

## Execution Steps

1. Restate the request in one sentence.
2. Classify the user intent.
3. Identify risk factors: policy-sensitive surfaces, cross-cutting impact, contract/API/persistence/security changes, dirty worktree overlap, missing validation, external-doc uncertainty.
4. If investigation is needed, apply the session-scoped executor-choice gate from `AGENTS.md`; do not select or call `discovery` automatically.
5. Run bounded direct inspection or delegate bounded read-only `discovery`, according to the user's choice, and produce or consume the compact evidence packet defined by `AGENTS.md`.
6. Decide whether a clarifying question is required before any edit, delegated apply, or artifact creation.
7. Choose the lightest safe route from the route catalog.
8. When the selected route is a new formal SDD or mini-SDD, ask both flow-selection questions before handoff. When it is continuation, validate/reuse the locked selection without asking.
9. State the chosen workflow before editing policy-sensitive files.
10. Reuse current conversation/file/worktree/Skill Registry context. Do not reread files or rerun status/search/registry commands merely because routing advanced. Generate the registry once only if necessary or explicitly requested; never regenerate it in the same session.
11. The orchestrator resolves only the skills needed for the flow and records them in `flow_skill_plan`. Subagents receive that plan, read only those skills, and return `skill_gap` instead of invoking registry tools.
12. After meaningful work, perform the Engram decision checkpoint from `AGENTS.md`.

## Output Contract

When this skill affects the answer, return a concise workflow decision:

- Skill applied: `workflow-triage`.
- Request classification.
- Key risks or why risk is low.
- Chosen workflow and why it is the lightest safe option.
- Compact evidence-packet summary when local context was needed.
- Investigation executor selected for this session or request; if `discovery`, the exact evidence or open questions delegated.
- Clarifying question or approval needed from the user, if any.
- Follow-on skills considered or loaded.
- Validation, memory, and commit implications when relevant, including the lightweight review/verify path for `simple-tdd`.

## References

- `AGENTS.md` — global guardrails, approvals, dirty worktree, TDD, memory, and Git policy.
- `skills/sdd-workflow/SKILL.md` — formal SDD/OpenSpec core routing and companion-module loading policy.
- `skills/sdd-workflow/phase-commit-contract.md` — mandatory logical transaction, exact attempt/lease identity, evidence coverage, resume, and persisted-receipt return rules for every PRD/SDD phase.
- `skills/sdd-workflow/executor-contract.md` — exact mechanism, risk-based slice, remediation, negative-evidence, and success gates for every code-writing route.
- `subagents/discovery.md` — bounded read-only research executor.
- `skills/skill-authoring/SKILL.md` — canonical skill format and registry contract conventions.
