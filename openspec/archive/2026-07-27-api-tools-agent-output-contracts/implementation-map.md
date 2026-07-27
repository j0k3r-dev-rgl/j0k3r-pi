# Implementation Map: Agent-efficient API Tools output contracts

## Purpose

Operational handoff for downstream SDD agents. This file is not normative; metadata, PRD, spec, design, and tasks win on conflicts.

## Explored Files

| Path | Status | Relevance | Key symbols | Findings |
|------|--------|-----------|-------------|----------|
| `extensions/api-tools/index.ts` | Read | Entrypoint | default export calling `registerApiTools` | Thin composition root; no expected change beyond re-export. |
| `extensions/api-tools/src/types.ts` | Read | Contracts | `ApiToolsConfig`, `ApiToolResult`, `ApiContinuationMetadata`, `ApiTruncationMetadata`, `ApiAuthConfig` | Needs new authorization-metadata types, detail result envelope, and failure categories. |
| `extensions/api-tools/src/config.ts` | Read | Configuration | `loadApiConfig`, `parseIntegrationBlock`, `parseLimits` | No block-level changes required; current `swagger`/`graphql` blocks remain valid. |
| `extensions/api-tools/src/client.ts` | Read | Network boundary | `createApiClient`, `rest`, `graphql`, `fetchSwaggerDocument` | GraphQL `execute` currently parses body as success; top-level `errors` need detection. Swagger fetch already validates document shape. |
| `extensions/api-tools/src/security.ts` | Read | Redaction/bounds | `redactToolResult`, `redactDeep`, `applyOutputTruncation`, `collectConfiguredSecrets` | Needs safe authorization-metadata extraction helper and vendor-extension allowlist. |
| `extensions/api-tools/src/tools.ts` | Read | Registration/dispatch | `registerApiTools`, `API_TOOL_NAMES`, `SWAGGER_PARAMETERS`, `GRAPHQL_PARAMETERS`, `classifyError`, `buildFailure`, `buildSuccess` | Input schemas need `detail` action; error classification should move to shared helper to avoid duplication. |
| `extensions/api-tools/src/swagger.ts` | Read | Swagger actions | `executeSwaggerAction`, `operationEntries`, `summaryForOperation`, `pruneSchema` | Needs compact discovery, `detail` action, security/OAuth/vendor metadata, local `$ref` resolution, and truthful HTTP errors. |
| `extensions/api-tools/src/graphql.ts` | Read | GraphQL actions | `executeGraphqlAction`, `DISCOVER_QUERY`, `TYPE_QUERY`, `describeFields`, `formatType` | Needs compact discovery, `detail` action, authorization provenance, introspection failure handling, bounded detail. |
| `extensions/api-tools/src/continuation.ts` | Read | Continuation | `ContinuationManager`, `sliceToBudget`, `serializeResult` | Artifact/cursor lifecycle is solid; public chunking should move to logical records or framed text chunks rather than raw JSON slices. |
| `extensions/api-tools/src/render.ts` | Read | Native renderer | `renderApiToolResult`, `buildSummary`, `metadataLines` | Handles success/failure/continuation already; minor updates for `detail` and authorization states. |
| `extensions/api-tools/src/pi-runtime.ts` | Read | Pi package boundary | `keyHint`, `Text` re-exports | Direct package imports already in place from prior flow; no change expected. |
| `extensions/api-tools/package.json` | Read | Package ownership | peer/dev declarations for Pi runtime packages | Already owns official Pi runtime packages; no new dependencies needed. |
| `extensions/api-tools/test/tools.test.ts` | Read | Registration tests | registration matrix, action dispatch, status safety | Needs `detail` action registration tests and new failure-envelope tests. |
| `extensions/api-tools/test/swagger.test.ts` | Read | Swagger tests | discovery, schema, request, redaction | Needs compact discovery, detail, security, reference, and error cases. |
| `extensions/api-tools/test/graphql.test.ts` | Read | GraphQL tests | discovery, schema, execute, redaction | Needs detail, authorization provenance, introspection failure, and bounded detail cases. |
| `extensions/api-tools/test/continuation.test.ts` | Read | Continuation tests | first chunk, reconstruction, ownership, expiry, containment | Needs logical-record boundary cases. |
| `extensions/api-tools/test/render.test.ts` | Read | Renderer tests | collapsed/expanded/partial/error | Needs `detail` and authorization-state rendering cases. |
| `extensions/api-tools/test/security.test.ts` | Read | Security tests | redaction, truncation | Needs authorization-metadata redaction and vendor-extension allowlist cases. |
| `extensions/api-tools/test/client.test.ts` | Read | Client tests | URL hardening | May need GraphQL top-level error detection tests. |
| `extensions/api-tools/test/config.test.ts` | Read | Config tests | block validation | No major changes expected. |
| `extensions/api-tools/README.md` | Read | Public docs | tool contracts, continuation | Update for `detail`, authorization provenance, and truthful errors. |

## Files To Modify

