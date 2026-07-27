# Specification: Agent-efficient API Tools output contracts

## Purpose

This specification normatively defines the contract-version-2 response shape, actions, error envelope, authorization-metadata provenance, structured continuation, and rendering behavior for the API Tools extension. It constrains the implementation of `api_swagger`, `api_graphql`, `api_rest_request`, and their native Pi rendering so that every model-facing response is concise, truthful, bounded, and directly actionable.

The intent is: identify one operation with a single compact discovery page, inspect exactly that executable contract with one `detail` call, keep broad type inspection behind a separate `schema` action, surface only contract-derived authorization metadata with explicit provenance, report every failure with a stable category and actionable next step, and continue large results at logical record boundaries without malformed fragments or duplicated context.

This spec supersedes the output contract of `api-tools-swagger-graphql-contracts` and is the source of truth for all downstream design, tasks, and tests.

## Metadata and PRD Alignment

- Metadata: `openspec/changes/api-tools-agent-output-contracts/metadata.yaml`
- PRD: `openspec/changes/api-tools-agent-output-contracts/prd.md`
- PRD Review: `openspec/changes/api-tools-agent-output-contracts/prd-review.md`
- Proposal: `openspec/changes/api-tools-agent-output-contracts/proposal.md`
- Implementation Map: `openspec/changes/api-tools-agent-output-contracts/implementation-map.md`
- metadata_alignment: `aligned`
- prd_alignment: `aligned`
- spec_alignment: `not-applicable`
- security_alignment: `aligned`
- Metadata/PRD requirements mapped: FR-1 through FR-12 and all acceptance criteria are represented by active requirements below. PRD review warnings (compatibility, quantified bounds, renderer-state checks, GraphQL description default, failure envelope details, vendor-extension set) are resolved in this spec.
- Metadata/PRD gaps/conflicts_detected: None

## Requirements

### Requirement `REQ-01`: Public API contract tool surface

- Revision: `R1`
- Status: active
- supersedes: None
- superseded_by: None

The API Tools extension SHALL expose exactly the six existing public tools: `api_status`, `api_auth_status`, `api_login`, `api_rest_request`, `api_swagger`, and `api_graphql`. The two contract tools, `api_swagger` and `api_graphql`, SHALL each expose the actions `discover`, `detail`, `schema`, and their existing execution action (`request` for Swagger, `execute` for GraphQL). The extension SHALL NOT register a third public detail, continuation, or schema-browsing tool.

#### Scenario `SCN-01-01`: Tool registration is stable

- GIVEN the extension is registered in a Pi session
- WHEN the public tool registry is enumerated
- THEN exactly `api_status`, `api_auth_status`, `api_login`, `api_rest_request`, `api_swagger`, and `api_graphql` are present, and `api_swagger`/`api_graphql` accept `discover`, `detail`, `schema`, and `request`/`execute` respectively.

---

### Requirement `REQ-02`: Compact Swagger discovery

- Revision: `R1`
- Status: active
- supersedes: None
- superseded_by: None

`api_swagger discover` SHALL return a bounded index of operations. Each row SHALL contain only:

- the operation identifier when present (`operationId`);
- the HTTP method and path;
- a compact declared authorization summary.

It SHALL NOT include parameters, request bodies, response schemas, expanded descriptions, component schemas, raw OpenAPI fragments, or duplicated full records. Filtering MAY reduce the index. Oversized indexes SHALL paginate at complete operation-row boundaries.

#### Scenario `SCN-02-01`: Discovery index is compact

- GIVEN a Swagger document with ten operations, each having parameters, request bodies, and response schemas
- WHEN `api_swagger discover` is called with no filter
- THEN the result contains one row per operation, each row showing `operationId`, `method`, `path`, and an authorization summary, and no row contains parameters, schemas, or raw OpenAPI fragments.

#### Scenario `SCN-02-02`: Discovery paginates at row boundaries

- GIVEN a Swagger document with 120 operations
- WHEN `api_swagger discover` is called with the default page size
- THEN the first page contains at most 50 complete rows, `has_more` is true, and the `next_cursor` selects the next operation row without splitting a row across pages.

---

### Requirement `REQ-03`: Compact GraphQL discovery

- Revision: `R1`
- Status: active
- supersedes: None
- superseded_by: None

`api_graphql discover` SHALL return a bounded index of executable root fields. Each row SHALL contain only:

