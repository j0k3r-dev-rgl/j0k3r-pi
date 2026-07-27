# Tasks: Agent-efficient API Tools output contracts

## Metadata and PRD Alignment
- Metadata: `openspec/changes/api-tools-agent-output-contracts/metadata.yaml`
- PRD: `openspec/changes/api-tools-agent-output-contracts/prd.md`
- metadata_alignment: aligned
- prd_alignment: aligned
- spec_alignment: aligned
- Metadata/PRD-driven task constraints: Keep exactly six public tools; add `detail` only within `api_swagger` and `api_graphql`; implement response contract version `2`; preserve strict TDD, same-origin/base-path trust controls, session-bound opaque cursors, native Pi rendering, extension-owned dependencies, contract-derived authorization only, and no external `$ref` fetching.
- Metadata/PRD/spec gaps/conflicts_detected before apply: None. Hybrid Engram cursor refresh remains pending because the Engram server was unavailable during task planning; OpenSpec remains authoritative.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1200-1800 |
| 400-line budget risk | High |
| Suggested task split | Yes + four apply work units to keep RED/GREEN evidence reviewable and independently verifiable |
| Delivery strategy | split-by-task |

Decision needed before apply: Yes
Suggested task split: Yes
400-line budget risk: High

### Suggested Work Units
| Unit | Goal | Suggested task range | Notes |
|------|------|----------------------|-------|
| 1 | Establish contract-version-2 result, failure, and continuation foundations with RED tests first | 1.1-1.5, 2.1-2.4, 3.1-3.3 | Shared infrastructure; blocks all downstream behavior |
| 2 | Deliver Swagger compact discovery/detail/schema and aligned request failures | 1.2, 1.5, 2.5-2.7, 3.4 | Depends on Unit 1 |
| 3 | Deliver GraphQL compact discovery/detail/schema and truthful execute failures | 1.3, 1.5, 2.8-2.10, 3.5 | Depends on Unit 1 |
| 4 | Finish rendering, docs, package-wide regression, and live review evidence | 1.4, 2.11-2.12, 3.6-3.8 | Final integration/verification slice |

## Implementation Map Coverage
| Task/Phase | Map path/symbol/validation reference | Coverage notes |
|------------|--------------------------------------|----------------|
| Foundation / shared contracts | `extensions/api-tools/src/types.ts`; `src/result-format.ts`; `src/error-classify.ts`; `src/continuation.ts`; `src/tools.ts`; `test/tools.test.ts`; `test/continuation.test.ts`; `test/client.test.ts` | Covers `REQ-01`, `REQ-08`, `REQ-09`, `REQ-10`, `REQ-11`, `REQ-13`, `REQ-14`, `DES-002 R1`, `DES-003 R1` |
| Swagger implementation | `extensions/api-tools/src/swagger.ts`; `src/swagger/discovery.ts`; `src/swagger/detail.ts`; `src/swagger/schema.ts`; `src/security.ts`; `test/swagger.test.ts` | Covers `REQ-02`, `REQ-04`, `REQ-06`, `REQ-07`, `REQ-08`, `REQ-SEC-02`, `REQ-SEC-03`, `DES-001 R1`, `DES-004 R1`, `DES-005 R1`, `DES-006 R1` |
| GraphQL implementation | `extensions/api-tools/src/graphql.ts`; `src/graphql/discovery.ts`; `src/graphql/detail.ts`; `src/graphql/schema.ts`; `src/client.ts`; `src/security.ts`; `test/graphql.test.ts`; `test/client.test.ts` | Covers `REQ-03`, `REQ-05`, `REQ-06`, `REQ-07`, `REQ-08`, `REQ-SEC-04`, `REQ-SEC-05`, `DES-001 R1`, `DES-004 R1`, `DES-006 R1` |
| Rendering and docs | `extensions/api-tools/src/render.ts`; `extensions/api-tools/README.md`; `test/render.test.ts`; live Pi review | Covers `REQ-12`, `REQ-14`, `DES-007 R1` |
| Full regression | `cd extensions/api-tools && npm test`; `cd extensions/api-tools && npm run typecheck` | Required package-local validation for all work units and `DES-008 R1` |

## Security Task Coverage
| Security Requirement | Implementation Task | Validation Task | Result |
|---|---|---|---|
| `REQ-SEC-01` redaction and secret exclusion | 2.3, 2.4, 2.10, 2.11 | 3.1, 3.3, 3.5, 3.6 | covered |
| `REQ-SEC-02` local-only `$ref` resolution | 2.6 | 3.4 | covered |
| `REQ-SEC-03` OpenAPI vendor allowlist | 2.6, 2.10 | 3.1, 3.4 | covered |
| `REQ-SEC-04` GraphQL directive allowlist | 2.9, 2.10 | 3.1, 3.5 | covered |
| `REQ-SEC-05` trust boundaries and cancellation | 2.3, 2.8 | 3.3, 3.5 | covered |

