# Markdown Audit and SDD/ISDD Research

## Purpose

This document captures the current investigation so the remaining work can be handled incrementally.

It combines two tracks:

1. a read-only audit of first-party markdown documentation in this repository;
2. a read-only research summary about SDD and the more implementation-oriented/engineering-oriented framing the project may want to call `ISDD`.

## Investigation Scope

### Markdown audit scope

Reviewed sources included:

- `README.md`
- `AGENTS.md`
- `docs/*.md`
- `extensions/*/README.md`
- `skills/**/SKILL.md`
- `subagents/*.md`
- `openspec/**`
- `.pi/skill-registry.md`

### SDD / ISDD research scope

Reviewed sources included:

- repository workflow docs and skills
- OpenSpec artifacts already present in the repo
- Context7 sources related to OpenSpec and SDD-like workflows

### Limitations

This investigation did **not** have a generic browser/web/forum/article tool available.

So:

- external coverage is limited to what could be inspected through **Context7**;
- no unsupported claims about web/forum/article consensus should be inferred from this document.

## Current Behavior Baseline Used for Validation

The markdown audit validated docs against the current implemented behavior:

- Memory is opt-in via `.pi/memory.json` with `enabled: true`; default is `false`.
- Skill Registry is opt-in via `.pi/skill-registry.config.json` with `enabled: true`; default is `false`.
- Memory backups use `backups.include_sessions` as the primary flag.
- Legacy `backups.include_prompts` is fallback-only compatibility.
- Memory migration surface/tool has been removed.
- Session/subagent lineage remains metadata-based via `memory_sessions.metadata_json` plus `memory_session_prompts`.
- The related OpenSpec change is archived under `openspec/changes/archive/2026-06-17-memory-skill-registry-enable-gates/`.

---

# Part I — Markdown Inconsistency Audit

## Executive Summary

Core docs are mostly aligned with current Memory and Skill Registry behavior.

The main inconsistencies are:

1. workflow route vocabulary drift across top-level policy and workflow skills;
2. contradictory backup examples vs cautionary guidance in Memory docs/skills;
3. stale references inside the archived OpenSpec packet;
4. a few low-risk archive hygiene issues.

## Findings

### F1 — Workflow route names conflict between `AGENTS.md` and workflow skills

**Severity:** Medium

**Evidence:**

- `AGENTS.md` defines a mandatory route list centered on:
  - `inline` / `simple-tdd`
  - `simple-tdd-with-review`
  - `mini-sdd`
  - `prd-first`
  - `formal-sdd`
- `skills/workflow-triage/SKILL.md` introduces additional route names such as:
  - `inline-answer`
  - `inline-readonly`
  - `inline-docs-only`
  - `minimal-delegated-apply`
  - `prd-first-sdd`
  - `use-existing-prd-sdd`
  - `blocked-ask-user`
- `skills/sdd-workflow/SKILL.md` also treats `minimal delegated apply` as a named flow.
- `AGENTS.md` later references `minimal-delegated-apply` in verification language even though it is not defined in the earlier mandatory route list.

**Impact:**

- workflow policy is not fully self-consistent;
- route naming can become ambiguous during orchestration and verification;
- future policy changes are easier to drift.

**Suggested remediation:**

- define a single canonical taxonomy in `AGENTS.md` and make workflow skills inherit it verbatim; or
- explicitly define aliases/sub-routes in `AGENTS.md` so the expanded route set is first-class.

---

### F2 — Memory backup examples contradict the cautionary guidance

**Severity:** Medium

**Evidence:**

- `extensions/memory/README.md` “Recommended project config” uses `"include_sessions": true`.
- The same README says `backups.include_sessions=true` should be used only when the project intentionally wants session and session-prompt export/import.
- `skills/memory-configuration/SKILL.md` also uses `"include_sessions": true` in the recommended config.
- That skill also recommends `backups.include_sessions=false` unless the user intentionally wants session audit data in backups.

**Impact:**

- operators may copy the “recommended” example and enable session/prompt export unintentionally;
- backup contents may become broader than expected.

