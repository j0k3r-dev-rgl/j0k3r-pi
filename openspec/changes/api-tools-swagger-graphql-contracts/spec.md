# Specification: Conditional API Tools, Rendering, and Lossless Output Contracts

## Purpose

Define the normative replacement of the three legacy GraphQL tools (`api_graphql_query`, `api_graphql_schema_queries`, `api_graphql_schema_query`) with exactly two independently enabled, opt-in API-contract tools (`api_swagger` and `api_graphql`). Preserve `api_auth_status`, `api_login`, and `api_rest_request` unchanged, and preserve `api_status` except for the explicit security-driven removal of public endpoint URL disclosure plus safe additive integration state. Add explicit `swagger` and `graphql` configuration blocks, session-bound lossless bounded output, and native Pi collapsed/expanded tool-row rendering. Keep the configured REST origin and base path as the sole trust boundary for external calls; add no runtime or development dependency.

## Metadata and PRD Alignment

- Metadata: `openspec/changes/api-tools-swagger-graphql-contracts/metadata.yaml`
- PRD: `openspec/changes/api-tools-swagger-graphql-contracts/prd.md` — None (metadata marks `prd_policy: waived`).
- metadata_alignment: `aligned`
- prd_alignment: `not-applicable`
- spec_alignment: `not-applicable` (this artifact is the spec output)
- security_alignment: `aligned`
- Metadata/PRD requirements mapped:
  - Exactly two independent replacement tools → `REQ-TOOL-001`, `REQ-TOOL-002`, `REQ-TOOL-003`.
  - Independent `swagger`/`graphql` configuration blocks with `enabled`/`framework`/`url` → `REQ-CFG-001` through `REQ-CFG-004`.
  - Swagger URL precedence and Spring/Node contracts → `REQ-URL-001` through `REQ-URL-004`.
  - GraphQL URL precedence and legacy `graphql_url` fallback → `REQ-URL-005` through `REQ-URL-007`.
  - Same-origin/base-path URL hardening for Swagger and GraphQL → `REQ-SEC-001` through `REQ-SEC-009`.
  - `api_swagger` actions `discover`/`schema`/`request` → `REQ-TOOL-004` through `REQ-TOOL-006`.
  - `api_graphql` actions `discover`/`schema`/`execute` → `REQ-TOOL-007` through `REQ-TOOL-009`.
  - Same-tool cursor continuation without a third tool → `REQ-OUT-001` through `REQ-OUT-005`.
  - Bounded output and redaction before persistence → `REQ-OUT-001`, `REQ-OUT-002`, `REQ-SEC-010`, `REQ-SEC-011`.
  - Native collapsed/expanded rendering, Pi-owned expansion state → `REQ-REN-001` through `REQ-REN-004`.
  - Safe additive `api_status` fields → `REQ-STS-001` through `REQ-STS-003`.
  - Legacy tool removal, unchanged retained tools, and the `api_status` URL-disclosure security exception → `REQ-TOOL-001`, `REQ-TOOL-010`, `REQ-TOOL-011`, `REQ-STS-001` through `REQ-STS-003`.
  - No new dependency, no OpenAPI YAML, no cross-session continuation, no OpenAPI `servers` routing, no third tool → `REQ-OUT-003`, `REQ-URL-003`, `REQ-TOOL-012`, `REQ-TOOL-013`.
- Metadata/PRD gaps/conflicts_detected: Removed the dangling reference to a non-existent eighth URL-requirement identifier from the alignment mapping; GraphQL URL precedence and fallback are fully covered by `REQ-URL-005` through `REQ-URL-007`. User-approved status remediation resolves the design-discovered `api_status` conflict by making URL-field removal an explicit security-driven exception to retained behavior. No other conflicts.

## Requirements

### Configuration

#### Requirement `REQ-CFG-001`: Explicit swagger and graphql configuration blocks
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

The configuration parser SHALL accept optional top-level `swagger` and `graphql` objects in the API tools configuration file. Each block, when present, SHALL contain at least `enabled: boolean`.

#### Scenario `SCN-CFG-001`: Missing blocks leave legacy tools removed
- GIVEN neither `swagger` nor `graphql` is present in the configuration
- WHEN the extension loads
- THEN `api_swagger` and `api_graphql` SHALL NOT be registered
- AND the three legacy GraphQL tools SHALL NOT be registered.

#### Scenario `SCN-CFG-002`: Disabled blocks do not register tools
- GIVEN a `swagger` block with `enabled: false` and a `graphql` block with `enabled: false`
- WHEN the extension loads
- THEN `api_swagger` and `api_graphql` SHALL NOT be registered.

#### Requirement `REQ-CFG-002`: Framework required when enabled
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

When a block has `enabled: true`, the `framework` field SHALL be present and SHALL be exactly one of `spring` or `node`. Any other value, or a missing `framework` when `enabled: true`, SHALL be reported as a recoverable configuration error.

#### Scenario `SCN-CFG-003`: Enabled block without framework is rejected
- GIVEN a `swagger` block with `enabled: true` and no `framework`
- WHEN the extension loads
- THEN `api_swagger` SHALL NOT be registered
- AND `api_status` SHALL report a `swagger` object containing `enabled: true` and `framework: undefined` or a recoverable error marker, without exposing the reason as a secret or path.

#### Scenario `SCN-CFG-004`: Unsupported framework value is rejected
- GIVEN a `graphql` block with `enabled: true` and `framework: "dotnet"`
- WHEN the extension loads
- THEN `api_graphql` SHALL NOT be registered
- AND the error code and message SHALL be deterministic and safe for model output.

#### Requirement `REQ-CFG-003`: Optional per-block URL
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

Each block MAY contain an optional `url: string`. When present, it SHALL be validated as a hardened HTTP(S) URL before use. The URL is the highest-precedence source for the effective endpoint of that integration.

#### Scenario `SCN-CFG-005`: Block URL with unsafe scheme is rejected
- GIVEN a `swagger` block with `enabled: true`, `framework: "node"`, and `url: "file:///etc/passwd"`
- WHEN the extension loads or the tool is invoked
- THEN the effective URL SHALL be rejected
- AND the resulting error SHALL be recoverable and SHALL NOT expose internal paths.

#### Requirement `REQ-CFG-004`: graphql_url remains a fallback, not an enablement trigger
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

The legacy top-level `graphql_url` field SHALL NOT cause `api_graphql` to be registered. It SHALL be considered only as the second-priority GraphQL URL source when `graphql.enabled === true` and `graphql.url` is absent.

#### Scenario `SCN-CFG-006`: graphql_url alone does not enable GraphQL
- GIVEN a configuration with `graphql_url: "https://example.com/gql"` and no `graphql` block
- WHEN the extension loads
- THEN `api_graphql` SHALL NOT be registered
- AND `api_swagger` SHALL NOT be registered unless a `swagger` block enables it.

### URL Precedence and Endpoint Hardening

#### Requirement `REQ-URL-001`: Swagger URL precedence
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

The effective Swagger document URL SHALL be determined by this exact precedence:
1. `swagger.url` when present and validated.
2. For `framework: "spring"` only: `/v3/api-docs` resolved beneath the configured REST base URL.
3. If the `/v3/api-docs` request is missing, non-success, returns non-JSON, or an invalid OpenAPI/Swagger document, then exactly one fallback to `/v2/api-docs` resolved beneath the same base URL.
4. For `framework: "node"`: if `swagger.url` is absent, the extension SHALL return a recoverable configuration error; it SHALL NOT perform any route scan.

#### Scenario `SCN-URL-001`: Node without explicit URL returns configuration error
- GIVEN a `swagger` block with `enabled: true`, `framework: "node"`, and no `url`
- WHEN `api_swagger` `discover` is invoked
- THEN the result SHALL be a recoverable error with a deterministic code
- AND the error SHALL NOT contain a URL, path, or credential.

#### Scenario `SCN-URL-002`: Spring v3 success skips v2 fallback
- GIVEN a `swagger` block with `enabled: true`, `framework: "spring"`, no `url`, and a valid `/v3/api-docs` JSON document
- WHEN `api_swagger` `discover` is invoked
- THEN the document SHALL be fetched from `/v3/api-docs`
- AND the `/v2/api-docs` fallback SHALL NOT be attempted.

#### Scenario `SCN-URL-003`: Spring v3 failure triggers exactly one v2 fallback
- GIVEN a `swagger` block with `enabled: true`, `framework: "spring"`, no `url`, a 404 from `/v3/api-docs`, and a valid `/v2/api-docs` document
- WHEN `api_swagger` `discover` is invoked
- THEN `/v3/api-docs` SHALL be requested first
- AND `/v2/api-docs` SHALL be requested exactly once
- AND the valid v2 document SHALL be used.

#### Scenario `SCN-URL-004`: Spring v3 and v2 both fail returns recoverable error
- GIVEN a `swagger` block with `enabled: true`, `framework: "spring"`, no `url`, and non-success responses from both `/v3/api-docs` and `/v2/api-docs`
- WHEN `api_swagger` `discover` is invoked
- THEN the result SHALL be a recoverable error with a deterministic code
- AND the error SHALL NOT include raw response bodies or internal paths.

#### Requirement `REQ-URL-002`: Swagger document validation
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

A fetched Swagger document SHALL be accepted only if it is valid JSON and contains a recognizable Swagger/OpenAPI marker (`swagger` or `openapi` field). A document that fails this check SHALL be treated as a missing/invalid document for the purpose of the v2 fallback and SHALL result in a recoverable error when no fallback succeeds.