- the canonical selector, such as `Query.getUnreadCount` or `Mutation.createItem`;
- the operation kind (`query` or `mutation`);
- a compact declared authorization summary when available.

It SHALL NOT recursively expand arguments, return types, nested fields, descriptions, or the complete schema. A failed, denied, malformed, or partial introspection response SHALL produce an explicit failure envelope; it SHALL NOT be rendered as an empty successful list.

#### Scenario `SCN-03-01`: GraphQL discovery lists root fields

- GIVEN an introspection response exposing `Query` with three fields and `Mutation` with two fields
- WHEN `api_graphql discover` is called
- THEN the result contains five rows, each showing `Query.fieldName` or `Mutation.fieldName`, the kind, and an authorization summary, and no row contains argument lists, return types, or nested type definitions.

#### Scenario `SCN-03-02`: Introspection failure is a visible error

- GIVEN an introspection response that is invalid JSON or contains top-level errors
- WHEN `api_graphql discover` is called
- THEN the result is a failure envelope with category `graphql_error` or `provider_error`, and the content is not an empty list.

---

### Requirement `REQ-04`: Selected Swagger operation detail

- Revision: `R1`
- Status: active
- supersedes: None
- superseded_by: None

`api_swagger detail` SHALL accept exactly one stable operation selector. It SHALL return the complete executable contract for only that operation, bounded with structured continuation when necessary. The detail SHALL distinguish:

- path, query, header, and cookie parameters;
- required and optional values, types, formats, enums, defaults, and constraints;
- accepted request content types and request-body schema;
- successful and error response status contracts, headers, content types, and body schemas;
- effective authentication/security requirements and referenced security schemes;
- OAuth scopes and safe permission/role/authority vendor metadata when present;
- authorization metadata availability when no such information is published.

Path-level and operation-level parameters/security SHALL follow OpenAPI inheritance and override semantics. Local references (`$ref` pointing to a fragment within the same document) SHALL be resolved safely. Unsupported or external references SHALL be reported explicitly as `unsupported_reference` rather than silently omitted.

#### Scenario `SCN-04-01`: One operation detail contains executable contract

- GIVEN a Swagger document with `POST /items/{id}` having path, query, and body parameters, a 200 response, a 404 response, and a `security` requirement
- WHEN `api_swagger detail` is called with the `operationId` of that operation
- THEN the result contains the method, path, parameter list with location and required flags, request body content types, response statuses with content types, the effective security scheme, and any OAuth scopes.

#### Scenario `SCN-04-02`: Local references are resolved

- GIVEN a Swagger document where a parameter is defined under `#/components/parameters/ItemId` and referenced by `$ref`
- WHEN `api_swagger detail` is called for the operation that uses the reference
- THEN the referenced parameter is expanded inline and included in the parameter list.

#### Scenario `SCN-04-03`: External references are marked unsupported

- GIVEN a Swagger document with a `$ref` pointing to an external URL
- WHEN `api_swagger detail` is called for the operation containing that reference
- THEN the field containing the external reference is replaced with an explicit `unsupported_reference` marker and the remainder of the detail is returned.

---

### Requirement `REQ-05`: Selected GraphQL operation detail

- Revision: `R1`
- Status: active
- supersedes: None
- superseded_by: None

`api_graphql detail` SHALL accept exactly one canonical root-field selector. It SHALL return the complete executable contract for only that field:

- root kind and field name;
- arguments with type, nullability, list shape, default value, description, and deprecation where exposed;
- return type and a bounded useful field contract;
- declared directives, scopes, roles, permissions, or authorities when the server exposes applied metadata;
- authorization metadata availability when standard introspection cannot expose it.

The implementation SHALL handle cycles and enforce depth, field-count, byte, and line limits. It SHALL NOT traverse the whole reachable schema by default.

#### Scenario `SCN-05-01`: GraphQL detail exposes one executable field

- GIVEN an introspection response with `Query.getUnreadCount(id: ID!)` returning `Int`
- WHEN `api_graphql detail` is called with selector `Query.getUnreadCount`
- THEN the result contains the kind `query`, the field name, one argument with type `ID!`, default value if any, return type `Int`, and any applied authorization metadata.

#### Scenario `SCN-05-02`: Bounded depth prevents schema explosion

- GIVEN an introspection response with a recursive type or a deeply nested return type
- WHEN `api_graphql detail` is called with the default depth limit
- THEN the result stops at the configured depth, reports `has_more` and a cursor if more fields remain, and never serializes the entire reachable schema.

