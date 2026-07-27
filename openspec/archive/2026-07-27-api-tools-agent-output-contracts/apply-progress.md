# Apply Progress: Agent-efficient API Tools output contracts

## Mode
Strict TDD

## Approval Binding
- Approval id: `apply-api-tools-agent-output-contracts-20260726T161223Z`
- Packet revision: `formal-sdd-task-20260726T140500Z-v1`
- Approval record ref: `openspec/changes/api-tools-agent-output-contracts/implementation-map.md#apply-approval-record`
- Approved scope summary: Full v2 API Tools packet in four ordered work units for shared contracts, Swagger, GraphQL, rendering/docs, and package regression.
- Approval summary redacted: true
- Recorded at: `2026-07-26T16:12:23Z`

## Completed Tasks
- [x] 1.1 Add failing contract tests for v2 metadata, continuation, and shared failures.
- [x] 1.2 Add failing Swagger tests for compact discovery/detail/schema and refs/auth behavior.
- [x] 1.3 Add failing GraphQL tests for compact discovery/detail/schema, bounds, and truthful errors.
- [x] 1.4 Add failing renderer tests for v2 detail/failure/continuation/auth states.
- [x] 1.5 Establish baseline and capture RED failures.
- [x] 2.1 Extend shared types for v2 action, failure, authorization, and continuation contracts.
- [x] 2.2 Update tool registration for `detail` actions and REST cursor continuation.
- [x] 2.3 Centralize failure mapping and expose truthful HTTP/GraphQL errors.
- [x] 2.4 Refactor continuation to page immutable logical records by record index.
- [x] 2.5 Implement compact Swagger discovery dispatcher flow.
- [x] 2.6 Implement Swagger detail with inherited params/security, local refs, and unsupported markers.
- [x] 2.7 Keep Swagger schema separate from detail.
- [x] 2.8 Implement compact GraphQL discovery with visible introspection failures.
- [x] 2.9 Implement GraphQL detail/schema with canonical selectors, bounds, and cycle markers.
- [x] 2.10 Enforce authorization allowlists, redaction, and provenance helpers.
- [x] 2.11 Update renderer for v2 summary, failure, authorization, and continuation metadata.
- [x] 2.12 Update README for v2 migration, `detail`, failures, provenance, and continuation.
- [x] 3.1 Run security-focused assertions.
- [x] 3.2 Run continuation-focused assertions.
- [x] 3.3 Run tool/client alignment assertions.
- [x] 3.4 Run Swagger assertions.
- [x] 3.5 Run GraphQL assertions.
- [x] 3.6 Run renderer assertions.
- [x] 3.7 Run full package tests and typecheck.

