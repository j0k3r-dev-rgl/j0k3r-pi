# PRD: Agent-efficient API Tools output contracts

## Status

State: reviewed
Owner: orchestrator
Last updated: 2026-07-26
Approval: approved-by-prd-review

## Problem

The API Tools extension exposes useful Swagger and GraphQL capabilities, but its current model-facing output is inefficient and sometimes misleading. Discovery may return excessive detail or, for GraphQL, falsely report zero operations. Detail output can recursively expand large schemas until the transport cuts JSON mid-document. Provider failures may appear as successful tool calls, leaving the agent without a visible actionable error. Authorization requirements are also omitted even when the API contract exposes security, scopes, roles, or permission metadata.

Agents need progressive disclosure: first identify the available operation by a compact stable name, then request the complete contract for exactly one selected operation. Every response must remain concise, truthful, bounded, and directly useful for selecting the next action.

This PRD supersedes the output and discovery contract of `api-tools-swagger-graphql-contracts`. Its implementation foundation may be reused, but the previous flow was abandoned after live runtime evidence invalidated its verification result.

## Goals

- Make every API Tools response concise, agent-oriented, and free of duplicated context.
- Make Swagger and GraphQL discovery return compact operation indexes rather than expanded contracts.
- Add an explicit `detail` action to both `api_swagger` and `api_graphql` for one selected executable operation.
- Preserve `schema` as advanced type/schema inspection distinct from executable-operation detail.
- Surface authentication, permission, role, authority, or scope metadata when the API contract actually exposes it.
- Report unavailable authorization metadata explicitly rather than guessing.
- Normalize HTTP, GraphQL, validation, provider, cancellation, and continuation failures into visible actionable errors.
- Ensure large successful and failed responses use deterministic structured continuation without malformed JSON fragments or silent data loss.
- Apply the same concise-output and truthful-error principles across all API Tools tools, including `api_rest_request`.
- Preserve native Pi collapsed/expanded rendering while keeping UI expansion independent from model-facing output bounds.

## Non-Goals

- Infer hidden backend authorization rules from endpoint names, successful execution, JWT claims, or application behavior.
- Claim that a user has a role or permission merely because a contract declares a security requirement.
- Inspect backend source code at runtime to reconstruct undocumented authorization policy.
- Add another public continuation or artifact-retrieval tool.
- Expose credentials, access tokens, internal artifact paths, raw secret-bearing headers, or unrestricted provider payloads.
- Change login semantics, token persistence, endpoint trust boundaries, or the extension-owned Pi package contract unless required to preserve the revised output behavior.
- Generate clients, execute arbitrary discovery scans, or use OpenAPI `servers` outside the configured API trust boundary.

## Users / Personas

- **Coding agent:** needs to identify the correct endpoint or GraphQL operation with minimal context, inspect one contract, then invoke it safely.
- **Developer/operator:** needs truthful failures and enough authorization metadata to understand why an invocation may be rejected.
- **Reviewer/maintainer:** needs deterministic output, security boundaries, and tests that prove no context explosion, silent truncation, or permission guessing.

## User Stories

- As an agent, I want `discover` to return only stable operation identities and minimal authorization hints so I can choose the next operation without loading every schema.
- As an agent, I want `detail` for one operation to show exactly what inputs, headers, authentication, permissions, roles, outputs, and errors are contractually known.
- As an agent, I want broad type inspection to remain separate from executable-operation detail so I do not accidentally request an entire schema graph.
- As an agent, I want provider and validation failures to be explicit and actionable instead of appearing as empty or successful results.
- As an agent, I want continuation pages to contain valid structured records with an obvious next cursor rather than arbitrary JSON fragments.
- As an operator, I want authorization metadata to distinguish declared, unavailable, and unknown states without exposing secrets.

## Functional Requirements

### FR-1: Stable public tool set

Keep the two public contract tools, `api_swagger` and `api_graphql`; do not add a third public detail or continuation tool. Each tool SHALL expose `discover`, `detail`, `schema`, and its existing execution action (`request` or `execute`). Existing base tools remain registered according to their current configuration rules.

### FR-2: Compact Swagger discovery

`api_swagger discover` SHALL return a bounded index of operations. Each row SHALL contain only the minimum stable selector and recognition data:

- operation identifier when present;
- HTTP method and path;
- compact declared authorization summary.

It SHALL NOT include parameters, request bodies, response schemas, expanded descriptions, component schemas, raw OpenAPI fragments, or duplicated full records. Filters MAY reduce the index. Oversized indexes SHALL paginate at operation boundaries.

### FR-3: Compact GraphQL discovery