| Path | Reason | Expected change | Owner phase |
|------|--------|-----------------|-------------|
| `extensions/api-tools/src/types.ts` | Add version-2 action, authorization, failure, logical-record, and continuation contracts | New interfaces for `ApiActionDocument`, `ApiLogicalRecord`, `ApiResultDetails`, `ApiAuthorizationMetadata`, `ApiFailureEnvelope`, detail selectors, and count-based continuation metadata | design/task |
| `extensions/api-tools/src/tools.ts` | Update input schemas and shared result/error composition | Add `detail` to `SWAGGER_PARAMETERS` and `GRAPHQL_PARAMETERS`; add cursor-only continuation for `api_rest_request`; import shared builders/classifier; keep exactly six tools | design/task |
| `extensions/api-tools/src/swagger.ts` | Implement compact discovery and `detail` | Replace/extend discovery formatter; add `detail` action with parameter/security/response metadata; resolve local `$ref`; mark external refs unsupported | design/task |
| `extensions/api-tools/src/graphql.ts` | Implement compact discovery and `detail` | Replace/extend discovery formatter; add `detail` action with arguments/return/authorization metadata; detect introspection errors | design/task |
| `extensions/api-tools/src/security.ts` | Extract safe authorization metadata | Add `extractAuthorizationMetadata` helper with allowlist of safe vendor keys; ensure redaction before output | design/task |
| `extensions/api-tools/src/client.ts` | Detect GraphQL top-level errors | `graphql()` helper or caller should classify top-level `errors` array as failure | design/task |
| `extensions/api-tools/src/continuation.ts` | Logical record/page boundaries | Keep artifact/cursor lifecycle, permissions, containment, replay, and cleanup; persist immutable redacted record documents and advance by record index or explicit text frame | design/task |
| `extensions/api-tools/src/render.ts` | Render detail and authorization states | Add metadata lines for `detail` selector and authorization provenance | design/task |
| `extensions/api-tools/test/tools.test.ts` | Cover new actions and failure envelope | Add `detail` registration/dispatch and cross-tool error code tests | task/apply |
| `extensions/api-tools/test/swagger.test.ts` | Cover new Swagger behavior | Compact discovery, detail, security schemes, scopes, vendor metadata, reference resolution, HTTP errors | task/apply |
| `extensions/api-tools/test/graphql.test.ts` | Cover new GraphQL behavior | Compact discovery, detail, authorization provenance, introspection failure, depth/field budgets | task/apply |
| `extensions/api-tools/test/continuation.test.ts` | Cover logical chunk boundaries | Test complete records and framed chunks, not mid-JSON fragments | task/apply |
| `extensions/api-tools/test/render.test.ts` | Cover detail/auth rendering | Collapsed/expanded views for `detail` and authorization metadata | task/apply |
| `extensions/api-tools/test/security.test.ts` | Cover authorization metadata redaction | Allowlist behavior and safe vendor-key extraction | task/apply |
| `extensions/api-tools/test/client.test.ts` | Cover GraphQL top-level error detection | Failure classification for GraphQL `errors` | task/apply |
| `extensions/api-tools/README.md` | Public documentation | Document `detail`, authorization provenance, truthful errors, compatibility/versioning | task/apply |

## Files To Create

| Path | Reason | Expected responsibility |
|------|--------|-------------------------|
| `extensions/api-tools/src/result-format.ts` | Shared version-2 result and logical-page formatting | Build typed success/failure action documents, frame bounded text, render only the current page into `content`, and project minimal non-duplicative `details` |
| `extensions/api-tools/src/error-classify.ts` | Centralized typed error classification | Map HTTP, GraphQL, validation, configuration, timeout, cancellation, provider, reference, authorization, and cursor failures to stable action-scoped envelopes |
| `extensions/api-tools/src/swagger/detail.ts` | Selected Swagger operation detail | Build executable contract: parameters, request body, responses, security, scopes, safe vendor metadata |
| `extensions/api-tools/src/swagger/discovery.ts` | Compact Swagger discovery | Build bounded operation index with authorization summary |
| `extensions/api-tools/src/swagger/schema.ts` | Broad type/schema inspection | Bounded schema inspection distinct from executable detail |
| `extensions/api-tools/src/graphql/detail.ts` | Selected GraphQL operation detail | Build executable contract: arguments, return type, bounded field contract, authorization metadata |
| `extensions/api-tools/src/graphql/discovery.ts` | Compact GraphQL discovery | Build bounded root-field index with authorization summary |
| `extensions/api-tools/src/graphql/schema.ts` | Broad type inspection | Bounded type/field inspection distinct from executable detail |

## Files To Delete

| Path | Reason | Risk |
|------|--------|------|
| None identified | The current files can be refactored in place or supplemented with new modules | Removing files risks losing historical context; prefer migration within existing structure |

## Relevant Symbols

| Symbol | File | Why it matters |
|--------|------|----------------|
| `registerApiTools` | `src/tools.ts` | Main registration and lifecycle wiring point; must include `detail` actions. |
| `API_TOOL_NAMES` | `src/tools.ts` | Must remain six public tool names; no new public tools. |
| `SWAGGER_PARAMETERS` | `src/tools.ts` | Must expose `discover`, `detail`, `schema`, `request` action branches. |
| `GRAPHQL_PARAMETERS` | `src/tools.ts` | Must expose `discover`, `detail`, `schema`, `execute` action branches. |
| `executeSwaggerAction` | `src/swagger.ts` | Dispatcher for Swagger actions; must route `detail`. |
| `executeGraphqlAction` | `src/graphql.ts` | Dispatcher for GraphQL actions; must route `detail`. |
| `operationEntries` / `summaryForOperation` | `src/swagger.ts` | Current discovery formatter; must become more compact and add authorization summary. |
| `DISCOVER_QUERY` / `TYPE_QUERY` | `src/graphql.ts` | Introspection queries; may need applied-directive metadata fields if supported by target backend. |
| `ContinuationManager.finalize` | `src/continuation.ts` | Entry point for bounded output; should consume a logical-chunk formatter. |
| `redactToolResult` / `redactDeep` | `src/security.ts` | Must redact vendor extension values before output while preserving safe authorization metadata. |
| `classifyError` | `src/tools.ts`, `src/swagger.ts`, `src/graphql.ts` | Duplicated; should move to shared module for consistent failure codes. |

## Behavioral Findings

- `api_swagger discover` currently returns `tags` and operation `summary` in addition to method/path/id; PRD requires a more compact index.
- `api_swagger schema` currently prunes a schema fragment at `max_depth`; it does not resolve local `$ref` values or surface security metadata.
- `api_graphql discover` currently returns `return_type` and treats missing introspection data as an empty list; PRD requires explicit failure for introspection errors.
- `api_graphql execute` currently parses the response body as success regardless of top-level `errors`; PRD requires truthful failure classification.
- `api_rest_request` already returns HTTP >= 400 as failure, but Swagger `request` does not.
- `ContinuationManager` preserves the complete redacted result in an immutable artifact but the first public chunk can be a raw JSON fragment.
- `renderApiToolResult` correctly avoids expansion-state ownership and hard-coded keys.

## Constraints / Risks

