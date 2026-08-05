# Pi Workflow and Startup Lifecycle Regression Scenarios

This document is non-authoritative maintainer and reviewer guidance. It does not create a workflow, consent gate, phase, runtime check, or acceptance rule. Canonical behavior remains in `AGENTS.md`, the applicable `SKILL.md` files, and approved change artifacts.

## Purpose

Use these scenarios after changing workflow, routing, TDD, startup-documentation, onboarding, ownership, or handoff contracts. Run only the cases affected by the change plus representative neighboring boundaries. Record actual routing and clause evidence; do not turn this catalog into mandatory ceremony for ordinary project work.

## Validation method

For each applicable scenario:

1. Resolve direct skill matches without related expansion.
2. Identify the expected workflow and canonical owner from current contracts.
3. Confirm advice versus execution authorization.
4. Confirm user-owned material decisions and agent-owned local reversible choices.
5. Check the expected artifact, TDD, verification, change-request, or stop condition.
6. Record `PASS`, `ISSUE`, or `BLOCKED` with exact paths/checks.

Related skills are handoff hints, not additional owners. A lower-ranked generic helper is not a failure when the canonical owner is selected correctly.

## Workflow routing scenarios

| ID | Request | Expected result |
|---|---|---|
| WF-01 | “Which workflow should I use?” | `workflow-triage`; `ADVICE_ONLY`; no project inspection or execution. |
| WF-02 | Small explicit bounded code fix | Direct Orchestrator; no second start confirmation; load TDD and anti-overengineering. |
| WF-03 | Medium multi-file feature with shared plan | Mini-SDD: `mini-sdd.md` → `apply.md` → independent `verify.md` → archive. |
| WF-04 | Large cross-contract/security/migration change | Formal SDD phases through `tasks.md`, apply, independent verify, and archive. |
| WF-05 | User explicitly selects Mini-SDD or Formal SDD | Begin selected workflow without reopening triage unless scope materially changes. |
| WF-06 | Advice-only architecture or workflow comparison | Explain without execution; comparison does not authorize reads or changes. |
| WF-07 | SDD artifact is `BLOCKED` | Do not advance; request only the missing material decision/dependency. |
| WF-08 | Mini-SDD archive preflight | Require ready `mini-sdd.md` and passing `verify.md`; do not require `tasks.md`. |
| WF-09 | Formal SDD archive preflight | Require ready `tasks.md` and passing `verify.md`. |
| WF-10 | Verified candidate changed before archive/delivery | Recompute the verified continuity manifest immediately before the boundary; any record or aggregate SHA-256 mismatch blocks mutation/delivery, invalidates prior verification continuity, and requires a new applicable verification decision. |
| WF-11 | Workflow-relevant delegation requires a canonical handoff | Include the exact six-field handoff envelope in the prompt; a reference to an unavailable contract is insufficient. |
| WF-12 | User calls OpenSpec a separate workflow | Treat OpenSpec as the artifact namespace/convention for Mini-SDD and Formal SDD, never as a fourth workflow or external authority. |

## Anti-overengineering and TDD scenarios

| ID | Request | Expected result |
|---|---|---|
| DEV-01 | Bug with approved requirement/acceptance IDs | Reproduce with expected RED, smallest GREEN, REFACTOR, focused regression evidence. |
| DEV-02 | Bug with ambiguous expected behavior | Ask for the material behavior/acceptance decision before code changes. |
| DEV-03 | User does not name target files | Agent identifies directly required files within the approved behavior boundary. |
| DEV-04 | Repository has a clear local framework/convention | Reuse it without asking; ask only if conventions conflict or create a material trade-off. |
| DEV-05 | Several equivalent local reversible implementations | Agent selects the simplest sufficient compliant choice. |
| DEV-06 | New dependency, migration, compatibility bridge, or external service | Require explicit applicable authorization; do not infer it from implementation convenience. |
| DEV-07 | Pure feature removal without observable absence contract | Do not manufacture RED; remove obsolete behavior/tests/support and validate retained behavior. |
| DEV-08 | Removed route must return an approved status | Treat absence as observable behavior and use normal RED → GREEN → REFACTOR. |
| DEV-09 | Security-sensitive behavior | Require applicable negative/adversarial evidence, not only happy-path tests. |
| DEV-10 | Documentation/config-only change | Use focused structural/syntax validation; do not invent code tests. |
| DEV-11 | Focused validation passes but broader risk is coupled | Broaden only for demonstrated regression, security, data, migration, or external-effect risk. |
| DEV-12 | Optional cleanup appears nearby | Exclude it unless required for the approved outcome or separately authorized. |

