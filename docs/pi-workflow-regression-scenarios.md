# Pi Workflow and Project Documentation Regression Scenarios

This document is non-authoritative maintainer and reviewer guidance. It does not create a workflow, consent gate, phase, runtime check, or acceptance rule. Canonical behavior remains in `AGENTS.md`, the applicable `SKILL.md` files, and approved change artifacts.

## Purpose

Use these scenarios after changing workflow, routing, TDD, project-documentation, onboarding, ownership, or handoff contracts. Run only the cases affected by the change plus representative neighboring boundaries. Record actual routing and clause evidence; do not turn this catalog into mandatory ceremony for ordinary project work.

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
| WF-02 | Small explicit bounded code fix | Use Direct Orchestrator for a known trivial patch, an explicit direct override, or an authorized targeted fix already resolved by completed research. Otherwise use bounded discovery in Planned Workflow; never duplicate sufficient research. Apply TDD and anti-overengineering to code changes. |
| WF-03 | Medium multi-file feature with shared plan | Planned Workflow delegates planning, apply, and independent verify; after user approval, the orchestrator archives directly. |
| WF-04 | Work cannot fit a coherent lightweight contract | Resolve material decisions or split scope with the user; do not introduce another workflow. |
| WF-05 | User explicitly requests execution without delegation | Direct Orchestrator investigates, plans, implements, and validates within approved scope; no delegated phases. |
| WF-06 | Advice-only architecture or workflow comparison | Explain without execution; comparison does not authorize reads or changes. |
| WF-07 | workflow artifact is `BLOCKED` | Do not advance; request only the missing material decision/dependency. |
| WF-08 | Planned Workflow archive preflight | Orchestrator requires ready plan.md, passing verify.md, unchanged continuity evidence, explicit archive approval, and a safe absent destination; never delegate archive. |
| WF-09 | Pre-implementation discovery only | Assign exact discovery.md path and contract skill in Planned Workflow; preserve EVID-### evidence, read artifact, and stop without automatic planning or implementation. |
| WF-10 | Verified candidate changed before archive/delivery | Recompute the verified continuity manifest immediately before the boundary; any record or aggregate SHA-256 mismatch blocks mutation/delivery, invalidates prior verification continuity, and requires a new applicable verification decision. |
| WF-11 | Workflow-relevant delegation requires a canonical handoff | Supply seven delegation fields and the exact accessible artifact-contract skill path; agent reads it and returns only the four-field Handoff block. |
| WF-12 | User calls OpenSpec a separate workflow | Treat OpenSpec as the artifact namespace for Planned Workflow and discovery, not another workflow. |
| WF-13 | Standalone investigation or research is requested | Route to deep-researcher (producing report.md and sources.md), using local code and external sources as needed, never 00-discovery, unless direct execution is authorized. |
| WF-14 | discovery.md already exists for another investigation | Do not overwrite; resolve ownership or assign a distinct change folder. |
| WF-15 | Planned Workflow apply or remediation | Validate every MINI-### and acceptance check; do not require legacy tasks/spec artifacts. |
| WF-16 | Existing historical workflow artifacts | Preserve them; do not automatically migrate, delete, or resume retired phases. |
| WF-17 | Configuration file is inside writable scope | Require explicit configuration authorization; generic implementation permission is insufficient. |

| WF-18 | Archive destination exists, path is unsafe, or atomic rename is unavailable | Stop without overwrite/merge or automatic copy/delete fallback; request the missing decision. |
| WF-19 | Archive completed | Confirm complete destination tree, absent source, and no owned residue; report destination without a new phase artifact. |