#### Scenario `SCN-05-03`: Cycles are detected and terminated

- GIVEN an introspection response where a type references itself through fields
- WHEN `api_graphql detail` is called for a field returning that type
- THEN the cycle is detected, the repeated type is marked as `cycle_reference`, and serialization completes without infinite recursion.

---

### Requirement `REQ-06`: Advanced schema inspection remains separate

- Revision: `R1`
- Status: active
- supersedes: None
- superseded_by: None

`schema` SHALL remain available for intentional advanced type/schema inspection. It SHALL require an explicit selector and a bounded depth. It SHALL NOT be used as the default path for discovering or detailing executable operations, and it SHALL honor the same structured continuation and failure contracts as `discover` and `detail`.

#### Scenario `SCN-06-01`: Schema action requires a selector

- GIVEN a request to `api_swagger schema` without a selector
- WHEN the action is validated
- THEN the call fails with category `validation_error` and a message indicating that a selector is required.

#### Scenario `SCN-06-02`: Schema action returns bounded type information

- GIVEN a request to `api_graphql schema` with selector `Item` and depth 2
- WHEN the action runs
- THEN the result contains only the `Item` type and its fields expanded to depth 2, and no executable operation detail is included.

---

### Requirement `REQ-07`: Contract-derived authorization provenance

- Revision: `R1`
- Status: active
- supersedes: None
- superseded_by: None

Authorization metadata SHALL have one of the following explicit provenance states:

- `declared`: extracted from standard OpenAPI security requirements/schemes, OAuth scopes, safe recognized vendor extensions, or GraphQL applied directives actually returned by the server;
- `not_declared`: the contract was read successfully but publishes no applicable authorization requirement;
- `unavailable`: the protocol or server response does not expose applied authorization metadata;
- `unknown`: the contract could not be read or interpreted reliably.

The extension SHALL NOT infer actual runtime roles or permissions. Standard GraphQL introspection limitations SHALL be visible. Safe recognized OpenAPI vendor keys and GraphQL directive names are bounded by the allowlists in `REQ-SEC-03` and `REQ-SEC-04`. Arbitrary vendor payloads SHALL NOT be returned wholesale.

#### Scenario `SCN-07-01`: Declared OpenAPI security is surfaced

- GIVEN an operation with `security: [{ bearerAuth: [] }]`, scheme `bearerAuth` of type `http` and scheme `bearer`, and an OAuth scope `items:read`
- WHEN `api_swagger detail` is called for that operation
- THEN the authorization metadata has state `declared`, lists the security scheme, and includes the scope `items:read`.

#### Scenario `SCN-07-02`: Missing authorization metadata reports `not_declared`

- GIVEN an operation with no `security` field and no recognized vendor extensions
- WHEN `api_swagger detail` is called for that operation
- THEN the authorization metadata has state `not_declared` and no roles, permissions, scopes, or authorities are invented.

#### Scenario `SCN-07-03`: GraphQL standard introspection reports `unavailable`

- GIVEN a GraphQL endpoint that does not expose applied authorization directives
- WHEN `api_graphql detail` is called for any field
- THEN the authorization metadata has state `unavailable` and the reason states that standard introspection does not expose applied directives.

#### Scenario `SCN-07-04`: Contract read failure reports `unknown`

- GIVEN an OpenAPI document that cannot be parsed or a GraphQL introspection response that is malformed
- WHEN a detail or discovery action is attempted
- THEN the authorization metadata, if included in the failure detail, has state `unknown` and the failure envelope is returned.

---

### Requirement `REQ-08`: Truthful actionable failure envelope

- Revision: `R1`
- Status: active
- supersedes: None
- superseded_by: None

All API Tools SHALL use a compatible failure envelope. Every failure response SHALL include:

- a failure category drawn from the stable set defined in this spec;
- a stable code unique within the category and action;
- a concise safe message;
- the HTTP status or GraphQL error classification when applicable;
- a boolean `retryable` indicating whether retry or user/configuration correction is plausible;
- one actionable `next_step` when known.

HTTP responses `>=400`, GraphQL top-level `errors`, invalid introspection shapes, configuration failures, cancellation, cursor failures, and parsing failures SHALL NOT be rendered as ordinary successes. Large raw error bodies, stack traces, internal artifact paths, credentials, and duplicate provider payloads SHALL be excluded or safely bounded.

