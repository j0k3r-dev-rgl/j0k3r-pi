# Proposal: Agent-efficient API Tools output contracts

## Intent

Make API Tools output concise, truthful, bounded, and directly actionable for coding agents. Swagger and GraphQL operation discovery should identify one operation cheaply; selected-operation detail should expose only that executable contract; failures and continuation must remain valid and visible without leaking secrets or unsupported authorization claims.

## Scope

### In Scope
- Preserve the six existing public tools and add `detail` actions within `api_swagger` and `api_graphql`.
- Separate compact `discover`, selected-operation `detail`, advanced `schema`, and execution behavior.
- Normalize safe failure envelopes across REST, Swagger, GraphQL, configuration, cancellation, and continuation paths.
- Replace arbitrary serialized-envelope slicing with deterministic logical-record or explicitly framed continuation pages.
- Surface contract-derived authorization provenance with a narrow allowlist and bounded values.
- Preserve native collapsed/expanded Pi rendering, extension independence, current configuration, redaction, cancellation, and network trust boundaries.

### Out of Scope
- New public tools, client generation, full schema browsing, cross-session continuation, or runtime authorization probing.
- Inference of hidden roles, permissions, or effective user access.
- External OpenAPI `$ref` retrieval, cross-origin server selection, backend annotation changes, or new credential behavior.
- Returning arbitrary vendor extensions, provider bodies, internal artifact paths, or secret-bearing data.

## Capabilities

### New Capabilities
- `selected-operation-detail`: Swagger and GraphQL expose one bounded executable operation contract through an explicit `detail` action.
- `contract-authorization-provenance`: Discovery and detail report `declared`, `not_declared`, `unavailable`, or `unknown` authorization state from contract evidence only.
- `structured-output-continuation`: Oversized results continue at complete logical records or explicit framed-text boundaries with deterministic same-tool cursors.
- `truthful-api-tool-failures`: All API Tools families use a compatible safe failure envelope with stable classification and an actionable next step.

### Modified Capabilities
- `api-contract-discovery`: Swagger and GraphQL discovery become bounded minimal operation indexes rather than expanded contract views.
- `api-schema-inspection`: `schema` remains available but is explicitly selected, bounded, and distinct from operation detail.
- `api-tools-rendering`: Native collapsed and expanded views represent detail, authorization provenance, failures, and continuation without adding model context or owning expansion state.
- `api-request-output`: REST, Swagger request, and GraphQL execute use compatible bounded success and failure semantics.

## Approach

Adopt the exploration recommendation to split Swagger and GraphQL discovery/detail/schema formatting into cohesive internal modules while retaining the existing public tool names and thin registration boundary. Centralize failure classification/result formatting, retain the existing session-bound continuation artifact lifecycle, and change its public page construction to operate on redacted logical records or framed text.

Compatibility is an intentional in-place response-contract revision: retain all public tool names and existing action names, add `detail`, and identify revised structured results as contract version `2`. Do not maintain parallel legacy/full envelopes because that would preserve the duplication and malformed-continuation defects this change removes. README migration notes and cross-tool contract tests must identify changed discovery, schema, execution-error, and continuation shapes before apply.

Use these proposal-level bounds as the normative starting point for spec:
- discovery: 50 operations by default and at most 100 per page;
- GraphQL detail: default depth 3, maximum depth 5, and at most 200 returned fields per page;
- Swagger detail: one selected operation per call, with parameters and responses paginated only at complete record boundaries;
- descriptions and vendor values: at most 500 characters per value;
- vendor metadata: at most 32 scalar values per recognized key, each at most 128 characters;
- all actions: retain the configured/default 50,000-byte and 2,000-line response ceilings, with continuation before either ceiling is exceeded.

Recognize only these case-insensitive OpenAPI extension keys: `x-role`, `x-roles`, `x-required-role`, `x-required-roles`, `x-permission`, `x-permissions`, `x-required-permission`, `x-required-permissions`, `x-authority`, `x-authorities`, `x-required-authority`, `x-required-authorities`, `x-scope`, `x-scopes`, `x-required-scope`, and `x-required-scopes`. Accept only bounded scalar strings or arrays of scalar strings; reject or omit objects and report unsupported metadata without returning it. For GraphQL, consume only applied directive metadata actually returned by the server whose directive name is one of `role`, `roles`, `permission`, `permissions`, `authority`, `authorities`, `scope`, `scopes`, `auth`, or `authz` and whose arguments are bounded scalar strings/lists. Standard introspection without applied directive data reports `unavailable`; directive definitions alone do not establish authorization.

GraphQL detail includes bounded descriptions by default because they are part of the executable contract, truncating each to 500 characters with an explicit truncation marker. No additional display flag is introduced unless spec evidence shows a necessary compatibility case.

