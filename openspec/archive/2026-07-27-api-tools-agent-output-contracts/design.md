# Design: Agent-efficient API Tools output contracts

## Technical Approach

Refactor the existing Swagger and GraphQL monoliths into thin action dispatchers plus cohesive discovery, detail, and schema builders. All public actions produce a typed contract-version-2 `ApiActionDocument`: compact page metadata plus an ordered set of already-safe logical records. A shared formatter renders only the current page into model-facing `content`; `details` carries status, version, action/identity rendering hints, failure metadata, and continuation metadata but never a duplicate domain payload.

The existing `ContinuationManager` retains session ownership, opaque cursors, restrictive temporary files, expiry, containment checks, and idempotent cleanup. Its payload changes from a serialized `ApiToolResult` to an immutable redacted logical-record document. Pagination advances by record index. Text-bearing execution responses are converted to explicit ordered frames before persistence; structured discovery/detail/schema records are never sliced mid-record. Domain builders enforce stable ordering and bounded atomic records before the manager applies byte and line ceilings.

`src/tools.ts` remains the registration/composition boundary. It owns strict action schemas and routes every potentially large contract/request result through the same continuation pipeline. Compact status/auth/login results remain intrinsically below the ceilings. `api_rest_request` gains a cursor-only schema branch and uses synthetic action identity `request`, preserving the public six-tool surface while allowing same-tool continuation.

## Metadata and PRD Alignment
- Metadata: `openspec/changes/api-tools-agent-output-contracts/metadata.yaml`
- PRD: `openspec/changes/api-tools-agent-output-contracts/prd.md`
- metadata_alignment: aligned
- prd_alignment: aligned
- spec_alignment: aligned
- Metadata/product constraints influencing design: hybrid/OpenSpec authority; exactly six public tools; explicit `detail` actions only inside the two existing contract tools; contract version 2 without parallel legacy envelopes; quantified page/depth/field/string/byte/line bounds; native Pi expansion; extension-owned dependencies; strict TDD; contract-derived authorization only; no external `$ref` fetches; no cross-session continuation.
- Metadata/PRD/spec conflicts_detected: None. The target backend's server-specific GraphQL applied-directive transport remains unevidenced; the design safely reports `unavailable` for standard introspection and does not add vendor probing. The pure extraction boundary accepts applied metadata only when it is actually present in the selected-field response in the approved shape.

## Architecture Decisions
| `decision_id` | Revision | Status | `supersedes` | `superseded_by` | Choice | Alternatives considered | Rationale |
|---|---|---|---|---|---|---|---|
| `DES-001` | R1 | active | None | None | Keep `swagger.ts` and `graphql.ts` as thin dispatchers; place discovery/detail/schema behavior in `src/swagger/` and `src/graphql/`. | Extend monoliths; add helpers but keep all behavior in two files. | The normative actions have distinct selectors, bounds, records, and tests. Cohesive modules reduce accidental discovery/detail/schema leakage while preserving the existing registration and client boundaries. |
| `DES-002` | R1 | active | None | None | Introduce a typed `ApiActionDocument` of ordered logical records and paginate immutable redacted records by index; frame unstructured text before pagination. | Slice serialized result JSON; persist complete duplicate payload in `details`; add a public retrieval tool. | Record-index continuation is valid, deterministic, reconstructable, and same-tool. It prevents malformed JSON and duplicate context while retaining the secure cursor lifecycle. |
| `DES-003` | R1 | active | None | None | Centralize typed result/failure construction in `result-format.ts` and error mapping in `error-classify.ts`; give `ApiClientError` a machine-readable kind. | Keep duplicated regex classifiers; throw all failures to Pi; return provider bodies. | A single envelope guarantees compatible categories, stable action-scoped codes, retryability, safe messages, and next steps across REST, Swagger, GraphQL, login, validation, and continuation. Typed causes preserve cancellation and timeout truthfully. |
| `DES-004` | R1 | active | None | None | Resolve Swagger selectors by exact `operationId` first, then canonical `METHOD path`; reject ambiguous/missing matches. GraphQL detail accepts one canonical `Query.field` or `Mutation.field` through `operation`; GraphQL schema retains `name`. | Fuzzy matching; first-match selection; replace existing schema input keys. | Exact selectors are deterministic and avoid breaking the existing Swagger schema and GraphQL schema inputs. Ambiguity becomes an actionable validation failure rather than a guessed operation. |
| `DES-005` | R1 | active | None | None | Resolve only same-document JSON Pointer `$ref` values with cycle detection and inherited OpenAPI path/operation merge rules; emit bounded `unsupported_reference` records for external or invalid references. | Fetch external references; silently omit unresolved values; fail the entire detail. | This preserves useful partial detail without expanding the SSRF/data-leak boundary or hiding missing contract information. External targets are never serialized. |
| `DES-006` | R1 | active | None | None | Extract authorization through pure bounded helpers: OpenAPI standard security plus exact case-insensitive vendor-key allowlist; GraphQL approved applied-directive names only when selected-field applied metadata is actually returned. | Arbitrary vendor pass-through; directive-definition inference; JWT/runtime access inference; server-specific probing. | The design can report `declared`, `not_declared`, `unavailable`, or `unknown` without claiming effective access or exposing arbitrary contract payloads. |
| `DES-007` | R1 | active | None | None | Keep Pi-native `Text` rendering and Pi-owned expansion; render summary from metadata and current bounded `content` only. | Custom component/state; hidden full payload in expanded view; hard-coded key. | Existing rendering is structurally sound. Metadata-driven summaries add detail/auth/failure/continuation states without mutating model output or creating a second expansion state. |
| `DES-008` | R1 | active | None | None | Extend the existing semantically owning test files under `test/`; do not create parallel per-feature suites. Use focused RED-GREEN-REFACTOR, then full package test/typecheck and secondary live Pi review. | New ticket-specific test files; manual-only validation; framework changes. | Vitest and the existing mirrored package test tree already own these behaviors. This preserves strict TDD, fixture reuse, and extension-local validation. |