## Greenfield startup scenarios

| ID | Request | Expected owner/result |
|---|---|---|
| NEW-01 | Proposed solution with unresolved problem/users/evidence | `product-discovery`; no MVP, architecture, or implementation invented. |
| NEW-02 | User explicitly supplies and accepts premise/audience/uncertainty | `product-definition` may begin without ceremonial discovery. |
| NEW-03 | MVP scope or new capability decision | `product-definition`; user owns scope and trade-offs. |
| NEW-04 | Approved capability needs observable behavior | `requirements-definition` with requirement and acceptance IDs. |
| NEW-05 | Unsupported scale/security/availability target | Stop for justified target/evidence; do not invent it. |
| NEW-06 | Architecture driver or trust boundary | `architecture-definition`; no hidden technology/vendor selection. |
| NEW-07 | Significant technology/dependency/integration choice | `technical-decisions`; simplest baseline, evidence, consequences, and user decision. |
| NEW-08 | Approved change ready for implementation planning | `delivery-planning`; one small vertical increment/sprint/flow item. |
| NEW-09 | Experiment or conformance evidence | `product-validation`; predeclared criteria and correct trace IDs. |
| NEW-10 | Evidence challenges approved canonical content | Initiator requests CR; Validation creates/routes it; target owner returns disposition; Validation closes with evidence. |
| NEW-11 | Router loads one canonical domain owner | Owner consumes the supplied shared contract and does not recursively re-enter startup routing. |
| NEW-12 | Registry resolves startup/onboarding for an SDD phase | Treat `sdd_phases` as relevance metadata only; it does not create a phase owner or fourth workflow. |
| NEW-13 | CR record says `APPROVED` but no owner disposition exists | Do not infer acceptance; lifecycle status and target-owner semantic disposition are distinct. |
| NEW-14 | English and Spanish README lifecycle summaries are reviewed after a contract change | Both describe the same three workflows, routing boundaries, and startup lifecycle without creating separate authority. |
| NEW-15 | Registry owner selection could expand related skills by default | Resolve the canonical owner with `include_related:false`; related skills remain handoff hints and never become co-owners. |

## Existing-project onboarding scenarios

| ID | Situation | Expected result |
|---|---|---|
| OLD-01 | Existing repository lacks trustworthy baseline | Principal-only onboarding requests scan scope/depth/exclusions/sensitive boundaries before inspection. |
| OLD-02 | Tiny bounded repository | Principal may merge/omit lanes; no fixed subagent count or unnecessary fan-out. |
| OLD-03 | Large monorepo | Map project units before detailed reconstruction. |
| OLD-04 | Multiple independent products collide in singleton docs | Stop canonical generation and ask for one product/documentation boundary. |
| OLD-05 | No immutable VCS reference | Use the defined deterministic snapshot procedure or mark evidence `UNVERIFIABLE`. |
| OLD-06 | Parallel lanes return in different orders | Stable ordering/deduplication produces arrival-order-independent evidence; disagreements remain `CONFLICT`. |
| OLD-07 | Research subagent writes canonical docs or infers intent | Reject the result; subagents return evidence only. |
| OLD-08 | Sensitive value is encountered | Persist no raw value; sanitize/escalate; block dependent work while unrelated safe lanes continue only if the broader boundary is unchanged. |
| OLD-09 | Code demonstrates behavior but intent is unknown | Record AS_IS evidence; require user decision before TO_BE promotion. |
| OLD-10 | One lane fails or becomes stale | Rerun/invalidate only affected evidence and dependents; do not rescan unchanged lanes. |
| OLD-11 | User requests “all documentation” after a scan | Generate only currently applicable, evidence-supported documents after necessary user decisions; no AS_IS-to-TO_BE promotion or placeholders. |
| OLD-12 | Two lanes differ only in claim whitespace/Unicode form | Apply the bounded normalization rule before IDs; do not paraphrase or infer semantic equivalence. |