The stable failure categories are:

- `http_error`: HTTP response status `>=400` or transport-level HTTP failure.
- `graphql_error`: GraphQL response contains a top-level `errors` array.
- `validation_error`: invalid input, missing selector, malformed schema, or incompatible action argument.
- `provider_error`: provider-side failure not captured by HTTP or GraphQL error structures.
- `configuration_error`: missing or invalid extension configuration or trust-boundary setting.
- `timeout_error`: the request exceeded the configured timeout.
- `cancellation_error`: the request was cancelled through the `AbortSignal`.
- `continuation_error`: invalid, expired, or malformed cursor or pagination failure.
- `reference_error`: unsupported or unresolvable `$ref` or schema reference.
- `authorization_metadata_error`: the authorization metadata could not be extracted safely.
- `unknown_error`: unexpected failure that does not fit the above categories.

#### Scenario `SCN-08-01`: HTTP 500 is a failure

- GIVEN a Swagger request action that receives an HTTP 500 response
- WHEN the result is produced
- THEN the response is a failure envelope with category `http_error`, status `500`, `retryable` true, and `next_step` indicating to check the provider status.

#### Scenario `SCN-08-02`: GraphQL top-level errors are failures

- GIVEN a GraphQL execute action that receives a 200 body with top-level `errors`
- WHEN the result is produced
- THEN the response is a failure envelope with category `graphql_error`, `retryable` false, and `next_step` indicating to inspect the query or server logs.

#### Scenario `SCN-08-03`: Large provider error body is redacted

- GIVEN a provider response body larger than 500 bytes containing internal details
- WHEN the failure envelope is produced
- THEN the body is truncated to at most 500 characters with a truncation marker, credentials are redacted, and internal paths are removed.

---

### Requirement `REQ-09`: Structured lossless continuation

- Revision: `R1`
- Status: active
- supersedes: None
- superseded_by: None

Continuation SHALL operate on complete logical records or explicitly framed text chunks, not arbitrary slices of a serialized tool-result envelope. Every bounded response SHALL expose:

- `returned_count`: the number of items or records in the current page;
- `total`: the total when known;
- `has_more`: boolean;
- an opaque `next_cursor` when more data exists;
- the exact same-tool follow-up action that consumes the cursor.

Pages SHALL be deterministic, valid model-facing structures, and free of skipped or duplicated records. Redaction SHALL occur before persistence or pagination. Cursor ownership, expiry, and containment SHALL remain session-bound and path-free.

#### Scenario `SCN-09-01`: Continuation page contains complete records

- GIVEN a Swagger detail result whose parameters and responses exceed the byte budget
- WHEN the first page is returned
- THEN the page ends after a complete parameter or response record, `has_more` is true, and `next_cursor` references the same detail action.

#### Scenario `SCN-09-02`: Cursor reconstruction is lossless

- GIVEN a continuation cursor produced by a successful bounded action
- WHEN the same tool is called with that cursor
- THEN the next page begins with the record immediately after the last record of the previous page, no records are duplicated, and the union of all pages equals the full redacted result.

---

### Requirement `REQ-10`: No duplicate model context

- Revision: `R1`
- Status: active
- supersedes: None
- superseded_by: None

The tool-result `content` field SHALL contain the concise agent-facing result. The `details` field SHALL contain only structured metadata required for rendering or continuation. The `details` field SHALL NOT duplicate the complete domain payload. Expanded rendering MAY present all content in the current page but SHALL NOT inject hidden full schemas or provider bodies into the model context.

#### Scenario `SCN-10-01`: Details do not duplicate content

- GIVEN a successful `api_swagger detail` result
- WHEN the tool-result envelope is inspected
- THEN the `content` contains the rendered contract and the `details` contains only cursor, version, and rendering hints; the complete payload is not present in both fields.

---

### Requirement `REQ-11`: Base tool output alignment

- Revision: `R1`
- Status: active
- supersedes: None
- superseded_by: None

`api_rest_request` SHALL use the same bounded response and truthful HTTP-error contract as Swagger request execution. `api_status`, `api_auth_status`, `api_login`, and authentication/configuration errors SHALL remain compact, safe, and actionable. Existing secret redaction, token persistence, same-origin/base-path containment, redirect policy, cancellation, and Git-safety behavior SHALL remain intact.

#### Scenario `SCN-11-01`: REST and Swagger request share failure semantics