## Data Flow

```text
Untrusted tool params / cursor
          |
          v
src/tools.ts strict oneOf schema + cursor/input exclusivity
          |
          +---------------- cursor -------------------+
          |                                            |
          v                                            v
Swagger/GraphQL/REST dispatcher               ContinuationManager.continue
          |                                            |
          v                                            |
ApiClient ---- HTTP trust boundary ----> configured same-origin/base-path API
  | AbortSignal, manual redirects, limits             |
  v                                                    |
parsed contract/response                               |
  |                                                    |
  +--> domain discovery/detail/schema builder          |
  |       - exact selector                             |
  |       - local refs/cycles/depth/field bounds       |
  |       - auth provenance allowlists                 |
  |                                                    |
  +--> typed error classifier                          |
          |                                            |
          v                                            |
ApiActionDocument (ordered logical records)            |
          |                                            |
          v                                            |
recursive redaction + value bounding                   |
          |                                            |
          v                                            |
ContinuationManager.finalize --------------------------+
  | persist immutable redacted records in 0700/0600 session temp boundary
  | paginate by record index / explicit text frame
  v
ApiToolResult v2
  content = current complete records only
  details = status/version/action/identity/error/continuation only
          |
          +--> model context
          +--> Pi-native collapsed/expanded renderer (same bounded page)
```

Trust boundaries are: caller parameters/cursors, external API responses/contracts, project-local credential/config state, and private session temporary storage. Redaction and authorization allowlisting occur before temporary persistence. Renderer state never crosses back into execution results.

