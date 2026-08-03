# Numbered Modular Documentation Contract

This contract governs startup lifecycle documents created under `docs/`. It defines documentation structure, not product or technical decisions.

## Approved groups

```text
docs/
├── 00-discovery/
│   ├── 00-opportunity.md
│   ├── 01-users-and-stakeholders.md
│   ├── 02-evidence/
│   ├── 03-assumptions/
│   ├── 04-product-direction.md
│   └── 05-existing-project/
├── 01-product/
│   ├── 00-product-vision.md
│   ├── 01-success-metrics.md  # success/guardrail intent and metric links only; operational definitions belong to Validation
│   ├── 02-mvp-hypothesis.md
│   ├── 03-scope.md
│   ├── 04-user-journeys/
│   └── 05-capabilities/
├── 02-requirements/
│   ├── 00-requirements-index.md
│   ├── 01-functional/
│   ├── 02-quality/
│   └── 03-constraints/
├── 03-architecture/
│   ├── 00-architecture-drivers.md
│   ├── 01-system-context.md
│   ├── 02-system-boundaries.md
│   ├── 03-data-and-trust-boundaries.md
│   ├── 04-deployment-view.md
│   ├── decisions/
│   └── integrations/
├── 04-delivery/
│   ├── 00-delivery-model.md
│   ├── 01-roadmap.md
│   ├── 02-definition-of-done.md
│   ├── 03-increments/
│   └── 04-sprints/
└── 05-validation/
    ├── 00-measurement-plan.md
    ├── 01-experiments/
    ├── 02-decisions/
    └── 03-change-requests/
```

Create a group only when its first approved document is needed. Do not scaffold empty groups or placeholders.

## Numbering

- Fixed top-level groups use the approved two-digit prefixes.
- Ordered documents inside a group use creation-order prefixes such as `00-`, `01-`, and `02-`.
- Repeatable records use stable four-digit identifiers such as `0001-`, `0002-`, and `0003-`.
- Never renumber an existing artifact automatically.
- Never reuse a retired number.
- Use lowercase English kebab-case path slugs.

Examples:

```text
docs/00-discovery/00-opportunity.md
docs/00-discovery/02-evidence/0001-founder-interviews.md
docs/02-requirements/01-functional/0001-account-registration.md
docs/03-architecture/decisions/0001-initial-deployment-shape.md
docs/04-delivery/04-sprints/0001-complete-registration-flow.md
docs/05-validation/01-experiments/0001-registration-activation.md
```

## Identifier and reference semantics

- Every durable document ID must be unique within the approved documentation root and remain immutable. Use a short uppercase owner/type namespace plus a stable semantic slug or four-digit sequence, such as `DISC-OPPORTUNITY`, `REQ-0001`, `ADR-0001`, `EXP-0001`, or `CR-0001`.
- Filename prefixes preserve path creation order; metadata IDs preserve identity. They may coincide when practical, but renaming or moving a file must not change its ID.
- Qualify a child record with its parent document ID, for example `REQ-0001:AC-01`. Never reference an unqualified local ID from another document.
- Every cross-document reference includes both canonical path and stable ID in the form `<canonical-path>#<stable-id>`. This resolves owner namespaces and survives title changes.
- Use the next unused repository-wide `CR-####` identifier for material change requests. Other repeatable owner records use the next unused number in their owner/type namespace.

## Document boundary

A document must answer one coherent question or own one decision family. Split it when independent parts:

- have different decision owners;
- can be approved or superseded independently;
- have different evidence or risks;
- belong to different functional capabilities, integrations, architecture decisions, increments, sprints, or experiments;
- force reviewers to reconstruct unrelated context.

Do not split prose only to satisfy a line-count target. There is no universal line limit. Use reviewability and independent decision ownership as the boundary.

Summary documents should remain concise and link to numbered details. Do not maintain the same requirement or decision in several files.

## Required metadata

Every durable lifecycle document begins with:

```markdown
## Document Status
- ID: <globally unique stable identifier>
- Status: DRAFT | READY | APPROVED | SUPERSEDED | BLOCKED
- Decision owner: <user or role> | UNASSIGNED
- Language: <approved language>
- Supersedes: None | <canonical-path>#<document-ID>
- Blockers: None | <specific blockers>
```

Use `APPROVED` only after explicit user approval of the current contents. `READY` means complete for review, not approved.

Reuse approved language, decision owners, scope, evidence references, and metadata unless they are absent, stale, contradicted, or specific to the new decision.

## Required context sections

Include these sections when applicable; omit a section only when it has no role in the document:

```markdown
## Purpose

## Inputs and Trace Links

## Confirmed Evidence

## Supported Evidence

## Inferences

## Assumptions

## Unknowns

## Decisions

## Scope

## Exclusions

## Risks

## Questions Requiring a Decision

## Next Permitted Action
```

Do not copy full parent content into child documents. Link to stable document or requirement IDs and include only the local context needed to review the current decision.

## Canonical ownership