- GIVEN an `api_rest_request` and a `api_swagger request` that both receive an HTTP 403
- WHEN the results are produced
- THEN both use the same failure envelope structure, category `http_error`, status `403`, and compatible `next_step` text.

---

### Requirement `REQ-12`: Native Pi rendering

- Revision: `R1`
- Status: active
- supersedes: None
- superseded_by: None

Collapsed rows SHALL show: tool, action, status, selected identity or count, continuation state, and a Pi-owned expansion hint. Expanded rows SHALL show the complete current bounded page and actionable error metadata. Rendering SHALL NOT reveal internal paths, bypass redaction, maintain competing expansion state, hard-code a physical key, or cosmetically repair malformed execution results.

#### Scenario `SCN-12-01`: Collapsed row is compact and useful

- GIVEN a successful `api_swagger detail` result
- WHEN the row is collapsed
- THEN the collapsed text shows `api_swagger detail`, the operation selector, status, and a hint that expansion shows the full bounded page.

#### Scenario `SCN-12-02`: Expanded failure shows actionable metadata

- GIVEN a failure envelope with category `graphql_error`
- WHEN the row is expanded
- THEN the expanded view shows the safe message, category, code, and `next_step`, and does not show raw provider body or stack traces.

---

### Requirement `REQ-13`: Quantified bounds

- Revision: `R1`
- Status: active
- supersedes: None
- superseded_by: None

The following bounds SHALL apply unless the active configuration sets a smaller value:

| Resource | Default | Maximum | Applies to |
|---|---|---|---|
| Discovery page size | 50 operations | 100 operations | Swagger and GraphQL `discover` |
| GraphQL detail depth | 3 | 5 | `api_graphql detail` and `schema` |
| GraphQL detail field count | 200 fields per page | 200 fields per page | `api_graphql detail` and `schema` |
| Description/vendor value length | 500 characters | 500 characters | descriptions and any vendor metadata value |
| Vendor metadata values per key | 32 scalar values | 32 scalar values | OpenAPI vendor extension keys and GraphQL directive arguments |
| Vendor metadata value length | 128 characters | 128 characters | each scalar value under vendor metadata |
| Response byte ceiling | 50,000 bytes | 50,000 bytes | all actions |
| Response line ceiling | 2,000 lines | 2,000 lines | all actions |

Continuation SHALL be triggered before either the byte or line ceiling is exceeded. All string truncations SHALL use an explicit truncation marker.

#### Scenario `SCN-13-01`: Default page size is respected

- GIVEN 75 operations in a Swagger document and no explicit page size
- WHEN `api_swagger discover` is called
- THEN the first page contains 50 rows, `has_more` is true, and the action does not exceed the response byte ceiling.

#### Scenario `SCN-13-02`: GraphQL depth default is enforced

- GIVEN a GraphQL type tree deeper than 5 levels
- WHEN `api_graphql detail` is called with no explicit depth
- THEN the default depth of 3 is applied, and fields beyond depth 3 are either omitted or continued with a cursor.

---

### Requirement `REQ-14`: Contract version and compatibility

- Revision: `R1`
- Status: active
- supersedes: None
- superseded_by: None

Every revised tool result SHALL identify response contract version `2`. The README SHALL document the migration from the prior output contract, listing changed discovery, schema, execution-error, and continuation shapes. The extension SHALL NOT maintain parallel legacy and version-2 envelopes for the same action.

#### Scenario `SCN-14-01`: Revised results carry version 2

- GIVEN a successful `api_swagger discover` call
- WHEN the result envelope is inspected
- THEN the `details` contain `contract_version: 2`.

#### Scenario `SCN-14-02`: README documents migration

- GIVEN the extension README
- WHEN the `api_swagger` and `api_graphql` sections are read
- THEN they describe the new `detail` action, the compact discovery output, the failure envelope, and the changed continuation shape.

---

## Security / Privacy Requirements

### Requirement `REQ-SEC-01`: Redaction and secret exclusion

- Revision: `R1`
- Status: active
- supersedes: None
- superseded_by: None

The system SHALL redact secret-like values recursively before returning provider payloads, error details, or continuation artifacts. Credentials, access tokens, internal artifact paths, raw secret-bearing headers, and unrestricted provider payloads SHALL NOT appear in model-facing outputs or renderer details.

#### Abuse / Failure Scenario `SCN-SEC-01-01`: Token in error body is redacted