- Exactly two public contract tools (`api_swagger`, `api_graphql`); no third detail/continuation tool.
- Contract-derived authorization only; never infer hidden backend roles.
- No credential, secret, internal path, or arbitrary vendor payload exposure.
- Same-origin/base-path trust boundary from `src/client.ts` must be preserved.
- Continuation must remain session-bound, opaque, and path-free.
- Breaking change to output envelopes needs compatibility/versioning decision in proposal/spec.
- PRD warns that success metrics need quantified bounds (page sizes, depth limits, byte budgets).

## Test / Validation Map

| Command or test file | Purpose | When to run |
|----------------------|---------|-------------|
| `cd extensions/api-tools && npm run typecheck` | TypeScript contract validation | After every meaningful structural change |
| `cd extensions/api-tools && npm test` | Full extension test suite | After each TDD cycle and before handoff |
| `extensions/api-tools/test/swagger.test.ts` | Swagger compact discovery, detail, security, refs, errors | During task/apply |
| `extensions/api-tools/test/graphql.test.ts` | GraphQL compact discovery, detail, authorization provenance, introspection failures | During task/apply |
| `extensions/api-tools/test/tools.test.ts` | Tool registration, action schemas, failure envelope alignment | During task/apply |
| `extensions/api-tools/test/continuation.test.ts` | Logical chunk boundaries and cursor lifecycle | During task/apply |
| `extensions/api-tools/test/render.test.ts` | Collapsed/expanded/detail/auth rendering | During task/apply |
| `extensions/api-tools/test/security.test.ts` | Authorization metadata redaction and allowlist | During task/apply |
| `extensions/api-tools/test/client.test.ts` | GraphQL top-level error detection | During task/apply |
| Manual Pi live review | Confirm compact rows, useful expanded pages, visible errors, continuation hints | During verify |

## Proposal Decisions

- Response compatibility: revise existing results in place as contract version `2`; preserve the six public tool names and existing action identities, add `detail`, and do not maintain duplicate legacy envelopes. README migration notes and cross-tool tests are required.
- Bounds to carry into spec: discovery default 50/max 100 operations per page; GraphQL detail default depth 3/max 5 and max 200 returned fields per page; descriptions max 500 characters; recognized vendor metadata max 32 scalar values per key and 128 characters per value; all output remains within the configured/default 50,000-byte and 2,000-line ceilings.
- OpenAPI authorization vendor metadata: exact case-insensitive keys `x-role`, `x-roles`, `x-required-role`, `x-required-roles`, `x-permission`, `x-permissions`, `x-required-permission`, `x-required-permissions`, `x-authority`, `x-authorities`, `x-required-authority`, `x-required-authorities`, `x-scope`, `x-scopes`, `x-required-scope`, and `x-required-scopes`; scalar strings/arrays only. Objects and unrestricted payloads are unsupported and must not be returned.
- GraphQL authorization metadata: only applied directive metadata actually returned by the server for directive names `role`, `roles`, `permission`, `permissions`, `authority`, `authorities`, `scope`, `scopes`, `auth`, or `authz`. Directive definitions alone are not declarations; standard introspection without applied metadata reports `unavailable`.
- GraphQL descriptions: included by default in `detail`, bounded to 500 characters with an explicit truncation marker; no display flag in the initial contract.
- External OpenAPI `$ref` retrieval remains rejected and explicitly marked unsupported. Only local same-document fragments may be resolved.
- Recommended module scope is confirmed: shared result/error helpers plus cohesive Swagger and GraphQL discovery/detail/schema modules; existing registration, client trust, redaction, and cursor lifecycle boundaries remain.

## Rejected Paths

- Parallel legacy and version-2 result envelopes: rejected because they preserve duplicated model context and complicate truthful continuation.
- Arbitrary vendor-extension pass-through or GraphQL authorization inference: rejected for security and provenance correctness.
- External `$ref` fetching, a third public detail/continuation tool, or a custom pagination transport: rejected as outside the approved PRD.

## Design Refinement

### Active design decisions

| Decision revision | Source | Operational consequence |
|---|---|---|
| `DES-001 R1` | `design.md` | `swagger.ts`/`graphql.ts` become thin dispatchers; action logic moves to the six concrete domain modules listed above. |
| `DES-002 R1` | `design.md` | `ContinuationManager` accepts redacted ordered logical records, persists no duplicate result envelope, and advances by record index or explicit text frame. |
| `DES-003 R1` | `design.md` | `result-format.ts` and `error-classify.ts` own compatible version-2 results/failures; `ApiClientError` receives a typed cause kind. |
| `DES-004 R1` | `design.md` | Swagger selects exact `operationId` then canonical `METHOD path`; GraphQL detail uses canonical `Query.field`/`Mutation.field`; ambiguity is a validation failure. |
| `DES-005 R1` | `design.md` | Swagger resolves local JSON Pointer refs only, detects cycles, and emits bounded path-free unsupported markers for external/invalid refs. |
| `DES-006 R1` | `design.md` | Authorization extraction is pure, allowlisted, scalar-only, bounded, and provenance-bearing; standard GraphQL introspection reports `unavailable`. |
| `DES-007 R1` | `design.md` | Existing native `Text` and Pi-owned expansion remain; renderer reads only current-page content plus minimal metadata. |
| `DES-008 R1` | `design.md` | Existing owner test files are extended under strict RED-GREEN-REFACTOR; no parallel feature suites or framework changes. |

All listed design decisions are active R1 records with `supersedes: None` and `superseded_by: None`. Tasks and apply must reference these active revisions only.

### Required data/result flow

1. Strict tool schema validates execution or cursor-only continuation.
2. Client preserves same-origin/base-path/redirect/cancellation controls and returns typed response evidence.
3. Domain builder produces stable ordered bounded records for one action/selector.
4. Authorization allowlisting and recursive redaction occur before persistence.
5. Continuation stores immutable redacted records in private session temp storage and pages at complete record/frame boundaries.
6. Formatter emits current-page `content`; `details` contains only contract version, status, action/identity, failure, render hints, and continuation counts/instruction.
7. Pi renderer displays the same bounded page without hidden payload or expansion state.

### Refined symbols/interfaces