#### Scenario `SCN-URL-005`: Non-OpenAPI JSON document does not pass as Swagger
- GIVEN a `swagger` block with `enabled: true`, `framework: "spring"`, and `/v3/api-docs` returning `{ "foo": "bar" }`
- WHEN `api_swagger` `discover` is invoked
- THEN the v2 fallback MAY be attempted
- AND if the fallback also returns non-Swagger JSON, the result SHALL be a recoverable configuration error.

#### Requirement `REQ-URL-003`: Swagger execution ignores OpenAPI servers
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

For `api_swagger` `request`, the effective request URL SHALL be constructed from the configured REST origin and base path plus the caller-supplied relative path. The extension SHALL ignore any `servers` array present in the OpenAPI document.

#### Scenario `SCN-URL-006`: Swagger request stays on configured origin
- GIVEN a Swagger document containing `servers: [{ "url": "https://external.example.com" }]`
- AND a `request` action with `path: "/users"` and `method: "GET"`
- WHEN the request is executed
- THEN the request SHALL be sent to the configured REST origin/base path
- AND the external server URL SHALL NOT be used.

#### Requirement `REQ-URL-004`: Swagger and GraphQL URL hardening
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

Every effective Swagger and GraphQL URL SHALL be an HTTP(S) URL, SHALL be same-origin with the configured REST origin, SHALL remain within the configured REST base path, SHALL NOT contain URL userinfo, SHALL NOT contain path traversal (`..`), SHALL NOT contain control characters, and SHALL follow the existing redirect policy. The same validation set that applies to `api_rest_request` URLs SHALL apply to Swagger-document URLs, Swagger-request paths, and GraphQL endpoint URLs.

#### Scenario `SCN-URL-007`: URL with userinfo is rejected
- GIVEN a `swagger.url` value of `"https://user:pass@host.example.com/v3/api-docs"`
- WHEN the URL is validated
- THEN the URL SHALL be rejected
- AND the error SHALL be recoverable and SHALL NOT contain the credential substring.

#### Scenario `SCN-URL-008`: GraphQL path traversal is rejected
- GIVEN a `graphql.url` value resolving to `"https://host.example.com/api/../internal/gql"`
- WHEN the URL is validated
- THEN the effective URL SHALL be rejected
- AND the error SHALL be recoverable and SHALL NOT expose the internal path.

#### Scenario `SCN-URL-009`: GraphQL absolute URL outside base path is rejected
- GIVEN a `graphql` block with `enabled: true`, `framework: "spring"`, and `url: "/other/gql"` where `/other` is outside the configured REST base path
- WHEN the URL is validated
- THEN the URL SHALL be rejected
- AND the result SHALL be a recoverable error.

#### Requirement `REQ-URL-005`: GraphQL URL precedence
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

The effective GraphQL endpoint URL SHALL be determined by this exact precedence:
1. `graphql.url` when present and validated.
2. The legacy `graphql_url` value when `graphql.enabled === true` and `graphql.url` is absent.
3. `/graphql` resolved beneath the configured REST base URL.
4. If no valid REST base exists, the extension SHALL return a recoverable configuration error.

#### Scenario `SCN-URL-010`: GraphQL explicit URL takes precedence
- GIVEN a `graphql` block with `enabled: true`, `framework: "node"`, `url: "https://host.example.com/api/gql"`, and a legacy `graphql_url: "https://host.example.com/legacy"`
- WHEN `api_graphql` `execute` is invoked
- THEN the request SHALL be sent to `/api/gql`
- AND the legacy URL SHALL NOT be used.

#### Scenario `SCN-URL-011`: GraphQL legacy fallback used when block URL absent
- GIVEN a `graphql` block with `enabled: true`, `framework: "spring"`, no `url`, and `graphql_url: "https://host.example.com/gql"`
- WHEN `api_graphql` `execute` is invoked
- THEN the request SHALL be sent to `/gql` resolved beneath the REST base path
- AND the default `/graphql` path SHALL NOT be used.

#### Scenario `SCN-URL-012`: GraphQL default path when no explicit URL
- GIVEN a `graphql` block with `enabled: true`, `framework: "spring"`, no `url`, and no `graphql_url`
- WHEN `api_graphql` `execute` is invoked
- THEN the request SHALL be sent to `/graphql` resolved beneath the REST base path.

#### Requirement `REQ-URL-006`: GraphQL URL hardening applies to all precedence sources
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

The hardening rules in `REQ-URL-004` SHALL apply to the `graphql.url` value, the legacy `graphql_url` value, and the default `/graphql` resolved path.

#### Requirement `REQ-URL-007`: Redirect continuity
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

Redirects for Swagger-document fetch, Swagger-request execution, and GraphQL execution SHALL follow the same policy as `api_rest_request`. Redirects that would leave the same-origin/base-path boundary SHALL be rejected.

#### Scenario `SCN-URL-013`: Cross-origin redirect during GraphQL execute is rejected
- GIVEN a GraphQL request that receives a 302 redirect to `https://external.example.com/`
- WHEN the redirect is followed
- THEN the redirect SHALL be rejected before the cross-origin request is made
- AND the result SHALL be a recoverable error.

### Public Input Schemas

#### Requirement `REQ-SCH-001`: Strict TypeBox-compatible tool input schemas
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

Both `api_swagger` and `api_graphql` SHALL expose TypeBox-compatible JSON Schema input objects. Each action branch SHALL set `additionalProperties: false` so that unknown inputs are rejected. Each schema SHALL require `action` as a string enum of the actions defined for that tool. Each schema SHALL accept an optional `cursor: string`. The runtime SHALL reject inputs that fail schema validation with a recoverable typed error whose `code` is `validation_error`.

##### Scenario `SCN-SCH-001`: Unknown property rejected
- GIVEN an `api_swagger` invocation with `action: "discover"` and `foo: "bar"`
- WHEN the input is validated
- THEN the invocation SHALL be rejected
- AND the error code SHALL be `validation_error`.

##### Scenario `SCN-SCH-002`: Missing action rejected
- GIVEN an `api_graphql` invocation with no `action`
- WHEN the input is validated
- THEN the invocation SHALL be rejected
- AND the error SHALL be recoverable.

#### Requirement `REQ-SCH-002`: Exact `api_swagger` input schema
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

`api_swagger` SHALL accept exactly these action branches, each with `additionalProperties: false`:

- `action: "discover"` — optional `tag: string`, optional `operation: string`.
- `action: "schema"` — required `operation: string`, optional `max_depth: number` bounded by a safe inclusive maximum (e.g., `6`).
- `action: "request"` — required `method` as one of `["GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"]`, required `path: string`, optional `headers: object` with string values, optional `body: string`, optional `use_token: boolean`.

The optional `cursor: string` SHALL be permitted at the top level for all actions. When `cursor` is absent, the action branch fields above apply normally. When `cursor` is present, continuation mode SHALL use the stricter rule in `REQ-OUT-008`: only `action`, `cursor`, and explicitly documented display-only fields are permitted; action branch inputs such as filters, operation selectors, request fields, schema-depth fields, and execution inputs SHALL be rejected.

##### Scenario `SCN-SCH-003`: Discover with tag filter accepted
- GIVEN `action: "discover"` and `tag: "users"`
- WHEN the input is validated
- THEN the input SHALL be accepted.

##### Scenario `SCN-SCH-004`: Schema without operation rejected
- GIVEN `action: "schema"` and no `operation`
- WHEN the input is validated
- THEN the invocation SHALL be rejected.

##### Scenario `SCN-SCH-005`: Request with unsupported method rejected
- GIVEN `action: "request"`, `method: "TRACE"`, and `path: "/users"`
- WHEN the input is validated
- THEN the invocation SHALL be rejected.

#### Requirement `REQ-SCH-003`: Exact `api_graphql` input schema
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

`api_graphql` SHALL accept exactly these action branches, each with `additionalProperties: false`:

- `action: "discover"` — optional `filter: string`.
- `action: "schema"` — required `name: string`, optional `max_depth: number` bounded by a safe inclusive maximum (e.g., `6`).
- `action: "execute"` — required `query: string`, optional `variables: object`, optional `operationName: string`, optional `headers: object` with string values, optional `use_token: boolean`.

The optional `cursor: string` SHALL be permitted at the top level for all actions. When `cursor` is absent, the action branch fields above apply normally. When `cursor` is present, continuation mode SHALL use the stricter rule in `REQ-OUT-008`: only `action`, `cursor`, and explicitly documented display-only fields are permitted; action branch inputs such as filters, operation selectors, request fields, schema-depth fields, and execution inputs SHALL be rejected.

##### Scenario `SCN-SCH-006`: Execute with query accepted
- GIVEN `action: "execute"` and `query: "query { users { id } }"`
- WHEN the input is validated
- THEN the input SHALL be accepted.

##### Scenario `SCN-SCH-007`: Schema without name rejected
- GIVEN `action: "schema"` and no `name`
- WHEN the input is validated
- THEN the invocation SHALL be rejected.

##### Scenario `SCN-SCH-008`: Discover with unknown property rejected
- GIVEN `action: "discover"` and `unknown: true`
- WHEN the input is validated
- THEN the invocation SHALL be rejected.

### Tool Registration and Action Contracts

#### Requirement `REQ-TOOL-001`: Exactly two independently enabled replacement tools
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

The extension SHALL register `api_swagger` only when the `swagger` block is present and `swagger.enabled === true`. The extension SHALL register `api_graphql` only when the `graphql` block is present and `graphql.enabled === true`. Registration decisions SHALL be independent.

#### Scenario `SCN-TOOL-001`: Only swagger enabled
- GIVEN a `swagger` block with `enabled: true` and no `graphql` block
- WHEN the extension loads
- THEN `api_swagger` SHALL be registered
- AND `api_graphql` SHALL NOT be registered
- AND the three legacy GraphQL tools SHALL NOT be registered.