## Files Changed
| File | Action | What Was Done |
|------|--------|---------------|
| `extensions/api-tools/src/types.ts` | Modified | Added contract v2 result, failure, authorization, and continuation types. |
| `extensions/api-tools/src/tools.ts` | Modified | Added `detail` schemas, REST cursor continuation, and v2 document finalization. |
| `extensions/api-tools/src/client.ts` | Modified | Added typed client error kinds and retained trust/cancellation controls. |
| `extensions/api-tools/src/security.ts` | Modified | Added allowlisted auth extraction, truncation, path sanitization, and redaction helpers. |
| `extensions/api-tools/src/continuation.ts` | Modified | Reworked continuation to persist redacted logical-record documents and page by record index. |
| `extensions/api-tools/src/render.ts` | Modified | Rendered v2 action/failure/authorization/continuation metadata. |
| `extensions/api-tools/src/swagger.ts` | Modified | Replaced monolithic behavior with v2 dispatcher outputs. |
| `extensions/api-tools/src/swagger/discovery.ts` | New | Compact Swagger discovery rows and selector helpers. |
| `extensions/api-tools/src/swagger/detail.ts` | New | Swagger detail/schema builders with inherited params/security and ref handling. |
| `extensions/api-tools/src/swagger/schema.ts` | New | Thin schema export wrapper. |
| `extensions/api-tools/src/graphql.ts` | Modified | Replaced monolithic behavior with v2 dispatcher outputs. |
| `extensions/api-tools/src/graphql/discovery.ts` | New | Compact GraphQL discovery rows. |
| `extensions/api-tools/src/graphql/detail.ts` | New | GraphQL detail/schema builders with bounds and cycle markers. |
| `extensions/api-tools/src/graphql/schema.ts` | New | Thin schema export wrapper. |
| `extensions/api-tools/src/result-format.ts` | New | Shared v2 success/failure document helpers and framing helpers. |
| `extensions/api-tools/src/error-classify.ts` | New | Shared failure classification helpers. |
| `extensions/api-tools/test/tools.test.ts` | Modified | Added v2 registration/continuation/login assertions. |
| `extensions/api-tools/test/swagger.test.ts` | Modified | Added compact discovery/detail/schema/request failure assertions. |
| `extensions/api-tools/test/graphql.test.ts` | Modified | Added compact discovery/detail/schema/truthful error assertions. |
| `extensions/api-tools/test/continuation.test.ts` | Modified | Added logical-record continuation assertions. |
| `extensions/api-tools/test/render.test.ts` | Modified | Added v2 renderer assertions. |
| `extensions/api-tools/test/security.test.ts` | Modified | Added allowlist/provenance/redaction assertions. |
| `extensions/api-tools/test/client.test.ts` | Modified | Added typed client error assertions. |
| `extensions/api-tools/README.md` | Modified | Documented contract version 2 behavior and migration expectations. |
| `openspec/changes/api-tools-agent-output-contracts/tasks.md` | Modified | Marked completed apply tasks. |
| `openspec/changes/api-tools-agent-output-contracts/implementation-map.md` | Modified | Recorded actual apply outputs and validations. |
| `openspec/changes/api-tools-agent-output-contracts/apply-progress.md` | New | Recorded cumulative apply progress and validation evidence. |
| `openspec/changes/api-tools-agent-output-contracts/metadata.yaml` | Modified | Advanced authoritative flow state to apply-complete / verify-ready. |

## Implementation Map Alignment
| Expected map entry | Actual result | Notes |
|--------------------|---------------|-------|
| Shared v2 result/failure/continuation helpers | Implemented | Added `result-format.ts`, `error-classify.ts`, and logical-record continuation. |
| Swagger modular discovery/detail/schema | Implemented | Added `src/swagger/` modules plus thin dispatcher. |
| GraphQL modular discovery/detail/schema | Implemented | Added `src/graphql/` modules plus thin dispatcher. |
| Renderer/doc updates | Implemented | Updated `render.ts` and `README.md`. |
| Full package regression | Implemented | `npm test` and `npm run typecheck` passed. |

New files/symbols discovered during apply: `ApiActionDocument`, `ApiFailureEnvelope`, `ApiAuthorizationMetadata`, `result-format.ts`, `error-classify.ts`, `src/swagger/*`, `src/graphql/*`.
Deviations from implementation map: None material. The implementation kept Swagger schema logic exported from the detail module via a thin wrapper rather than a second independent builder.

## Validations
- `cd extensions/api-tools && npm test` (RED after test updates): failed in `test/graphql.test.ts` and `test/tools.test.ts` before implementation changes.
- `cd extensions/api-tools && npm test`: passed (`9` files, `41` tests).
- `cd extensions/api-tools && npm run typecheck`: passed.

## Metadata, PRD, Spec, and Security Alignment
- Metadata: `openspec/changes/api-tools-agent-output-contracts/metadata.yaml`
- PRD: `openspec/changes/api-tools-agent-output-contracts/prd.md`
- metadata_alignment: aligned
- prd_alignment: aligned
- spec_alignment: aligned
- security_alignment: aligned
- Metadata/PRD/spec/security requirements implemented in this batch: v2 result contract, `detail` actions, compact discovery, truthful failures, record-boundary continuation, authorization provenance, native rendering summaries, README migration notes, and package-local validation.
- Metadata/PRD/spec/security conflicts_detected encountered: None.