| Symbol/interface | File | Required role |
|---|---|---|
| `ApiActionDocument`, `ApiLogicalRecord`, `ApiResultDetails` | `src/types.ts` | Internal typed source and public page metadata for contract version 2. |
| `ApiFailureCategory`, `ApiFailureEnvelope` | `src/types.ts` | Stable category/code/message/status/retryable/next-step contract. |
| `ApiAuthorizationMetadata` | `src/types.ts` | `declared`/`not_declared`/`unavailable`/`unknown` provenance and bounded values. |
| `buildSuccessDocument`, `buildFailureDocument`, `renderPage`, `frameText` (names may be refined without changing responsibility) | `src/result-format.ts` | Non-duplicative content/details projection and explicit text framing. |
| `classifyError` | `src/error-classify.ts` | Typed cross-tool failure mapping using `<tool>.<action>.<condition>` codes. |
| `ApiClientError.kind` | `src/client.ts` | Preserve validation/configuration/timeout/cancellation/provider cause across the trust boundary. |
| `ContinuationManager.finalize`, `ContinuationManager.continue` | `src/continuation.ts` | Record-index pagination, replay, cursor binding, persistence, and cleanup. |
| Swagger exact selector/local-ref/detail builders | `src/swagger/detail.ts` | Inheritance, one operation, safe references, request/response/security records. |
| GraphQL canonical selector/detail traversal | `src/graphql/detail.ts` | Arguments/defaults/deprecation/descriptions, cycles/depth/field budget, applied metadata when actually returned. |

### Refined validation map

| Requirement / decisions | Focused evidence | Broader evidence |
|---|---|---|
| `REQ-01`, `REQ-10`, `REQ-11`, `REQ-14`; `DES-002`/`DES-003` | `test/tools.test.ts` exact registry/action schemas, REST cursor, v2 details, no duplicated domain payload, cross-tool failures | Full package tests/typecheck |
| `REQ-02`, `REQ-04`, `REQ-06`, `REQ-07`, `REQ-08`, `REQ-13`, `REQ-SEC-02`, `REQ-SEC-03`; `DES-004`/`DES-005`/`DES-006` | `test/swagger.test.ts` compact rows, exact/ambiguous selector, inheritance/detail, refs, auth, bounds, HTTP errors | Full package tests/typecheck |
| `REQ-03`, `REQ-05`, `REQ-06`, `REQ-07`, `REQ-08`, `REQ-13`, `REQ-SEC-04`; `DES-004`/`DES-006` | `test/graphql.test.ts` introspection failures, canonical detail, args/types/cycles/bounds/auth states/top-level errors | Full package tests/typecheck |
| `REQ-09`, `REQ-SEC-01`; `DES-002` | `test/continuation.test.ts` redaction-before-persistence, complete records/frames, reconstruction, replay, count/byte/line bounds, cursor security | Full package tests/typecheck |
| `REQ-12`; `DES-007` | `test/render.test.ts` collapsed/expanded/partial/failure/detail/auth/continuation and package-owned imports | Full package tests plus secondary live Pi review |
| `REQ-SEC-01`, `REQ-SEC-03`, `REQ-SEC-04`; `DES-006` | `test/security.test.ts` allowlists, scalar rejection, value/count bounds, secret/path/body sanitization | Full package tests/typecheck |
| `REQ-SEC-05`; `DES-003` | `test/client.test.ts` typed timeout/cancellation/configuration and retained URL/redirect controls | Full package tests/typecheck |

Apply starts with the narrow existing owner-suite baseline, records expected RED failures for changed behavior, reaches focused GREEN, refactors only after GREEN, then runs `cd extensions/api-tools && npm test` and `npm run typecheck`. No dependency or test-framework change is approved.

## Remaining Evidence Gaps

- Non-blocking: the target GraphQL backend's applied-directive transport shape is still not evidenced. The active design does not probe or guess a vendor protocol; standard introspection returns `unavailable`, while the pure allowlisted extractor handles applied metadata only when it is actually present in the selected-field response in an approved scalar/list shape.
- No normative design gap remains for failure categories, version-2 envelope ownership, selector ambiguity, or pagination ordering; `spec.md` and `design.md` now define those constraints.

## Apply Results

### Actual touched files

- `extensions/api-tools/src/types.ts`
- `extensions/api-tools/src/tools.ts`
- `extensions/api-tools/src/client.ts`
- `extensions/api-tools/src/security.ts`
- `extensions/api-tools/src/continuation.ts`
- `extensions/api-tools/src/render.ts`
- `extensions/api-tools/src/swagger.ts`
- `extensions/api-tools/src/swagger/discovery.ts`
- `extensions/api-tools/src/swagger/detail.ts`
- `extensions/api-tools/src/swagger/schema.ts`
- `extensions/api-tools/src/graphql.ts`
- `extensions/api-tools/src/graphql/discovery.ts`
- `extensions/api-tools/src/graphql/detail.ts`
- `extensions/api-tools/src/graphql/schema.ts`
- `extensions/api-tools/src/result-format.ts`
- `extensions/api-tools/src/error-classify.ts`
- `extensions/api-tools/test/tools.test.ts`
- `extensions/api-tools/test/swagger.test.ts`
- `extensions/api-tools/test/graphql.test.ts`
- `extensions/api-tools/test/continuation.test.ts`
- `extensions/api-tools/test/render.test.ts`
- `extensions/api-tools/test/security.test.ts`
- `extensions/api-tools/test/client.test.ts`
- `extensions/api-tools/README.md`

### Actual result vs expected map

| Expected map entry | Actual result | Notes |
|---|---|---|
| Shared v2 result/failure/continuation helpers | Implemented | Added `result-format.ts`, `error-classify.ts`, logical-record pagination, and typed failure envelopes. |
| Swagger compact discovery/detail/schema | Implemented | Added selector helpers, inherited parameter/security handling, local ref resolution, and unsupported markers. |
| GraphQL compact discovery/detail/schema | Implemented | Added canonical selectors, bounded nested field descriptions, cycle markers, and truthful top-level error failures. |
| Renderer/doc alignment | Implemented | Updated native summary/detail rendering and README migration notes. |
| Focused and package-wide validation | Implemented | RED captured with failing tests before implementation; GREEN package tests and typecheck passed. |

### Validation status

- `cd extensions/api-tools && npm test` (RED after test updates): failed in `test/graphql.test.ts` and `test/tools.test.ts` before production changes.
- `cd extensions/api-tools && npm test`: passed (`9` files, `41` tests).
- `cd extensions/api-tools && npm run typecheck`: passed.