## Security Controls and Failure Handling
| Concern | Design Control | Validation Expectation |
|---|---|---|
| Credentials and provider payloads | `redactDeep` runs before record persistence and output. Failure excerpts are recursively redacted, stripped of internal paths, and capped at 500 characters with a marker. `details` cannot carry raw response/domain payloads. | Inject tokens, secret headers, paths, stack text, and large bodies; assert exclusion from content, details, artifacts, cursors, and rendering. |
| Authorization claims | Exact OpenAPI key and GraphQL directive-name allowlists; scalar/list-only extraction; 32 values/key, 128 chars/value; provenance state and source; never inspect JWT claims or infer effective access. | State tests for `declared`, `not_declared`, `unavailable`, `unknown`; object/complex argument rejection; count/length bounds; directive definitions alone ignored. |
| SSRF / reference traversal | Preserve client same-origin/base-path and redirect controls. Swagger resolver accepts only `#` JSON Pointers in the fetched document, uses decoded pointer tokens safely, detects cycles, and never emits external targets. | External/relative URL refs produce `unsupported_reference`; local refs resolve; cyclic refs terminate; no extra network call or URL/path leak. |
| Untrusted selectors and action inputs | Strict `oneOf`, `additionalProperties: false`, exact canonical selectors, cursor-only continuation branches, page/depth clamps. | Missing, malformed, ambiguous, conflicting cursor inputs, and over-limit values return `validation_error` or `continuation_error` with stable codes and next steps. |
| HTTP / GraphQL truthfulness | Typed failure classifier maps HTTP >=400, GraphQL top-level errors, malformed introspection, configuration, timeout, cancellation, parsing, references, and cursor faults to the spec categories. Error codes follow `<tool>.<action>.<condition>`; continuation codes use `continuation.<condition>`. | Cross-tool envelope assertions cover category, code, safe message, status/classification, retryable, and next_step. No HTTP/GraphQL error remains success. |
| Cancellation | `AbortSignal` remains propagated through `ApiClient`; `ApiClientError.kind` distinguishes cancellation from timeout/provider errors. Cancellation is never swallowed by a generic validation classifier. | Client and action tests cancel in-flight requests and assert `cancellation_error`, retryable true, plus no continued I/O. |
| Continuation integrity | Cursor records bind owner/tool/action/artifact/index/expiry; artifacts contain only immutable redacted records; pages advance by record index; replay is deterministic; paths remain private. | Reconstruct all pages and compare ordered records; assert no skip/duplicate/split, replay identity, wrong-owner/tool/action/expiry failures, containment and cleanup. |
| Output denial/context explosion | Discovery defaults 50/max 100; GraphQL depth 3/max 5 and 200 fields/page; descriptions 500 chars; all atomic records bounded; paginator accounts for page framing before 50,000 bytes/2,000 lines. | Boundary fixtures at and above every limit; assert valid pages and explicit continuation/truncation markers. An impossible oversized atomic record returns a safe `continuation_error` rather than slicing structured JSON. |
| Dependency independence | No runtime package added; retain extension-owned peer/dev Pi packages and package-local Vitest/TypeScript commands. | Static import/package checks plus `npm test` and `npm run typecheck` from `extensions/api-tools`; no sibling-resolution path. |

## File Changes
| File | Action | Description |
|------|--------|-------------|
| `extensions/api-tools/src/types.ts` | Modify | Add contract-version-2 action document, logical record/page, continuation, authorization provenance, failure category/envelope, selector/detail types. |
| `extensions/api-tools/src/tools.ts` | Modify | Add `detail` action schemas, REST cursor branch, shared result/error imports, and route Swagger/GraphQL/REST through one bounded formatter/continuation path while retaining six tools. |
| `extensions/api-tools/src/result-format.ts` | Create | Build success/failure action documents, render valid current-page content, frame bounded text, and project minimal result details. |
| `extensions/api-tools/src/error-classify.ts` | Create | Map typed client/domain/cursor errors and HTTP/GraphQL failures to stable categories, action-scoped codes, retryability, and next steps. |
| `extensions/api-tools/src/swagger.ts` | Modify | Become a thin dispatcher for discover/detail/schema/request and shared failure handling. |
| `extensions/api-tools/src/swagger/discovery.ts` | Create | Enumerate stable operations, filter, sort, and create compact authorization-aware discovery records. |
| `extensions/api-tools/src/swagger/detail.ts` | Create | Resolve one operation, inheritance, local refs, parameters, request bodies, responses, security schemes/scopes, vendor metadata, and unsupported markers into ordered records. |
| `extensions/api-tools/src/swagger/schema.ts` | Create | Preserve explicit bounded advanced schema inspection without returning the executable-operation detail envelope. |
| `extensions/api-tools/src/graphql.ts` | Modify | Become a thin dispatcher for discover/detail/schema/execute and reject malformed/top-level-error introspection. |
| `extensions/api-tools/src/graphql/discovery.ts` | Create | Validate introspection shape and emit sorted `Query.field`/`Mutation.field` compact records. |
| `extensions/api-tools/src/graphql/detail.ts` | Create | Resolve one canonical root field, arguments/defaults/deprecation/descriptions, bounded return fields, cycles, and available applied authorization metadata. |
| `extensions/api-tools/src/graphql/schema.ts` | Create | Perform explicit selected-type bounded inspection with shared cycle/field-budget behavior. |
| `extensions/api-tools/src/security.ts` | Modify | Add bounded scalar extraction, exact authorization allowlists, provenance helpers, error/path sanitization, and reusable string truncation. |
| `extensions/api-tools/src/client.ts` | Modify | Add typed `ApiClientError.kind`; preserve trust/cancellation controls and expose response evidence for centralized HTTP/GraphQL classification. |
| `extensions/api-tools/src/continuation.ts` | Modify | Persist redacted logical-record documents and page by record index/text frame; preserve ownership, expiry, containment, permissions, replay, and cleanup. |
| `extensions/api-tools/src/render.ts` | Modify | Render v2 action/selector/count/auth/failure/continuation metadata plus current page using native Pi components. |
| `extensions/api-tools/test/tools.test.ts` | Modify | Exact six-tool/action schemas, REST cursor path, contract version, no duplicate details, and cross-tool failure envelope tests. |
| `extensions/api-tools/test/swagger.test.ts` | Modify | Compact discovery; selectors; detail completeness; inheritance; local/external refs; auth provenance; bounds; HTTP failures. |
| `extensions/api-tools/test/graphql.test.ts` | Modify | Compact discovery; malformed/errors; canonical detail; arguments/descriptions; cycles/depth/fields; authorization states; execute failures. |
| `extensions/api-tools/test/continuation.test.ts` | Modify | Logical record and text-frame boundaries, reconstruction, replay, metadata, limits, cursor faults, permissions, cleanup. |
| `extensions/api-tools/test/security.test.ts` | Modify | Allowlists, scalar validation, bounds, provenance, error/path redaction before persistence. |
| `extensions/api-tools/test/client.test.ts` | Modify | Typed configuration/validation/timeout/cancellation causes and retained URL/redirect protections. |
| `extensions/api-tools/test/render.test.ts` | Modify | Collapsed/expanded/partial/failure/detail/auth/continuation v2 states and package independence. |
| `extensions/api-tools/README.md` | Modify | Document contract v2, `detail`, exact inputs/selectors, provenance, failures/codes, bounds, continuation, migration, cancellation, security, rendering, and limits. |

