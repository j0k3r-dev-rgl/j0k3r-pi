# Numbered Modular Documentation Contract

This contract governs startup lifecycle documents created under `docs/`. It defines documentation structure, not product or technical decisions.

## Approved groups

```text
docs/
├── 00-discovery/
├── 01-product/
├── 02-requirements/
├── 03-architecture/
├── 04-delivery/
└── 05-validation/
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
docs/02-requirements/functional/0001-account-registration.md
docs/03-architecture/decisions/0001-initial-deployment-shape.md
docs/04-delivery/sprints/0001-complete-registration-flow.md
docs/05-validation/experiments/0001-registration-activation.md
```

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
- ID: <stable group-specific identifier>
- Status: DRAFT | READY | APPROVED | SUPERSEDED | BLOCKED
- Decision owner: <user or role> | UNASSIGNED
- Language: <approved language>
- Supersedes: None | <document ID>
- Blockers: None | <specific blockers>
```

Use `APPROVED` only after explicit user approval of the current contents. `READY` means complete for review, not approved.

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

- Discovery owns problem evidence and assumptions.
- Product owns vision, product outcomes, MVP boundaries, journeys, and product capabilities.
- Requirements owns verifiable functional requirements, applicable quality requirements, and product constraints.
- Architecture owns drivers, system boundaries, data/trust boundaries, deployment views, integrations, and architecture decision records.
- Delivery owns delivery model, roadmap, Definition of Done, increments, and sprint commitments.
- Validation owns measurement plans, experiments, observed outcomes, and learning decisions.

A downstream document may challenge an upstream decision with new evidence, but it must emit a change request or trace link rather than silently rewriting the upstream fact.

## Change impact

When an approved artifact changes:

1. Describe the semantic change.
2. Follow recorded trace links.
3. Mark only materially affected descendants `BLOCKED` or requiring review.
4. Preserve unaffected approvals.
5. If the impact cannot be bounded safely, state that uncertainty and ask the user before proceeding.

Formatting-only changes do not invalidate descendants.

## Anti-overengineering checks

Before creating a document, verify:

- it supports a current decision;
- no existing document already owns the subject;
- its detail is proportional to risk and the next action;
- optional future concerns remain excluded or explicitly deferred;
- it contains no invented requirements or disguised assumptions;
- the simplest viable option is visible when alternatives are considered;
- there is one next permitted action rather than an unbounded future plan.