### Apply discoveries

- The v2 contract fit well as an internal `ApiActionDocument` plus record-index pagination without changing the public six-tool surface.
- Sanitizing internal filesystem paths required a narrower absolute-path matcher so API paths such as `/users` remain visible.
- Standard GraphQL introspection remains safely represented as authorization state `unavailable`; no vendor probing was introduced.

## Task Packet Handoff

### Apply-ready packet

- Packet revision: `formal-sdd-task-20260726T140500Z-v1`
- Recommended apply strategy: split by approved work unit because the expected implementation is materially above the 400-line review budget and spans shared contracts, two protocol surfaces, rendering, and package-wide regression.
- Ordered work units:
  1. Shared v2 result/continuation/error infrastructure plus RED baseline (`tasks.md` Phase 1 and tasks 2.1-2.4).
  2. Swagger compact discovery/detail/schema and aligned request failures (`tasks.md` tasks 2.5-2.7, 3.4).
  3. GraphQL compact discovery/detail/schema and truthful execute failures (`tasks.md` tasks 2.8-2.10, 3.5).
  4. Rendering, README migration notes, full package validation, and live review evidence (`tasks.md` tasks 2.11-2.12, 3.6-3.8).
- Apply preconditions:
  - Preserve `DES-001 R1` through `DES-008 R1` without introducing new public tools, legacy envelopes, external `$ref` fetches, arbitrary vendor metadata passthrough, or sibling-extension dependency borrowing.
  - Record focused RED failures before each work unit’s implementation changes.
  - Keep OpenSpec authoritative; refresh Engram cursor after artifact writes when the Engram service is available.

## Apply Approval Record

- `approval_id`: `apply-api-tools-agent-output-contracts-20260726T161223Z`
- `type`: `apply`
- `apply_approved_by_user`: `true`
- `approved_packet_revision`: `formal-sdd-task-20260726T140500Z-v1`
- `execution_strategy`: `single-invocation-four-ordered-work-units`
- `approval_scope_refs`:
  - `packet:formal-sdd-task-20260726T140500Z-v1`
  - `strategy:single-invocation-four-ordered-work-units`
  - `work-unit:1-shared-v2-result-continuation-error-infrastructure`
  - `work-unit:2-swagger-discovery-detail-schema`
  - `work-unit:3-graphql-discovery-detail-schema`
  - `work-unit:4-rendering-docs-regression-live-review-handoff`
  - `tasks:1.1-3.8`
  - `security:REQ-SEC-01-REQ-SEC-05`
  - `artifact:openspec/changes/api-tools-agent-output-contracts/prd.md`
  - `artifact:openspec/changes/api-tools-agent-output-contracts/prd-review.md`
  - `artifact:openspec/changes/api-tools-agent-output-contracts/proposal.md`
  - `artifact:openspec/changes/api-tools-agent-output-contracts/spec.md`
  - `artifact:openspec/changes/api-tools-agent-output-contracts/design.md`
  - `artifact:openspec/changes/api-tools-agent-output-contracts/tasks.md`
  - `artifact:openspec/changes/api-tools-agent-output-contracts/implementation-map.md`
- `approval_scope_fingerprint`: `sha256:dda13ce02d4e4d3554adbe78ad351c557e31ea2e01ccb097f44caf56d50d04bf`
- `approval_record_ref`: `openspec/changes/api-tools-agent-output-contracts/implementation-map.md#apply-approval-record`
- `approval_recorded_at`: `2026-07-26T16:12:23Z`
- `approval_summary`: Apply the complete version-2 API Tools output-contract packet in four ordered work units with strict TDD and independent verification.
- `approval_summary_redacted`: `true`

## Remediation Apply Approval Record

- `approval_id`: `remediation-apply-api-tools-agent-output-contracts-20260726T164500Z`
- `type`: `remediation-apply`
- `apply_approved_by_user`: `true`
- `approved_packet_revision`: `formal-sdd-remediation-20260726T164500Z-v1`
- `source_verify_revision`: `formal-sdd-verify-20260726T174130Z-v1-r7`
- `approval_scope_refs`:
  - `blocker:verify-critical-discovery-operation-count-bounds`
  - `blocker:verify-critical-graphql-malformed-introspection-empty-success`
  - `blocker:verify-critical-graphql-detail-overflow-continuation`
  - `requirements:REQ-02,REQ-03,REQ-05,REQ-09,REQ-13`
  - `method:strict-tdd`
  - `validation:package-tests-and-typecheck`
  - `excluded:permissions.json,unrelated-worktree-changes,reload,live-smoke-before-green-verify`
- `approval_scope_fingerprint`: `sha256:d145559b301c91ff8cbfdd33b04f62225d72451d8c374a61297bf9cef9da44df`
- `approval_record_ref`: `openspec/changes/api-tools-agent-output-contracts/implementation-map.md#remediation-apply-approval-record`
- `approval_recorded_at`: `2026-07-26T16:45:00Z`
- `approval_summary`: Remediate exactly the three critical verification blockers with strict TDD, rerun package validation, and return to independent verification before reload or live smoke.
- `approval_summary_redacted`: `true`

## Live Smoke Evidence

- Login succeeded and the persisted token was valid.
- `api_status` reported API Tools enabled with Spring Swagger and GraphQL integrations.
- Swagger discovery returned a compact 50-operation page, but the model-facing output exposed no continuation cursor or instruction despite the known larger operation set.
- Swagger detail for `GET /review/analysis/status` returned the selected executable contract.
- REST and Swagger request both surfaced the backend HTTP 500 response truthfully and safely.
- GraphQL execute succeeded for `query ApiToolsSmoke { __typename }`.
- GraphQL discovery failed because standard Spring introspection rejects `__Field.appliedDirectives`; this contradicts the required standard-introspection fallback to authorization state `unavailable`.

## Live Smoke Remediation Approval Record