No production file is deleted. `config.ts`, `pi-runtime.ts`, `index.ts`, `package.json`, and `tsconfig.json` are expected read/validation-only unless apply discovers a type-only integration need; any material change to dependencies, configuration keys, trust behavior, or public tool count is outside this design and must block.

## Implementation Map Updates
- `openspec/changes/api-tools-agent-output-contracts/implementation-map.md` updated/read: Yes
- Files promoted from candidates to expected changes: `src/swagger/{discovery,detail,schema}.ts`, `src/graphql/{discovery,detail,schema}.ts`, `src/result-format.ts`, `src/error-classify.ts`; `api_rest_request` continuation work promoted in `src/tools.ts` and existing tests.
- Relevant symbols/interfaces added or refined: `ApiActionDocument`, `ApiLogicalRecord`, `ApiPageDetails`, `ApiFailureEnvelope`, `ApiAuthorizationMetadata`, `ApiClientError.kind`, `ContinuationManager.finalize/continue`, exact Swagger/GraphQL selector resolvers and domain builders.
- Validation map updates: focused Vitest files mapped to active requirements and decisions; full package tests/typecheck; package-independence static checks; secondary live Pi review.
- Conflicts or stale entries: Prior map described `details.data` payloads and serialized-result slicing as the implementation baseline. The refined map replaces those expected contracts with content-only logical pages and record-index continuation; the baseline findings remain historical evidence.