## Deviations from Design
- Swagger schema export is a thin wrapper over the shared Swagger detail module instead of a second standalone implementation file. Behavior remains within approved design boundaries.

## Issues Found
- Engram service remained unavailable during apply, so the hybrid compact cursor could not be refreshed. OpenSpec artifacts are authoritative and sufficient for verify.

## Remaining Tasks
- [ ] 3.8 During verify, perform the secondary live Pi review for compact collapsed rows, useful expanded pages, visible failures, and continuation hints.

## Status
24/25 tasks complete. Ready for verify.

## Remediation Apply Cycle

### Approval Binding
- Approval id: `remediation-apply-api-tools-agent-output-contracts-20260726T164500Z`
- Packet revision: `formal-sdd-remediation-20260726T164500Z-v1`
- Approval record ref: `openspec/changes/api-tools-agent-output-contracts/implementation-map.md#remediation-apply-approval-record`
- Approved scope summary: Remediate only the three failed verification blockers for discovery page-size bounds, malformed GraphQL introspection handling, and GraphQL detail overflow continuation.
- Approval summary redacted: true
- Recorded at: `2026-07-26T16:45:00Z`

### Completed Remediation Work
- [x] Added RED coverage for the failed verification cases in `test/tools.test.ts` and `test/graphql.test.ts`.
- [x] Enforced the default 50-operation discovery page size through same-tool continuation for Swagger and GraphQL discovery.
- [x] Rejected malformed GraphQL introspection bodies that omit usable `__schema` root-field data instead of returning a successful empty discovery result.
- [x] Allowed GraphQL detail/schema traversal to continue beyond the 200-field page budget and surfaced `has_more`/`next_cursor` through the shared continuation pipeline.
- [x] Reran focused remediation tests, full package tests, and typecheck.

### Remediation Files Changed
| File | Action | What Was Done |
|------|--------|---------------|
| `extensions/api-tools/src/continuation.ts` | Modified | Added optional per-action record-count pagination limits for same-tool continuation. |
| `extensions/api-tools/src/swagger/discovery.ts` | Modified | Defined the default discovery page-size constant used by Swagger continuation. |
| `extensions/api-tools/src/graphql/discovery.ts` | Modified | Rejected malformed/partial introspection discovery payloads and defined the default discovery page-size constant. |
| `extensions/api-tools/src/graphql/detail.ts` | Modified | Removed the hard stop at 200 fields so GraphQL detail/schema can continue through pagination. |
| `extensions/api-tools/src/tools.ts` | Modified | Applied action-specific continuation page limits for Swagger/GraphQL discovery and GraphQL detail/schema. |
| `extensions/api-tools/test/tools.test.ts` | Modified | Added regression coverage for 50-row discovery pages and GraphQL detail continuation. |
| `extensions/api-tools/test/graphql.test.ts` | Modified | Added malformed introspection failure coverage. |
| `openspec/changes/api-tools-agent-output-contracts/tasks.md` | Modified | Recorded the remediation scope note while leaving verify-owned task 3.8 pending. |
| `openspec/changes/api-tools-agent-output-contracts/implementation-map.md` | Modified | Recorded remediation-specific touched files, validations, and verify handoff. |
| `openspec/changes/api-tools-agent-output-contracts/apply-progress.md` | Modified | Appended cumulative remediation apply evidence. |
| `openspec/changes/api-tools-agent-output-contracts/metadata.yaml` | Modified | Advanced authoritative flow state from failed verify to remediation apply complete / verify ready. |

### Remediation Validations
- `cd extensions/api-tools && npm test -- test/tools.test.ts test/graphql.test.ts test/swagger.test.ts`: failed first (RED) on the three new remediation assertions, then passed after the fix.
- `cd extensions/api-tools && npm test`: passed (`9` files, `43` tests).
- `cd extensions/api-tools && npm run typecheck`: passed.