| WF-20 | Material product question before implementation | Ask the user and record the decision or blocker in plan.md; no separate PRD artifact, review agent, or mandatory product-documentation detour. |
| WF-21 | User explicitly requests product documentation | Use project-documentation independently; its ownership modules are not Planned Workflow phases. |
| WF-22 | Decision is missing or ambiguous | Trip circuit breaker immediately: stop execution, ask user directly for the decision, do not mutate files or guess defaults. |
| WF-23 | Orchestrator prepares to mutate files | Present Pre-Mutation Summary Gate to user (files, changes, rationale, validation) before applying modifications. |
| WF-24 | Research identifies exact cause and fix, but user requested analysis only | Present findings and stop; sufficient evidence permits reusing research, not implementation. |
| WF-25 | User authorizes the targeted fix after sufficient research | Direct Orchestrator applies and validates after the summary gate; no repeated discovery/planning or redundant consent. Configuration Lock still applies. |
| WF-26 | A subagent has an unresolved material decision and a live parent-question channel | Stop dependent work, ask through ask_orchestrator, wait in the same session; return BLOCKED when no channel/resolution exists. Parent answers facts/approved decisions, asks user for unmade decisions, and does not invent authority. |
| WF-27 | plan.md defines independent Parallel Units | Launch independent workers concurrently in one turn, omitting mode unless explicitly requested by the user; manager chooses mode. Integrate once and run one combined independent verify, not one verify per unit. |
| WF-28 | Parallel apply starts with pre-existing modified/untracked files | Capture pre-apply path/state/content and index identities. Surface Check attributes only baseline-relative deltas; unchanged pre-existing work is not worker output. Never clean/stash/reset or demand a commit. |
| WF-29 | A worker changes a file that was already modified before apply | Content identity must reveal the delta even when git status/name is unchanged. New outside-surface or concurrent edits require attribution; missing baseline blocks rather than retrospective reconstruction. |
| WF-30 | New verify snapshot must be reproducible | Verify computes approved deliverable identities directly under applicable scope, without a parent relay. Record exact present/absent identities and SHA-256 of UTF-8 JSON.stringify of path-sorted three-string records, with the complete read-only command and concrete paths. Repeat at delivery/archive; drift blocks. Reject duplicate paths and unexpected symlinks; preserve historical encodings. |
| WF-31 | Verify sections could duplicate acceptance evidence | Keep proof once in the MINI matrix; other sections contain only gaps, discrepancies, or references. Matching hashes do not replace functional acceptance. |
| WF-32 | Routing cache is stale/missing or returns many candidates | Resolve directly against live sources with include_related:false for owner selection; no cache writes or generate prerequisite. Read selected skills only, retaining mandatory guardrails. |
| WF-33 | A rule is repeated across workflow documents | Keep authorization in AGENTS, routing in triage, lifecycle in work-workflow, and formats in artifact-contracts; preserve lean-worker boundaries and explicit assigned-contract reads. |
| WF-34 | Standalone research has useful independent complementary questions | Triage starts with two deep-researcher lanes when useful, not a fixed count. Each seven-field prompt supplies shared context, one bounded question, depth, source/evidence bounds, freshness/version/geography constraints or None, language, and sensitive boundaries. Assign distinct timestamped lane-slug directories containing only report.md and sources.md; launch concurrently in one parent turn, omit mode unless user requested it, and consume notifications without polling. |
| WF-35 | Standalone research question is small or depends on another answer | Use one researcher rather than manufacturing parallelism; keep standalone output fallback. Direct factual answers/exact known reads remain direct, and pre-implementation discovery remains 00-discovery. |
| WF-36 | User requests research explicitly without delegation | Apply direct-execution override before lane selection: inspect/research directly within approved bounds, never launch researchers. Advice-only comparisons remain non-executing. |
| WF-37 | Research returns mixed READY/BLOCKED, failed, missing, or unusable lanes | Parent accounts for every launched lane explicitly. Usable independent findings may be reported with limitations, but dependent conclusions/actions stop and cannot be claimed complete. Workers use live ask_orchestrator and wait when available, otherwise BLOCKED; parent asks user for unmade material decisions. |
| WF-38 | Bounded research lanes reuse local source IDs or disagree | Respect each lane's source/depth/freshness/evidence bounds without an exhaustive sweep or fixed quota. Parent reads reports and source indexes, qualifies material citations by lane/report/source path, and retains facts, interpretation, uncertainty, and contradictions without false consensus. |
| WF-39 | Research-only parallel results are ready | Parent gives one integrated answer; no synthesizer agent, extra phase, or required integration artifact. Workers never implement recommendations or edit canonical docs. Findings alone grant no implementation authority; retain WF-24/WF-25 authorization boundaries. |
| WF-40 | User already explicitly authorized unchanged Planned Workflow apply | Parent reads ready plan and announces exact mutation/validation; reuse consent with author/message, action, scope, authority artifact, and change identity. No duplicate approval. READY/checks alone are not consent; advice-only work stops, scope growth/new material decisions require a question, and WF-17 plus separate commit/push/archive consent still apply. |
| WF-41 | Fixed-candidate validation checks have no dependencies or shared mutable resources | Checks may overlap only after isolation is established; no candidate edits or checker conflicts. Preserve one final independent verifier over the complete candidate/MINI set after prerequisite results, not a verifier per check/unit or manufactured Parallel Units. |
| WF-42 | Checks share a fixture/database/port/file/cache, have unknown side effects, or overlap ongoing apply | Run sequentially when independence/isolation is unproven; never verify a candidate while implementation edits continue. Failed/missing prerequisites stop dependent checks and final PASS; usable independent results retain their actual status. No new runtime capability or automatic retry is implied. |
| WF-43 | Provider authentication/transport interrupts apply, unlike task acceptance failure or a missing decision | Report the actual category and affected phase/task, known partial artifacts/changes/results, incomplete or uncertain work, and one permitted next action. Preserve partial work and usable independent results; stop dependent advancement. Never infer no changes, claim success, invent resume handles, repair credentials, or automatically relaunch/switch model or effort. |
| WF-44 | User explicitly says “relanza” after interruption | Under applicable continuation semantics, resume only unchanged authorized scope/model/effort, preserving partial work and inspecting bounded state. Consent is not a blanket future retry, credential/config repair, or model/effort switch. Unsupported/unknown safe continuation blocks; ask only the missing decision. |