## Interfaces / Contracts
```ts
export const API_CONTRACT_VERSION = 2 as const;

export type ApiFailureCategory =
  | 'http_error' | 'graphql_error' | 'validation_error' | 'provider_error'
  | 'configuration_error' | 'timeout_error' | 'cancellation_error'
  | 'continuation_error' | 'reference_error' | 'authorization_metadata_error'
  | 'unknown_error';

export interface ApiFailureEnvelope {
  category: ApiFailureCategory;
  code: string;                  // <tool>.<action>.<condition>
  message: string;               // safe and concise
  http_status?: number;
  graphql_classification?: string;
  retryable: boolean;
  next_step?: string;
}

export interface ApiAuthorizationMetadata {
  state: 'declared' | 'not_declared' | 'unavailable' | 'unknown';
  sources: Array<'openapi_security' | 'oauth_scope' | 'openapi_vendor' | 'graphql_applied_directive'>;
  schemes?: Array<{ name: string; type: string; scheme?: string; scopes?: string[] }>;
  roles?: string[];
  permissions?: string[];
  authorities?: string[];
  scopes?: string[];
  reason?: string;
  truncated?: boolean;
  unsupported_metadata?: boolean;
}

export interface ApiLogicalRecord {
  id: string;                    // stable within immutable document
  kind: string;                  // operation, parameter, response, field, text_frame, marker...
  text: string;                  // complete bounded agent-facing record
}

export interface ApiActionDocument {
  contract_version: typeof API_CONTRACT_VERSION;
  tool: 'api_rest_request' | 'api_swagger' | 'api_graphql';
  action: string;
  identity?: string;
  status: 'success' | 'failure';
  records: ApiLogicalRecord[];   // stable order, redacted before persistence
  total?: number;
  failure?: ApiFailureEnvelope;
}

export interface ApiContinuationMetadata {
  returned_count: number;
  total?: number;
  has_more: boolean;
  next_cursor?: string;
  follow_up: { tool: string; action: string; cursor_parameter: 'cursor' };
  returned_bytes: number;
  returned_lines: number;
}

export interface ApiResultDetails {
  contract_version: 2;
  status: 'success' | 'failure';
  action: string;
  identity?: string;
  failure?: ApiFailureEnvelope;
  continuation: ApiContinuationMetadata;
  render?: { authorization_state?: ApiAuthorizationMetadata['state']; returned_count?: number };
}
```

`content[0].text` is a valid, self-contained rendering of only the current page. It includes the page's complete records and exact follow-up instruction. Domain objects do not also appear in `details`. For text execution output, each record is an explicit frame with sequence/range metadata; joining frame payloads in order reconstructs the complete redacted text.

## Testing Strategy
| Layer | What to Test | Approach |
|-------|-------------|----------|
| Pure unit | Selector resolution, OpenAPI inheritance/refs, GraphQL type formatting/cycles, allowlists/provenance, bounds, typed error mapping, record framing | Extend the semantically owning Swagger, GraphQL, security, and continuation suites with representative fixtures and meaningful output assertions. |
| Dispatcher/tool contract | Exactly six tools; strict schemas; `detail`; cursor-only branches; contract version 2; compatible failures; no `details` payload duplication | Adapt `tools.test.ts`; inspect registered schemas and execute mocked clients through public tool callbacks. |
| Client boundary | Same-origin/base-path/redirect protection, typed timeout/cancellation/config causes, HTTP evidence | Adapt `client.test.ts` with injected fetch and AbortSignal; retain existing security cases. |
| Continuation integration | Redaction-before-persistence, complete logical pages, byte/line accounting, lossless reconstruction, deterministic replay, ownership/expiry/containment/cleanup | Adapt `continuation.test.ts`; inspect private temp artifacts only inside tests and ensure no path escapes output. |
| Renderer | Native collapsed/expanded/partial/success/failure/detail/auth/continuation and width-safe wrapping | Adapt `render.test.ts` using the existing `Text` seam and Pi key hint; no custom expansion state. |
| Package regression | All existing and new extension behavior | From `extensions/api-tools`: establish baseline, run focused RED/GREEN commands during apply, then `npm test` and `npm run typecheck`. |
| Manual secondary | Real Pi compact rows, expanded current page, visible errors, continuation hint | Live Pi review during verify after executable renderer tests pass; never substitute it for automated evidence. |

Apply must first run the narrow existing owner suites as a safety baseline. Each added/changed behavior requires an expected failing assertion before production changes, followed by focused GREEN and post-refactor reruns. No test framework, dependency, or test-tree migration is authorized.

## Migration / Rollout

No persisted data migration is required. Contract version 2 is an in-place response contract revision: public tool names and existing actions remain, `detail` is added, and no parallel legacy envelope is retained. Existing active continuation cursors are session-bound and incompatible with the new record artifact; reload/restart the Pi session during rollout so old cursors expire and artifacts are cleaned. README migration notes must identify changed discovery, schema output, execution-error, REST continuation, and continuation metadata shapes. Rollback reverts the whole v2 formatter/action refactor and discards active session cursors; shared failure/redaction changes must not be partially rolled back.

## Open Questions
- [ ] Non-blocking runtime evidence: does the target GraphQL backend expose an approved applied-directive payload shape? Until evidenced and explicitly supported without broad probing, standard introspection returns authorization state `unavailable`.