#### Scenario `SCN-TOOL-002`: Only graphql enabled
- GIVEN a `graphql` block with `enabled: true` and no `swagger` block
- WHEN the extension loads
- THEN `api_graphql` SHALL be registered
- AND `api_swagger` SHALL NOT be registered
- AND the three legacy GraphQL tools SHALL NOT be registered.

#### Scenario `SCN-TOOL-003`: Both enabled independently
- GIVEN a `swagger` block with `enabled: true` and a `graphql` block with `enabled: true`
- WHEN the extension loads
- THEN both tools SHALL be registered
- AND neither registration SHALL depend on the other block being valid beyond its own `enabled`/`framework` checks.

#### Requirement `REQ-TOOL-002`: Action input required
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

Both `api_swagger` and `api_graphql` SHALL require an `action` input. The set of valid values SHALL be exactly the actions defined for each tool.

#### Requirement `REQ-TOOL-003`: No third public tool
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

Continuation SHALL be implemented through an optional `cursor` input on the same tool (`api_swagger` or `api_graphql`). No additional public tool, such as an artifact-retrieval tool, SHALL be registered for this purpose.

#### Scenario `SCN-TOOL-004`: Third retrieval tool is absent
- GIVEN the extension is loaded with both tools enabled
- WHEN the tool list is inspected
- THEN exactly `api_status`, `api_auth_status`, `api_login`, `api_rest_request`, `api_swagger`, and `api_graphql` MAY be present
- AND no `api_artifact_retrieve`, `api_cursor_resolve`, or equivalent tool SHALL be present.

#### Requirement `REQ-TOOL-004`: api_swagger action discover
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

`api_swagger` SHALL support `action: "discover"`. It SHALL fetch the effective Swagger document according to `REQ-URL-001`, validate it, and return a bounded summary of document identity, tags, and operations. Optional `tag` and `operation` filters MAY reduce the returned summary.

#### Scenario `SCN-TOOL-005`: Swagger discover returns bounded summary
- GIVEN a valid OpenAPI document at the effective URL
- WHEN `api_swagger` `discover` is invoked with no filter
- THEN the result SHALL contain `title`, `version`, `tags` (names only), and `operations` (method/path/summary/id)
- AND the output SHALL fit the configured byte/line budget.

#### Scenario `SCN-TOOL-006`: Swagger discover with tag filter
- GIVEN a valid OpenAPI document with operations grouped under `users` and `orders`
- WHEN `api_swagger` `discover` is invoked with `tag: "users"`
- THEN only operations whose tags include `users` SHALL be listed.

#### Requirement `REQ-TOOL-005`: api_swagger action schema
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

`api_swagger` SHALL support `action: "schema"`. It SHALL require an `operation` identifier and return the bounded schema/contract for that operation. It SHALL accept an optional `max_depth` with a safe upper bound to limit nested expansion.

#### Scenario `SCN-TOOL-007`: Swagger schema returns operation contract
- GIVEN a valid OpenAPI document and an operation identifier `"getUserById"`
- WHEN `api_swagger` `schema` is invoked with `operation: "getUserById"`
- THEN the result SHALL contain the operation's method, path, parameters, request body reference, and response schemas
- AND the output SHALL fit the configured budget or return a bounded first chunk with continuation.

#### Scenario `SCN-TOOL-008`: Swagger schema max_depth bounded
- GIVEN a deeply nested schema
- WHEN `api_swagger` `schema` is invoked with `max_depth: 2`
- THEN the schema expansion SHALL stop at depth 2
- AND the result SHALL indicate that deeper fields are truncated.

#### Requirement `REQ-TOOL-006`: api_swagger action request
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

`api_swagger` SHALL support `action: "request"`. It SHALL require `method` and `path` and execute an HTTP request against the configured REST origin. It SHALL accept optional safe headers, body, and token options consistent with `api_rest_request`. The full path SHALL be hardened according to `REQ-URL-004`.

#### Scenario `SCN-TOOL-009`: Swagger request executes relative path
- GIVEN `action: "request"`, `method: "POST"`, `path: "/users"`, and a valid JSON body
- WHEN the request is executed
- THEN the HTTP request SHALL be sent to the configured REST origin + base path + `/users`
- AND the response SHALL be redacted and bounded according to the output contract.

#### Scenario `SCN-TOOL-010`: Swagger request rejects absolute path
- GIVEN `action: "request"`, `method: "GET"`, `path: "https://external.example.com/users"`
- WHEN the request is validated
- THEN the path SHALL be rejected
- AND the result SHALL be a recoverable error.

#### Requirement `REQ-TOOL-007`: api_graphql action discover
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

`api_graphql` SHALL support `action: "discover"`. It SHALL introspect the hardened GraphQL endpoint and return a bounded overview of available query and mutation operation names and their types. Optional filters MAY reduce output.

#### Scenario `SCN-TOOL-011`: GraphQL discover returns bounded operation list
- GIVEN a valid GraphQL introspection response
- WHEN `api_graphql` `discover` is invoked
- THEN the result SHALL contain operation names and types (`query`/`mutation`) only
- AND the output SHALL fit the configured budget.

#### Requirement `REQ-TOOL-008`: api_graphql action schema
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

`api_graphql` SHALL support `action: "schema"`. It SHALL require a `name` (type or operation name) and return the bounded GraphQL schema contract for that name. It SHALL accept an optional bounded `max_depth`.

#### Scenario `SCN-TOOL-012`: GraphQL schema returns type contract
- GIVEN a GraphQL schema with a type `User`
- WHEN `api_graphql` `schema` is invoked with `name: "User"`
- THEN the result SHALL contain the fields, types, and relationships of `User` bounded by the configured budget or `max_depth`.

#### Requirement `REQ-TOOL-009`: api_graphql action execute
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

`api_graphql` SHALL support `action: "execute"`. It SHALL require `query` and execute the query against the hardened GraphQL endpoint. It SHALL accept optional `variables`, `operationName`, safe headers, and token options.

#### Scenario `SCN-TOOL-013`: GraphQL execute submits query
- GIVEN `action: "execute"`, `query: "query { users { id } }"`, and no variables
- WHEN the request is executed
- THEN the GraphQL request SHALL be sent to the hardened endpoint
- AND the response SHALL be redacted and bounded.

#### Scenario `SCN-TOOL-014`: GraphQL execute with variables and operation name
- GIVEN `action: "execute"`, `query: "query GetUser($id: ID!) { user(id: $id) { name } }"`, `variables: { id: "1" }`, and `operationName: "GetUser"`
- WHEN the request is executed
- THEN the GraphQL request SHALL include the variables and operation name
- AND the response SHALL be redacted and bounded.

#### Requirement `REQ-TOOL-010`: Remove legacy GraphQL tools
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

The extension SHALL NOT register `api_graphql_query`, `api_graphql_schema_queries`, or `api_graphql_schema_query` under any configuration.

#### Scenario `SCN-TOOL-015`: Legacy tools are absent
- GIVEN any configuration
- WHEN the extension loads
- THEN the three legacy GraphQL tools SHALL NOT be registered.

#### Requirement `REQ-TOOL-011`: Retained tools unchanged
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

`api_auth_status`, `api_login`, and `api_rest_request` SHALL retain their existing public behavior, schemas, and side effects. `api_status` SHALL retain its existing non-secret, non-URL public behavior, schema shape, and side effects except for two intentional status changes: the safe additive integration state defined in `REQ-STS-001`, and the security-driven removal of endpoint URL disclosure defined in `REQ-STS-002` and `REQ-STS-003`. The removed status fields include `endpoints.rest_url`, `endpoints.graphql_url`, and any equivalent effective URL, configured origin, base path, or integration endpoint string.

#### Scenario `SCN-TOOL-016`: api_rest_request behavior unchanged
- GIVEN a configuration with `api_rest_request` already working
- WHEN the extension loads with the new conditional tools enabled
- THEN `api_rest_request` SHALL continue to accept the same inputs and produce the same observable outputs for equivalent requests.

#### Requirement `REQ-TOOL-012`: No arbitrary endpoint scan
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

The extension SHALL NOT perform arbitrary endpoint scanning, route guessing, or server enumeration beyond the explicit URL precedence in `REQ-URL-001` and `REQ-URL-005`.

#### Scenario `SCN-TOOL-017`: No hidden route enumeration
- GIVEN a `swagger` block with `framework: "node"` and no `url`
- WHEN `api_swagger` is invoked
- THEN the extension SHALL NOT attempt to discover `/api-docs`, `/swagger.json`, `/openapi.json`, or any other default path.

#### Requirement `REQ-TOOL-013`: No new dependency
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

The change SHALL NOT add any runtime or development dependency to the package. The extension SHALL use only the installed Pi extension APIs, Node standard-library filesystem/temporary-directory/cryptographic-randomness APIs, and existing package dependencies.

### Output, Continuation, and Boundedness

#### Requirement `REQ-OUT-001`: Complete fitting results returned directly
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

When a tool result fits within the configured byte and line budgets, the extension SHALL return the complete redacted result directly in the tool response, with `has_more: false` and no cursor.

#### Scenario `SCN-OUT-001`: Small result returned complete
- GIVEN a Swagger discover result of 200 lines and 8 KB
- AND configured budgets of at least 10 KB and 500 lines
- WHEN the tool completes
- THEN the result SHALL contain the full redacted response
- AND `has_more` SHALL be false
- AND `next_cursor` SHALL be absent.

#### Requirement `REQ-OUT-002`: Oversized results redacted and serialized once
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

