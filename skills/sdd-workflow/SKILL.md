---
name: sdd-workflow
description: "Executes OpenSpec Specification-Driven Development (PRD, Mini-SDD, Formal SDD) where every phase resolves skills and generates its corresponding Markdown artifact."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "9.0"
---

# OpenSpec Specification-Driven Development (SDD) Workflow

This skill governs the OpenSpec artifact lifecycle under `openspec/changes/<change-slug>/`, where **every subagent resolves skills and generates its corresponding `.md` artifact**.

---

## OpenSpec Directory Structure & Artifact Mapping
```
openspec/changes/<change-slug>/
├── prd.md         (Created by prd-review: Product Requirements Document)
├── explore.md     (Created by sdd-explore: Codebase mapping & symbol analysis)
├── proposal.md    (Created by sdd-proposal: High-level intent & Delta spec: ADDED/MODIFIED/REMOVED)
├── spec.md        (Created by sdd-spec: Technical requirements & behavioral contracts)
├── design.md      (Created by sdd-design: Architecture & interface design based on skills)
├── tasks.md       (Created by sdd-task: Actionable checklist based on skills & Strict TDD)
├── apply.md       (Created by sdd-apply: Implementation log, files modified & TDD evidence)
└── verify.md      (Created by sdd-verify: Verification log & test suite execution evidence)
```

---

## Phased OpenSpec Lifecycle & Artifact Sequence

1. **`sdd-explore`** ➔ Escribe `explore.md` (Mapeo de código y símbolos).
2. **`sdd-proposal`** ➔ Escribe `proposal.md` (Definición de cambios propuestos).
3. **`sdd-spec`** ➔ Escribe `spec.md` (Contratos normativos e invariantes).
4. **`sdd-design`** ➔ **Lee skills** y escribe `design.md` (Arquitectura e interfaces).
5. **`sdd-task`** ➔ **Lee skills** y escribe `tasks.md` (Checklist con tareas TDD y patrones).
6. **`sdd-apply`** ➔ **Lee skills**, ejecuta Strict TDD (RED ➔ GREEN ➔ REFACTOR), actualiza `tasks.md` y escribe `apply.md`.
7. **`sdd-verify`** ➔ **Lee `apply.md`**, `tasks.md` y `spec.md`, ejecuta la suite completa de tests, y escribe `verify.md`.
8. **`sdd-archive`** ➔ Consolida especificaciones y archiva el cambio.