### Remediation Alignment
- metadata_alignment: aligned
- prd_alignment: aligned
- spec_alignment: aligned
- security_alignment: aligned
- Conflicts detected: None.

### Remediation Remaining Work
- [ ] 3.8 During verify, perform the secondary live Pi review for compact collapsed rows, useful expanded pages, visible failures, and continuation hints.

### Remediation Status
Remediation apply complete. The three failed verification blockers are implemented and ready for independent `sdd-verify`.

## Live Remediation Apply Cycle

### Approval Binding
- Approval id: `live-remediation-apply-api-tools-agent-output-contracts-20260726T170343Z`
- Packet revision: `formal-sdd-live-remediation-20260726T170400Z-v1`
- Approval record ref: `openspec/changes/api-tools-agent-output-contracts/implementation-map.md#live-smoke-remediation-approval-record`
- Approved scope summary: Remediate only the two failed live smoke behaviors for standard-compatible GraphQL discovery introspection and model-visible Swagger discovery continuation.
- Approval summary redacted: true
- Recorded at: `2026-07-26T17:03:43Z`

### Completed Live Remediation Work
- [x] Added RED coverage that GraphQL discover/detail use standard introspection fields only.
- [x] Added RED coverage that Swagger discovery pages expose the same-tool continuation cursor and follow-up instruction in model-facing content.
- [x] Removed unsupported `appliedDirectives` requests from the GraphQL discovery/detail introspection queries so standard introspection falls back to `authorization: unavailable`.
- [x] Made same-tool continuation model-visible in bounded content while preserving structured continuation metadata in `details`.
- [x] Persisted per-action continuation record limits so follow-up cursor pages honor the same page budget as the first page.
- [x] Reran focused regressions, full package tests, and typecheck.

### Live Remediation Files Changed
| File | Action | What Was Done |
|------|--------|---------------|
| `extensions/api-tools/src/graphql.ts` | Modified | Removed unsupported `appliedDirectives` selections from the GraphQL discovery and detail introspection queries. |
| `extensions/api-tools/src/continuation.ts` | Modified | Added model-facing continuation instructions and persisted per-action page limits into stored cursor artifacts. |
| `extensions/api-tools/test/graphql.test.ts` | Modified | Added regression assertions that standard introspection queries do not request `appliedDirectives`. |
| `extensions/api-tools/test/tools.test.ts` | Modified | Added regression assertions that bounded discovery content exposes `next_cursor` and the same-tool follow-up action. |
| `extensions/api-tools/test/continuation.test.ts` | Modified | Updated continuation coverage for model-visible follow-up text while preserving deterministic page bodies apart from opaque cursor values. |
| `openspec/changes/api-tools-agent-output-contracts/tasks.md` | Modified | Recorded the live remediation scope note while leaving verify-owned live review work pending. |
| `openspec/changes/api-tools-agent-output-contracts/implementation-map.md` | Modified | Recorded the live remediation implementation, validations, and verify handoff. |
| `openspec/changes/api-tools-agent-output-contracts/apply-progress.md` | Modified | Appended cumulative live remediation apply evidence. |
| `openspec/changes/api-tools-agent-output-contracts/metadata.yaml` | Modified | Advanced authoritative flow state from live-smoke-failed verify to live remediation apply complete / verify ready. |

### Live Remediation Validations
- `cd extensions/api-tools && npm test -- test/graphql.test.ts test/tools.test.ts`: failed first (RED) on the new live-remediation assertions, then passed after the fix.
- `cd extensions/api-tools && npm test`: passed (`9` files, `43` tests).
- `cd extensions/api-tools && npm run typecheck`: passed.

### Live Remediation Alignment
- metadata_alignment: aligned
- prd_alignment: aligned
- spec_alignment: aligned
- security_alignment: aligned
- Conflicts detected: None.