## Pre-Apply Traceability
| PRD requirement (if in scope) | Active spec requirement/scenario revision | Active design decision/control revision | Implementation task | Acceptance criterion | Planned validation evidence | Result |
|---|---|---|---|---|---|---|
| FR-1 stable public tool set | `REQ-01 R1`, `SCN-01-01` | `DES-001 R1`, `DES-008 R1` | 1.1, 2.2 | Exactly six public tools; `detail` added only to Swagger/GraphQL | `test/tools.test.ts`; package tests | aligned |
| FR-2 compact Swagger discovery | `REQ-02 R1`, `SCN-02-01`, `SCN-02-02` | `DES-001 R1`, `DES-004 R1`, `DES-006 R1` | 1.2, 2.5 | Compact row-only discovery with deterministic pagination | `test/swagger.test.ts`; package tests | aligned |
| FR-3 compact GraphQL discovery | `REQ-03 R1`, `SCN-03-01`, `SCN-03-02` | `DES-001 R1`, `DES-003 R1`, `DES-006 R1` | 1.3, 2.8 | Root-field index and truthful introspection failures | `test/graphql.test.ts`; `test/client.test.ts`; package tests | aligned |
| FR-4 Swagger detail | `REQ-04 R1`, `SCN-04-01`-`SCN-04-03` | `DES-004 R1`, `DES-005 R1`, `DES-006 R1` | 2.6 | One-operation executable contract with inheritance, refs, auth metadata | `test/swagger.test.ts`; package tests | aligned |
| FR-5 GraphQL detail | `REQ-05 R1`, `SCN-05-01`-`SCN-05-03` | `DES-004 R1`, `DES-006 R1` | 2.9 | One-field executable contract with bounded traversal and cycle markers | `test/graphql.test.ts`; package tests | aligned |
| FR-6 schema separation | `REQ-06 R1`, `SCN-06-01`, `SCN-06-02` | `DES-001 R1`, `DES-004 R1` | 2.7, 2.9 | Explicit selector-only bounded schema actions | `test/swagger.test.ts`; `test/graphql.test.ts` | aligned |
| FR-7 authorization provenance | `REQ-07 R1`, `SCN-07-01`-`SCN-07-04` | `DES-006 R1` | 2.6, 2.9, 2.10 | `declared`/`not_declared`/`unavailable`/`unknown` states from allowlisted evidence only | `test/security.test.ts`; `test/swagger.test.ts`; `test/graphql.test.ts` | aligned |
| FR-8 truthful actionable errors | `REQ-08 R1`, `SCN-08-01`-`SCN-08-03` | `DES-003 R1` | 1.1, 2.3, 2.5, 2.8 | Cross-tool stable failure envelope with safe excerpts | `test/tools.test.ts`; `test/client.test.ts`; `test/swagger.test.ts`; `test/graphql.test.ts` | aligned |
| FR-9 structured lossless continuation | `REQ-09 R1`, `SCN-09-01`, `SCN-09-02` | `DES-002 R1` | 1.1, 2.4 | Logical-record or framed-text pages with deterministic cursors | `test/continuation.test.ts`; package tests | aligned |
| FR-10 no duplicate model context | `REQ-10 R1`, `SCN-10-01` | `DES-002 R1`, `DES-007 R1` | 1.1, 2.11 | `content` only for current page; `details` only for metadata | `test/tools.test.ts`; `test/render.test.ts` | aligned |
| FR-11 base tool alignment | `REQ-11 R1`, `SCN-11-01` | `DES-003 R1` | 2.2, 2.3, 2.5, 2.8 | REST and Swagger request share failure/bounded output semantics | `test/tools.test.ts`; `test/client.test.ts` | aligned |
| FR-12 native rendering | `REQ-12 R1`, `SCN-12-01`, `SCN-12-02` | `DES-007 R1` | 1.4, 2.11 | Native collapsed/expanded rows for v2 detail/failure/continuation states | `test/render.test.ts`; live Pi review | aligned |
| Quantified bounds and compatibility warnings | `REQ-13 R1`, `REQ-14 R1` | `DES-002 R1`, `DES-003 R1`, `DES-008 R1` | 1.1, 2.1, 2.12 | Enforced page/field/value limits and README migration notes | `test/tools.test.ts`; `test/continuation.test.ts`; README review; package tests | aligned |

Overall pre-apply traceability: aligned
Apply-ready packet revision: `formal-sdd-task-20260726T140500Z-v1`

