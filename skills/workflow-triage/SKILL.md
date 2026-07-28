---
name: workflow-triage
description: "Routes requests to OpenSpec tiers (Direct Edit, PRD, Mini-SDD, Formal SDD) covering all artifact phases including apply.md and verify.md."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "7.0"
---

# OpenSpec Workflow Triage & Skill Resolution

Select the appropriate OpenSpec tier and identify relevant domain skills to attach to subagent tasks:

---

## 1. Triage & Routing Table

| Request Type | Target Tier | Primary Artifact Location | Delegated Subagents & Artifacts |
|---|---|---|---|
| Quick fix, 1-2 files | **Direct Edit** | N/A (Inline code edit) | Orchestrator (Loads `tdd`) |
| Unclear product goal / user stories | **PRD** | `openspec/changes/<slug>/prd.md` | `prd-review` (`prd.md`) |
| Codebase mapping before proposal | **Exploration** | `openspec/changes/<slug>/explore.md` | `sdd-explore` (`explore.md`) |
| Medium feature / multi-file edit | **Mini-SDD** | `openspec/changes/<slug>/mini-sdd.md` | `sdd-explore` → `sdd-apply` (`apply.md`) → `sdd-verify` (`verify.md`) |
| Large / Cross-cutting / Architecture | **Formal OpenSpec SDD** | `openspec/changes/<slug>/` (`explore.md`, `proposal.md`, `spec.md`, `design.md`, `tasks.md`, `apply.md`, `verify.md`) | `sdd-explore` → `sdd-proposal` → `sdd-spec` → `sdd-design` → `sdd-task` → `sdd-apply` (`apply.md`) → `sdd-verify` (`verify.md`) |

---

## 2. Core Quality Mandates
- **Artifact Traceability**: Every subagent generates its corresponding `.md` artifact (`explore.md`, `proposal.md`, `spec.md`, `design.md`, `tasks.md`, `apply.md`, `verify.md`).
- **Verify Reads Apply**: `sdd-verify` reads `apply.md` to inspect the exact files modified, tasks completed, and TDD evidence recorded by `sdd-apply`.
- **Strict TDD**: All code-writing routes must follow RED → GREEN → REFACTOR.
- **Skill Pattern Compliance**: Subagents read target `SKILL.md` files and follow established patterns.
- **Zero Metadata Bloat**: Keep state in Markdown artifacts under `openspec/changes/<change-slug>/`. Never generate giant `metadata.yaml` files or fragile lease locks.
