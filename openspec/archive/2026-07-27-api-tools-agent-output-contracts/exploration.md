## Exploration: api-tools-agent-output-contracts

### Current State

The API Tools extension (`extensions/api-tools/`) already implements a substantial foundation for the new PRD: six public tools, two conditional contract tools (`api_swagger`, `api_graphql`), a lossless artifact/cursor continuation manager, native Pi rendering, and security redaction. The current test suite passes 42 tests and `tsc --noEmit` is clean.

#### Existing public tool contract

`src/tools.ts` registers `api_status`, `api_auth_status`, `api_login`, `api_rest_request`, and conditionally `api_swagger`/`api_graphql`. The two contract tools already expose the actions `discover`, `schema`, and `request`/`execute`. `schema` is currently used as the "one selected operation" view, but it returns a raw schema fragment bounded by `max_depth` rather than the complete executable contract the PRD calls `detail`.

#### Discovery behavior today

- `api_swagger discover` (in `src/swagger.ts`) returns `title`, `version`, all `tags`, and a full `operations` array where each row includes `method`, `path`, `summary`, `id`, and `tags`.
- `api_graphql discover` (in `src/graphql.ts`) returns `name`, `type`, and `return_type` for every Query and Mutation root field. It does not expose authorization metadata.
- Both discovery actions filter on `tag`/`filter` and `operation` but do not paginate by operation boundaries; the continuation manager can chunk the serialized JSON, but that risks slicing mid-document.

#### Detail/schema separation gap

There is no explicit `detail` action. The PRD requires `detail` for one selected operation (executable contract) and `schema` for broad type/schema inspection. Current `schema` overlaps with `detail` but lacks the required fields: inherited parameters, security requirements, OAuth scopes, safe vendor authorization metadata, request/response content contracts, and explicit provenance states.

#### Authorization metadata gap

No code currently extracts or surfaces OpenAPI security requirements, security schemes, OAuth scopes, or safe vendor extensions. `src/security.ts` focuses on secret redaction and JWT expiration. The PRD's four provenance states (`declared`, `not_declared`, `unavailable`, `unknown`) are not implemented.

#### Truthful error behavior today

Errors are classified by `classifyError` in `src/tools.ts`, `src/swagger.ts`, and `src/graphql.ts` with duplicated helpers. HTTP >= 400 in `api_rest_request` is returned as a failure, but Swagger `request` treats HTTP errors as a success payload with `response.status`. GraphQL `execute` always parses the body as success; top-level `errors` are not detected. Introspection failures and invalid JSON are swallowed as generic `validation_error`/`provider_error`.

#### Continuation behavior today

`src/continuation.ts` serializes the complete redacted result to an immutable temp artifact and slices by byte/line budget. The chunking is deterministic and preserves the whole artifact, but the first chunk can be arbitrary JSON fragments (e.g., mid-object). The PRD requires logical record boundaries or explicitly framed text chunks, not slices of a serialized envelope.

#### Renderer behavior today

`src/render.ts` uses the Pi runtime `keyHint` and `Text`, returns a plain component, and handles collapsed/expanded/partial/failure states. It does not leak internal paths or redacted values.

### Affected Areas

- `extensions/api-tools/src/tools.ts` — tool registration, input schemas, error classification, shared helpers.
- `extensions/api-tools/src/swagger.ts` — add `detail` action, compact discovery, security/OAuth/vendor metadata, reference resolution, truthful error handling.
- `extensions/api-tools/src/graphql.ts` — add `detail` action, compact discovery, authorization metadata provenance, introspection error handling, depth/field budgets.
- `extensions/api-tools/src/types.ts` — new authorization metadata types, detail result types, failure envelope categories, continuation metadata.
- `extensions/api-tools/src/security.ts` — extract safe authorization metadata, redact vendor extensions without exposing arbitrary payloads.
- `extensions/api-tools/src/continuation.ts` — keep artifact/cursor lifecycle but make first chunk a logical record or framed text chunk rather than raw JSON fragment.
- `extensions/api-tools/src/client.ts` — minor: GraphQL `execute` should detect top-level errors and surface them as failures rather than success.
- `extensions/api-tools/src/render.ts` — minor: handle `detail` and new authorization states in collapsed/expanded views.
- `extensions/api-tools/test/swagger.test.ts` — expand to cover compact discovery, detail, security, references, error cases.
- `extensions/api-tools/test/graphql.test.ts` — expand to cover detail, authorization provenance, introspection failure, bounded depth/field counts.
- `extensions/api-tools/test/tools.test.ts` — update schema registration, new action enums, error code coverage.
- `extensions/api-tools/test/continuation.test.ts` — logical chunk boundary cases.
- `extensions/api-tools/README.md` — document `detail` actions, authorization metadata provenance, truthful errors, and chunking guarantees.