When a tool result exceeds the configured budgets, the extension SHALL:
1. Recursively redact the complete result.
2. Serialize the redacted result once to an immutable artifact beneath an extension-owned unguessable temporary directory.
3. Return a bounded first chunk of the redacted result.
4. Return safe continuation metadata: `has_more: true`, returned range/count, total count when known, and an opaque random `next_cursor`.

#### Scenario `SCN-OUT-002`: Oversized result yields first chunk and cursor
- GIVEN a Swagger schema result of 1000 lines and 100 KB
- AND configured budgets of 10 KB and 100 lines
- WHEN the tool completes
- THEN the result SHALL contain the first bounded chunk
- AND `has_more` SHALL be true
- AND `next_cursor` SHALL be a non-empty opaque string
- AND no `artifact_path` SHALL be present in content, details, error, or cursor.

#### Requirement `REQ-OUT-003`: Cursor is same-tool and same-action
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

A cursor SHALL be bound to the active Pi session, the originating tool (`api_swagger` or `api_graphql`), and the originating action. A tool invocation with a `cursor` SHALL read the next chunk of the original result without repeating the network request. The action in the cursor SHALL match the action provided in the input.

#### Scenario `SCN-OUT-003`: Cursor continuation returns next chunk
- GIVEN a prior `api_swagger` `discover` result with `has_more: true` and a valid `next_cursor`
- WHEN `api_swagger` is invoked with `cursor: next_cursor` and `action: "discover"`
- THEN the next bounded chunk of the same redacted result SHALL be returned
- AND no network request SHALL be repeated.

#### Scenario `SCN-OUT-004`: Mismatched action rejected
- GIVEN a cursor created by `api_swagger` `discover`
- WHEN `api_swagger` is invoked with that cursor and `action: "schema"`
- THEN the result SHALL be a recoverable typed error with a deterministic code
- AND the internal artifact SHALL NOT be accessed.

#### Scenario `SCN-OUT-005`: Mismatched tool rejected
- GIVEN a cursor created by `api_swagger` `discover`
- WHEN `api_graphql` is invoked with that cursor
- THEN the result SHALL be a recoverable typed error with a deterministic code
- AND the internal artifact SHALL NOT be accessed.

#### Requirement `REQ-OUT-004`: Execution inputs rejected with cursor
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

When a cursor is provided, the tool SHALL reject any execution-specific inputs such as `query`, `variables`, `method`, `path`, `body`, or `operation` that would alter the original result. Only the `cursor`, `action`, and safe display options (if any) are allowed during continuation.

#### Scenario `SCN-OUT-006`: Query with GraphQL cursor is rejected
- GIVEN a cursor from `api_graphql` `execute`
- WHEN `api_graphql` is invoked with that cursor and also `query: "query { other }"`
- THEN the result SHALL be a recoverable typed error
- AND the original artifact SHALL be read only at the cursor offset.

#### Requirement `REQ-OUT-005`: Cursor invalidation
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

Cursors SHALL expire after a bounded lifetime. Cursors from a prior session, a reload, or a restart SHALL be invalid. Invalid, expired, wrong-tool, wrong-action, or malformed cursors SHALL return a recoverable typed error without exposing internal artifact paths or state.

#### Scenario `SCN-OUT-007`: Expired cursor returns typed error
- GIVEN a cursor that has exceeded its TTL
- WHEN the tool is invoked with that cursor
- THEN the result SHALL be a recoverable error with code `cursor_expired` or equivalent
- AND the error SHALL NOT contain the internal artifact path.

#### Scenario `SCN-OUT-008`: Cursor invalid after reload
- GIVEN a cursor created before the extension reloaded
- WHEN the tool is invoked with that cursor after reload
- THEN the result SHALL be a recoverable error with code `cursor_invalid` or equivalent
- AND the error SHALL NOT contain the internal artifact path.

#### Requirement `REQ-OUT-006`: Deterministic chunk boundaries
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

Chunk boundaries SHALL be deterministic and based on byte or line offsets into the immutable redacted artifact. Re-invoking the same tool with the same cursor SHALL return the same chunk. Continuation SHALL NOT skip, duplicate, or reorder items.

#### Scenario `SCN-OUT-009`: Continuation reconstructs full result
- GIVEN an oversized result chunked into four chunks
- WHEN the model invokes the cursor chain through all four chunks
- THEN the concatenation of the chunks SHALL equal the full redacted artifact
- AND no item SHALL be duplicated or omitted.

#### Requirement `REQ-OUT-007`: No public artifact path
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

No public `content`, `details`, error, renderer output, or cursor payload SHALL contain `artifact_path` or any internal filesystem path.

#### Scenario `SCN-OUT-010`: No path leakage in oversized result
- GIVEN an oversized result written to an internal artifact
- WHEN the tool response and renderer output are inspected
- THEN no field SHALL contain a path string matching the artifact directory
- AND the cursor payload SHALL be opaque and path-free.

#### Requirement `REQ-OUT-008`: Cursor mode rejects execution-specific inputs
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

When `cursor` is provided, the tool SHALL reject any input field that could change the original result or select a different action branch. Prohibited fields include `tag`, `operation`, `max_depth`, `name`, `query`, `variables`, `operationName`, `method`, `path`, `body`, and `headers`. Only `action`, `cursor`, and any explicitly documented display-only fields are permitted during continuation.

##### Scenario `SCN-OUT-011`: `max_depth` rejected with cursor
- GIVEN a cursor created by `api_swagger` `schema`
- WHEN `api_swagger` is invoked with that cursor, `action: "schema"`, and `max_depth: 5`
- THEN the result SHALL be a recoverable typed error with code `cursor_execution_inputs_rejected`.

##### Scenario `SCN-OUT-012`: `headers` rejected with cursor
- GIVEN a cursor created by `api_swagger` `request`
- WHEN `api_swagger` is invoked with that cursor, `action: "request"`, and `headers: { accept: "text/plain" }`
- THEN the result SHALL be a recoverable typed error with code `cursor_execution_inputs_rejected`.

#### Requirement `REQ-OUT-009`: Precise tool-result envelope and details fields
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

Every tool result SHALL be an `ApiToolResult` containing:
- `content: Array<{ type: 'text'; text: string }>`;
- `details?: object` with `status: 'success' | 'failure'`;
- `isError?: boolean`.

On success, `details.data` MAY contain the structured result, `details.request` MAY contain the redacted request summary, `details.response` MAY contain the redacted HTTP response summary, and `details.continuation` MAY contain safe continuation metadata (`has_more`, `next_cursor`, `returned_bytes`, `returned_lines`, `total_bytes`, `total_lines`). On failure, `details.error` SHALL contain `code: string`, `message: string`, and `recoverable: boolean`. No `content`, `details`, error, or cursor field SHALL contain `artifact_path` or an internal filesystem path.

##### Scenario `SCN-OUT-013`: Successful discover result envelope
- GIVEN a successful `api_swagger` `discover` invocation
- WHEN the result is inspected
- THEN `details.status` SHALL be `'success'`
- AND `details.data.title` SHALL be present.

##### Scenario `SCN-OUT-014`: Oversized result continuation envelope
- GIVEN an oversized `api_graphql` `execute` result
- WHEN the first chunk is returned
- THEN `details.continuation.has_more` SHALL be `true`
- AND `details.continuation.next_cursor` SHALL be a non-empty opaque string.

#### Requirement `REQ-OUT-010`: Byte and line budgets with safe bounds
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

The extension SHALL enforce per-tool-response byte and line budgets. The byte budget SHALL be the configured `limits.max_response_bytes` clamped to a safe inclusive maximum of `50,000`. The line budget SHALL be the configured `limits.max_response_lines` clamped to a safe inclusive maximum of `2,000`. A result that fits both budgets is returned complete. An oversized result is serialized to an immutable redacted artifact and chunked at line or UTF-8 byte boundaries without splitting multi-byte codepoints. Configured values less than or equal to zero or non-finite SHALL be replaced by the safe default.

##### Scenario `SCN-OUT-015`: Large response chunked
- GIVEN a response body of 10 MB and configured budgets of 50,000 bytes and 2,000 lines
- WHEN the tool completes
- THEN the first chunk SHALL not exceed the budgets
- AND continuation SHALL expose the remaining redacted artifact through the same-tool cursor.

##### Scenario `SCN-OUT-016`: Zero budget replaced by default
- GIVEN a configured `max_response_bytes` of `0`
- WHEN the budget is applied
- THEN the effective byte budget SHALL be the safe default of `50,000`.

#### Requirement `REQ-OUT-011`: Cursor bounded lifetime and session ownership
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

Cursors SHALL be owned by the active Pi session and SHALL bind to the originating session, tool, action, artifact, and deterministic offset. Cursors SHALL expire after a bounded TTL measured from creation. The default TTL SHALL be `3,600` seconds and the maximum TTL SHALL be `86,400` seconds. A cursor used after expiry or from a different session SHALL return a recoverable typed error and SHALL NOT read the artifact.

##### Scenario `SCN-OUT-017`: Expired cursor returns typed error
- GIVEN a cursor that is older than the configured TTL
- WHEN the tool is invoked with that cursor
- THEN the result SHALL be a recoverable error with code `cursor_expired`.

##### Scenario `SCN-OUT-018`: Cross-session cursor rejected
- GIVEN a valid cursor created by session A
- WHEN session B invokes the same tool with that cursor
- THEN the result SHALL be a recoverable error with code `cursor_invalid`.

#### Requirement `REQ-OUT-012`: Typed recoverable cursor errors
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