## Compact delegation and directory scope

| ID | Situation | Expected result |
|---|---|---|
| SCOPE-01 | Controllers, services, and tests under one module | Use the narrowest common module parent once; no sibling-directory or predicted-file inventory. |
| SCOPE-02 | Separate approved backend and frontend areas | Use the minimal distinct roots; do not silently grant repository-wide writes. |
| SCOPE-03 | Implementation needs another directory | Stop and request scope expansion before modifying outside the boundary. |
| SCOPE-04 | Shared types outside writable module | Grant only necessary additional read access; no implicit write permission. |
| SCOPE-05 | Config file lies inside writable directory | Configuration Lock still requires explicit authorization. |
| SCOPE-06 | Upstream contract already has scope and acceptance | Seven compact fields reference it; each exact path appears once, no copied inventories/criteria/commands. |
| SCOPE-07 | First discovery has no upstream contract | Send question, consolidated read area, exclusions, exact output and skill references; do not invent a context document. |
| SCOPE-08 | Apply completed | Actual changed files appear in apply evidence; verify checks completeness independently. |
| SCOPE-09 | User explicitly restricts one file | Preserve that tighter boundary; parent consolidation cannot broaden explicit authorization. |
| SCOPE-10 | Prompt exceeds soft word target due to essential authority | Preserve authority, not an arbitrary truncation; remove duplication first. |
| SCOPE-11 | Assigned skill explicitly requires exact skill-template.md outside implementation roots | Read that task-required input without another permission roundtrip; citation grants no editing or arbitrary/recursive link-following. An unrelated outside-boundary link, unexpected symlink, or secret remains blocked; SCOPE-03/04 still control expansion/writes. |
| SCOPE-12 | Approved-file stat/SHA-256 or read-only Git identity is needed | Execute directly under the exact allowed command or bounded read-only validation allowance. A sole None, explicit only-diff limit, or tighter file boundary still wins; reject injected shell fragments, untrusted interpolation, credential/environment inspection, network/external writes, and silent traversal. Policy does not bypass tool/security gates or authorize Git mutations. |

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
| NEW-01 | Proposed solution with unresolved problem/users/evidence | `project-documentation` routes to `references/owners/product-discovery.md`; no MVP, architecture, or implementation invented. |
| NEW-02 | User explicitly supplies and accepts premise/audience/uncertainty | `project-documentation` routes to `references/owners/product-definition.md` without ceremonial discovery. |
| NEW-03 | MVP scope or new capability decision | `project-documentation` routes to product-definition owner module; user owns scope and trade-offs. |
| NEW-04 | Approved capability needs observable behavior | `project-documentation` routes to requirements owner module with requirement and acceptance IDs. |
| NEW-05 | Unsupported scale/security/availability target | Stop for justified target/evidence; do not invent it. |
| NEW-06 | Architecture driver or trust boundary | `project-documentation` routes to architecture owner module; no hidden technology/vendor selection. |
| NEW-07 | Significant technology/dependency/integration choice | `project-documentation` routes to technical-decisions owner module; simplest baseline, evidence, consequences, and user decision. |
| NEW-08 | Approved change ready for implementation planning | `project-documentation` routes to delivery-planning owner module; one small vertical increment/sprint/flow item. |
| NEW-09 | Experiment or conformance evidence | `project-documentation` routes to product-validation owner module; predeclared criteria and correct trace IDs. |
| NEW-10 | Evidence challenges approved canonical content | Initiator requests CR; Validation creates/routes it; target owner returns disposition; Validation closes with evidence. |
| NEW-11 | Router loads one canonical domain owner module | `project-documentation` reads only the selected internal owner module and shared contract; owner modules are not separate skills. |
| NEW-12 | Registry resolves project-documentation for an workflow phase | Treat phase relevance as routing metadata only; it does not create a phase owner or another workflow. |
| NEW-13 | CR record says `APPROVED` but no owner disposition exists | Do not infer acceptance; lifecycle status and target-owner semantic disposition are distinct. |
| NEW-14 | English and Spanish README lifecycle summaries are reviewed after a contract change | Both describe the same two workflows, routing boundaries, and startup lifecycle without creating separate authority. |
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