- Discovery owns problem evidence and assumptions outside the existing-project evidence boundary.
- Existing Project Onboarding owns sanitized, snapshot-bound `AS_IS` evidence and the documentation gap map under `docs/00-discovery/05-existing-project/`. Domain owners retain ownership of every explicitly promoted `TO_BE` artifact.
- Product owns vision, product outcomes, success and guardrail intent, MVP boundaries, journeys, and product capabilities. Product links operational metric IDs instead of redefining their measurement details.
- Requirements owns verifiable functional requirements, applicable quality requirements, product constraints, and acceptance criteria.
- Architecture owns architecture drivers, system context, system boundaries, data/trust boundaries, and deployment views.
- Technical Decisions owns architecture decision records, technology selections, dependency decisions, and integrations.
- Delivery owns delivery model, roadmap, Definition of Done, increments, and sprint commitments.
- Validation owns operational metric definitions, cohorts, collection and analysis methods, baselines, thresholds, observation periods, experiments, observed outcomes, learning decisions, and the lifecycle of cross-owner material change-request records. The target domain owner alone decides and applies the proposed semantic change.

A downstream document may challenge an upstream decision with new evidence, but it must emit a material change request or trace link rather than silently rewriting the upstream fact.

## Evidence provenance

Each applicable durable evidence record must include:

- source or collection method;
- collection date or covered period;
- context, cohort, or population when relevant;
- precise locator or reference;
- limitations and known confounders;
- confidence rationale;
- freshness: `CURRENT | STALE | SUPERSEDED | UNVERIFIABLE | CONFLICT`; and
- sensitivity or redaction status.

Never persist raw secrets, credentials, regulated data, sensitive personal values, or equivalent protected content in lifecycle Markdown. Store only the minimum sanitized summary and a permitted opaque or access-controlled source reference. If the approved decision requires exact protected evidence, keep it in an approved controlled system outside `docs/` and link only its safe reference.

## Material change requests

When evidence materially challenges approved canonical content, the initiating skill requests one canonical record under `docs/05-validation/03-change-requests/`; `product-validation` alone creates or updates that record and owns its lifecycle and routing. The target canonical owner owns disposition of the proposed semantic change. Link the record from source and target artifacts rather than duplicating it.

The lifecycle is deterministic:

1. The initiating skill asks `product-validation` to create or update the canonical record.
2. Validation sets status and routes it to the target owner.
3. The target owner returns `ACCEPTED | DECLINED | DEFERRED | NEEDS_MORE_EVIDENCE` with rationale and affected IDs; it does not close the record itself.
4. Validation records the disposition and resulting status.
5. The target owner applies an accepted semantic change only after required approval.
6. Validation records closure evidence after impact review and closes the record when its closure condition is met.

CR status tracks the Validation-owned record lifecycle; disposition tracks the target owner's semantic decision on the challenged canonical content. `APPROVED` status therefore records lifecycle processing of an accepted change and must not be inferred from, or substituted for, the target owner's `ACCEPTED` disposition.

Each record contains:

- stable repository-wide `CR-####` ID;
- source evidence ID or reference;
- target canonical ID;
- proposed semantic change;
- initiating skill, Validation record owner, and target semantic owner;
- status: `OPEN | REVIEWING | APPROVED | REJECTED | WITHDRAWN | CLOSED`;
- disposition: `ACCEPTED | DECLINED | DEFERRED | NEEDS_MORE_EVIDENCE`;
- affected artifact IDs; and
- target-owner disposition rationale and return date; and
- closure evidence or next review condition.

## Trace promotion and validation

- Promote reconstructed implementation knowledge through `AS_IS evidence ID → user decision ID → TO_BE canonical artifact ID`.
- Existing implementation evidence must not become a `TO_BE` product or requirement decision without explicit user approval.
- Validation or verification evidence must link requirement and acceptance IDs when it claims implementation or conformance validation.
- Pre-requirement experiments may instead trace to opportunity, assumption, hypothesis, journey, capability, or outcome IDs.

## Change impact

When an approved artifact changes:

1. Describe the semantic change.
2. Follow recorded trace links.
3. Mark only materially affected descendants `BLOCKED` or requiring review.
4. Preserve unaffected approvals.
5. If the impact cannot be bounded safely, state that uncertainty and ask the user before proceeding.

Formatting-only changes do not invalidate descendants. Outside onboarding snapshots, evidence marked `STALE`, `SUPERSEDED`, `UNVERIFIABLE`, or `CONFLICT` must not be reused as current support; identify the affected claim and ask for refreshed evidence or an explicit bounded decision.

## Structural validation

Before reporting `Validation executed`, run and report the applicable checks:

- path belongs to the canonical owner and uses valid numbering/kebab-case;
- document ID and referenced IDs resolve uniquely using canonical path plus stable ID;
- required metadata fields and allowed status values are present and internally consistent;
- evidence provenance and sensitive-data sanitization are complete when evidence is recorded;
- parent, requirement, acceptance, decision, and change-request links required by the artifact resolve;
- no canonical fact is duplicated or silently rewritten across owners;
- no empty, speculative, or unsupported artifact was created; and
- exactly one next permitted action is stated, or `None` when complete.

Use focused syntax or registry checks when the changed artifact defines Mermaid or skill routing. Record `NOT_APPLICABLE` with a reason for checks that do not apply; never report a bare validation claim.

## Anti-overengineering checks

Before creating a document, verify:

- it supports a current decision;
- no existing document already owns the subject;
- its detail is proportional to risk and the next action;
- optional future concerns remain excluded or explicitly deferred;
- it contains no invented requirements or disguised assumptions;
- the simplest viable option is visible when alternatives are considered;
- there is one next permitted action rather than an unbounded future plan.
