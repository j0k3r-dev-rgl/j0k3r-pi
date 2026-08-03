---
name: startup-documentation
description: "initialize, route, and maintain a startup project's numbered modular Markdown documentation under docs/ without inventing product, architecture, technology, or delivery decisions."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Startup Documentation

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "product",
  "domains": ["startup-lifecycle", "project-documentation", "decision-routing", "traceability"],
  "triggers": {
    "paths": [
      "docs/00-discovery/**/*.md",
      "docs/01-product/**/*.md",
      "docs/02-requirements/**/*.md",
      "docs/03-architecture/**/*.md",
      "docs/04-delivery/**/*.md",
      "docs/05-validation/**/*.md"
    ],
    "keywords": [
      "startup documentation",
      "initialize startup documentation",
      "new software project",
      "start new software project",
      "startup project",
      "start startup project",
      "new application",
      "new application project",
      "guide project definition",
      "project documentation flow",
      "create project documentation flow",
      "numbered modular documentation",
      "numbered modular Markdown documentation",
      "which document owns",
      "document ownership",
      "reconstruct modular documentation baseline",
      "scan codebase for documentation",
      "que documento corresponde",
      "documentar codigo existente",
      "documentar proyecto startup",
      "flujo documental startup",
      "iniciar nuevo proyecto de software",
      "definir nueva aplicacion",
      "documentacion modular numerada"
    ]
  },
  "sdd_phases": ["explore", "proposal", "spec", "design", "task", "apply", "verify"],
  "related_skills": [
    "anti-overengineering",
    "cognitive-doc-design",
    "existing-project-onboarding",
    "product-discovery"
  ],
  "priority": 90
}
```

## Activation Contract

Use this skill when a user starts or reorganizes a software startup's project documentation, asks which numbered Markdown document owns a decision, or requests progression through the documented startup lifecycle.

This is a domain-documentation router. It does not create a fourth Pi execution workflow and does not replace Direct Orchestrator, Mini-SDD, or Formal SDD. Load the specific domain skill that owns the requested decision. Use `existing-project-onboarding` when an existing implementation must be scanned and reconstructed into the modular documentation baseline. Use `product-discovery` when a new project's problem, users, evidence, assumptions, or product direction are not yet established.

Do not create the complete documentation tree eagerly, generate empty placeholder files, or use this skill to decide product scope, architecture, technology, sprint content, or validation thresholds.

## Change Intake Routing

For an MVP or application already being evolved, route only the first unresolved decision. Reuse approved documents and do not restart the lifecycle when existing contracts already answer the change.

| Requested change | First canonical owner or action |
|---|---|
| Bug whose expected behavior and acceptance are already approved | Trace the existing requirement/acceptance IDs, select the applicable Pi workflow, and use Strict TDD; reopen product documentation only if evidence challenges it. |
| Bug whose expected behavior is missing, ambiguous, or contradictory | `requirements-definition` before implementation. |
| Feature inside approved product scope with clear behavior | `requirements-definition`. |
| New capability, changed user journey, or product-scope expansion | `product-definition`. |
| Feature whose problem, audience, or value remains uncertain | `product-discovery`, with `product-validation` for an approved bounded experiment when useful. |
| New or changed architecture driver, responsibility, data/trust, or deployment boundary | `architecture-definition`. |
| Significant technology, dependency, vendor, protocol, or integration choice | `technical-decisions`. |
| Approved change ready to become an increment, sprint, or flow item | `delivery-planning`. |
| Outcome evidence, conformance evidence, experiment result, or learning decision | `product-validation`. |
| Existing codebase without a trustworthy modular documentation baseline | Principal-only `existing-project-onboarding`. |

Documentation defines and traces the intended change; it does not authorize implementation. Code changes proceed only through Direct Orchestrator, Mini-SDD, or Formal SDD as selected by workflow triage and must follow Strict TDD. Do not run onboarding for an ordinary feature or bug, repeat discovery for an already supported problem, or regenerate unaffected documentation.

## Hard Rules

- Load and follow `anti-overengineering` whenever this skill is active.
- Store durable project documentation as Markdown under the exact approved group and owner paths in `references/document-contract.md`.
- Create only the group, index, and document needed for the current approved decision. Never scaffold every possible document.
- Each document owns one coherent subject or decision family. Split it only when parts need independent review, value, risk, evidence, approval, or delivery handling now.
- Treat summary documents as navigation and decision summaries; put repeated evidence, requirements, decisions, integrations, increments, sprints, and experiments in numbered child files.
- Preserve creation-order numbers. Never renumber existing documents merely to improve appearance, and never reuse a retired identifier.
- Use lowercase English kebab-case for paths while allowing document prose in the language explicitly selected by the user.
- Ask only for unresolved decisions necessary for the next document. Group questions, put the simplest viable option first, explain material trade-offs, and never infer the user's product or technical choices.
- Reuse approved language, decision owners, scope, evidence references, and metadata unless they are absent, stale, contradicted, or specific to the new decision.
- Distinguish confirmed evidence, supported evidence, inference, assumption, and unknown. Never promote an assumption to a requirement silently.
- One canonical owner must exist for each durable fact or decision. Other documents link to it rather than duplicate or overwrite it.
- Route architecture drivers and views to `architecture-definition`; route ADRs, technology selections, dependency decisions, and integrations to `technical-decisions`.
- Route product outcome and success/guardrail intent to `product-definition`; route operational metric definitions, thresholds, results, and learning decisions to `product-validation`.
- When upstream evidence or decisions change, identify affected links and request review only for materially affected descendants. If impact cannot be bounded safely, mark the uncertainty and ask the user.
- Do not place architecture, technology, delivery, or implementation decisions inside discovery or product documents. Route them to their owning group and skill.
- Follow `references/document-contract.md` for document metadata, status, numbering, ownership, evidence provenance, material change requests, trace promotion, links, boundaries, and change handling.
- Load this router once for the current routing decision. Resolve direct matches without related-skill expansion, then select the exact canonical owner by path/decision contract. Generic documentation or supporting skills never co-own a lifecycle artifact and do not displace a matching owner even when also returned by routing. Load only the selected owner and its explicitly applicable mandatory dependencies. Related skills are handoff hints, not an instruction to load the lifecycle. The selected owner consumes the shared contract directly and must not recursively restart routing.

## Decision Gates

Before creating or changing documentation, resolve only what is necessary now:

- project and document language when no parent or existing convention establishes it;
- the current decision or question the document must answer;
- the canonical group and owning domain skill;
- the user who owns any material product, architecture, cost, risk, or delivery decision;
- whether current claims are evidence, inference, assumptions, or unknowns;
- whether a new document is necessary or an existing canonical document should be updated.

Stop and ask before:

- selecting among materially different valid product or technical alternatives;
- adding a new documentation group, cross-project convention, dependency, migration, or compatibility policy;
- replacing an approved decision;
- creating a document that would duplicate an existing canonical owner;
- creating architecture or delivery artifacts before their approved inputs exist.

## Execution Steps

1. Identify the user's current decision and reuse all approved context already available.
2. Resolve direct registry matches without related expansion and load only the canonical domain skill that owns the decision plus mandatory dependencies applicable now; do not expand all lifecycle skills.
3. Read the relevant existing parent/index document only when it is required and has not already been supplied.
4. Ask a concise grouped questionnaire for unresolved facts and user-owned choices.
5. Create or update only the smallest coherent Markdown artifact required now.
6. Apply the shared document contract, reuse approved metadata, and add links instead of copying canonical content.
7. Run the shared structural-validation checklist and check that the document has a single responsibility, explicit exclusions, bounded size, evidence provenance when applicable, decision ownership, valid trace links, and one next permitted action.
8. Run structural validation. Generate the skill registry and run relevant routing checks only when the approved scoped change modifies skill definitions or routing metadata.
9. Stop when the requested document or routing decision is complete.

## Output Contract

Return:

- Skills applied: `startup-documentation`, `anti-overengineering`, and the selected domain skill.
- Current lifecycle group and canonical document path.
- Decision or question documented.
- User decisions requested and resolved, or `None`.
- Evidence, inference, assumptions, and unknowns kept distinct.
- Documents created or updated; empty or speculative documents created: `None`.
- Trace links and materially affected descendants.
- Validation executed.
- One next permitted action, or `None`.

## References

- `references/document-contract.md` — canonical modular Markdown, metadata, numbering, ownership, evidence, traceability, and change contract.
- `~/.pi/agent/skills/anti-overengineering/SKILL.md` — mandatory scope, simplicity, and decision controls.
- `~/.pi/agent/skills/cognitive-doc-design/SKILL.md` — progressive disclosure and reviewability guidance.
- `~/.pi/agent/skills/product-discovery/SKILL.md` — discovery-group owner for problem, users, evidence, assumptions, and initial direction.
- `~/.pi/agent/AGENTS.md` — canonical Pi workflow, authority, and delegation policy.