### Live Remediation Remaining Work
- [ ] 3.8 During verify, perform the secondary live Pi review for compact collapsed rows, useful expanded pages, visible failures, and continuation hints.
- [ ] Rerun the independent verify cycle and repeated post-reload live smoke required by the live remediation approval.

### Live Remediation Status
Live remediation apply complete. The two failed live smoke blockers are implemented and ready for independent `sdd-verify`.

## Live Remediation 2 Apply Cycle

### Approval Binding
- Approval id: `live-remediation-2-apply-api-tools-agent-output-contracts-20260726T171519Z`
- Packet revision: `formal-sdd-live-remediation-2-20260726T171500Z-v1`
- Approval record ref: `openspec/changes/api-tools-agent-output-contracts/implementation-map.md#live-smoke-remediation-2-approval-record`
- Approved scope summary: Remediate only the remaining GraphQL repeated-`__Type.fields` introspection rejection and the corresponding detail-query risk.
- Approval summary redacted: true
- Recorded at: `2026-07-26T17:15:19Z`

### Completed Live Remediation 2 Work
- [x] Added RED coverage that GraphQL discovery/detail introspection queries keep at most one `fields` selection per request.
- [x] Reworked GraphQL discovery to fetch Query and Mutation root fields through separate `__type(name: ...)` calls so standard servers no longer see repeated `__Type.fields` in one request.
- [x] Reworked GraphQL detail/schema introspection to fetch the selected root field and referenced types through staged single-`fields` queries rather than one broad schema query.
- [x] Preserved the approved `authorization: unavailable` fallback and bounded detail/schema traversal while avoiding server-specific probing.
- [x] Reran focused regressions, full package tests, and typecheck.

### Live Remediation 2 Files Changed
| File | Action | What Was Done |
|------|--------|---------------|
| `extensions/api-tools/src/graphql.ts` | Modified | Replaced the repeated-`fields` discovery/detail/schema introspection queries with staged `__type(name: ...)` requests and synthetic schema assembly for the existing builders. |
| `extensions/api-tools/test/graphql.test.ts` | Modified | Added regression assertions that every GraphQL introspection request contains at most one `fields` selection and still returns the expected compact discovery/detail behavior. |
| `extensions/api-tools/test/tools.test.ts` | Modified | Updated public-tool contract coverage for the staged GraphQL discovery/detail flows and retained the pagination assertions. |
| `openspec/changes/api-tools-agent-output-contracts/tasks.md` | Modified | Recorded the remediation-2 scope note while keeping verify-owned live review work pending. |
| `openspec/changes/api-tools-agent-output-contracts/implementation-map.md` | Modified | Recorded the remediation-2 implementation, query-shape change, validations, and verify handoff. |
| `openspec/changes/api-tools-agent-output-contracts/apply-progress.md` | Modified | Appended cumulative remediation-2 apply evidence. |
| `openspec/changes/api-tools-agent-output-contracts/metadata.yaml` | Modified | Advanced authoritative flow state from verify-failed/live blocker to remediation-2 apply complete / verify ready. |

### Live Remediation 2 Validations
- `cd extensions/api-tools && npm test -- test/graphql.test.ts test/tools.test.ts`: failed first (RED) on the new query-shape assertions, then passed after the fix.
- `cd extensions/api-tools && npm test`: passed (`9` files, `43` tests).
- `cd extensions/api-tools && npm run typecheck`: passed.

### Live Remediation 2 Alignment
- metadata_alignment: aligned
- prd_alignment: aligned
- spec_alignment: aligned
- security_alignment: aligned
- Conflicts detected: None.

### Live Remediation 2 Remaining Work
- [ ] 3.8 During verify, perform the secondary live Pi review for compact collapsed rows, useful expanded pages, visible failures, and continuation hints.
- [ ] Rerun the independent verify cycle, including any verification harness and the post-user-reload live smoke required by the remediation-2 approval.

### Live Remediation 2 Status
Live remediation 2 apply complete. The GraphQL repeated-`__Type.fields` discovery blocker and corresponding detail-query risk are implemented and ready for independent `sdd-verify`.