Cursor-related failures SHALL return recoverable errors with deterministic codes:
- malformed or unresolvable cursor → `cursor_invalid`;
- expired cursor → `cursor_expired`;
- cursor from a different tool → `cursor_wrong_tool`;
- cursor from a different action → `cursor_wrong_action`;
- cursor combined with execution-specific inputs → `cursor_execution_inputs_rejected`.

The error message and details SHALL NOT contain the artifact path, cursor payload internals, or session identifiers.

##### Scenario `SCN-OUT-019`: Wrong-tool cursor error code
- GIVEN a cursor created by `api_swagger`
- WHEN `api_graphql` is invoked with that cursor
- THEN the error code SHALL be `cursor_wrong_tool`.

##### Scenario `SCN-OUT-020`: Execution-input conflict error code
- GIVEN a cursor created by `api_graphql` `execute`
- WHEN `api_graphql` is invoked with that cursor and `query: "query { other }"`
- THEN the error code SHALL be `cursor_execution_inputs_rejected`.

### Rendering

#### Requirement `REQ-REN-001`: Native collapsed/expanded renderer
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

Both `api_swagger` and `api_graphql` SHALL provide a `renderResult` implementation compatible with the installed Pi runtime. The renderer SHALL return a plain component object with `render(width): string[]` and `invalidate(): void`.

#### Scenario `SCN-REN-001`: Render function exists on each tool
- GIVEN the extension is loaded with both tools enabled
- WHEN the tool definitions are inspected
- THEN each tool SHALL expose a `renderResult` callback.

#### Requirement `REQ-REN-002`: Pi owns expansion state
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

The renderer SHALL NOT maintain a competing expansion state variable. It SHALL receive `expanded` and `isPartial` from the Pi runtime. The renderer SHALL use the runtime-owned keybinding hint for `app.tools.expand` and SHALL NOT hard-code a physical key.

#### Scenario `SCN-REN-002`: No hard-coded expand key
- GIVEN the renderer source code
- WHEN inspected
- THEN no literal key sequence such as `"ctrl+o"` or `"ctrl+e"` SHALL appear in renderer logic
- AND expansion hints SHALL be sourced from the runtime.

#### Requirement `REQ-REN-003`: Collapsed view is bounded and useful
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

The collapsed view SHALL display the tool name, status, action, key identity/counts, and a continuation/expansion hint. It SHALL fit within a reasonable collapsed row height.

#### Scenario `SCN-REN-003`: Collapsed view shows summary
- GIVEN a successful `api_swagger` `discover` result with 5 tags and 12 operations
- WHEN the tool row is collapsed
- THEN the rendered text SHALL include `"api_swagger"`, `"discover"`, and counts or identifiers
- AND the total line count SHALL not exceed the Pi collapsed-row budget.

#### Requirement `REQ-REN-004`: Expanded view shows current chunk
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

The expanded view SHALL render every model-facing value in the current chunk plus safe structured metadata (status, request summary, continuation info). It SHALL wrap lines to the supplied width. It SHALL NOT reveal redacted values or internal paths.

#### Scenario `SCN-REN-004`: Expanded view wraps to width
- GIVEN a `api_graphql` `execute` result containing a 200-character line
- AND a terminal width of 80 columns
- WHEN the tool row is expanded
- THEN the rendered output SHALL wrap the long line without exceeding the supplied width
- AND no internal filesystem path SHALL appear.

#### Scenario `SCN-REN-005`: Expanded view for continuation
- GIVEN a partial result with `has_more: true` and a `next_cursor`
- WHEN the tool row is expanded
- THEN the rendered output SHALL include the current chunk content and a safe continuation hint
- AND the cursor value itself MAY be shown as an opaque short token.

#### Scenario `SCN-REN-006`: Expanded failure view
- GIVEN a recoverable configuration error result
- WHEN the tool row is expanded
- THEN the rendered output SHALL show the error code and a safe message
- AND SHALL NOT include raw response bodies, credentials, or internal paths.

### Status Integration

#### Requirement `REQ-STS-001`: Safe additive api_status fields
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

`api_status` MAY include a `swagger` object and/or a `graphql` object when the corresponding block is present. Each integration object SHALL contain exactly `enabled: boolean` and, when `enabled: true`, `framework: "spring" | "node"`. `api_status` SHALL NOT disclose URLs, credentials, schemas, headers, cursors, artifacts, or internal paths.

#### Scenario `SCN-STS-001`: Status shows enabled frameworks
- GIVEN a configuration with `swagger.enabled: true`, `swagger.framework: "spring"`, `graphql.enabled: true`, `graphql.framework: "node"`
- WHEN `api_status` is invoked
- THEN the result SHALL contain `swagger: { enabled: true, framework: "spring" }` and `graphql: { enabled: true, framework: "node" }`
- AND SHALL NOT contain `url`, `graphql_url`, `headers`, `auth`, `schema`, `cursor`, or `artifact_path`.

#### Scenario `SCN-STS-002`: Disabled block status
- GIVEN a configuration with `swagger.enabled: false` and a `graphql` block with `enabled: true` and `framework: "spring"`
- WHEN `api_status` is invoked
- THEN the result SHALL contain `swagger: { enabled: false }` and `graphql: { enabled: true, framework: "spring" }`.

#### Requirement `REQ-STS-002`: No sensitive status disclosure
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

`api_status` SHALL NOT disclose the effective URL, configured origin, configured base path, integration endpoint path, credentials, headers, schemas, cursors, artifacts, internal filesystem paths, or raw provider data. It MAY continue to disclose safe non-URL operational status already exposed by the integration, such as whether configuration exists, overall enablement, auth type category, timeout/limit numbers, configured booleans, warnings, and git state, when those values contain no secrets or paths.

#### Scenario `SCN-STS-003`: Status does not leak URL
- GIVEN a `swagger.url` value of `"https://api.internal.example.com/v3/api-docs"`
- WHEN `api_status` is invoked
- THEN the status output SHALL NOT contain `"api.internal.example.com"` or any URL substring.

#### Requirement `REQ-STS-003`: Retained status behavior
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

`api_status` SHALL continue to report the existing safe non-URL fields it reported before this change, including `enabled` for the overall API tools integration. It SHALL intentionally stop reporting `endpoints.rest_url`, `endpoints.graphql_url`, and any equivalent URL/origin/path endpoint field as a security-driven behavior change.

## Security / Privacy Requirements

### Requirement `REQ-SEC-001`: Same-origin Swagger document fetch
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

The Swagger document fetch SHALL be same-origin with the configured REST origin and SHALL remain within the configured REST base path.

#### Abuse / Failure Scenario `SCN-SEC-001`: SSRF through swagger.url blocked
- GIVEN a `swagger.url` value of `"https://internal-network/metadata"` where the host differs from the configured REST origin
- WHEN the URL is validated
- THEN the URL SHALL be rejected
- AND the request SHALL NOT be issued.

### Requirement `REQ-SEC-002`: Base-path containment for Swagger and GraphQL
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

All Swagger and GraphQL effective URLs SHALL be resolved and validated against the configured REST base path. URLs or paths that escape the base path SHALL be rejected.

#### Abuse / Failure Scenario `SCN-SEC-002`: Path traversal to admin endpoint
- GIVEN a `graphql.url` value resolving to `"/api/../admin/users"`
- WHEN the URL is validated
- THEN the traversal SHALL be rejected
- AND the request SHALL NOT be issued.

### Requirement `REQ-SEC-003`: No URL userinfo
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

URLs containing userinfo (username, password, or both) SHALL be rejected before any network request.

#### Abuse / Failure Scenario `SCN-SEC-003`: Credential substring redacted in error
- GIVEN a `swagger.url` value of `"https://admin:secret@host.example.com/v3/api-docs"`
- WHEN the URL is rejected
- THEN the error message SHALL NOT contain `"admin"`, `"secret"`, or the full credential substring.

### Requirement `REQ-SEC-004`: No control characters in URLs
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

URLs containing control characters SHALL be rejected.

#### Abuse / Failure Scenario `SCN-SEC-004`: Newline injection in GraphQL URL
- GIVEN a `graphql.url` value containing a newline character
- WHEN the URL is validated
- THEN the URL SHALL be rejected
- AND the error SHALL be recoverable.

### Requirement `REQ-SEC-005`: Redirect policy enforcement
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

Redirects SHALL be followed only when the target remains same-origin and within the base path, consistent with the policy for `api_rest_request`. Cross-origin redirects SHALL be rejected.

#### Abuse / Failure Scenario `SCN-SEC-005`: Cross-origin redirect during Swagger request
- GIVEN a `request` action that returns a 302 redirect to `https://attacker.example.com/`
- WHEN the redirect is processed
- THEN the redirect SHALL be rejected
- AND the request SHALL NOT be completed to the attacker origin.

### Requirement `REQ-SEC-006`: Recursive redaction before persistence
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

Before writing any artifact to disk, the extension SHALL apply the recursive redaction helpers (`redactToolResult`, `redactDeep`, or equivalent) to remove credentials, tokens, and other secret-like values from the complete result.

#### Abuse / Failure Scenario `SCN-SEC-006`: Secret in response body not persisted
- GIVEN a GraphQL response containing `{ "data": { "user": { "apiKey": "sk-12345" } } }`
- WHEN the response is oversized and written to an artifact
- THEN the artifact SHALL contain a redacted `apiKey` value, not `"sk-12345"`.

### Requirement `REQ-SEC-007`: Artifact containment and permissions
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

Temporary artifacts SHALL be written beneath an extension-owned unguessable temporary directory. The directory SHALL be created with restrictive permissions. Artifact reads SHALL verify the resolved path is still within the extension-owned directory (symlink/realpath containment).

