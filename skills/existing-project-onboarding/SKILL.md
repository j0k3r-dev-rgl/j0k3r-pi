---
name: existing-project-onboarding
description: "scan an existing software project only after explicit approval, reconstruct language-agnostic AS_IS evidence, ask for unknown intent, and coordinate only currently applicable, evidence-supported, user-approved canonical Markdown documents."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.3"
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
      "existing codebase",
      "scan this existing codebase",
      "scan codebase for documentation",
      "modular documentation baseline",
      "onboarding evidence",
      "project documentation from code",
      "generate all necessary modular documentation",
      "reconstruct modular documentation baseline",
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
  "sdd_phases": [],
  "related_skills": [
    "startup-documentation",
    "product-discovery",
    "product-definition",
    "anti-overengineering"
  ],
  "priority": 94
}
```

## Activation Contract

Use this skill when an existing software project lacks the modular startup documentation baseline, when its documentation is incomplete or stale, or when the user asks the principal to scan the current implementation and coordinate currently applicable, evidence-supported canonical documents after the necessary user decisions.

This is a language-, framework-, architecture-, platform-, and repository-layout-agnostic, principal-agent-only documentation capability. It is not a Pi workflow, workflow phase, or subagent role, and it does not select, replace, or alter any execution workflow. Its registry `sdd_phases` remain empty so phase-only resolution cannot activate onboarding; intent or path routing must select it explicitly. The principal agent uses it only to coordinate bounded read-only research and generate the approved modular documentation baseline. Supporting subagents must not load or apply this skill; they receive isolated research assignments and return evidence to the principal.

The principal acquires one approved evidence snapshot, delegates only the necessary independent research lanes in parallel, consolidates their evidence and conflicts, then applies the canonical owner skills itself in dependency order. Subagents never generate canonical lifecycle documents or make user-owned decisions.

Do not activate it for a new project with no existing implementation, a single feature request, an ordinary code review, or a request to update one already-owned canonical document. Do not scan anything before the user approves scope, depth, exclusions, and sensitive-data boundaries.

## Hard Rules

- Consume the `startup-documentation` and `references/document-contract.md` context already supplied by the router. If no router context was supplied, load them once for the shared contract without re-entering documentation routing. Load and follow `anti-overengineering` whenever this skill is active.
- Before any project inspection or delegation, present the exact scan goal, depth, included paths, exclusions, sensitive-data policy, expected evidence outputs, intended canonical-document generation, and proposed research lanes. Obtain explicit user approval.
- Offer bounded scan depths without selecting for the user:
  - `ORIENTATION`: public documentation, repository structure, manifests, and non-sensitive configuration;
  - `STANDARD`: orientation plus application code, tests, data boundaries, integrations, build/deploy configuration, and operational evidence;
  - `DEEP`: standard plus approved history, security posture, legacy/debt evidence, runtime/operational artifacts, and broader impact analysis.
- Treat the approved scope as a hard boundary. Any new path, external research, runtime access, credential use, generated output, history inspection, or deeper investigation requires renewed approval.
- Exclude secrets and sensitive credential material by default, including `.env*`, private keys, certificates with private material, credential files, secret stores, tokens, and equivalent project-specific surfaces.
- Never persist raw suspected secrets, credentials, regulated data, or equivalent sensitive values found in any surface. Record only a sanitized type, sensitivity/access class, redaction status, and a permitted locator. When the path, name, or locator itself reveals protected information, use only an approved opaque or access-controlled reference; stop and escalate safely on suspected exposure.
- Exclude generated, vendored, binary, dependency-cache, build-output, and coverage surfaces by default. If generated/vendor status is uncertain, mark it `UNKNOWN`. Inspect one only when the user explicitly approves it and it is necessary for a named decision.
- Remain technology agnostic. Recognize file types, manifests, tools, and conventions only as evidence; never require a particular language, framework, package manager, architecture, or build system.
- For authorized TypeScript/JavaScript, Java, or Go code research, call `workspace_graph_status` first and then use applicable `find_symbol`, `find_references`, `function_call_tree`, or `reverse_function_call_tree` operations before text search. Use targeted reads after precise symbols/files are identified. Fall back to text search only after recording unavailable/unusable graph coverage or an actual query failure.
- For other languages and non-code surfaces, use the narrowest available structural, symbol, documentation, configuration, manifest, test, or user-approved command evidence. If behavior cannot be verified, mark it `UNKNOWN`; never claim absence solely because a tool could not detect it.
- Acquire one approved evidence snapshot and reuse its catalog. Record revision/ref, dirty state, approved scope/depth, start/end time, tools/versions, queries or commands, exclusions, authorization basis, and stopping conditions. When no immutable revision/ref exists, derive a bounded snapshot with a standard one-shot SHA-256 procedure: normalize approved regular-file paths as repository-relative POSIX UTF-8; reject ambiguous, escaping, duplicate, symlink, or unsupported entries; hash exact file bytes; emit `F<TAB><lowercase-sha256><TAB><path>` records sorted by `path.encode('utf-8')`; join records with one LF and no trailing LF; and identify the set as `sha256:<aggregate-lowercase-sha256>`. Record the exact path set, exclusions, command/tool version, and unreadable-file failures. Before accepting a mutable snapshot identity, capture the same exact path set twice with the same procedure and compare every manifest record and aggregate identifier; any difference marks freshness `UNVERIFIABLE`. If files change during either capture, any file cannot be read, or identity cannot be reproduced, mark freshness `UNVERIFIABLE` and do not claim an atomic snapshot. Do not make each downstream skill rescan the same project. The principal may use an existing or approved helper tool that implements this exact manifest procedure; record its version, inputs, output, and reproducibility evidence, and do not weaken the normative algorithm.
- Track evidence freshness as `CURRENT`, `STALE`, `SUPERSEDED`, `UNVERIFIABLE`, or `CONFLICT`. On change, compare only approved relevant paths, invalidate affected evidence/packets, and require renewed approval when scope, depth, or sensitivity boundaries expand. If orientation or later evidence requires a path outside the approved snapshot set, obtain renewed approval, issue a new snapshot ID over the newly approved exact set, and mark the prior snapshot `SUPERSEDED`; never mutate an existing snapshot identity.
- Define a proportional scan budget and stopping condition for the current decision without universal numeric limits. A partial orientation result is valid when its coverage limits are explicit.
- Before detailed reconstruction of a monorepo, polyglot repository, or multi-deployable system, map project units with stable ID, type, paths, owner, deployability, independent version/release status, product association, and shared dependencies. Shared components must not silently create product requirements.
- Each canonical documentation baseline covers one explicitly approved product boundary. Evidence mapping may cover several project units, but if independent products would require conflicting singleton product or architecture documents, stop canonical generation and ask the user to select one product boundary and documentation root; do not invent a multiproduct hierarchy.
- Classify every material finding as `OBSERVED`, `DECLARED`, `INFERRED`, `UNKNOWN`, `CONFLICT`, or `LEGACY`.
- Separate current state from intended state:
  - `AS_IS` records verified or bounded current behavior, structure, architecture, technology, delivery, and validation evidence;
  - `TO_BE` records product intent, requirements, accepted architecture direction, future delivery, or desired behavior only after explicit user approval.
- Existing code proves implementation, not product intent. Never promote `AS_IS` behavior into an approved requirement or `TO_BE` decision silently.
- Document implemented behavior even when its original intent is unknown. Record completeness as `COMPLETE`, `PARTIAL`, or `UNKNOWN` only relative to the named approved evidence boundary, distinguishing static, test, runtime, external-contract, and intent coverage. Never claim project-wide completeness without evidence.
- Promote implementation knowledge only through `AS_IS evidence ID → user decision ID → TO_BE canonical artifact ID`; implementation evidence alone cannot approve product or requirement intent.
- Generate every evidence-supported, owner-applicable canonical document required for the approved product/documentation boundary only after its relevant user decisions are approved. Create no irrelevant groups, empty placeholders, speculative decisions, or documents unsupported by evidence or user approval.
- Each canonical owner skill creates its own documents. Onboarding coordinates evidence and sequence; it must not duplicate or overwrite canonical ownership.
- The principal alone consolidates evidence, asks the user questions, applies canonical owner skills, and writes lifecycle documents. Research subagents are read-only with respect to `docs/`, implementation, dependencies, data, infrastructure, runtime state, and external systems.
- Select only research lanes needed by current scope and risk; do not launch a fixed team for every project. Candidate lanes are: structure/dependencies; observed behavior/requirements; tests/quality; architecture/data/trust/integrations; and delivery/operations. Merge or omit lanes for small projects. A low-risk, tightly bounded orientation may use one principal-only lane when the approved question does not benefit from independent parallel evidence.
- Give each research subagent one disjoint evidence responsibility, bounded paths, explicit exclusions, the shared snapshot/project-unit IDs, sensitive-data policy, evidence schema, stopping condition, and one read-only next action. Permit path overlap only when two named questions genuinely require independent evidence, and record the reason.
- Keep research contexts clean: do not send another subagent's conclusions, prior reports, unneeded conversation, speculative hypotheses, or canonical-generation instructions. Every prompt explicitly says: do not load or apply `existing-project-onboarding`; do not write canonical documentation; return evidence only. Each subagent must classify findings independently and must not infer product intent. The principal rejects any result that violates these boundaries.
- Every research delegation must state only the seven compact dynamic fields: `Goal`; `Known context and missing facts`; `Scope, paths, and exclusions`; `Governing contracts and ready artifacts`; `Assigned skills`; `Expected output and evidence`; and `Blockers and next permitted action`. Stable attempt, authority, language, handoff, Code Research, and fallback rules remain in `discovery.md`; send only change-specific values not already defined there. Use `None` explicitly and never fill missing context through unapproved investigation.
- Require every research result to return snapshot/project-unit IDs, evidence records and exact locators, classification, confidence, completeness boundary, freshness, sensitivity/redaction status, conflicts, unknowns, excluded-evidence dependencies, checks performed, and one next action. Bare summaries are not evidence.
- Do not expose one lane's result to another while independent research is running. After collection, sort records by snapshot ID, project-unit ID, canonical source locator, evidence classification, and lane ID before assigning evidence IDs. For deduplication only, normalize claim text to Unicode NFC; treat exactly U+0009 TAB, U+000A LF, U+000B VT, U+000C FF, U+000D CR, and U+0020 SPACE as ASCII whitespace; trim outer occurrences and collapse each internal run of those code points to one U+0020 SPACE; preserve case, punctuation, identifiers, every other code point, and classification; normalize the locator set by exact-string deduplication and UTF-8 byte-order sorting. Deduplicate only when normalized claim text, classification, and locator set match. Never paraphrase or infer semantic equivalence; preserve incompatible claims as `CONFLICT`. Arrival order never determines IDs, precedence, or conflict resolution. Source authority may be recorded but never silently resolves conflicting product intent. The principal may create a non-authoritative near-duplicate review cluster to reduce reviewer effort, but clustered records keep their original IDs and never merge or resolve claims automatically.
- Reject or rerun only the affected lane when its snapshot identity, scope, provenance, or sensitive-data handling is invalid. Do not make all lanes rescan unchanged evidence.
- Pass each canonical owner a sanitized, versioned context packet containing packet/snapshot/project-unit IDs, approved scope, selected evidence IDs with compact summaries, approved decisions, unknowns/conflicts, prohibited inferences/non-goals, owner question, allowed outputs, and one next action. Expand full provenance only for evidence IDs needed to decide or verify the current owner question. Every compact reference retains at least canonical locator, classification, confidence, freshness, and sensitivity/redaction status; expanded records add collection method, completeness boundary, limitations, and excluded-evidence dependencies.
- Group user questions by lifecycle area and present the smallest viable recommendation first. Do not ask the user to answer facts already demonstrated by credible evidence; ask them to confirm intent, resolve conflicts, choose among valid alternatives, or supply unknown product decisions.
- A blocker in one lifecycle area stops only affected canonical documents when other areas can proceed independently and coherently. A suspected sensitive exposure blocks its lane and dependent evidence/artifacts; unrelated non-sensitive lanes may continue only when the exposure does not change the broader security/privacy boundary. Security, privacy, safety, or regulatory conflicts block every dependent artifact until an authorized owner resolves them.
- Do not modify implementation, dependencies, data, infrastructure, runtime state, or external systems. This skill is read-only with respect to the existing project except for approved Markdown documentation and generated skill-registry artifacts when skill definitions themselves change.

## Decision Gates

Before scanning, resolve and obtain explicit approval for:

- repository/project root, one canonical product boundary, documentation root, and included paths;
- scan goal and `ORIENTATION | STANDARD | DEEP` depth;
- excluded paths and project-specific sensitive surfaces;
- whether Git history, tests/commands, runtime configuration, infrastructure, generated artifacts, external documentation, or external services may be inspected;
- document language when no approved convention exists;
- which bounded research lanes are necessary, their evidence responsibilities, allowed overlap, parallelism, and stopping conditions;
- whether canonical documents should be created as evidence becomes ready or only after one consolidated review;
- user or role owning product, architecture, technology, delivery, and validation decisions.

After scanning, stop and ask grouped questions when:

- observed behavior has unconfirmed product intent;
- documentation, code, tests, configuration, or user declarations conflict;
- implementation is partial and the desired outcome is unknown;
- an architecture or technology choice is observable but its rationale or continued acceptance is unknown;
- a quality, security, privacy, regulatory, compatibility, data-retention, delivery, or validation requirement cannot be inferred safely;
- generating a canonical `TO_BE` document requires selecting among materially different valid alternatives;
- multiple independent products would collide in singleton canonical paths;
- broader access or a rescan is required.

## Execution Steps

1. Explain the documentation-only onboarding outcome and request explicit approval for scan root, one product/documentation boundary, depth, included/excluded paths, sensitive-data policy, optional evidence sources, proposed research lanes, document language, generation timing, and decision owners.
2. After approval, the principal inspects only the narrowest orientation surfaces needed to establish the shared snapshot, project-unit map, and non-overlapping research boundaries.
3. Select the minimum useful lanes and delegate their bounded read-only investigations in parallel. Do not delegate canonical document generation or this skill itself.
4. Collect all lane results against the same snapshot, reject invalid provenance or scope violations, apply the deterministic ordering and deduplication contract, and preserve unresolved disagreement as `CONFLICT`.
5. Build one reusable consolidated evidence catalog and documentation gap map. The following are possible catalog paths; create each file only when applicable:

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

6. Create only applicable evidence files. For every finding, record stable evidence ID, originating lane, snapshot/project-unit IDs, `AS_IS` state, classification, precise source locator and method, confidence, completeness boundary, freshness, sensitivity/redaction status, product intention status, conflicts, excluded evidence dependencies, and decisions required.
7. Use `0001-scan-scope.md` for snapshot/provenance, approved evidence boundary, lane assignments, scan budgets/stopping conditions, exclusions, authorization basis, and consolidation results. Use `0002-project-structure.md` for the project-unit map when applicable.
8. Produce `0012-documentation-gap-map.md` as the principal's orchestration plan. For each canonical group, record `REQUIRED | NOT_APPLICABLE | BLOCKED | PENDING_REVIEW`, separate freshness status, supporting evidence IDs, owning skill, questions, and next permitted action. Under tests/quality, also record characterization-test need as `REQUIRED | NOT_REQUIRED | BLOCKED | UNKNOWN` for legacy, refactor, or behavior-preservation work.
9. Ask unresolved questions in bounded batches: product and intent; capabilities and incomplete/legacy behavior; requirements and quality; architecture/data/trust; technical decisions and integrations; delivery/operations; validation/metrics.
10. The principal resolves, loads, and applies owner skills in dependency order, passing only their sanitized, current context packet and approved decisions:
   1. `product-discovery` when problem evidence or assumptions require clarification;
   2. `product-definition` for approved vision, outcome, MVP/current product scope, journeys, and capabilities;
   3. `requirements-definition` for each observed and approved small functional slice plus applicable quality/constraints;
   4. `architecture-definition` for drivers, context, boundaries, data/trust, and deployment views;
   5. `technical-decisions` for significant ADRs, technology selections, dependencies, and integrations;
   6. `delivery-planning` for observed/approved delivery model, roadmap, Definition of Done, increments, and sprints;
   7. `product-validation` for observed/approved metrics, experiments, and learning decisions.
11. Require each owner skill to reuse evidence IDs, ask only its unresolved user-owned decisions, create every applicable canonical document in its owned group, and avoid rescanning or duplicating evidence.
12. When original rationale is unknowable but the current implementation is verified, document the current choice as `OBSERVED`, rationale as `UNKNOWN`, and continued acceptance as a user decision. Do not fabricate a historical ADR.
13. After each user approval batch, update affected canonical documents and the gap map. Preserve unrelated approvals.
14. Finish with a coverage matrix listing every expected group and document as `CREATED`, `NOT_APPLICABLE`, `BLOCKED`, or `PENDING_REVIEW`, with separate freshness, evidence links, originating lanes, owner skill, blockers, and one next action.
15. Validate modularity, numbering, canonical ownership, evidence links, lane/snapshot consistency, classifications, AS_IS/TO_BE separation, sensitive-data handling, project-unit/packet integrity, unresolved conflicts, coverage/freshness, and routing for every owner skill used.

## Output Contract

Return:

- Skills applied: `existing-project-onboarding`, `startup-documentation`, `anti-overengineering`, and every canonical owner skill actually used.
- Approved scan root, product/documentation boundary, depth, included/excluded paths, optional evidence sources, sensitive-data policy, language, and generation timing.
- Research lanes delegated by the principal, bounded responsibilities, deterministic consolidation order, snapshot identity/procedure, attempt and fallback evidence, and checks performed; canonical documents written by subagents: `None`.
- Evidence catalog files created under `docs/00-discovery/05-existing-project/` after principal consolidation.
- Languages, frameworks, tools, architectures, and layouts observed without making any one of them mandatory.
- `AS_IS` findings by classification, named completeness boundary, snapshot/project-unit IDs, freshness, and redaction status.
- Grouped user questions and approved `TO_BE` decisions.
- Canonical documents generated by each owner skill.
- Coverage matrix with `CREATED | NOT_APPLICABLE | BLOCKED | PENDING_REVIEW` statuses and separate freshness.
- Cross-lane conflicts, unknowns, legacy behavior, and partial implementations still requiring principal or user decisions.
- Raw sensitive values persisted in lifecycle documentation: `None`; suspected exposure handled through sanitized metadata and safe escalation.
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