## Metadata and PRD Alignment
- Metadata: `openspec/changes/api-tools-agent-output-contracts/metadata.yaml`
- PRD: `openspec/changes/api-tools-agent-output-contracts/prd.md`
- metadata_alignment: aligned
- prd_alignment: aligned
- spec_alignment: aligned (spec not yet produced)
- Requirements/context carried forward: approved PRD FR-1 through FR-12; exactly two public contract tools; progressive disclosure; contract-only authorization; safe truthful errors; lossless continuation; non-duplicative model context; native Pi rendering; strict TDD; extension-owned dependencies; OpenSpec authority in hybrid mode.
- Metadata/PRD conflicts_detected: None

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| `extensions/api-tools/src/tools.ts` | Modified | Register revised action schemas and use shared output/failure contracts. |
| `extensions/api-tools/src/swagger.ts` and `src/swagger/` | Modified/New | Dispatch and implement compact discovery, selected detail, and bounded schema inspection. |
| `extensions/api-tools/src/graphql.ts` and `src/graphql/` | Modified/New | Dispatch and implement compact discovery, selected detail, and bounded schema inspection. |
| `extensions/api-tools/src/types.ts` | Modified | Define versioned results, authorization provenance, detail, failure, and continuation types. |
| `extensions/api-tools/src/security.ts` | Modified | Enforce authorization metadata allowlists, bounded scalar extraction, and redaction. |
| `extensions/api-tools/src/client.ts` | Modified | Preserve network controls and expose GraphQL/HTTP failures truthfully. |
| `extensions/api-tools/src/continuation.ts` | Modified | Preserve cursor lifecycle while paging complete logical records or framed text. |
| `extensions/api-tools/src/result-format.ts`, `src/error-classify.ts` | New | Centralize compatible result formatting and failure classification. |
| `extensions/api-tools/src/render.ts` | Modified | Render revised result states with Pi-native expansion. |
| `extensions/api-tools/test/*.test.ts` | Modified | Add strict TDD coverage for contracts, bounds, security, continuation, and rendering. |
| `extensions/api-tools/README.md` | Modified | Document contract version 2, migration, limits, provenance, failures, and continuation. |

## Security / Privacy Impact
- Impact: applicable
- Trust boundaries, sensitive data, permissions, secrets, external calls, input validation, or dependencies affected: authorization metadata crosses an external-contract-to-model boundary; provider errors and continuation artifacts may contain sensitive values; selectors, cursors, references, and response bodies remain untrusted input. Existing same-origin/base-path enforcement, redirect controls, cancellation, extension-owned dependencies, session-bound opaque cursors, and recursive redaction remain mandatory.
- Required security follow-up for spec/design/tasks: specify allowlisted keys/directives and scalar validation; apply redaction before pagination/persistence; distinguish declared requirements from effective access; reject external references; test secret/vendor-payload/internal-path exclusion; preserve cancellation semantics; threat-model malformed introspection, oversized metadata, cursor misuse, and provider error bodies.

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Existing callers break on response contract version 2 | Medium | Retain tool/action identities, publish migration notes, version every revised result, and add cross-tool compatibility tests. |
| Authorization extensions expose sensitive or misleading data | Medium | Exact allowlist, scalar-only bounded values, provenance states, redaction before persistence, and no access inference. |
| Logical pagination skips or duplicates records | Medium | Stable ordering, immutable redacted artifacts, cursor ownership/expiry checks, and reconstruction tests. |
| Detail remains too large or recursively expands | Medium | One selector, cycle detection, depth/field/byte/line bounds, and record-boundary continuation. |
| Refactor causes broad regression | Medium | Preserve thin registration/network boundaries and use strict focused RED-GREEN-REFACTOR plus full package tests/typecheck. |
| Manual Pi behavior differs from renderer tests | Low | Add executable collapsed/expanded/partial/failure/continuation assertions and retain live Pi review as secondary evidence. |

## Rollback Plan

Revert the contract-version-2 implementation and documentation as one change, restoring the prior dispatch, formatting, and continuation behavior while retaining no new persisted format or migration state. Because continuation artifacts are session-bound and temporary, stop active sessions and discard their cursors during rollback. Do not partially roll back only failure classification or redaction; those shared contracts must remain internally consistent.

## Dependencies
- Existing API Tools package, Pi runtime peer/dev dependencies, configuration, client trust controls, redaction, and continuation lifecycle.
- Approved PRD and PRD review warnings.
- No new third-party runtime dependency is expected.
- Spec must make the versioned envelope, bounds, failure codes, provenance semantics, pagination consistency, and archive mappings normative before design.

## Success Criteria
- [ ] Discovery pages contain only bounded stable selectors and compact authorization provenance, with no expanded contracts.
- [ ] One `detail` call returns or deterministically continues exactly one selected executable contract within the stated bounds.
- [ ] `schema` is separate, explicit, and bounded.
- [ ] All revised results identify response contract version `2`, and migration documentation covers changed callers.
- [ ] HTTP, GraphQL, introspection, validation, configuration, cancellation, parsing, and cursor failures use compatible safe actionable envelopes.
- [ ] Every oversized tested output remains valid, reconstructable, redacted, and free of skipped/duplicated records.
- [ ] Authorization metadata uses only approved evidence and always reports provenance/availability without claiming effective access.
- [ ] Renderer tests cover collapsed, expanded, partial, failure, continuation, detail, and authorization states; live Pi review remains a secondary check.
- [ ] Focused TDD evidence, full `npm test`, and `npm run typecheck` pass from `extensions/api-tools` without sibling-extension dependency resolution.