#### Abuse / Failure Scenario `SCN-SEC-007`: Symlink escape attempt
- GIVEN a cursor referencing an internal artifact name that is a symlink to `/etc/passwd`
- WHEN the artifact is read
- THEN the resolved path SHALL be checked against the extension-owned directory
- AND the read SHALL be rejected if the path escapes.

### Requirement `REQ-SEC-008`: Bounded output budgets
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

The extension SHALL enforce configured byte and line budgets on every tool response. The budgets SHALL be safe defaults or explicit configuration values and SHALL be bounded by reasonable upper limits.

#### Abuse / Failure Scenario `SCN-SEC-008`: Model context exhaustion
- GIVEN a 10 MB response body
- AND a configured byte budget of 50 KB
- WHEN the tool completes
- THEN the response SHALL be redacted and bounded to the first 50 KB
- AND the remainder SHALL be available only through the same-tool cursor.

### Requirement `REQ-SEC-009`: Cancellation propagation
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

The `AbortSignal` supplied by the Pi runtime SHALL be propagated to all network requests and long-running operations. Cancellation SHALL NOT be converted into an ordinary provider failure.

#### Abuse / Failure Scenario `SCN-SEC-009`: Cancelled request stops
- GIVEN a long-running GraphQL introspection
- WHEN the user cancels the turn
- THEN the in-flight request SHALL be aborted
- AND the tool result SHALL be a cancellation state, not a timeout error.

### Requirement `REQ-SEC-010`: Session-scoped cursor ownership
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

Cursor registry state SHALL be owned by the active Pi session. The cursor SHALL bind to a session identifier, tool, action, artifact identifier, and deterministic offset. The cursor payload SHALL be opaque and SHALL NOT encode the session identifier or artifact path in a recoverable form.

#### Abuse / Failure Scenario `SCN-SEC-010`: Cursor replay in another session
- GIVEN a valid cursor from session A
- WHEN session B invokes a tool with that cursor
- THEN the cursor SHALL be rejected
- AND the artifact for session A SHALL NOT be read.

### Requirement `REQ-SEC-011`: Idempotent shutdown and stale cleanup
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

`session_shutdown` SHALL remove all registry entries and temporary artifacts for the session idempotently. On startup, the extension MAY perform a stale startup sweep that removes leftover temporary directories from prior crashed sessions, but SHALL NOT use that sweep to restore continuation state.

#### Abuse / Failure Scenario `SCN-SEC-011`: Stale artifact after crash
- GIVEN a crash left a temporary artifact directory from a prior session
- WHEN the extension starts
- THEN the stale directory MAY be removed
- AND the extension SHALL NOT attempt to reconstruct cursors from the leftover files.

### Requirement `REQ-SEC-012`: No schema-name over-redaction
- Revision: `R1`
- Status: active
- `supersedes`: None
- `superseded_by`: None

Redaction SHALL target actual configured secret values. Field names such as `apiKey`, `token`, or `password` SHALL NOT be redacted merely because they are secret-like names unless they contain a configured secret value.

#### Abuse / Failure Scenario `SCN-SEC-012`: Schema field name preserved
- GIVEN a response containing `{ "apiKey": null }` where no configured secret is present
- WHEN the result is redacted
- THEN the field name `apiKey` SHALL remain visible
- AND the value SHALL remain `null`.

## Supersession Index

| Requirement/decision id | Revision | Status | Supersedes | Superseded by | Reason/date |
|---|---|---|---|---|---|
| `REQ-CFG-001` | `R1` | active | None | None | Initial spec. |
| `REQ-CFG-002` | `R1` | active | None | None | Initial spec. |
| `REQ-CFG-003` | `R1` | active | None | None | Initial spec. |
| `REQ-CFG-004` | `R1` | active | None | None | Initial spec. |
| `REQ-URL-001` | `R1` | active | None | None | Initial spec. |
| `REQ-URL-002` | `R1` | active | None | None | Initial spec. |
| `REQ-URL-003` | `R1` | active | None | None | Initial spec. |
| `REQ-URL-004` | `R1` | active | None | None | Initial spec. |
| `REQ-URL-005` | `R1` | active | None | None | Initial spec. |
| `REQ-URL-006` | `R1` | active | None | None | Initial spec. |
| `REQ-URL-007` | `R1` | active | None | None | Initial spec. |
| `REQ-TOOL-001` | `R1` | active | None | None | Initial spec. |
| `REQ-TOOL-002` | `R1` | active | None | None | Initial spec. |
| `REQ-TOOL-003` | `R1` | active | None | None | Initial spec. |
| `REQ-TOOL-004` | `R1` | active | None | None | Initial spec. |
| `REQ-TOOL-005` | `R1` | active | None | None | Initial spec. |
| `REQ-TOOL-006` | `R1` | active | None | None | Initial spec. |
| `REQ-TOOL-007` | `R1` | active | None | None | Initial spec. |
| `REQ-TOOL-008` | `R1` | active | None | None | Initial spec. |
| `REQ-TOOL-009` | `R1` | active | None | None | Initial spec. |
| `REQ-TOOL-010` | `R1` | active | None | None | Initial spec. |
| `REQ-TOOL-011` | `R1` | active | None | None | Initial spec. |
| `REQ-TOOL-012` | `R1` | active | None | None | Initial spec. |
| `REQ-TOOL-013` | `R1` | active | None | None | Initial spec. |
| `REQ-OUT-001` | `R1` | active | None | None | Initial spec. |
| `REQ-OUT-002` | `R1` | active | None | None | Initial spec. |
| `REQ-OUT-003` | `R1` | active | None | None | Initial spec. |
| `REQ-OUT-004` | `R1` | active | None | None | Initial spec. |
| `REQ-OUT-005` | `R1` | active | None | None | Initial spec. |
| `REQ-OUT-006` | `R1` | active | None | None | Initial spec. |
| `REQ-OUT-007` | `R1` | active | None | None | Initial spec. |
| `REQ-REN-001` | `R1` | active | None | None | Initial spec. |
| `REQ-REN-002` | `R1` | active | None | None | Initial spec. |
| `REQ-REN-003` | `R1` | active | None | None | Initial spec. |
| `REQ-REN-004` | `R1` | active | None | None | Initial spec. |
| `REQ-STS-001` | `R1` | active | None | None | Initial spec. |
| `REQ-STS-002` | `R1` | active | None | None | Initial spec. |
| `REQ-STS-003` | `R1` | active | None | None | Initial spec. |
| `REQ-SEC-001` | `R1` | active | None | None | Initial spec. |
| `REQ-SEC-002` | `R1` | active | None | None | Initial spec. |
| `REQ-SEC-003` | `R1` | active | None | None | Initial spec. |
| `REQ-SEC-004` | `R1` | active | None | None | Initial spec. |
| `REQ-SEC-005` | `R1` | active | None | None | Initial spec. |
| `REQ-SEC-006` | `R1` | active | None | None | Initial spec. |
| `REQ-SEC-007` | `R1` | active | None | None | Initial spec. |
| `REQ-SEC-008` | `R1` | active | None | None | Initial spec. |
| `REQ-SEC-009` | `R1` | active | None | None | Initial spec. |
| `REQ-SEC-010` | `R1` | active | None | None | Initial spec. |
| `REQ-SEC-011` | `R1` | active | None | None | Initial spec. |
| `REQ-SEC-012` | `R1` | active | None | None | Initial spec. |
| `REQ-SCH-001` | `R1` | active | None | None | Initial spec. |
| `REQ-SCH-002` | `R1` | active | None | None | Initial spec. |
| `REQ-SCH-003` | `R1` | active | None | None | Initial spec. |
| `REQ-OUT-008` | `R1` | active | None | None | Initial spec. |
| `REQ-OUT-009` | `R1` | active | None | None | Initial spec. |
| `REQ-OUT-010` | `R1` | active | None | None | Initial spec. |
| `REQ-OUT-011` | `R1` | active | None | None | Initial spec. |
| `REQ-OUT-012` | `R1` | active | None | None | Initial spec. |

## Acceptance Criteria and Testability Matrix