**Suggested remediation:**

- make the default recommended example use `include_sessions: false`; and
- add a second clearly labeled example for intentionally session-inclusive backups.

---

### F3 — Archived OpenSpec packet still contains stale pre-archive paths

**Severity:** Low

**Evidence:**

Inside `openspec/changes/archive/2026-06-17-memory-skill-registry-enable-gates/`:

- `spec.md`, `proposal.md`, `design.md`, `tasks.md`, and `verify-report.md` still refer to paths like:
  - `openspec/changes/memory-skill-registry-enable-gates/...`
- those paths no longer exist as active change paths after archival.

**Impact:**

- archive packet is not fully self-contained;
- later readers may follow stale active paths instead of archived ones.

**Suggested remediation:**

- rewrite internal references during archival; or
- add an explicit archive note explaining that pre-archive paths should now be interpreted relative to the archived directory.

---

### F4 — Archived `apply-progress.md` references a nonexistent Skill Registry file path

**Severity:** Low

**Evidence:**

`openspec/changes/archive/2026-06-17-memory-skill-registry-enable-gates/apply-progress.md` lists:

- `extensions/skill-registry/src/index.ts`

But the actual file is:

- `extensions/skill-registry/index.ts`

**Impact:**

- minor traceability confusion in historical artifacts.

**Suggested remediation:**

- correct the archived file path; or
- note it as an archive erratum if archive immutability is preferred.

---

### F5 — Memory README validation counts are stale

**Severity:** Low

**Evidence:**

- `extensions/memory/README.md` still mentions an older validation count.
- later verification for the current behavior change passed with a higher test count.

**Impact:**

- low trust in README freshness;
- minor friction for readers using the README as a validation baseline.

**Suggested remediation:**

- update the number; or
- remove exact totals and keep only commands + generic pass expectations.

---

### F6 — Some archive/task docs still read like the change is active

**Severity:** Low

**Evidence:**

- some archived docs still say things like a file “was updated at” an active path under `openspec/changes/<slug>/...`
- after archival, those references are no longer live.

**Impact:**

- low-risk documentation hygiene issue;
- historical packet is slightly noisier than ideal.

**Suggested remediation:**

- normalize wording in archives to “updated before archival”; or
- rewrite paths to archived equivalents.

## Prioritization

### High-value active cleanup

1. **F1** — unify workflow route vocabulary
2. **F2** — fix Memory backup examples

### Lower-risk historical cleanup

3. **F3**
4. **F4**
5. **F5**
6. **F6**

---

# Part II — SDD / ISDD Research

## Repo-Supported Definition of SDD

In this repository, **SDD is not merely “write a spec first.”**

It is a governed workflow with:

- workflow selection before non-trivial changes;
- explicit routing between inline, simple TDD, mini-SDD, and formal SDD;
- optional PRD-first flows when product requirements need clarification;
- OpenSpec-style artifacts;
- delegated `apply` and `verify` phases;
- strict TDD for implementation;
- separate approval gates for research, planning, implementation, and closure.

Supported by:

- `AGENTS.md`
- `skills/sdd-workflow/SKILL.md`
- `skills/workflow-triage/SKILL.md`
- `subagents/sdd-apply.md`
- `subagents/sdd-verify.md`

## Broader SDD / OpenSpec Frame

Based on inspected Context7 sources, a broader OpenSpec-like SDD model generally emphasizes:

- agreement on intent before code;
- persistent artifacts for proposal/spec/design/tasks;
- requirement/scenario-driven change definition;
- explicit implementation planning before coding.

This repo clearly follows that shape, but adds a much stronger orchestration and approval model.

## Artifact Model in This Repo

Formal SDD in this repo uses or can use:

- `openspec/config.yaml`
- `openspec/changes/<change>/metadata.yaml`
- optional `prd.md`
- optional `prd-review.md`
- `proposal.md`
- `spec.md`
- `design.md`
- `tasks.md`
- `apply-progress.md`
- `verify-report.md`
- archive artifacts on closure

This is a broader and more operational model than a minimal proposal/spec/design/tasks-only setup.