### Approaches

1. **Add `detail` to existing `swagger.ts`/`graphql.ts` and keep current `schema` as-is**
   - Pros: minimal file churn, builds on existing actions.
   - Cons: leaves `schema` semantically too close to `detail`; does not resolve the mid-document chunking risk; `discover` still exposes more than the PRD allows.
   - Effort: Low-Medium.

2. **Refactor `swagger.ts` and `graphql.ts` into separate discovery/detail/schema modules, add a logical chunk formatter, and centralize error classification**
   - Pros: clean separation of the PRD's three action families; easier to enforce compact discovery, bounded detail, and separate schema; shared failure envelope and continuation formatting; easier to test in isolation.
   - Cons: larger file count, more test files, requires careful coordination with the existing continuation manager.
   - Effort: Medium.

3. **Keep monolithic files but introduce internal helpers for discovery, detail, schema, security, and error formatting**
   - Pros: reuses current file structure, smaller change footprint.
   - Cons: files grow larger and harder to test in isolation; less clear separation of the PRD's distinct concerns.
   - Effort: Medium.

### Recommendation

Adopt **approach 2** (modular refactor) with a conservative scope: introduce internal `swagger/discovery.ts`, `swagger/detail.ts`, `swagger/schema.ts`, `graphql/discovery.ts`, `graphql/detail.ts`, `graphql/schema.ts` (or equivalent helper modules within `src/swagger/` and `src/graphql/` folders), a shared `result-format.ts` for failure envelopes and logical chunking, and a shared `error-classify.ts` for all tools. This is the most maintainable path to satisfy the PRD's separation of concerns and the prior flow's lesson that output-contract defects invalidated verification.

### Metadata and PRD Alignment

- Metadata found: Yes
- PRD found: Yes
- Metadata alignment: aligned
- PRD alignment: aligned
- spec_alignment: not-applicable
- security_alignment: aligned
- Relevant metadata/PRD/security points:
  - PRD FR-1 through FR-12 define compact discovery, explicit `detail`, separate `schema`, contract-derived authorization metadata, truthful errors, structured continuation, and aligned base-tool output.
  - PRD non-goals prohibit inference of hidden roles, credential exposure, arbitrary client generation, and third public tools.
  - PRD warnings require quantifiable bounds, compatibility expectations, and renderer-state checks.
  - PRD open questions defer exact OpenAPI vendor-extension keys and GraphQL server-published metadata to SDD exploration.
- Metadata/PRD/security gaps/conflicts:
  - Current implementation does not expose `detail` actions (PRD FR-3, FR-4, FR-5).
  - Current `discover` output exceeds PRD compactness (PRD FR-2, FR-3).
  - Current authorization metadata is absent (PRD FR-7).
  - Current GraphQL `execute` and Swagger `request` do not consistently classify HTTP/GraphQL errors as failures (PRD FR-8).
  - Current continuation can slice mid-document (PRD FR-9).
  - PRD warns that success metrics need quantified bounds; proposal/spec should decide page sizes, depth limits, and byte budgets.
  - PRD warns about compatibility expectations for existing tool consumers; proposal/spec should define versioned response or migration contract.
  - PRD open question about GraphQL descriptions default should be decided in spec.

### Conflict Resolution

- conflicts_detected: []
- required_decision: None at exploration; proposal/spec should resolve quantified bounds, compatibility/versioning, and the supported vendor-extension set.

### Risks

- **Regression in continuation behavior:** refactoring chunking to logical records changes the observable output format for oversized responses. Mitigation: preserve the existing artifact/cursor lifecycle and only change the public first-chunk format.
- **Security exposure from vendor extensions:** supporting safe authorization-related vendor keys requires an explicit allowlist and redaction. Mitigation: define the exact key set in spec; never return arbitrary extensions.
- **GraphQL introspection failure handling:** changing failure classification may break existing callers that expect a successful empty list. Mitigation: document as a bugfix and define the failure envelope.
- **Breaking change to existing `schema` consumers:** the PRD redefines `schema` as broad type inspection. Mitigation: proposal/spec defines compatibility/versioning.
- **Reference resolution complexity:** local `$ref` resolution and external-ref markers need careful SSRF-safe implementation. Mitigation: resolve only local fragments within the same document; mark external refs as unsupported.
- **Test surface expansion:** the new actions require substantial new fixtures. Mitigation: strict TDD with representative OpenAPI and GraphQL introspection fixtures.

### Ready for Proposal

Yes. The current implementation is a usable foundation, but the PRD introduces material new actions, output contracts, and error semantics that require a proposal/spec phase before implementation.