## Phase 1: Foundation
- [x] 1.1 Add failing contract tests in `extensions/api-tools/test/tools.test.ts`, `test/continuation.test.ts`, and `test/client.test.ts` for version-2 result metadata, logical-record continuation, cursor-only continuation branches, and shared failure-envelope categories/codes (`REQ-01`, `REQ-08`, `REQ-09`, `REQ-10`, `REQ-11`, `REQ-14`; map: `src/tools.ts`, `src/result-format.ts`, `src/error-classify.ts`, `src/continuation.ts`).
- [x] 1.2 Add failing Swagger-focused tests in `extensions/api-tools/test/swagger.test.ts` for compact discovery rows, row-boundary pagination, exact selector resolution, inherited security/parameter detail, local `$ref` expansion, and external `unsupported_reference` markers (`REQ-02`, `REQ-04`, `REQ-06`, `REQ-07`, `REQ-SEC-02`, `REQ-SEC-03`).
- [x] 1.3 Add failing GraphQL-focused tests in `extensions/api-tools/test/graphql.test.ts` for compact root-field discovery, visible introspection/top-level-error failures, canonical `Query.field`/`Mutation.field` detail, depth/field/cycle limits, and authorization provenance states (`REQ-03`, `REQ-05`, `REQ-06`, `REQ-07`, `REQ-SEC-04`, `REQ-SEC-05`).
- [x] 1.4 Add failing renderer tests in `extensions/api-tools/test/render.test.ts` for collapsed/expanded version-2 detail, failure, authorization, and continuation states without duplicated payloads or hard-coded expansion keys (`REQ-10`, `REQ-12`, `REQ-14`).
- [x] 1.5 Record a focused safety baseline by running the narrow existing owner suites before production edits, then capture expected RED failures for the new cases from `cd extensions/api-tools && npm test -- --runInBand` or the narrow Vitest equivalent chosen during apply (`DES-008 R1`; validation target in implementation map).

## Phase 2: Implementation
- [x] 2.1 Extend `extensions/api-tools/src/types.ts` with contract-version-2 action-document, logical-record, continuation, authorization-metadata, and failure-envelope types plus bound-related metadata used across tools (`DES-002 R1`, `DES-003 R1`).
- [x] 2.2 Update `extensions/api-tools/src/tools.ts` to keep exactly six tools, add `detail` to Swagger/GraphQL schemas, add cursor-only continuation handling for `api_rest_request`, and route bounded outputs through the shared formatter/continuation path (`REQ-01`, `REQ-11`, `REQ-14`; symbols: `registerApiTools`, `SWAGGER_PARAMETERS`, `GRAPHQL_PARAMETERS`).
- [x] 2.3 Create `extensions/api-tools/src/result-format.ts` and `src/error-classify.ts`, and refine `extensions/api-tools/src/client.ts` so HTTP `>=400`, GraphQL top-level `errors`, timeout, cancellation, configuration, and parsing faults map to stable safe v2 failure envelopes with actionable next steps (`DES-003 R1`; validation via `test/tools.test.ts`, `test/client.test.ts`, `test/graphql.test.ts`).
- [x] 2.4 Refactor `extensions/api-tools/src/continuation.ts` to persist immutable redacted logical-record documents or explicit text frames and paginate by record index rather than raw JSON slicing, preserving owner/expiry/containment/cleanup guarantees (`REQ-09`, `REQ-10`, `REQ-13`, `REQ-SEC-01`; symbol: `ContinuationManager.finalize/continue`).
- [x] 2.5 Turn `extensions/api-tools/src/swagger.ts` into a thin dispatcher and add `extensions/api-tools/src/swagger/discovery.ts` for compact operation-index rows, filter handling, deterministic ordering, bounded pages, and aligned request-failure behavior (`REQ-02`, `REQ-08`, `REQ-11`; `DES-001 R1`, `DES-003 R1`).
- [x] 2.6 Add `extensions/api-tools/src/swagger/detail.ts` plus `extensions/api-tools/src/security.ts` helpers to resolve one Swagger operation by exact selector, merge inherited parameters/security, extract allowlisted authorization metadata, resolve local JSON Pointer refs, and emit bounded `unsupported_reference`/`unsupported_metadata` markers (`REQ-04`, `REQ-07`, `REQ-SEC-02`, `REQ-SEC-03`; `DES-004 R1`, `DES-005 R1`, `DES-006 R1`).
- [x] 2.7 Add `extensions/api-tools/src/swagger/schema.ts` so explicit schema inspection stays separate from executable detail while honoring bounded continuation and validation rules (`REQ-06`, `REQ-13`; `DES-001 R1`).
- [x] 2.8 Turn `extensions/api-tools/src/graphql.ts` into a thin dispatcher and add `extensions/api-tools/src/graphql/discovery.ts` so root-field discovery stays compact and introspection/GraphQL transport problems return visible failures instead of empty successes (`REQ-03`, `REQ-08`, `REQ-11`; `DES-001 R1`, `DES-003 R1`).
- [x] 2.9 Add `extensions/api-tools/src/graphql/detail.ts` and `src/graphql/schema.ts` to support canonical root-field detail and explicit schema inspection with bounded argument/return-field traversal, depth caps, field-count caps, and cycle markers (`REQ-05`, `REQ-06`, `REQ-13`; `DES-004 R1`, `DES-006 R1`).
- [x] 2.10 Expand `extensions/api-tools/src/security.ts` to enforce recursive redaction before pagination, OpenAPI vendor-key and GraphQL directive allowlists, scalar/list-only extraction, truncation markers, and `declared`/`not_declared`/`unavailable`/`unknown` provenance reporting (`REQ-07`, `REQ-SEC-01`, `REQ-SEC-03`, `REQ-SEC-04`).
- [x] 2.11 Update `extensions/api-tools/src/render.ts` so collapsed and expanded native Pi rows summarize v2 action identity, status, authorization state, continuation, and actionable failures while showing only the current bounded page (`REQ-10`, `REQ-12`, `REQ-14`; symbol: `renderApiToolResult`).
- [x] 2.12 Update `extensions/api-tools/README.md` with contract-version-2 migration notes, new `detail` actions, compact discovery expectations, failure-envelope semantics, continuation usage, bounds, security provenance, and live-review expectations (`REQ-14`; implementation-map docs path).