## Strong Engineering Orientation Already Present

Even without a formal local definition of `ISDD`, this repo already behaves like an implementation-oriented / engineering-heavy SDD system because it adds:

- workflow triage before implementation;
- mini-SDD for medium taskable work;
- explicit task packets;
- apply/verify separation;
- metadata-centric handoff;
- strict TDD requirements;
- verify-only review without silent fixing;
- archive/closure discipline.

## What I Could and Could Not Confirm About `ISDD`

### What I could support

I could support the claim that this repo already implements a **more engineering-oriented form of SDD** than a minimal baseline.

### What I could not support

I did **not** find direct evidence defining the acronym **`ISDD`** in:

- this repository;
- the repo markdown and workflow artifacts;
- the Context7 sources inspected.

So any stronger claim like “ISDD formally means X” would be speculative unless the project explicitly defines it.

## Comparison Table

| Topic | Generic OpenSpec / broader SDD | This repo |
|---|---|---|
| Core goal | Agree on intent before code | Same, plus workflow governance and agent safety |
| Main planning artifacts | Proposal, specs, design, tasks | Proposal, spec, design, tasks, plus optional PRD/PRD review and metadata |
| Workflow phases | proposal → specs → design → tasks → implement | discovery/triage → optional PRD → explore/proposal/spec/design/task → apply → verify → archive |
| Implementation boundary | After tasks/artifacts exist | Separate implementation approval required |
| Verification | Varies | Explicit `sdd-verify` gate, no silent fixing |
| Change context | Change folder artifacts | Change folder artifacts plus `metadata.yaml` and active-flow memory |
| Lightweight path | Less emphasized | Strong support for inline / simple-tdd / mini-sdd |
| TDD | Not always central | Mandatory for non-trivial code changes |
| Policy/risk handling | Often lighter | Central and explicit |

## Strengths of the Current Repo Workflow

- strong operator control;
- explicit approval boundaries;
- better safety for agent-driven work;
- verify gate is treated as real quality control;
- multiple process weights are available instead of forcing one heavy path for everything.

## Weaknesses / Risks

- documentation drift is more likely because the process model is rich;
- artifact discipline is not perfectly normalized yet;
- route taxonomy complexity can confuse future maintainers;
- “implementation-oriented SDD” is present in practice but not yet named/defined clearly.

## Non-Binding Improvement Options

1. **Define the canonical workflow taxonomy once**
   - likely in `AGENTS.md`
   - then align both workflow skills to it.

2. **Normalize formal OpenSpec artifacts to the documented model**
   - ensure formal changes consistently use `metadata.yaml`
   - keep `openspec/config.yaml` minimal as documented.

3. **Add a concise “SDD in this repo” explainer**
   - map inline / simple-TDD / mini-SDD / formal-SDD
   - clarify approval checkpoints and artifacts per route.

4. **If the project wants to use `ISDD`, define it explicitly**
   - either as a local term;
   - or as “implementation-oriented SDD” / “engineering SDD”;
   - with a short definition and when to use the term.

5. **Add lightweight artifact conformance checks**
   - warn when `openspec/config.yaml` contains fields the workflow says should live elsewhere;
   - warn when formal changes are missing expected metadata.

## Open Questions

- Does the project want `ISDD` to become a defined local term?
- Should older formal changes be backfilled to the newer metadata model?
- Is broader `openspec/config.yaml` usage intentional in practice, or should it be tightened to match the workflow skill more strictly?

## Recommended Next Order of Work

If this is going to be addressed gradually, the most practical sequence is:

1. fix **F1** workflow taxonomy drift;
2. fix **F2** Memory backup example inconsistency;
3. decide whether `ISDD` should become a documented local concept;
4. then clean archive/documentation hygiene items **F3–F6**.

## Source Notes

This document is based on:

- repository markdown and workflow artifacts;
- code-backed validation of the current Memory and Skill Registry behavior;
- Context7 sources related to OpenSpec and SDD-like approaches.

It does **not** claim generic web/forum/article consensus beyond those available sources.