- `approval_id`: `live-remediation-apply-api-tools-agent-output-contracts-20260726T170343Z`
- `type`: `live-remediation-apply`
- `apply_approved_by_user`: `true`
- `approved_packet_revision`: `formal-sdd-live-remediation-20260726T170400Z-v1`
- `source_verify_revision`: `formal-sdd-verify-20260726T175930Z-v1-r12`
- `approval_scope_refs`:
  - `blocker:live-graphql-discover-standard-introspection`
  - `blocker:live-swagger-discovery-continuation-not-model-visible`
  - `requirements:REQ-03,REQ-07,REQ-09,REQ-12,REQ-13`
  - `method:strict-tdd`
  - `validation:focused-regressions,full-package-tests,typecheck,post-reload-live-smoke`
  - `excluded:permissions.json,unrelated-worktree-changes,archive-without-explicit-approval`
- `approval_scope_fingerprint`: `sha256:c7933c4fb0b3d211e64d8d8dbaea371311f7f2e18f64b04e08db2cd3c08213dc`
- `approval_record_ref`: `openspec/changes/api-tools-agent-output-contracts/implementation-map.md#live-smoke-remediation-approval-record`
- `approval_recorded_at`: `2026-07-26T17:03:43Z`
- `approval_summary`: Remediate both live smoke failures with strict TDD and continue automatically through independent verification and repeated live smoke until green.
- `approval_summary_redacted`: `true`

## Live Smoke Remediation 2 Approval Record

- `approval_id`: `live-remediation-2-apply-api-tools-agent-output-contracts-20260726T171519Z`
- `type`: `live-remediation-apply`
- `apply_approved_by_user`: `true`
- `authorization_basis`: `user-directed-automatic-remediation-until-green`
- `approved_packet_revision`: `formal-sdd-live-remediation-2-20260726T171500Z-v1`
- `source_verify_revision`: `formal-sdd-verify-20260726T171301Z-v1-r16`
- `approval_scope_refs`:
  - `blocker:live-graphql-discover-repeated-fields-introspection-rejected`
  - `risk:live-graphql-detail-repeated-fields-risk`
  - `requirements:REQ-03,REQ-05,REQ-07`
  - `method:strict-tdd`
  - `validation:focused-regressions,full-package-tests,typecheck,verification-harness,post-user-reload-live-smoke`
  - `excluded:permissions.json,unrelated-worktree-changes,archive-without-explicit-approval`
- `approval_scope_fingerprint`: `sha256:c54c309b219b6bfa23718de488efdb754dccabb7cddb6fbbd6dd3d40553807b6`
- `approval_record_ref`: `openspec/changes/api-tools-agent-output-contracts/implementation-map.md#live-smoke-remediation-2-approval-record`
- `approval_recorded_at`: `2026-07-26T17:15:19Z`
- `approval_summary`: Reshape GraphQL discovery and detail introspection to avoid backend repeated-fields anti-abuse rejection, then continue automatically through verification; wait for the user's reload before the final real-tool smoke.
- `approval_summary_redacted`: `true`

## Handoff Notes

- This flow supersedes `api-tools-swagger-graphql-contracts`, which was abandoned after live runtime evidence invalidated its verification result. Reuse the retained trust, rendering, dependency, and cursor lifecycle foundations only where they conform to active spec/design revisions.
- OpenSpec is authoritative for this hybrid flow; Engram carries only a compact cursor. During this task phase the Engram service was unavailable, so the OpenSpec task packet is authoritative and the compact cursor must be rebuilt when memory service access returns.
- Design, spec, and the completed task packet remain aligned. Apply completed for packet `formal-sdd-task-20260726T140500Z-v1`; the next lifecycle phase is independent `sdd-verify` under the locked automatic execution mode.
- Apply established fresh RED/GREEN evidence, ending with 41 passing tests and clean typecheck. Verify must independently determine whether the change from the previously recorded 42-test baseline is legitimate.
- Dirty-worktree note from design preflight: the active change artifacts and invocation config are expected workflow overlap; `permissions.json` deletion and the modified superseded-flow metadata are outside application scope and must not be touched by apply.

## Remediation Apply Results

### Scope
- Approval id: `remediation-apply-api-tools-agent-output-contracts-20260726T164500Z`
- Packet revision: `formal-sdd-remediation-20260726T164500Z-v1`
- Scope refs: the three failed verify blockers only (`verify-critical-discovery-operation-count-bounds`, `verify-critical-graphql-malformed-introspection-empty-success`, `verify-critical-graphql-detail-overflow-continuation`).

### Actual remediation touched files
- `extensions/api-tools/src/continuation.ts`
- `extensions/api-tools/src/swagger/discovery.ts`
- `extensions/api-tools/src/graphql/discovery.ts`
- `extensions/api-tools/src/graphql/detail.ts`
- `extensions/api-tools/src/tools.ts`
- `extensions/api-tools/test/tools.test.ts`
- `extensions/api-tools/test/graphql.test.ts`

### Actual remediation result vs expected blockers
| Verify blocker | Actual remediation result | Notes |
|---|---|---|
| Discovery operation-count bounds | Fixed | Added action-specific continuation record limits so Swagger and GraphQL discovery return 50 rows per default page even when byte/line budgets would allow more. |
| Malformed GraphQL introspection empty success | Fixed | Discovery now rejects missing `__schema` and malformed root-field payloads with a validation failure instead of returning an empty success list. |
| GraphQL detail overflow continuation | Fixed | GraphQL detail/schema now emit the full record set and rely on the shared continuation pipeline to enforce the 200-record page budget with `has_more`/`next_cursor`. |

### Remediation validation status
- `cd extensions/api-tools && npm test -- test/tools.test.ts test/graphql.test.ts test/swagger.test.ts`: RED on the new remediation assertions before the fix; GREEN after implementation.
- `cd extensions/api-tools && npm test`: passed (`9` files, `43` tests).
- `cd extensions/api-tools && npm run typecheck`: passed.

### Remediation discoveries
- The shared continuation pipeline already had the right abstraction for the spec-required discovery/detail pagination fix; the missing capability was an action-scoped record-count limit, not a second continuation transport.
- GraphQL malformed introspection handling needs explicit structural validation even when the transport returned HTTP 200 and no top-level `errors` array.
- The package test count increased from 41 to 43 once the remediation regressions were added, so verify can reason about the test-count delta directly from executable evidence.

