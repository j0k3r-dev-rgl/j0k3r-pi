# PRD Review: Agent-efficient API Tools output contracts

## Verdict
Ready for SDD: Yes with warnings
PRD review approval: approved-by-prd-review
PRD flow lifecycle status: prd-review-complete-returned-to-triage
User override required to continue despite gaps: No

## PRD Inputs
- Metadata: `openspec/changes/api-tools-agent-output-contracts/metadata.yaml`
- PRD: `openspec/changes/api-tools-agent-output-contracts/prd.md`
- PRD declared status: draft
- Supporting context inspected: PRD, per-flow metadata, project `openspec/config.yaml`, `skills/sdd-workflow/phase-contracts.md`, `skills/sdd-workflow/shared-phase-rules.md`, `skills/sdd-workflow/prd-and-discovery.md`, `skills/sdd-workflow/artifact-conventions.md`. No additional code or contract artifacts were referenced by the active flow state.

## Strengths
- Problem statement is clear: current model-facing output is inefficient, sometimes misleading, and lacks authorization metadata.
- Goals and non-goals are well balanced, explicitly ruling out inference of hidden authorization, credential exposure, and arbitrary client generation.
- FR-1 through FR-12 provide a coherent requirements story: compact discovery, single-operation detail, separate schema inspection, contract-derived authorization, truthful errors, structured continuation, and aligned base-tool output.
- Security and privacy stance is explicit: no guessing roles, no exposing secrets, no unrestricted vendor payloads, redaction before output/pagination.
- User stories and personas align with agent, operator, and reviewer needs.
- Risks and mitigations are concrete and directly tied to PRD decisions.
- Out of scope section is crisp, preventing scope creep.
- The PRD is product/requirements-focused and avoids naming source files, functions, or implementation steps.

## Critical Debts
Issues that must be resolved before implementation:
- None

## Warnings
Issues that should be resolved before or during SDD planning:
- **Compatibility expectations for existing callers** are not stated. Because output envelopes for `api_swagger`, `api_graphql`, and `api_rest_request` are changing, the proposal/spec phase should define whether this is a breaking change, a versioned tool response, or a migration window.
- **Success metrics** are qualitative (e.g., "scales with operation count"). SDD should define measurable targets or at least testable proxies, such as byte-budget limits and page-count bounds.
- **AC-13 "Live Pi review"** is manual and subjective. SDD should pair it with concrete renderer-state checks and compactness thresholds so verification is reproducible.
- **GraphQL descriptions default** (Open Question 3) is a product/UX decision that may affect default detail output size. SDD should decide the default and optional flag, or request an explicit user decision if the tradeoff is material.
- **Exact vendor-extension key set** (Open Question 1) is correctly deferred to SDD exploration, but the resulting supported set must be reviewed for security before spec approval.
- **Failure envelope details** (categories, stable codes, retry/correctiveness hints) are not yet specified; SDD spec must define them.

## Suggestions
Non-blocking improvements:
- Add an explicit acceptance criterion for backward/forward compatibility or migration expectations for existing tool consumers.
- Convert the success metrics to quantifiable bounds where possible (e.g., max bytes per page, max operations per discovery page, max depth for GraphQL detail).
- Consider adding an explicit acceptance criterion that the failure envelope is stable across Swagger, GraphQL, and `api_rest_request` tools.

## Acceptance Criteria Matrix
| ID | Criterion | Source section | Testable? | Blocking? | Notes |
|----|-----------|----------------|-----------|-----------|-------|
| AC-1 | Swagger discovery returns only operation identity + compact authorization state and remains bounded | Acceptance Criteria | Yes | No | Bounded by item/page count and byte budgets; testable with large OpenAPI fixtures. |
| AC-2 | GraphQL discovery lists actual Query/Mutation root fields and never converts introspection failure to empty success | Acceptance Criteria | Yes | No | Testable with mocked introspection failures. |
| AC-3 | Each tool has an explicit `detail` action for one executable operation | Acceptance Criteria | Yes | No | Verify action schema and dispatcher. |
| AC-4 | Swagger detail covers parameters, headers/content, request body, responses/errors, security schemes, scopes, and safe role/permission metadata | Acceptance Criteria | Yes | No | Testable with representative OpenAPI contract; requires SDD-defined schema envelope. |
| AC-5 | GraphQL detail covers arguments, defaults, nullability, return contract, descriptions/deprecation, and exposed authorization metadata without full-schema traversal | Acceptance Criteria | Yes | No | Testable with bounded depth/field budgets. |
| AC-6 | Missing GraphQL applied authorization metadata is reported as unavailable rather than guessed | Acceptance Criteria | Yes | No | State machine test for `unavailable` provenance. |
| AC-7 | `schema` remains a separate, explicitly selected, bounded advanced-inspection action | Acceptance Criteria | Yes | No | Verify action schema separation. |
| AC-8 | HTTP 500 and GraphQL `errors` are visible failures with safe actionable messages | Acceptance Criteria | Yes | No | Testable with mocked error responses. |
| AC-9 | `api_rest_request`, Swagger request, and GraphQL execute share compatible output/error semantics | Acceptance Criteria | Yes | No | Test the shared failure envelope and bounded response fields. |
| AC-10 | Large results return valid structured pages with an obvious cursor; no malformed JSON | Acceptance Criteria | Yes | No | Test serialization boundaries and cursor semantics. |
| AC-11 | Model-facing `content` and renderer `details` do not duplicate complete payloads | Acceptance Criteria | Yes | No | Test structural equality/duplication. |
| AC-12 | Secrets, credentials, internal paths, and unrestricted vendor metadata never appear in outputs or renderers | Acceptance Criteria | Yes | No | Redaction/audit tests required. |
| AC-13 | Focused tests cover indexes, selectors, permission states, references/cycles, error classification, continuation, redaction, renderer states | Acceptance Criteria | Yes | No | Test coverage criterion. |
| AC-14 | Full API Tools tests and typecheck pass from extension-owned package environment | Acceptance Criteria | Yes | No | Validation command check. |
| AC-15 | Live Pi review confirms compact rows, useful expanded pages, visible errors, continuation hints | Acceptance Criteria | Partially | No | Manual/subjective; pair with renderer-state checks. |

