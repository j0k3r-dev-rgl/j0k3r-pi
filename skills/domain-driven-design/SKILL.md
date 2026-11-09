---
name: domain-driven-design
description: "Model non-trivial business rules and service boundaries with Domain-Driven Design: bounded contexts, ubiquitous language, aggregate invariants, value objects and domain events. Use for complex domain behavior, legacy domain refactoring, or domain documentation; not infrastructure, UI-only or plain CRUD tasks."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.1"
registry:
  category: "domain"
  domains: "domain-driven-design, domain-modeling, bounded-contexts, business-rules"
  paths: "docs/domain/**, **/domain/**, **/aggregates/**"
  keywords: "ddd, domain driven design, bounded context, ubiquitous language, aggregate invariant, value object, domain event, context map, event storming, subdomain, anti-corruption layer"
  related: "anti-overengineering, tdd"
  priority: 85
---

# Domain-Driven Design

## Activation Contract

Use for non-trivial business behavior, explicit domain modeling, service/context boundaries or legacy domain refactoring. Do not load merely because a file is under src, lib or app. Infrastructure, mechanical changes, UI-only work and plain CRUD do not need DDD.

## Canonical Scope

Own domain terminology, subdomain classification, bounded contexts, context maps, aggregate invariants and proportionate tactical patterns. Do not own workflow selection, dependency installation, stack choice or user-owned business decisions.

## Hard Rules

- **Reuse before modeling.** Read the project's existing glossary, domain contracts and boundaries when relevant. Do not introduce a competing vocabulary or duplicate a domain skill already owned by the project.
- **Never invent business rules.** Surface missing invariants/policies as decisions; known facts and research do not grant permission to choose business behavior.
- **Right-size the model.** Core complex rules may justify strategic and tactical DDD; supporting domains need only the useful pieces. Generic/CRUD behavior can use a transaction script or active record. No event sourcing, extra layers or repository per table by default.
- **Boundaries before patterns.** Name the affected context and terms before changing complex domain logic. Keep necessary decisions in the existing plan.md or canonical project docs; do not require a new documentation phase or scaffold a full docs/domain tree.
- **Invariants define consistency.** Choose aggregate boundaries from rules requiring atomic consistency, not tables. Keep aggregates small, reference other roots by identity, and make cross-boundary consistency/integration choices explicit rather than silently introducing shared transactions or events.
- **Keep business behavior testable.** Separate business rules from transport/persistence concerns when it materially helps the existing design; do not force a clean-architecture rewrite or forbid a suitable existing pattern.
- **Use ubiquitous language.** Code, tests and events use the context's agreed terms; clarify words with different meanings across contexts. Update only affected existing docs when rules change.
- Value objects compare by value; entities compare by identity. Events represent facts in the past tense. Use an anti-corruption layer where translation from a foreign/legacy model is actually needed, not automatically for every external API.

## Execution Steps

1. Identify the affected business rules, existing terminology and context. Classify core/supporting/generic with product evidence; ask only for unresolved material business choices.
2. Select the lightest modeling depth. For a trivial domain, state that DDD is unnecessary and continue without additional artifacts.
3. Record the boundary, invariants, commands and integration consequences needed for this change in its existing contract. Event storming/context maps are optional tools for actual ambiguity, not mandatory deliverables.
4. Choose aggregates/value objects/events only where the rules justify them. Reuse the current architecture unless the approved change requires otherwise.
5. Apply tdd for behavior changes and prove each changed invariant with focused tests. Follow the normal workflow owner; no separate DDD lifecycle.
6. Update affected canonical domain documentation in the same change. Optional templates in references support new documentation when authorized and useful.

## Output Contract

Integrate a compact domain summary into the normal plan/review: context and terms, changed invariants, selected modeling depth, affected boundaries, tests and unresolved decisions. Do not append another report or require every reference template.

## References

Adapted from the user's DSH skill at ~/.dsh/skills/domain-driven-design, with narrower Pi routing and no mandatory domain-document scaffolding.

- `references/ubiquitous-language-template.md` — vocabulary when a glossary is useful.
- `references/context-map-template.md` — cross-context relationships.
- `references/bounded-context-canvas.md` — strategic context questions.
- `references/aggregate-design-canvas.md` — invariants and consistency boundaries.
- `references/adr-template.md` — significant domain decisions only.