| Requirement or Scenario | Expected Evidence | Validation Layer | Notes |
|---|---|---|---|
| `REQ-CFG-001` | Unit tests in `extensions/api-tools/test/config.test.ts` for missing and disabled blocks | Unit | Config parser. |
| `SCN-CFG-001` | Test: no blocks → no swagger, no graphql, no legacy tools | Unit | `extensions/api-tools/test/tools.test.ts`. |
| `SCN-CFG-002` | Test: `enabled: false` blocks → no registration | Unit | `extensions/api-tools/test/tools.test.ts`. |
| `REQ-CFG-002` | Test: missing/unsupported framework produces recoverable error | Unit | `extensions/api-tools/test/config.test.ts`. |
| `SCN-CFG-003`, `SCN-CFG-004` | Test: status error marker and safe message | Unit | `extensions/api-tools/test/config.test.ts`. |
| `REQ-CFG-003` | Test: block URL scheme validation | Unit | `extensions/api-tools/test/config.test.ts` and `extensions/api-tools/test/client.test.ts`. |
| `SCN-CFG-005` | Test: `file://` URL rejected | Unit | `extensions/api-tools/test/client.test.ts`. |
| `REQ-CFG-004` | Test: `graphql_url` alone does not enable GraphQL | Unit | `extensions/api-tools/test/config.test.ts`. |
| `SCN-CFG-006` | Test: no `graphql` block → no `api_graphql` | Unit | `extensions/api-tools/test/tools.test.ts`. |
| `REQ-URL-001` | Test: Swagger URL precedence and v2 fallback | Unit | `extensions/api-tools/test/client.test.ts`. |
| `SCN-URL-001` | Test: Node without `url` returns configuration error | Unit | `extensions/api-tools/test/config.test.ts`. |
| `SCN-URL-002` | Test: v3 success skips v2 | Unit | `extensions/api-tools/test/client.test.ts`. |
| `SCN-URL-003` | Test: v3 failure triggers one v2 fallback | Unit | `extensions/api-tools/test/client.test.ts`. |
| `SCN-URL-004` | Test: both fail → recoverable error | Unit | `extensions/api-tools/test/client.test.ts`. |
| `REQ-URL-002` | Test: non-OpenAPI JSON rejected | Unit | `extensions/api-tools/test/client.test.ts`. |
| `SCN-URL-005` | Test: `{foo:bar}` document rejected | Unit | `extensions/api-tools/test/client.test.ts`. |
| `REQ-URL-003` | Test: request uses configured origin, ignores `servers` | Unit | `extensions/api-tools/test/client.test.ts` and `extensions/api-tools/test/swagger.test.ts`. |
| `SCN-URL-006` | Test: external `servers` URL ignored | Unit | `extensions/api-tools/test/client.test.ts`. |
| `REQ-URL-004` | Test: same-origin, base-path, userinfo, traversal, control-character rejection | Unit | `extensions/api-tools/test/client.test.ts`. |
| `SCN-URL-007` | Test: userinfo rejected and redacted | Unit + security review | `extensions/api-tools/test/client.test.ts`. |
| `SCN-URL-008` | Test: traversal rejected | Unit | `extensions/api-tools/test/client.test.ts`. |
| `SCN-URL-009` | Test: path outside base path rejected | Unit | `extensions/api-tools/test/client.test.ts`. |
| `REQ-URL-005` | Test: GraphQL URL precedence | Unit | `extensions/api-tools/test/config.test.ts` and `extensions/api-tools/test/client.test.ts`. |
| `SCN-URL-010` | Test: explicit URL overrides legacy | Unit | `extensions/api-tools/test/client.test.ts`. |
| `SCN-URL-011` | Test: legacy fallback used | Unit | `extensions/api-tools/test/client.test.ts`. |
| `SCN-URL-012` | Test: default `/graphql` used | Unit | `extensions/api-tools/test/client.test.ts`. |
| `REQ-URL-006` | Test: hardening applies to all GraphQL sources | Unit | `extensions/api-tools/test/client.test.ts`. |
| `REQ-URL-007` | Test: redirect policy continuity | Unit | `extensions/api-tools/test/client.test.ts`. |
| `SCN-URL-013` | Test: cross-origin redirect rejected | Unit | `extensions/api-tools/test/client.test.ts`. |
| `REQ-TOOL-001` | Test: conditional registration matrix | Unit | `extensions/api-tools/test/tools.test.ts`. |
| `SCN-TOOL-001`–`SCN-TOOL-003` | Test: registration combinations | Unit | `extensions/api-tools/test/tools.test.ts`. |
| `REQ-TOOL-002` | Test: missing/invalid `action` rejected | Unit | `extensions/api-tools/test/tools.test.ts`. |
| `REQ-TOOL-003` | Test: no extra retrieval tool registered | Unit | `extensions/api-tools/test/tools.test.ts`. |
| `SCN-TOOL-004` | Test: tool list inspection | Unit | `extensions/api-tools/test/tools.test.ts`. |
| `REQ-TOOL-004` | Test: `discover` action contract | Unit | `extensions/api-tools/test/swagger.test.ts` (new). |
| `SCN-TOOL-005` | Test: bounded summary | Unit | `extensions/api-tools/test/swagger.test.ts`. |
| `SCN-TOOL-006` | Test: tag filter | Unit | `extensions/api-tools/test/swagger.test.ts`. |
| `REQ-TOOL-005` | Test: `schema` action contract | Unit | `extensions/api-tools/test/swagger.test.ts`. |
| `SCN-TOOL-007` | Test: operation contract | Unit | `extensions/api-tools/test/swagger.test.ts`. |
| `SCN-TOOL-008` | Test: `max_depth` bounded | Unit | `extensions/api-tools/test/swagger.test.ts`. |
| `REQ-TOOL-006` | Test: `request` action contract | Unit | `extensions/api-tools/test/swagger.test.ts`. |
| `SCN-TOOL-009` | Test: relative path execution | Unit | `extensions/api-tools/test/swagger.test.ts`. |
| `SCN-TOOL-010` | Test: absolute path rejected | Unit | `extensions/api-tools/test/swagger.test.ts`. |
| `REQ-TOOL-007` | Test: `discover` action contract | Unit | `extensions/api-tools/test/graphql.test.ts` (new). |
| `SCN-TOOL-011` | Test: bounded operation list | Unit | `extensions/api-tools/test/graphql.test.ts`. |
| `REQ-TOOL-008` | Test: `schema` action contract | Unit | `extensions/api-tools/test/graphql.test.ts`. |
| `SCN-TOOL-012` | Test: type contract | Unit | `extensions/api-tools/test/graphql.test.ts`. |
| `REQ-TOOL-009` | Test: `execute` action contract | Unit | `extensions/api-tools/test/graphql.test.ts`. |
| `SCN-TOOL-013` | Test: query execution | Unit | `extensions/api-tools/test/graphql.test.ts`. |
| `SCN-TOOL-014` | Test: variables and operation name | Unit | `extensions/api-tools/test/graphql.test.ts`. |
| `REQ-TOOL-010` | Test: legacy tool names absent | Unit | `extensions/api-tools/test/tools.test.ts`. |
| `SCN-TOOL-015` | Test: legacy tool list absent | Unit | `extensions/api-tools/test/tools.test.ts`. |
| `REQ-TOOL-011` | Test: retained tools unchanged and `api_status` URL fields intentionally removed | Unit | `extensions/api-tools/test/tools.test.ts` and `extensions/api-tools/test/*.test.ts` existing coverage. |
| `SCN-TOOL-016` | Test: `api_rest_request` inputs/outputs preserved | Unit | `extensions/api-tools/test/tools.test.ts`. |
| `REQ-TOOL-012` | Test: no route enumeration | Unit | `extensions/api-tools/test/config.test.ts` and `extensions/api-tools/test/swagger.test.ts`. |
| `SCN-TOOL-017` | Test: Node missing URL → error, not scan | Unit | `extensions/api-tools/test/config.test.ts`. |
| `REQ-TOOL-013` | Test: no package.json dependency changes | Static | `git diff extensions/api-tools/package.json` shows no dependency additions. |
| `REQ-OUT-001` | Test: complete result returned | Unit | `extensions/api-tools/test/continuation.test.ts` (new). |
| `SCN-OUT-001` | Test: small result has `has_more: false` | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `REQ-OUT-002` | Test: artifact write + first chunk + cursor | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `SCN-OUT-002` | Test: no `artifact_path` in response | Unit + security review | `extensions/api-tools/test/continuation.test.ts`. |
| `REQ-OUT-003` | Test: same-tool/action continuation | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `SCN-OUT-003` | Test: next chunk no network | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `SCN-OUT-004`, `SCN-OUT-005` | Test: mismatched action/tool errors | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `REQ-OUT-004` | Test: execution inputs rejected with cursor | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `SCN-OUT-006` | Test: `query` + cursor rejected | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `REQ-OUT-005` | Test: expiry, reload, invalid cursor | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `SCN-OUT-007`, `SCN-OUT-008` | Test: typed error codes and no path | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `REQ-OUT-006` | Test: deterministic chunk boundaries | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `SCN-OUT-009` | Test: full reconstruction | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `REQ-OUT-007` | Test: no path in any public field | Unit + security review | `extensions/api-tools/test/continuation.test.ts`, `extensions/api-tools/test/security.test.ts`. |
| `SCN-OUT-010` | Test: response/cursor inspected for paths | Unit + security review | `extensions/api-tools/test/continuation.test.ts`. |
| `REQ-REN-001` | Test: `renderResult` exists | Unit | `extensions/api-tools/test/render.test.ts` (new). |
| `SCN-REN-001` | Test: tool definition inspection | Unit | `extensions/api-tools/test/render.test.ts`. |
| `REQ-REN-002` | Test: no hard-coded key, no custom state | Static + unit | `extensions/api-tools/test/render.test.ts`. |
| `SCN-REN-002` | Test: no literal key strings | Static | `grep`/`ripgrep` renderer source. |
| `REQ-REN-003` | Test: collapsed view bounded | Unit | `extensions/api-tools/test/render.test.ts`. |
| `SCN-REN-003` | Test: collapsed line count | Unit | `extensions/api-tools/test/render.test.ts`. |
| `REQ-REN-004` | Test: expanded view width-safe | Unit | `extensions/api-tools/test/render.test.ts`. |
| `SCN-REN-004` | Test: line wrapping | Unit | `extensions/api-tools/test/render.test.ts`. |
| `SCN-REN-005` | Test: continuation hint in expanded | Unit | `extensions/api-tools/test/render.test.ts`. |
| `SCN-REN-006` | Test: failure view safe | Unit | `extensions/api-tools/test/render.test.ts`. |
| `REQ-STS-001` | Test: status additive fields | Unit | `extensions/api-tools/test/tools.test.ts`. |
| `SCN-STS-001`–`SCN-STS-003` | Test: status output inspection | Unit | `extensions/api-tools/test/tools.test.ts`. |
| `REQ-STS-002` | Test: no URL/origin/base-path/credential in status while safe non-URL status remains | Unit + security review | `extensions/api-tools/test/tools.test.ts`. |
| `REQ-STS-003` | Test: existing status fields preserved | Unit | `extensions/api-tools/test/tools.test.ts`. |
| `REQ-SEC-001` | Test: same-origin rejection | Unit | `extensions/api-tools/test/client.test.ts`. |
| `SCN-SEC-001` | Test: different origin rejected | Unit | `extensions/api-tools/test/client.test.ts`. |
| `REQ-SEC-002` | Test: base-path containment | Unit | `extensions/api-tools/test/client.test.ts`. |
| `SCN-SEC-002` | Test: traversal rejection | Unit | `extensions/api-tools/test/client.test.ts`. |
| `REQ-SEC-003` | Test: userinfo rejection | Unit | `extensions/api-tools/test/client.test.ts`. |
| `SCN-SEC-003` | Test: credential redaction | Unit | `extensions/api-tools/test/security.test.ts`. |
| `REQ-SEC-004` | Test: control-character rejection | Unit | `extensions/api-tools/test/client.test.ts`. |
| `SCN-SEC-004` | Test: newline in URL rejected | Unit | `extensions/api-tools/test/client.test.ts`. |
| `REQ-SEC-005` | Test: redirect policy | Unit | `extensions/api-tools/test/client.test.ts`. |
| `SCN-SEC-005` | Test: cross-origin redirect rejected | Unit | `extensions/api-tools/test/client.test.ts`. |
| `REQ-SEC-006` | Test: redaction before artifact write | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `SCN-SEC-006` | Test: secret not in artifact | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `REQ-SEC-007` | Test: containment and symlink check | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `SCN-SEC-007` | Test: symlink escape rejected | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `REQ-SEC-008` | Test: budget enforcement | Unit | `extensions/api-tools/test/security.test.ts` and `extensions/api-tools/test/continuation.test.ts`. |
| `SCN-SEC-008` | Test: 10 MB response chunked | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `REQ-SEC-009` | Test: cancellation propagation | Unit | `extensions/api-tools/test/client.test.ts`. |
| `SCN-SEC-009` | Test: abort signal wired | Unit | `extensions/api-tools/test/client.test.ts`. |
| `REQ-SEC-010` | Test: session-bound cursor registry | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `SCN-SEC-010` | Test: cross-session cursor rejected | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `REQ-SEC-011` | Test: shutdown idempotency + stale cleanup | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `SCN-SEC-011` | Test: crash leftovers removed | Unit | `extensions/api-tools/test/continuation.test.ts`. |
| `REQ-SEC-012` | Test: field-name preservation | Unit | `extensions/api-tools/test/security.test.ts`. |
| `SCN-SEC-012` | Test: `apiKey: null` preserved | Unit | `extensions/api-tools/test/security.test.ts`. |
| `REQ-SCH-001` | Test: strict schema validation, `additionalProperties: false` | Unit | `extensions/api-tools/test/tools.test.ts`. |
| `SCN-SCH-001`, `SCN-SCH-002` | Test: unknown property and missing action rejected | Unit | `extensions/api-tools/test/tools.test.ts`. |
| `REQ-SCH-002` | Test: `api_swagger` action branch schemas | Unit | `extensions/api-tools/test/swagger.test.ts` (new). |
| `SCN-SCH-003`–`SCN-SCH-005` | Test: discover/schema/request schema acceptance and rejection | Unit | `extensions/api-tools/test/swagger.test.ts` (new). |
| `REQ-SCH-003` | Test: `api_graphql` action branch schemas | Unit | `extensions/api-tools/test/graphql.test.ts` (new). |
| `SCN-SCH-006`–`SCN-SCH-008` | Test: execute/schema/discover schema acceptance and rejection | Unit | `extensions/api-tools/test/graphql.test.ts` (new). |
| `REQ-OUT-008` | Test: execution inputs with cursor rejected | Unit | `extensions/api-tools/test/continuation.test.ts` (new). |
| `SCN-OUT-011`, `SCN-OUT-012` | Test: `max_depth`/`headers` with cursor rejected | Unit | `extensions/api-tools/test/continuation.test.ts` (new). |
| `REQ-OUT-009` | Test: result envelope fields present and path-free | Unit | `extensions/api-tools/test/continuation.test.ts` (new) and `extensions/api-tools/test/tools.test.ts`. |
| `SCN-OUT-013`, `SCN-OUT-014` | Test: success details and continuation metadata | Unit | `extensions/api-tools/test/continuation.test.ts` (new). |
| `REQ-OUT-010` | Test: byte/line budget bounds and chunking | Unit | `extensions/api-tools/test/security.test.ts` and `extensions/api-tools/test/continuation.test.ts` (new). |
| `SCN-OUT-015`, `SCN-OUT-016` | Test: 10 MB chunked, zero budget default | Unit | `extensions/api-tools/test/continuation.test.ts` (new). |
| `REQ-OUT-011` | Test: cursor TTL and cross-session rejection | Unit | `extensions/api-tools/test/continuation.test.ts` (new). |
| `SCN-OUT-017`, `SCN-OUT-018` | Test: expired and cross-session errors | Unit | `extensions/api-tools/test/continuation.test.ts` (new). |
| `REQ-OUT-012` | Test: typed cursor error codes | Unit | `extensions/api-tools/test/continuation.test.ts` (new). |
| `SCN-OUT-019`, `SCN-OUT-020` | Test: wrong-tool and execution-input error codes | Unit | `extensions/api-tools/test/continuation.test.ts` (new). |
| Full suite | `cd extensions/api-tools && npm test` | Integration | All tests pass. |
| Typecheck | `cd extensions/api-tools && npm run typecheck` | Static | Clean. |
| Package | Package validation script from `package.json` | Static | No new dependency. |
| Renderer manual | Collapsed/expanded review in Pi TUI | Manual | No new dependency; no hard-coded key. |
| Independent security/public-contract | Review of `content`/`details`/errors/cursors | Manual | No path/secret leakage. |