## Requirement Coverage Matrix
| Requirement/User Story | Covered by acceptance criteria? | Gaps / Notes |
|------------------------|----------------------------------|--------------|
| FR-1 Stable public tool set (two tools, discover/detail/schema/execute) | AC-3, AC-7 | Good. |
| FR-2 Compact Swagger discovery | AC-1 | Good. |
| FR-3 Compact GraphQL discovery + no silent empty list | AC-2 | Good. |
| FR-4 Selected Swagger operation detail | AC-4 | Good; exact security/vendor metadata set deferred to SDD. |
| FR-5 Selected GraphQL operation detail | AC-5 | Good. |
| FR-6 `schema` separate advanced inspection | AC-7 | Good. |
| FR-7 Contract-derived authorization provenance | AC-6, AC-12 | Good. |
| FR-8 Truthful actionable errors | AC-8, AC-9 | Good; exact failure envelope categories need SDD spec. |
| FR-9 Structured lossless continuation | AC-10 | Good. |
| FR-10 No duplicate model context | AC-11 | Good. |
| FR-11 Base-tool output alignment | AC-9 | Good; compatibility expectations not yet explicit. |
| FR-12 Native rendering | AC-15 | Subjective; add renderer-state checks in SDD. |
| US-1 Discover compact operation identities | AC-1, AC-2 | Good. |
| US-2 Detail for one operation | AC-4, AC-5 | Good. |
| US-3 Schema separate from executable detail | AC-7 | Good. |
| US-4 Provider/validation failures explicit | AC-8 | Good. |
| US-5 Continuation pages valid | AC-10 | Good. |
| US-6 Operator: distinguish declared/unavailable/unknown authz | AC-6 | Good. |

## Testability
| Requirement / Acceptance Criterion | Testable? | Suggested evidence |
|------------------------------------|-----------|--------------------|
| FR-1 / AC-3 Public tool action set | Yes | Tool schema and dispatcher tests asserting discover, detail, schema, request/execute exist. |
| FR-2 / AC-1 Swagger discovery boundedness | Yes | Unit tests with large OpenAPI fixtures; assert no response schemas, parameters, or raw fragments in output. |
| FR-3 / AC-2 GraphQL discovery failure handling | Yes | Mock introspection failures; assert failure envelope, not empty list. |
| FR-4 / AC-4 Swagger detail completeness | Yes | Representative OpenAPI contract tests; assert local refs resolved, external refs marked unsupported. |
| FR-5 / AC-5 GraphQL detail boundedness | Yes | Cycle fixtures, depth/field/byte budget tests; assert no full schema traversal. |
| FR-6 / AC-7 `schema` separation | Yes | Assert schema action requires selector and distinct output envelope. |
| FR-7 / AC-6 Authorization provenance | Yes | State tests for `declared`, `not_declared`, `unavailable`, `unknown`. |
| FR-8 / AC-8 Truthful errors | Yes | Mock HTTP 500, GraphQL errors, invalid introspection; assert failure envelope fields. |
| FR-9 / AC-10 Continuation | Yes | Page tests asserting `has_more`, `next_cursor`, complete records, valid JSON. |
| FR-10 / AC-11 No duplicate context | Yes | Structural tests comparing `content` and `details`. |
| FR-11 / AC-9 Base-tool alignment | Yes | Cross-tool error/response schema tests. |
| FR-12 / AC-15 Native rendering | Partially | Add renderer-state assertions; manual Pi review as secondary. |

## Open Decisions for Orchestrator/User
| Decision | Blocking? | Recommended owner | Notes |
|----------|-----------|-------------------|-------|
| Exact OpenAPI vendor-extension keys and GraphQL server-published metadata to support | No | sdd-explore/spec | Security review of any supported vendor extensions before spec approval. |
| Default GraphQL detail description exposure vs. optional flag | No | sdd-spec / user | PRD already requires bounded default; decide flag and default in SDD. |
| Compatibility/versioning for existing tool-output consumers | No | sdd-proposal/spec | Important for rollout; should be documented. |
| Quantified success metric bounds (page size, depth limits) | No | sdd-spec | Improves testability and verification. |

## Implementation Detail Leakage
PRD content that should move to `implementation-map.md`, `design.md`, or `tasks.md` instead of the PRD:
- None. The PRD stays at the product/requirements level and does not name source files, functions, classes, or implementation steps.

## Recommended Next Step
Return to `workflow-triage` so the user/orchestrator can choose the downstream SDD route (mini-SDD, formal SDD, or deferral). The PRD artifacts and review should be preserved; a new downstream route requires a fresh mode/store selection per artifact-conventions.