### Remediation handoff
- OpenSpec remains authoritative for this hybrid flow. Engram was still unavailable during remediation apply, so the compact cursor was not refreshed.
- Task `3.8` remains verify-owned. Independent verify should rerun package validation, confirm the three blocker requirements now pass, and record whether live Pi review evidence is available.

## Live Remediation Apply Results

### Scope
- Approval id: `live-remediation-apply-api-tools-agent-output-contracts-20260726T170343Z`
- Packet revision: `formal-sdd-live-remediation-20260726T170400Z-v1`
- Scope refs: the two failed live smoke blockers only (`live-graphql-discover-standard-introspection`, `live-swagger-discovery-continuation-not-model-visible`).

### Actual live remediation touched files
- `extensions/api-tools/src/graphql.ts`
- `extensions/api-tools/src/continuation.ts`
- `extensions/api-tools/test/graphql.test.ts`
- `extensions/api-tools/test/tools.test.ts`
- `extensions/api-tools/test/continuation.test.ts`

### Actual live remediation result vs expected blockers
| Live smoke blocker | Actual remediation result | Notes |
|---|---|---|
| GraphQL discover standard introspection | Fixed | Removed unsupported `appliedDirectives` selections from the discovery and detail introspection queries so standard servers can return the approved `authorization: unavailable` fallback. |
| Swagger discovery continuation not model-visible | Fixed | Bounded discovery content now includes `next_cursor` plus the exact same-tool follow-up instruction in model-facing output while preserving structured continuation metadata in `details`. |

### Live remediation validation status
- `cd extensions/api-tools && npm test -- test/graphql.test.ts test/tools.test.ts`: RED on the new live-remediation assertions before the fix; GREEN after implementation.
- `cd extensions/api-tools && npm test`: passed (`9` files, `43` tests).
- `cd extensions/api-tools && npm run typecheck`: passed.

### Live remediation discoveries
- The standard-introspection compatibility problem was entirely in the client-side query shape; the approved fallback to `authorization: unavailable` did not require any server-specific probing.
- Making continuation model-visible belonged in the shared continuation formatter rather than the Swagger discovery builder, keeping the same fix available to other bounded actions.
- Stored continuation artifacts needed to retain the first-page record cap so follow-up pages preserve the same page shape as the initial response.

### Live remediation handoff
- OpenSpec remains authoritative for this hybrid flow. Engram was still unavailable during live remediation apply, so the compact cursor was not refreshed.
- Independent verify should rerun focused/package validation as needed and then repeat the post-reload live smoke that previously failed on discovery behavior.
- Task `3.8` remains verify-owned.

## Live Remediation 2 Apply Results

### Scope
- Approval id: `live-remediation-2-apply-api-tools-agent-output-contracts-20260726T171519Z`
- Packet revision: `formal-sdd-live-remediation-2-20260726T171500Z-v1`
- Scope refs: the remaining GraphQL discovery repeated-`__Type.fields` blocker plus the corresponding detail-query risk only.

### Actual live remediation 2 touched files
- `extensions/api-tools/src/graphql.ts`
- `extensions/api-tools/test/graphql.test.ts`
- `extensions/api-tools/test/tools.test.ts`

### Actual live remediation 2 result vs expected scope
| Approved blocker/risk | Actual remediation result | Notes |
|---|---|---|
| GraphQL discover repeated-`__Type.fields` introspection rejection | Fixed in implementation | Discovery now fetches Query and Mutation root fields through separate `__type(name: ...)` requests, keeping one `fields` selection per GraphQL request while preserving the compact root-field index. |
| GraphQL detail repeated-`__Type.fields` risk | Fixed in implementation | Detail/schema now stage the selected root-field lookup and recursive type lookups through one-`fields` queries, reusing the existing builders with synthetic schema assembly instead of one broad introspection query. |

### Live remediation 2 validation status
- `cd extensions/api-tools && npm test -- test/graphql.test.ts test/tools.test.ts`: RED on the new query-shape assertions before the fix; GREEN after implementation.
- `cd extensions/api-tools && npm test`: passed (`9` files, `43` tests).
- `cd extensions/api-tools && npm run typecheck`: passed.

### Live remediation 2 discoveries
- The local backend's anti-abuse rule appears to reject repeated `__Type.fields` selections within a single introspection request, even after `appliedDirectives` removal.
- The existing detail/schema builders could be preserved by staging introspection into smaller `__type(name: ...)` requests and reconstructing the minimal synthetic schema expected by those builders.
- This remediation stayed within the approved contract because it changed only introspection query shape, not public result structure, authorization provenance semantics, or continuation behavior.

### Live remediation 2 handoff
- OpenSpec remains authoritative for this hybrid flow. Engram was still unavailable during remediation-2 apply, so the compact cursor could not be refreshed.
- Independent verify should rerun focused/package validation, then execute the verification harness and post-user-reload live smoke needed to confirm the runtime blocker is truly resolved.
- Task `3.8` remains verify-owned.

## Final Post-Reload Real-Tool Smoke Evidence

- Executed at `2026-07-26T17:42:21Z` after explicit user reload confirmation.
- Configuration source: `.pi/api.json` through API Tools; no raw credentials or tokens were printed or persisted.
- `api_login`, `api_auth_status`, and `api_status`: passed; token valid and both Spring integrations enabled.
- Swagger discovery: passed with 50 compact rows, model-visible same-tool cursor/instruction, and a successful 17-row continuation page.
- GraphQL discovery: passed with 50 compact `Query.*` rows using `authorization: unavailable`, a model-visible cursor/instruction, and a successful 3-row continuation page.
- Swagger detail: passed for `GET /review/analysis/status`.
- GraphQL detail: passed for `Query.getMyProfile`, including bounded nested fields and truthful standard-introspection authorization provenance.
- GraphQL read-only execute: passed for `query ApiToolsSmoke { __typename }` with HTTP 200.
- REST and Swagger read-only request: both surfaced the backend's HTTP 500 response with the same bounded safe body; this validates truthful failure alignment rather than backend endpoint health.
- Mutation policy: no destructive operation executed.
- Overall real-tool smoke result: PASS.

## Spec-to-Source Trace Notes