- GIVEN a provider error body containing a bearer token value
- WHEN the failure envelope is rendered
- THEN the token is replaced by a redaction marker and the redacted value is not recoverable from the model context.

---

### Requirement `REQ-SEC-02`: Reference resolution safety

- Revision: `R1`
- Status: active
- supersedes: None
- superseded_by: None

The system SHALL resolve only local `$ref` fragments within the same OpenAPI document. External references SHALL NOT be fetched automatically. Unsupported references SHALL be reported as `unsupported_reference` without exposing the external URL or path in the model-facing output.

#### Abuse / Failure Scenario `SCN-SEC-02-01`: External URL is not leaked

- GIVEN a Swagger document with an external `$ref` to `https://example.com/schema.json#/Item`
- WHEN `api_swagger detail` encounters the reference
- THEN the field is marked `unsupported_reference` and the external URL is not serialized in the response.

---

### Requirement `REQ-SEC-03`: OpenAPI vendor-extension allowlist

- Revision: `R1`
- Status: active
- supersedes: None
- superseded_by: None

The system SHALL recognize only the following case-insensitive OpenAPI vendor-extension keys for authorization metadata: `x-role`, `x-roles`, `x-required-role`, `x-required-roles`, `x-permission`, `x-permissions`, `x-required-permission`, `x-required-permissions`, `x-authority`, `x-authorities`, `x-required-authority`, `x-required-authorities`, `x-scope`, `x-scopes`, `x-required-scope`, `x-required-scopes`.

For each recognized key, the value SHALL be a scalar string or an array of scalar strings. Objects, arrays of objects, or unrestricted payloads SHALL be rejected and replaced with `unsupported_metadata`. At most 32 scalar values SHALL be returned per key, and each scalar value SHALL be truncated to at most 128 characters.

#### Abuse / Failure Scenario `SCN-SEC-03-01`: Object vendor extension is rejected

- GIVEN an operation with `x-roles: { admin: true, owner: true }`
- WHEN the authorization metadata is extracted
- THEN the `x-roles` entry is replaced with `unsupported_metadata` and no object is returned to the model.

#### Abuse / Failure Scenario `SCN-SEC-03-02`: Large vendor array is bounded

- GIVEN an operation with `x-permissions` containing 200 scalar strings
- WHEN the authorization metadata is extracted
- THEN only the first 32 scalar values are retained, each truncated to 128 characters, and the provenance remains `declared` with a truncation note.

---

### Requirement `REQ-SEC-04`: GraphQL directive allowlist

- Revision: `R1`
- Status: active
- supersedes: None
- superseded_by: None

The system SHALL consume GraphQL applied directive metadata only when the directive name is one of: `role`, `roles`, `permission`, `permissions`, `authority`, `authorities`, `scope`, `scopes`, `auth`, or `authz`. Directive definitions alone SHALL NOT establish authorization; only applied directives returned by the server for the selected field or type SHALL be used. Arguments SHALL be scalar strings or lists of scalar strings. Objects and complex values SHALL be rejected. Standard introspection without applied directive data SHALL report `unavailable`.

#### Abuse / Failure Scenario `SCN-SEC-04-01`: Directive definition without application is ignored

- GIVEN a schema that defines a `role` directive but never applies it to a field
- WHEN `api_graphql detail` is called for that field
- THEN the authorization metadata state is `unavailable`, not `declared`.

#### Abuse / Failure Scenario `SCN-SEC-04-02`: Complex directive argument is rejected

- GIVEN a field with applied directive `authz` whose argument is an input object
- WHEN the authorization metadata is extracted
- THEN the argument is replaced with `unsupported_metadata` and the remainder of the detail is returned.

---

### Requirement `REQ-SEC-05`: Trust boundaries and cancellation

- Revision: `R1`
- Status: active
- supersedes: None
- superseded_by: None

The system SHALL preserve existing same-origin/base-path enforcement, redirect controls, request cancellation, and Git-safety behavior. The `AbortSignal` SHALL be propagated through nested I/O. Cancellation SHALL NOT be converted into an ordinary provider failure.

#### Abuse / Failure Scenario `SCN-SEC-05-01`: Cancellation is reported as cancellation

- GIVEN an in-flight `api_swagger request` that is cancelled by the runtime
- WHEN the tool returns
- THEN the result is a failure envelope with category `cancellation_error`, `retryable` true, and `next_step` indicating the caller may retry.

---

## Supersession Index