## Archive Capability Mapping

| Change requirement/scenario ids | Target capability spec path | Operation | Target section/requirement | Sync intent |
|---|---|---|---|---|
| `REQ-TOOL-001`, `REQ-TOOL-002`, `REQ-TOOL-003`, `REQ-TOOL-004`–`REQ-TOOL-009`, `SCN-TOOL-001`–`SCN-TOOL-017` | `openspec/specs/conditional-api-contract-tools/spec.md` | add | Public API tools section: `api_swagger` and `api_graphql` action contracts, registration rules, and migration from legacy GraphQL tools. | New capability; add this change's normative tool contracts as the initial capability spec. |
| `REQ-OUT-001`–`REQ-OUT-007`, `SCN-OUT-001`–`SCN-OUT-010` | `openspec/specs/lossless-bounded-api-results/spec.md` | add | Bounded output and continuation section: redaction, serialization, opaque cursors, same-tool reconstruction, and no public path. | New capability; add this change as the initial capability spec. |
| `REQ-REN-001`–`REQ-REN-004`, `SCN-REN-001`–`SCN-REN-006` | `openspec/specs/native-api-tool-rendering/spec.md` | add | Renderer section: collapsed/expanded Pi tool-row contracts, Pi-owned expansion, width safety, and state handling. | New capability; add this change as the initial capability spec. |
| `REQ-SEC-001`–`REQ-SEC-012`, `REQ-URL-004`, `REQ-URL-007`, `SCN-SEC-001`–`SCN-SEC-012`, `SCN-URL-007`–`SCN-URL-013` | `openspec/specs/api-contract-endpoint-security/spec.md` | add | Trust-boundary section: same-origin/base-path containment, URL hardening, redirect policy, redaction, artifact containment, and cursor ownership. | New capability; add this change as the initial capability spec. |
| `REQ-STS-001`–`REQ-STS-003`, `SCN-STS-001`–`SCN-STS-003`, `REQ-TOOL-011` status exception | `openspec/specs/api-status/spec.md` | modify | Status section: add safe `swagger`/`graphql` enabled/framework state; remove REST/GraphQL URL disclosure; no URL/credential/path disclosure. | Existing capability; extend the status specification with safe integration state and record the security-driven removal of endpoint URL fields. |
| `REQ-TOOL-013`, `REQ-CFG-001`–`REQ-CFG-004`, `REQ-URL-001`–`REQ-URL-003`, `REQ-URL-005`–`REQ-URL-006`, `SCN-CFG-001`–`SCN-CFG-006`, `SCN-URL-001`–`SCN-URL-012` | `openspec/specs/conditional-api-contract-tools/spec.md` and `openspec/specs/api-contract-endpoint-security/spec.md` | add | Configuration and URL precedence sections; also dependency-free and framework-validation rules. | Cross-capability; add configuration and URL precedence rules to the relevant new capability specs. |
| `REQ-SCH-001`–`REQ-SCH-003`, `SCN-SCH-001`–`SCN-SCH-008` | `openspec/specs/conditional-api-contract-tools/spec.md` | add | Public input schema section: strict TypeBox-compatible action schemas, unknown-input rejection, and cursor field rules. | New capability spec section for exact tool inputs. |
| `REQ-OUT-008`–`REQ-OUT-012`, `SCN-OUT-011`–`SCN-OUT-020` | `openspec/specs/lossless-bounded-api-results/spec.md` | add | Continuation and output section: cursor mutual exclusions, result envelope, byte/line budgets, cursor TTL, and typed cursor errors. | Extend lossless bounded results capability with remediated contracts. |

The mapping assumes the `openspec/specs/` tree does not yet exist; `add` operations create the target capability specifications during the archive phase. The `api-status` capability is treated as `modify` because the existing public `api_status` tool is extended with safe additive fields and has URL endpoint disclosure removed as a security-driven behavior change. No `remove` operation is required at this change because the legacy GraphQL tools are removed from the extension, not from a durable capability specification; the migration note belongs in the new `conditional-api-contract-tools` spec.