## Phase 3: Testing / Verification
- [x] 3.1 Run `extensions/api-tools/test/security.test.ts` and the security-focused assertions in `test/swagger.test.ts` / `test/graphql.test.ts` to prove allowlists, unsupported metadata markers, truncation, provenance states, and secret/path redaction (`REQ-07`, `REQ-SEC-01`-`REQ-SEC-04`).
- [x] 3.2 Run `extensions/api-tools/test/continuation.test.ts` to prove logical-record/text-frame pagination, deterministic cursor replay, no skipped/duplicated records, and byte/line ceilings (`REQ-09`, `REQ-13`).
- [x] 3.3 Run `extensions/api-tools/test/tools.test.ts` and `extensions/api-tools/test/client.test.ts` to prove exact tool surface, v2 metadata, REST/Swagger failure alignment, GraphQL top-level-error handling, and cancellation/configuration classification (`REQ-01`, `REQ-08`, `REQ-11`, `REQ-14`, `REQ-SEC-05`).
- [x] 3.4 Run `extensions/api-tools/test/swagger.test.ts` for compact discovery, exact selector detail, inherited parameters/security, local refs, external `unsupported_reference`, and request-failure behavior (`REQ-02`, `REQ-04`, `REQ-06`).
- [x] 3.5 Run `extensions/api-tools/test/graphql.test.ts` for compact discovery, canonical detail, depth/field/cycle bounds, applied-metadata availability handling, and truthful execute failures (`REQ-03`, `REQ-05`, `REQ-06`, `REQ-07`).
- [x] 3.6 Run `extensions/api-tools/test/render.test.ts` to verify collapsed/expanded/failure/continuation/detail/auth states stay native, compact, and non-duplicative (`REQ-10`, `REQ-12`).
- [x] 3.7 Run `cd extensions/api-tools && npm test` and `cd extensions/api-tools && npm run typecheck` from the extension-owned package directory after focused GREEN/refactor passes (`AC-14`, `DES-008 R1`).
- [x] 3.8 During verify, perform the secondary live Pi review for compact collapsed rows, useful expanded pages, visible failures, and continuation hints without hidden payload leaks (`AC-15`; implementation-map manual validation target).

## Remediation Apply Notes
- 2026-07-26 remediation apply approval `remediation-apply-api-tools-agent-output-contracts-20260726T164500Z` is limited to the three failed verify blockers: discovery page-size bounds, malformed GraphQL introspection failure handling, and GraphQL detail overflow continuation.
- Remediation implementation stays within `REQ-02`, `REQ-03`, `REQ-05`, `REQ-09`, and `REQ-13`; task `3.8` remains verify-owned and incomplete until a live Pi review is executed.
- 2026-07-26 live remediation apply approval `live-remediation-apply-api-tools-agent-output-contracts-20260726T170343Z` is limited to the two failed live smoke blockers: standard-compatible GraphQL discovery introspection and model-visible Swagger discovery continuation.
- Live remediation implementation stayed within `REQ-03`, `REQ-07`, `REQ-09`, `REQ-12`, and `REQ-13`; independent verify still owns the repeated live smoke and task `3.8`.
- 2026-07-26 live remediation 2 apply approval `live-remediation-2-apply-api-tools-agent-output-contracts-20260726T171519Z` is limited to the remaining GraphQL repeated-`__Type.fields` live blocker and the corresponding detail-query risk.
- Live remediation 2 implementation stays within `REQ-03`, `REQ-05`, and `REQ-07`; verify owns the final verification-harness review, post-user-reload live smoke, and task `3.8`.
