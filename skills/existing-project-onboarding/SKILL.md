---
name: existing-project-onboarding
description: "scan an existing software project only after explicit approval, reconstruct its language-agnostic AS_IS evidence, ask for unknown intent, and orchestrate the modular startup skills to generate every applicable canonical Markdown document."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Existing Project Onboarding

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "product",
  "domains": ["existing-project-onboarding", "project-reconstruction", "as-is-documentation", "documentation-orchestration"],
  "triggers": {
    "paths": [
      "docs/00-discovery/05-existing-project/**/*.md"
    ],
    "keywords": [
      "existing project",
      "existing project onboarding",
      "document existing project",
      "scan project",
      "scan existing project",
      "scan an existing project",
      "document codebase",
      "onboarding evidence",
      "project documentation from code",
      "generate all necessary modular documentation",
      "reconstruct project documentation",
      "generate documentation from codebase",
      "legacy project documentation",
      "proyecto existente",
      "documentar codigo",
      "documentar proyecto existente",
      "escanear proyecto",
      "escanear proyecto existente",
      "generar documentacion del proyecto",
      "reconstruir documentacion"
    ]
  },
  "sdd_phases": ["explore", "proposal", "spec", "design", "task", "apply", "verify"],
  "related_skills": [
    "startup-documentation",
    "product-discovery",
    "product-definition",
    "requirements-definition",
    "architecture-definition",
    "technical-decisions",
    "delivery-planning",
    "product-validation",
    "anti-overengineering"
  ],
  "priority": 94
}
```

## Activation Contract

Use this skill when an existing software project lacks the modular startup documentation baseline, when its documentation is incomplete or stale, or when the user asks the agent to scan the current implementation and generate the applicable documents.

This is a language-, framework-, architecture-, platform-, and repository-layout-agnostic documentation orchestrator. It scans once within an explicitly approved boundary, creates a reusable evidence catalog and gap map, then resolves, loads, and applies the canonical owner skills in dependency order to generate every document required by the detected project.

Do not activate it for a new project with no existing implementation, a single feature request, an ordinary code review, or a request to update one already-owned canonical document. Do not scan anything before the user approves scope, depth, exclusions, and sensitive-data boundaries.

## Hard Rules

- Load and follow `startup-documentation`, its `references/document-contract.md`, and `anti-overengineering` whenever this skill is active.
- Before any project inspection, present the exact scan goal, depth, included paths, exclusions, sensitive-data policy, expected evidence outputs, and intended canonical-document generation. Obtain explicit user approval.
- Offer bounded scan depths without selecting for the user:
  - `ORIENTATION`: public documentation, repository structure, manifests, and non-sensitive configuration;
  - `STANDARD`: orientation plus application code, tests, data boundaries, integrations, build/deploy configuration, and operational evidence;
  - `DEEP`: standard plus approved history, security posture, legacy/debt evidence, runtime/operational artifacts, and broader impact analysis.
- Treat the approved scope as a hard boundary. Any new path, external research, runtime access, credential use, generated output, history inspection, or deeper investigation requires renewed approval.
- Exclude secrets and sensitive credential material by default, including `.env*`, private keys, certificates with private material, credential files, secret stores, tokens, and equivalent project-specific surfaces. Never copy secret values into evidence or documentation.
- Exclude generated, vendored, binary, dependency-cache, build-output, and coverage surfaces by default. Inspect one only when the user explicitly approves it and it is necessary for a named decision.
- Remain technology agnostic. Recognize file types, manifests, tools, and conventions only as evidence; never require a particular language, framework, package manager, architecture, or build system.
- For authorized TypeScript/JavaScript, Java, or Go code research, call `workspace_graph_status` first and then use applicable `find_symbol`, `find_references`, `function_call_tree`, or `reverse_function_call_tree` operations before text search. Use targeted reads after precise symbols/files are identified. Fall back to text search only after recording unavailable/unusable graph coverage or an actual query failure.
- For other languages and non-code surfaces, use the narrowest available structural, symbol, documentation, configuration, manifest, test, or user-approved command evidence. If behavior cannot be verified, mark it `UNKNOWN`; never claim absence solely because a tool could not detect it.
- Scan the approved project once and reuse the evidence catalog. Do not make each downstream skill rescan the same project. Perform a fresh targeted read only when evidence may have changed or a precise unresolved gap requires it.
- Classify every material finding as `OBSERVED`, `DECLARED`, `INFERRED`, `UNKNOWN`, `CONFLICT`, or `LEGACY`.
- Separate current state from intended state:
  - `AS_IS` records verified or bounded current behavior, structure, architecture, technology, delivery, and validation evidence;
  - `TO_BE` records product intent, requirements, accepted architecture direction, future delivery, or desired behavior only after explicit user approval.
- Existing code proves implementation, not product intent. Never promote `AS_IS` behavior into an approved requirement or `TO_BE` decision silently.
- Document implemented behavior even when its original intent is unknown. Record completeness as `COMPLETE`, `PARTIAL`, or `UNKNOWN` against the observed boundary and list missing/unverified behavior without inventing it.
- Generate all applicable documents needed to represent the detected project, but create no irrelevant groups, empty placeholders, speculative decisions, or documents unsupported by evidence or user approval.
- Each canonical owner skill creates its own documents. Onboarding coordinates evidence and sequence; it must not duplicate or overwrite canonical ownership.
- Group user questions by lifecycle area and present the smallest viable recommendation first. Do not ask the user to answer facts already demonstrated by credible evidence; ask them to confirm intent, resolve conflicts, choose among valid alternatives, or supply unknown product decisions.
- A blocker in one lifecycle area stops only affected canonical documents when other areas can proceed independently and coherently.
- Do not modify implementation, dependencies, data, infrastructure, runtime state, or external systems. This skill is read-only with respect to the existing project except for approved Markdown documentation and generated skill-registry artifacts when skill definitions themselves change.

## Decision Gates

Before scanning, resolve and obtain explicit approval for:

- repository/project root and included paths;
- scan goal and `ORIENTATION | STANDARD | DEEP` depth;
- excluded paths and project-specific sensitive surfaces;
- whether Git history, tests/commands, runtime configuration, infrastructure, generated artifacts, external documentation, or external services may be inspected;
- document language when no approved convention exists;
- whether canonical documents should be created as evidence becomes ready or only after one consolidated review;
- user or role owning product, architecture, technology, delivery, and validation decisions.

After scanning, stop and ask grouped questions when:

- observed behavior has unconfirmed product intent;
- documentation, code, tests, configuration, or user declarations conflict;
- implementation is partial and the desired outcome is unknown;
- an architecture or technology choice is observable but its rationale or continued acceptance is unknown;
- a quality, security, privacy, regulatory, compatibility, data-retention, delivery, or validation requirement cannot be inferred safely;
- generating a canonical `TO_BE` document requires selecting among materially different valid alternatives;
- broader access or a rescan is required.

## Execution Steps

1. Explain the onboarding outcome and request explicit approval for scan root, depth, included/excluded paths, sensitive-data policy, optional evidence sources, document language, generation timing, and decision owners.
2. After approval, inspect the narrowest orientation surfaces needed to identify repository structure and technology-independent evidence categories.
3. Build one reusable evidence catalog and documentation gap map under:

```text
docs/00-discovery/05-existing-project/
├── 0001-scan-scope.md
├── 0002-project-structure.md
├── 0003-observed-capabilities.md
├── 0004-observed-requirements.md
├── 0005-observed-architecture.md
├── 0006-technologies-and-dependencies.md
├── 0007-integrations.md
├── 0008-tests-and-quality.md
├── 0009-delivery-and-operations.md
├── 0010-incomplete-or-legacy-behavior.md
├── 0011-conflicts-and-unknowns.md
└── 0012-documentation-gap-map.md
```

4. Create only applicable evidence files. For every finding, record stable evidence ID, `AS_IS` state, classification, source path/symbol/configuration/test/command, confidence, completeness, product intention status, conflicts, and decisions required.
5. Produce `0012-documentation-gap-map.md` as the orchestration plan. For each canonical group, record `REQUIRED | NOT_APPLICABLE | BLOCKED | PENDING_REVIEW`, supporting evidence IDs, owning skill, questions, and next permitted action.
6. Ask unresolved questions in bounded batches: product and intent; capabilities and incomplete/legacy behavior; requirements and quality; architecture/data/trust; technical decisions and integrations; delivery/operations; validation/metrics.
7. Resolve, load, and apply owner skills in dependency order, passing only their bounded evidence packet and approved decisions:
   1. `product-discovery` when problem evidence or assumptions require clarification;
   2. `product-definition` for approved vision, outcome, MVP/current product scope, journeys, and capabilities;
   3. `requirements-definition` for each observed and approved small functional slice plus applicable quality/constraints;
   4. `architecture-definition` for drivers, context, boundaries, data/trust, and deployment views;
   5. `technical-decisions` for significant ADRs, technology selections, dependencies, and integrations;
   6. `delivery-planning` for observed/approved delivery model, roadmap, Definition of Done, increments, and sprints;
   7. `product-validation` for observed/approved metrics, experiments, and learning decisions.
8. Require each owner skill to reuse evidence IDs, ask only its unresolved user-owned decisions, create every applicable canonical document in its owned group, and avoid rescanning or duplicating evidence.
9. When original rationale is unknowable but the current implementation is verified, document the current choice as `OBSERVED`, rationale as `UNKNOWN`, and continued acceptance as a user decision. Do not fabricate a historical ADR.
10. After each user approval batch, update affected canonical documents and the gap map. Preserve unrelated approvals.
11. Finish with a coverage matrix listing every expected group and document as `CREATED`, `NOT_APPLICABLE`, `BLOCKED`, or `PENDING_REVIEW`, with evidence links, owner skill, blockers, and one next action.
12. Validate modularity, numbering, canonical ownership, evidence links, classifications, AS_IS/TO_BE separation, sensitive-data exclusions, unresolved decisions, and routing for every owner skill used.

## Output Contract

Return:

- Skills applied: `existing-project-onboarding`, `startup-documentation`, `anti-overengineering`, and every canonical owner skill actually used.
- Approved scan root, depth, included/excluded paths, optional evidence sources, sensitive-data policy, language, and generation timing.
- Evidence catalog files created under `docs/00-discovery/05-existing-project/`.
- Languages, frameworks, tools, architectures, and layouts observed without making any one of them mandatory.
- `AS_IS` findings by classification and completeness.
- Grouped user questions and approved `TO_BE` decisions.
- Canonical documents generated by each owner skill.
- Coverage matrix with `CREATED | NOT_APPLICABLE | BLOCKED | PENDING_REVIEW` statuses.
- Conflicts, unknowns, legacy behavior, and partial implementations still requiring decisions.
- Sensitive values read or persisted: `None`.
- Implementation, dependency, data, infrastructure, runtime, or external-system changes performed: `None`.
- Validation executed.
- One next permitted action, or `None`.

## References

- `~/.pi/agent/skills/startup-documentation/SKILL.md` — lifecycle documentation routing and canonical group ownership.
- `~/.pi/agent/skills/startup-documentation/references/document-contract.md` — numbering, metadata, modularity, traceability, and change-impact contract.
- `~/.pi/agent/skills/product-discovery/SKILL.md` — problem evidence and assumption owner.
- `~/.pi/agent/skills/product-definition/SKILL.md` — product vision, outcome, MVP, scope, journey, and capability owner.
- `~/.pi/agent/skills/requirements-definition/SKILL.md` — functional, quality, constraint, and acceptance owner.
- `~/.pi/agent/skills/architecture-definition/SKILL.md` — architecture view and driver owner.
- `~/.pi/agent/skills/technical-decisions/SKILL.md` — ADR, technology, dependency, and integration owner.
- `~/.pi/agent/skills/delivery-planning/SKILL.md` — delivery model, roadmap, increment, sprint, and Definition of Done owner.
- `~/.pi/agent/skills/product-validation/SKILL.md` — measurement, experiment, and learning-decision owner.
- `~/.pi/agent/skills/anti-overengineering/SKILL.md` — mandatory scope, evidence, simplicity, and decision controls.
- `~/.pi/agent/AGENTS.md` — canonical consent, proportional access, Code Research, and workflow boundaries.