These notes map the active spec requirements from `spec.md` to the implementation-map files. They are non-normative; the spec is the source of truth.

| Spec requirement | Primary source paths | Trace note |
|---|---|---|
| `REQ-01` public tool surface | `src/tools.ts` | `registerApiTools`, `API_TOOL_NAMES`, `SWAGGER_PARAMETERS`, `GRAPHQL_PARAMETERS` must expose `discover`, `detail`, `schema`, `request`/`execute`. |
| `REQ-02` compact Swagger discovery | `src/swagger.ts` / `src/swagger/discovery.ts` | `operationEntries` / `summaryForOperation` become compact; remove parameters, schemas, raw fragments from index rows. |
| `REQ-03` compact GraphQL discovery | `src/graphql.ts` / `src/graphql/discovery.ts` | `DISCOVER_ROOT_QUERY` issues separate `__type(name: Query|Mutation)` requests so each introspection request has one `fields` selection, then `buildGraphqlDiscoverDocument` returns only canonical selector, kind, and authorization summary; introspection failures become failure envelopes. |
| `REQ-04` Swagger detail | `src/swagger.ts` / `src/swagger/detail.ts` | Build executable contract with inherited parameters, security schemes, OAuth scopes, vendor metadata, local `$ref` resolution, and unsupported-reference markers. |
| `REQ-05` GraphQL detail | `src/graphql.ts` / `src/graphql/detail.ts` | `ROOT_FIELD_QUERY` plus staged `TYPE_BY_NAME_QUERY` lookups build the selected executable contract with arguments, return type, bounded field contract, cycle detection, and applied directive metadata fallback semantics. |
| `REQ-06` schema separation | `src/swagger.ts` / `src/graphql.ts` (or `src/swagger/schema.ts`, `src/graphql/schema.ts`) | `schema` action requires explicit selector and bounded depth; not the default path for executable operations. |
| `REQ-07` authorization provenance | `src/security.ts` | `extractAuthorizationMetadata` implements `declared`/`not_declared`/`unavailable`/`unknown` states. |
| `REQ-08` truthful failure envelope | `src/result-format.ts`, `src/error-classify.ts`, `src/client.ts`, `src/tools.ts` | Centralize failure categories/codes; `graphql()` detects top-level errors; Swagger `request` reports HTTP >= 400 as failure. |
| `REQ-09` structured continuation | `src/continuation.ts` | Logical-record or framed-text chunking; keep artifact/cursor lifecycle. |
| `REQ-10` no duplicate context | `src/result-format.ts`, `src/render.ts` | `content` holds agent-facing result; `details` holds only rendering/continuation metadata. |
| `REQ-11` base tool alignment | `src/tools.ts`, `src/client.ts` | `api_rest_request` and Swagger `request` share failure envelope and bounded response semantics. |
| `REQ-12` native rendering | `src/render.ts` | `renderApiToolResult` handles `detail`, authorization states, and continuation. |
| `REQ-13` quantified bounds | `src/config.ts`, `src/types.ts`, `src/security.ts`, `src/continuation.ts` | Enforce page sizes, depths, field counts, value lengths, byte/line ceilings. |
| `REQ-14` contract version / migration | `src/types.ts`, `README.md` | Result `details` carries `contract_version: 2`; README documents migration. |
| `REQ-SEC-01` redaction / secrets | `src/security.ts` | Recursive redaction before output and pagination. |
| `REQ-SEC-02` reference safety | `src/swagger.ts` / `src/swagger/detail.ts` | Resolve local `$ref` only; mark external refs `unsupported_reference`. |
| `REQ-SEC-03` OpenAPI vendor allowlist | `src/security.ts` | Case-insensitive key allowlist; scalar strings/arrays only; bounded counts and lengths. |
| `REQ-SEC-04` GraphQL directive allowlist | `src/security.ts` / `src/graphql/detail.ts` | Directive-name allowlist; applied directives only; reject complex arguments. |
| `REQ-SEC-05` trust boundaries / cancellation | `src/client.ts` | Propagate `AbortSignal`; cancellation reported as `cancellation_error`. |

## Completion Summary

- `completion_revision`: `formal-sdd-completion-20260727T020958Z-v1`
- `verification_revision`: `formal-sdd-final-verify-20260726T174421Z-v1-r25`
- Result: 25/25 tasks complete; focused tests, all 43 package tests, typecheck, and post-reload non-destructive real-tool smoke passed.
- Security: aligned; no credential exposure, external-reference fetching, arbitrary authorization inference, or destructive live mutation.
- Archive scope: move the verified OpenSpec change to `openspec/changes/archive/2026-07-27-api-tools-agent-output-contracts`; capability-spec synchronization is `none` per the canonical spec; refresh the hybrid Engram closure pointer.
- Residual risks: none blocking; retain sanitized runtime evidence only.

## Archive Approval Record

- `approval_id`: `archive-api-tools-agent-output-contracts-20260727T020958Z`
- `type`: `archive`
- `archive_approved_by_user`: `true`
- `approved_completion_revision`: `formal-sdd-completion-20260727T020958Z-v1`
- `approval_scope_refs`:
  - `completion:formal-sdd-completion-20260727T020958Z-v1`
  - `verify-packet:formal-sdd-final-verify-20260726T174421Z-v1-r25`
  - `verify-report:openspec/changes/api-tools-agent-output-contracts/verify-report.md#verdict`
  - `archive-mapping:none`
  - `archive-target:openspec/changes/archive/2026-07-27-api-tools-agent-output-contracts`
  - `engram-topic:sdd.active-flow.api-tools-agent-output-contracts`
- `approval_scope_fingerprint`: `sha256:e40ba8a890cce53ed5d2b0951601fe4cd5e797713f999641dcb2e73762f46d8a`
- `approval_record_ref`: `openspec/changes/api-tools-agent-output-contracts/implementation-map.md#archive-approval-record`
- `approval_recorded_at`: `2026-07-27T02:09:58Z`
- `approval_summary`: Close the verified formal API Tools output-contract flow, apply the explicit no-capability-sync mapping, move the OpenSpec change to its deterministic archive path, and refresh the compact Engram closure pointer.
- `approval_summary_redacted`: `true`