## Delivery and continuation scenarios

| ID | Situation | Expected result |
|---|---|---|
| DEL-01 | Sprint proposed as frontend/backend/database-only work | Reject as a complete functional module; require a vertical approved boundary. |
| DEL-02 | Necessary enabling work | Link to the same goal with its own acceptance/DoD evidence; do not represent it as user-complete value. |
| DEL-03 | Required ADR is unresolved | Mark affected item `CONDITIONAL_NOT_COMMITTABLE`; unrelated traced planning may continue. |
| DEL-04 | Kanban/flow selected | Use increments as flow items; create sprint records only when sprints are explicitly selected. |
| DEL-05 | Increment reaches implementation result | Record TDD, acceptance/conformance, broader checks, validation status, data/release evidence, and result. |
| DEL-06 | Result is `NOT_DONE` | Return remaining behavior to bounded replanning; no hidden carry-over or value claim. |
| DEL-07 | Required validation or CR remains unresolved | Next increment remains `BLOCKED` or `CONDITIONAL`, not `ELIGIBLE`. |
| DEL-08 | Increment is potentially releasable | Do not infer release authorization; record `NOT_REQUESTED | APPROVED | BLOCKED`. |
| DEL-09 | Delivery plan exists before implementation | Record planned evidence expectations; observed TDD/results remain `None` until a separately authorized workflow produces them. |
| DEL-10 | Increment has an unresolved material privacy incident or guardrail breach | Do not claim `DONE`, authorize release, or mark a dependent increment `ELIGIBLE`; require owner disposition and applicable Validation/CR evidence. |

## Conditional AI/agent architecture scenarios

Apply these only when the application itself contains AI/agent capabilities.

| ID | Situation | Expected result |
|---|---|---|
| AI-01 | Agent can invoke tools or external systems | Record tool permissions, authorization boundary, least privilege, and human-approval gate when required. |
| AI-02 | Prompts/instructions cross trust boundaries | Record instruction source/trust, injection risk, context handling, and applicable verification. |
| AI-03 | Agent uses persistent memory/context | Record data ownership, sensitivity, retention/deletion, isolation, and user-control boundaries. |
| AI-04 | Agent-produced release artifact has material provenance risk | Technical decision records sufficient source/build provenance or attestation evidence without mandating a vendor or framework. |
| AI-05 | RAG or embedding/vector context crosses trust boundaries | Record retrieval source/trust, data isolation, sensitivity, retention, and applicable injection/poisoning risks without imposing RAG controls elsewhere. |
| AI-06 | Material AI model/provider or agent-tooling choice | Route to Technical Decisions when risk, data, cost, integration, operations, or reversibility is affected. |
| AI-07 | Build plugin, CI action, base image, toolchain, generator, or generated artifact materially affects release integrity | Include it in risk-proportional dependency/provenance review; do not limit supply-chain evidence to runtime libraries. |

## Evidence to retain

For each maintenance run, retain only concise review evidence:

- scenario IDs exercised;
- intent/path probe;
- expected and actual workflow/owner;
- relevant canonical clauses;
- validation command/tool result;
- unresolved issue or `None`.

Do not create per-run artifacts unless the governing workflow or maintainer explicitly needs durable evidence.