`api_graphql discover` SHALL return a bounded index of executable root fields. Each row SHALL contain only:

- canonical selector, such as `Query.getUnreadCount` or `Mutation.createItem`;
- operation kind (`query` or `mutation`);
- compact declared authorization summary when available.

It SHALL NOT recursively expand arguments, return types, nested fields, descriptions, or the complete schema. A failed, denied, malformed, or partial introspection response SHALL produce an explicit failure or documented partial result; it SHALL NOT silently become an empty successful list.

### FR-4: Selected Swagger operation detail

`api_swagger detail` SHALL accept one stable operation selector and return the complete contract for only that operation, bounded with structured continuation when necessary. The detail SHALL distinguish:

- path, query, header, and cookie parameters;
- required and optional values, types, formats, enums, defaults, and constraints;
- accepted request content types and request-body schema;
- successful and error response status contracts, headers, content types, and body schemas;
- effective authentication/security requirements and referenced security schemes;
- OAuth scopes and safe permission/role/authority vendor metadata when present;
- authorization metadata availability when no such information is published.

Path-level and operation-level parameters/security SHALL follow OpenAPI inheritance and override semantics. Local references SHALL be resolved safely; unsupported or external references SHALL be reported explicitly rather than silently omitted.

### FR-5: Selected GraphQL operation detail

`api_graphql detail` SHALL accept one canonical root-field selector. It SHALL return the complete executable contract for only that field:

- root kind and field name;
- arguments with type, nullability, list shape, default value, description, and deprecation where exposed;
- return type and a bounded useful field contract;
- declared directives, scopes, roles, permissions, or authorities when the server exposes applied metadata;
- authorization metadata availability when standard introspection cannot expose it.

The implementation SHALL handle cycles and enforce depth, field-count, byte, and line limits. It SHALL never traverse the whole reachable schema by default.

### FR-6: Advanced schema inspection remains separate

`schema` SHALL remain available for intentional advanced type/schema inspection. It SHALL require an explicit selector and bounded depth. It SHALL not be used as the default path for discovering or detailing executable operations, and it SHALL honor the same structured continuation and error contracts.

### FR-7: Contract-derived authorization only

Authorization metadata SHALL have an explicit provenance and state:

- `declared`: extracted from standard OpenAPI security requirements/schemes, OAuth scopes, safe recognized vendor extensions, or GraphQL metadata actually exposed by the server;
- `not_declared`: the contract was read successfully but publishes no applicable authorization requirement;
- `unavailable`: the protocol or server response does not expose applied authorization metadata;
- `unknown`: the contract could not be read or interpreted reliably.

The extension SHALL never infer actual runtime roles or permissions. Standard GraphQL introspection limitations SHALL be visible. Safe recognized OpenAPI vendor keys may include role, permission, authority, and scope variants, but arbitrary vendor payloads SHALL not be returned wholesale.

### FR-8: Truthful actionable errors

All tools SHALL use a consistent failure envelope with:

- failure category and stable code;
- concise safe message;
- HTTP status or GraphQL error classification when applicable;
- whether retry or user/configuration correction is plausible;
- one actionable next step when known.

HTTP responses `>=400`, GraphQL top-level `errors`, invalid introspection shapes, configuration failures, cancellation, cursor failures, and parsing failures SHALL not be rendered as ordinary successes. Large raw error bodies, stack traces, internal paths, credentials, and duplicate provider payloads SHALL be excluded or safely bounded.

### FR-9: Structured lossless continuation

Continuation SHALL operate on complete logical records or explicitly framed text chunks, not arbitrary slices of a serialized tool-result envelope. Every bounded response SHALL expose:

- returned item/range count;
- total when known;
- `has_more`;
- an obvious opaque `next_cursor` when more data exists;
- the exact same-tool follow-up action.

Pages SHALL be deterministic, valid model-facing structures and free of skipped or duplicated records. Redaction SHALL occur before persistence or pagination. Cursor ownership, expiry, containment, and cleanup remain session-bound.

### FR-10: No duplicate model context

`content` SHALL contain the concise agent-facing result. `details` SHALL contain only structured metadata required for rendering or continuation and SHALL NOT duplicate the complete domain payload. Expanded rendering MAY present all content in the current page but SHALL not inject hidden full schemas or provider bodies into model context.

### FR-11: Base-tool output alignment

- `api_rest_request` SHALL use the same bounded response and truthful HTTP-error contract as Swagger request execution.
- `api_status`, `api_auth_status`, `api_login`, and authentication/configuration errors SHALL remain compact, safe, and actionable.
- Existing secret redaction, token persistence, same-origin/base-path containment, redirect policy, cancellation, and Git-safety behavior SHALL remain intact.