| Requirement / decision id | Revision | Status | Supersedes | Superseded by | Reason / date |
|---|---|---|---|---|---|
| `api-tools-swagger-graphql-contracts` output contract | N/A | superseded | N/A | `api-tools-agent-output-contracts` spec R1 | Prior verification invalidated by live runtime evidence; 2026-07-26 |
| `REQ-01` | R1 | active | N/A | N/A | Initial spec |
| `REQ-02` | R1 | active | N/A | N/A | Initial spec |
| `REQ-03` | R1 | active | N/A | N/A | Initial spec |
| `REQ-04` | R1 | active | N/A | N/A | Initial spec |
| `REQ-05` | R1 | active | N/A | N/A | Initial spec |
| `REQ-06` | R1 | active | N/A | N/A | Initial spec |
| `REQ-07` | R1 | active | N/A | N/A | Initial spec |
| `REQ-08` | R1 | active | N/A | N/A | Initial spec |
| `REQ-09` | R1 | active | N/A | N/A | Initial spec |
| `REQ-10` | R1 | active | N/A | N/A | Initial spec |
| `REQ-11` | R1 | active | N/A | N/A | Initial spec |
| `REQ-12` | R1 | active | N/A | N/A | Initial spec |
| `REQ-13` | R1 | active | N/A | N/A | Initial spec |
| `REQ-14` | R1 | active | N/A | N/A | Initial spec |
| `REQ-SEC-01` | R1 | active | N/A | N/A | Initial spec |
| `REQ-SEC-02` | R1 | active | N/A | N/A | Initial spec |
| `REQ-SEC-03` | R1 | active | N/A | N/A | Initial spec |
| `REQ-SEC-04` | R1 | active | N/A | N/A | Initial spec |
| `REQ-SEC-05` | R1 | active | N/A | N/A | Initial spec |

## Acceptance / Testability Summary

| Requirement group | Expected evidence | Detail reference |
|---|---|---|
| Tool surface (REQ-01) | Unit test: `tools.test.ts` asserts exactly six public tools and action schemas | inline |
| Compact discovery (REQ-02, REQ-03) | Unit tests: `swagger.test.ts` and `graphql.test.ts` with large fixtures; assert row contents, absence of expanded schemas, and pagination boundaries | inline |
| Selected detail (REQ-04, REQ-05) | Unit tests: representative OpenAPI and GraphQL fixtures; assert parameters, responses, security, arguments, return types, and bounded depth | inline |
| Schema separation (REQ-06) | Unit test: `schema` action requires selector and returns only type/schema information | inline |
| Authorization provenance (REQ-07, REQ-SEC-03, REQ-SEC-04) | State-machine tests: `declared`, `not_declared`, `unavailable`, `unknown` for both OpenAPI and GraphQL | inline |
| Failure envelope (REQ-08) | Unit tests: mocked HTTP 500, GraphQL errors, invalid introspection, validation, timeout, cancellation; assert envelope fields and redaction | inline |
| Structured continuation (REQ-09) | Unit tests: `continuation.test.ts` logical chunk boundaries, cursor reconstruction, no duplicate records | inline |
| No duplicate context (REQ-10) | Structural test: `content` and `details` do not contain the same complete payload | inline |
| Base tool alignment (REQ-11) | Cross-tool test: `api_rest_request` and `api_swagger request` share failure envelope shape | inline |
| Native rendering (REQ-12) | Renderer tests: `render.test.ts` collapsed/expanded/partial/failure/continuation/detail/auth states | inline |
| Bounds (REQ-13) | Unit tests: default page sizes, depth limits, vendor value counts/lengths, byte/line ceilings | inline |
| Contract version and migration (REQ-14) | Unit test: `contract_version: 2` in result details; README review | inline |
| Security and redaction (REQ-SEC-01 through REQ-SEC-05) | Security tests: `security.test.ts` redaction, vendor allowlists, external reference markers, cancellation classification | inline |
| Full package health | `npm test` and `npm run typecheck` from `extensions/api-tools` | inline |
| Live Pi review | Secondary manual check of compact rows, useful expanded pages, visible errors, and continuation hints | inline |

## Archive Capability Mapping Summary

| Capability | Target capability spec path | Operation | Detail reference |
|---|---|---|---|
| none | N/A | none | No existing `openspec/specs/` capability specifications; this change is scoped to a single extension's output contract and does not introduce a durable cross-extension capability specification. |