### FR-12: Native rendering

Collapsed rows SHALL show tool, action, status, selected identity or count, continuation state, and Pi-owned expansion hint. Expanded rows SHALL show the complete current bounded page and actionable error metadata. Rendering SHALL not reveal internal paths, bypass redaction, maintain competing expansion state, hard-code a physical key, or repair malformed execution results cosmetically.

## Acceptance Criteria

- [ ] Swagger discovery returns only operation identity plus compact authorization state and remains bounded for large documents.
- [ ] GraphQL discovery lists actual Query/Mutation root fields and never converts introspection failure into a successful empty list.
- [ ] Each tool has an explicit `detail` action for one executable operation.
- [ ] Swagger detail covers parameters, accepted headers/content, request body, responses/errors, security schemes, scopes, and safe contract-published role/permission metadata.
- [ ] GraphQL detail covers arguments, defaults, nullability, return contract, descriptions/deprecation, and exposed authorization metadata without traversing the full schema.
- [ ] Missing GraphQL applied authorization metadata is reported as unavailable rather than guessed.
- [ ] `schema` remains a separate, explicitly selected, bounded advanced-inspection action.
- [ ] HTTP 500 and GraphQL `errors` are visible failures with safe actionable messages.
- [ ] `api_rest_request`, Swagger request, and GraphQL execute share compatible output/error semantics.
- [ ] Large discovery/detail/execution/error results return valid structured pages with an obvious cursor; no page ends as malformed JSON.
- [ ] Model-facing `content` and renderer `details` do not duplicate complete payloads.
- [ ] Secrets, credentials, internal paths, and unrestricted vendor metadata never appear in outputs or renderers.
- [ ] Focused tests cover indexes, detail selectors, permissions/roles availability states, references/cycles, error classification, structured continuation, redaction, and renderer states.
- [ ] Full API Tools tests and typecheck pass from the extension-owned package environment.
- [ ] Live Pi review confirms compact collapsed rows, useful expanded pages, visible errors, and continuation hints.

## Constraints

- Continue using exactly two public API contract tools.
- Preserve project-local `.pi/api.json` configuration and current trust boundaries.
- Preserve extension independence and API Tools-owned Pi runtime dependencies.
- Use strict schemas and deterministic selectors.
- Apply redaction before output or persistence.
- Treat provider contracts as the only authorization source unless a later explicitly approved capability introduces another source.
- Use strict TDD for implementation.
- Keep OpenSpec authoritative and Engram a compact cursor for this hybrid flow.

## Risks

| Risk | Mitigation |
|---|---|
| OpenAPI omits real application roles | Report provenance and availability; never infer hidden policy. |
| GraphQL standard introspection omits applied directives | Report `unavailable`; support only explicit server-published metadata. |
| Detail still expands large recursive contracts | Enforce selector, cycle detection, depth/field budgets, and structured continuation. |
| Compact discovery removes useful recognition context | Preserve stable selector, method/path or root kind, and compact authorization state only. |
| Error normalization breaks retained callers | Define compatibility expectations and test each tool family before changing shared helpers. |
| Local/external OpenAPI references complicate completeness | Resolve supported local refs and return an explicit unsupported-reference marker for others. |
| Vendor extensions leak excessive metadata | Recognize safe authorization-related keys only and bound every value. |

## Success Metrics

- Discovery output scales with operation count, not schema graph size.
- Selecting one operation requires at most one `discover` page and one `detail` call in the common case.
- No tested provider failure is labeled success.
- No tested oversized result produces malformed JSON or lacks continuation instructions.
- Authorization metadata always states provenance/availability and never claims inferred access.
- Live agent use can identify, inspect, and invoke an operation without loading unrelated endpoint or type contracts.

## Open Questions

- Which exact OpenAPI vendor-extension keys and GraphQL server-specific metadata are present in the target backend? The SDD exploration must inspect redacted contract shapes and define a safe supported set.
- Does the target OpenAPI document use external `$ref` values? External retrieval remains out of scope unless separately approved.
- Should GraphQL `detail` expose descriptions by default or behind an optional display flag when they are unusually long? Default behavior must remain bounded and agent-useful.

## Out of Scope

- Backend annotations or resolver-policy changes required to publish currently hidden roles/permissions.
- Runtime authorization testing by attempting privileged mutations.
- Cross-origin endpoint compatibility or OpenAPI server selection.
- Persistent cross-session continuation.
- A generic GraphQL IDE, full SDL browser, generated client, or documentation portal.
