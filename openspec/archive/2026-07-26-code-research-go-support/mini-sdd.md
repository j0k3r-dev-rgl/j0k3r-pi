# Mini-SDD: Tree-sitter Go support for code-research

## Flow selection

- Flow: `mini-sdd`
- Artifact store: `hybrid`
- Execution mode: `auto`
- Selection locked: 2026-07-26T00:34:11Z
- Initial packet revision: `go-support-initial-20260726T003411Z-v1`
- Explore packet revision: `go-support-explore-20260726T003411Z-v2`

This selection authorizes creation of the flow and read-only planning. It does not authorize implementation, archive, commit, branch, tag, or push operations.

## Prior evidence

The user wants `code-research` to support Go in the same practical way it already supports Java and TypeScript/JavaScript. The implementation must follow the existing language architecture and use Tree-sitter; it must not introduce `gopls`, CHA/RTA/VTA analysis, or a separate Go semantic helper.

Read-only discovery found the extension under `extensions/code-research/`. Go is currently absent from public language schemas, shared language types, source policy, parser cache, project detection, graph policy/schema, language dispatch, persisted graph coverage, and tests. Existing graph traversal is largely language-neutral once Go nodes and edges are produced.

Known likely surfaces included:

- `extensions/code-research/src/tools/`
- `extensions/code-research/src/types.ts`
- `extensions/code-research/src/core/`
- a new `extensions/code-research/src/languages/go/`
- `extensions/code-research/test/`, including workspace-graph fixtures

## Expected behavior

Add `go` as a supported language, including auto-detection and the same applicable public operations provided for Java and TypeScript/JavaScript:

- symbol lookup;
- reference lookup;
- forward call trees;
- reverse call trees;
- persisted workspace graph generation, validation, status, and graph-backed queries.

The Go implementation should recognize the corresponding Go declarations and calls needed to provide parity within the existing syntactic Tree-sitter model. Existing limits, exclusions, diagnostics, result bounding, and compatibility expectations remain consistent unless explore identifies a concrete language-specific requirement.

## Explore results

Explore validated the existing architecture and confirmed the best template is the Java language module, with TypeScript/JS patterns for cross-file import resolution and call-tree dispatch. Go will be a new first-class language module with full public tool support, not merely graph indexing.

### Structural template

- **Symbol model / extraction**: mirror `src/languages/java/symbol-model.ts` and `src/languages/java/symbol-extractor.ts`.
- **Find symbol adapter**: mirror `src/languages/java/find-symbol.ts`.
- **Find references direct analyzer**: mirror `src/languages/java/find-references.ts`.
- **Call tree / reverse call tree**: mirror `src/languages/java/function-call-tree.ts` and `src/languages/java/reverse-function-call-tree.ts`, but simplified because Go has no class inheritance.
- **Workspace graph builder**: hook into `src/core/workspace-graph.ts` next to the Java/TS/Python branches.

### Go declarations and expression forms needed for parity

- `package_clause` (package name)
- `function_declaration` (top-level function)
- `method_declaration` (function with receiver)
- `type_declaration` / `type_spec` (named types, structs, interfaces)
- `var_declaration` / `const_declaration` (top-level variables/constants)
- `interface_type` / `method_spec` (interface method signatures)
- `call_expression` (direct calls)
- `selector_expression` (method calls and package-qualified calls)
- `import_declaration` / `import_spec` (cross-package references)

### Graph schema / version updates

- Add `go` to `SupportedLanguage` and to GraphNode language literals in `src/types.ts`.
- Add `go` to `GRAPH_POLICY_SUPPORTED_LANGUAGES` in `src/core/graph-policy.ts`.
- Add `go` to `detectGraphLanguage` and `SUPPORTED_GRAPH_SOURCE_EXTENSIONS` in `src/core/source-policy.ts`.
- Add a `goSymbolCoverage` proof block in the shard schema (mirror `javaSymbolCoverage`) to satisfy `validateSubprojectGraphShard`.
- No schema version bump is required for the new language; the existing schema version already accommodates additional language fields as additive changes.

### Dependency placement

- Add `tree-sitter-go@0.23.3` to `extensions/code-research/package.json` `dependencies`.
- This version has a peer dependency on `tree-sitter@^0.21.1`, matching the current pinned `tree-sitter` version.
- Run `npm install` inside `extensions/code-research/` so the extension owns its own lockfile and `node_modules`, preserving dependency independence.

### Project / source policy

- Add Go markers to `SUBPROJECT_MARKERS` in `src/core/project-detector.ts`: `go.mod`, `go.work`.
- `.go` files are already plain text and fit the existing `MAX_GRAPH_SOURCE_BYTES` limit; no special source policy is needed for `_test.go`, build tags, or generated files beyond the generic exclusion rules.
- `go.work` should be treated as a subproject marker (not a source file), so `go.work` directories are not automatically traversed as source.

### Test order and validation commands

- `npm run typecheck` inside `extensions/code-research/` after every structural change.
- `npm test` with focused new tests first, then full package suite.
- New test files:
  - `extensions/code-research/test/find-symbol-go.test.ts`
  - `extensions/code-research/test/find-references-go.test.ts`
  - `extensions/code-research/test/function-call-tree-go.test.ts`
  - `extensions/code-research/test/reverse-function-call-tree-go.test.ts`
  - `extensions/code-research/test/workspace-graph/shard-content-go.test.ts` (or additions to `shard-content.test.ts`)
- Red-green-refactor each slice before moving to the next.
- Final regression: full `npm test` and `npm run typecheck` in `extensions/code-research/`.

## Apply-ready packet

### Scope

Add first-class Go support to `extensions/code-research/` using `tree-sitter-go@0.23.3` with practical parity to Java and TypeScript/JavaScript public tools.

### Non-goals

- No `gopls`, language-server, or Go compiler integration.
- No whole-program CHA/RTA/VTA call-graph analysis.
- No cross-package full type inference beyond syntactic receiver/import matching.
- No public Python-style "graph-only" intermediate state; Go must be exposed through all public tools from the start.
- No changes to authentication, authorization, network, secrets, or user-data policy.
- No commit, branch, tag, or push operations.

### Relevant files and symbols

#### Files to modify

| Path | Reason | Expected change |
|------|--------|----------------|
| `extensions/code-research/package.json` | add parser dependency | add `tree-sitter-go@0.23.3` to `dependencies` |
| `extensions/code-research/src/types.ts` | language type literals | add `go` to `SupportedLanguage`, `GraphNode`, and related coverage types |
| `extensions/code-research/src/core/parser.ts` | parser cache | add Go parser factory and import |
| `extensions/code-research/src/core/source-policy.ts` | file detection | add `.go` to supported extensions and language detection |
| `extensions/code-research/src/core/project-detector.ts` | project markers | add `go.mod` / `go.work` to `SUBPROJECT_MARKERS` |
| `extensions/code-research/src/core/graph-policy.ts` | graph-supported languages | add `go` to `GRAPH_POLICY_SUPPORTED_LANGUAGES` and normalize function |
| `extensions/code-research/src/core/graph-schema.ts` | schema validation | add `go` language literal and Go coverage proof shape |
| `extensions/code-research/src/core/shared.ts` | language detection | add `go` case to `detectLanguage` |
| `extensions/code-research/src/core/find-symbol-resolver.ts` | language dispatch | add Go language adapter and include `go` in graph coverage path |
| `extensions/code-research/src/core/find-references-resolver.ts` | language dispatch | add `go` branch and Go graph coverage |
| `extensions/code-research/src/core/function-call-tree-resolver.ts` | language dispatch | add Go execution branch |
| `extensions/code-research/src/core/reverse-function-call-tree-resolver.ts` | language dispatch | add Go execution branch |
| `extensions/code-research/src/core/workspace-graph.ts` | graph construction | add Go shard-building branch |
| `extensions/code-research/src/tools/find-symbol.ts` | public tool schema | add `go` to language literal union |
| `extensions/code-research/src/tools/find-references.ts` | public tool schema | add `go` to language literal union |
| `extensions/code-research/src/tools/function-call-tree.ts` | public tool schema | add `go` to language literal union |
| `extensions/code-research/src/tools/reverse-function-call-tree.ts` | public tool schema | add `go` to language literal union |
| `extensions/code-research/src/tools/workspace-graph.ts` | status summary | add `go` language count and update rendered text |
| `extensions/code-research/README.md` | public contract | add Go row to supported-language table and update tool descriptions |

#### Files to create

| Path | Reason |
|------|--------|
| `extensions/code-research/src/languages/go/symbol-model.ts` | Go declaration kinds, coarse kinds, modifiers, ID hashing, signature helpers |
| `extensions/code-research/src/languages/go/symbol-extractor.ts` | Tree-sitter traversal emitting Go canonical symbol records |
| `extensions/code-research/src/languages/go/find-symbol.ts` | Direct `find_symbol` adapter for Go |
| `extensions/code-research/src/languages/go/find-references.ts` | Direct `find_references` analyzer for Go |
| `extensions/code-research/src/languages/go/function-call-tree.ts` | Forward and reverse Go call-tree execution |
| `extensions/code-research/src/languages/go/shared.ts` | Go signature helpers and language detection |
| `extensions/code-research/src/languages/go/workspace-graph.ts` | Go graph builder used by `src/core/workspace-graph.ts` |
| `extensions/code-research/test/find-symbol-go.test.ts` | TDD evidence for Go symbol lookup |
| `extensions/code-research/test/find-references-go.test.ts` | TDD evidence for Go reference lookup |
| `extensions/code-research/test/function-call-tree-go.test.ts` | TDD evidence for Go forward call tree |
| `extensions/code-research/test/reverse-function-call-tree-go.test.ts` | TDD evidence for Go reverse call tree |
| `extensions/code-research/test/workspace-graph/shard-content-go.test.ts` | Go graph shard coverage proofs |
| `extensions/code-research/docs/go-symbol-coverage-v1.md` | Go coverage contract (mirror Java doc) |
| `extensions/code-research/docs/go-symbol-contract-v1.md` | Go symbol contract (mirror TypeScript doc) |

#### Files to delete

None.

### Ordered implementation steps

1. **Dependency & parser wiring**
   - Add `tree-sitter-go@0.23.3` to `package.json` and run `npm install` inside `extensions/code-research/`.
   - Add Go parser to `src/core/parser.ts` and `.go` detection to `src/core/source-policy.ts`.
   - Add `go.mod` / `go.work` markers to `src/core/project-detector.ts`.
   - Add `go` to `src/types.ts` language literals.
   - Add `go` to `src/core/graph-policy.ts` supported languages.
   - Update `src/tools/*` schemas and `src/core/shared.ts` to accept `go`.
   - Run `npm run typecheck` (expect failures for missing Go module, but verify wiring compiles).

2. **Go symbol model and extraction**
   - Create `src/languages/go/symbol-model.ts` with Go-specific declaration kinds, coarse kinds, modifier allowlist, and ID hashing (mirror `java/symbol-model.ts`).
   - Create `src/languages/go/symbol-extractor.ts` that visits `package_clause`, `function_declaration`, `method_declaration`, `type_declaration`, `var_declaration`, `const_declaration`, and interface `method_spec` nodes.
   - Create `src/languages/go/find-symbol.ts` adapter.
   - Write `test/find-symbol-go.test.ts` with red tests for package, function, method, and interface lookup.
   - Implement until tests pass.
   - Run `npm test test/find-symbol-go.test.ts` and `npm run typecheck`.

3. **Go workspace graph indexing**
   - Create `src/languages/go/workspace-graph.ts` that builds file/symbol nodes and `calls`/`implements`/`imports` edges.
   - Resolve direct calls to same-package functions; resolve selector calls to methods on types declared in the same package; mark cross-package/package-qualified calls as external.
   - Add Go branch to `src/core/workspace-graph.ts`.
   - Update `src/core/graph-schema.ts` to accept `go` language and add `goSymbolCoverage` proof.
   - Write `test/workspace-graph/shard-content-go.test.ts` with red tests for file/symbol nodes and internal call edges.
   - Implement until tests pass.
   - Run `npm test test/workspace-graph/shard-content-go.test.ts` and `npm run typecheck`.

4. **Go call trees (forward and reverse)**
   - Create `src/languages/go/function-call-tree.ts` (forward and reverse) using the same package-level index.
   - Add Go branch to `src/core/function-call-tree-resolver.ts` and `src/core/reverse-function-call-tree-resolver.ts`.
   - Write `test/function-call-tree-go.test.ts` and `test/reverse-function-call-tree-go.test.ts` with red tests.
   - Implement until tests pass.
   - Run focused tests and `npm run typecheck`.

5. **Go find references**
   - Create `src/languages/go/find-references.ts` direct analyzer covering calls, imports, selector reads, and local identifier usages.
   - Add `go` branch to `src/core/find-references-resolver.ts`.
   - Write `test/find-references-go.test.ts` with red tests.
   - Implement until tests pass.
   - Run focused tests and `npm run typecheck`.

6. **Tool schema, README, and contract docs**
   - Add `go` to all public tool schemas in `src/tools/*`.
   - Update `src/tools/workspace-graph.ts` language counts.
   - Update `README.md` supported-language table.
   - Add `docs/go-symbol-coverage-v1.md` and `docs/go-symbol-contract-v1.md`.
   - Run `npm run typecheck`.

7. **Regression validation**
   - Run full `npm test` in `extensions/code-research/`.
   - Run `npm run typecheck`.
   - Fix any regressions with new focused tests.

### Measurable acceptance criteria

1. `npm run typecheck` in `extensions/code-research/` passes with zero errors.
2. `npm test` in `extensions/code-research/` passes, including all existing tests (no regressions).
3. `find_symbol` with `language: 'go'` returns correct package, function, method, type, and interface symbols from representative Go fixtures.
4. `find_symbol` for a Go interface returns `implementation_locations` for concrete types that implement its method set syntactically.
5. `find_references` with `language: 'go'` returns call sites, imports, and local usages for a representative Go symbol.
6. `function_call_tree` with `language: 'go'` returns a tree rooted at a Go function/method and expands internal same-package calls.
7. `reverse_function_call_tree` with `language: 'go'` returns a reverse tree rooted at a Go function/method and expands internal same-package callers.
8. `buildWorkspaceGraph` produces a Go shard with file/symbol nodes, `calls` edges, and a valid `goSymbolCoverage` proof.
9. `workspace_graph_status` reports Go language coverage and counts `go` files/symbols.
10. `README.md` documents Go as a supported language for the applicable tools.

### Validation commands

```bash
cd extensions/code-research
npm run typecheck
npm test
npm test test/find-symbol-go.test.ts
npm test test/find-references-go.test.ts
npm test test/function-call-tree-go.test.ts
npm test test/reverse-function-call-tree-go.test.ts
npm test test/workspace-graph/shard-content-go.test.ts
```

### Allowed surfaces

- `extensions/code-research/src/languages/go/*` (new module)
- `extensions/code-research/src/core/*` (language-dispatch additions)
- `extensions/code-research/src/tools/*` (schema additions)
- `extensions/code-research/src/types.ts` (language literal additions)
- `extensions/code-research/src/config.ts` (no changes expected unless config needs a Go key)
- `extensions/code-research/test/*` (new Go tests)
- `extensions/code-research/docs/*` (new Go contract docs)
- `extensions/code-research/README.md` (public contract update)
- `extensions/code-research/package.json` (single dependency addition)
- `extensions/code-research/package-lock.json` (generated by `npm install`)

### Forbidden surfaces

- No `gopls`, `go build`, `go vet`, `gopls`, or any Go toolchain invocation.
- No CHA/RTA/VTA or whole-program pointer analysis.
- No changes to `.pi/code-research.json` schema or default values.
- No changes to authentication, authorization, secrets, network, or user-data handling.
- No new public tools beyond the existing five (`find_symbol`, `find_references`, `function_call_tree`, `reverse_function_call_tree`, `workspace_graph_status`).
- No changes to other Pi extensions or shared runtime packages.
- No cross-extension package borrowing; `tree-sitter-go` must be installed by `extensions/code-research/package.json`.
- No commit, branch, tag, or push.

### Security / privacy / auth / data constraints

- No auth or secret handling change.
- New parser dependency must be an established `tree-sitter` grammar (`tree-sitter-go`) with a compatible version pinned.
- Preserve existing path exclusions, source-size limits, bounded output, cache safety, and workspace-only analysis.
- No user source code is transmitted outside the workspace.
- Generated `.pi/workspace-code-graph` artifacts remain under the existing ignore policy.

### Known unknowns and blockers

- **tree-sitter-go native binary compilation**: `npm install` will compile a native module. This is expected to work on the development environment, but if it fails, the apply is blocked until a compatible prebuilt binary or alternative environment is available.
- **Receiver type resolution precision**: The initial implementation will resolve method calls using syntactic receiver type names within the same package. Cross-package method resolution (e.g., `pkg.Foo.Bar()` where `Foo` is imported) will be marked as external unless the import path can be cheaply mapped to a local package.
- **Generic methods**: `type_parameter_list` on functions/methods must be included in signatures and IDs but does not need full constraint analysis for parity.
- **Build tags and generated files**: Generic source exclusions already cover `vendor`, `node_modules`, and dot directories. `_test.go` files are plain `.go` and will be indexed like any other source file; this matches current behavior for test files in other languages.

### Persistence updates

- `openspec/changes/code-research-go-support/mini-sdd.md` (this file) — authoritative lifecycle record.
- `openspec/changes/code-research-go-support/metadata.yaml` — flow state and skill plan.
- Engram active-flow observation `sdd.active-flow.code-research-go-support` — compact cursor.

### Next recommended phase

`apply` — the exact packet was approved and recorded locally; invoke `sdd-apply` once for the complete approved batch.

## Apply approval record

- Approval ID: `apply-go-support-20260726T003919Z`
- Type: `apply`
- Approved packet revision: `go-support-explore-20260726T003411Z-v2`
- Execution strategy: `single-batch`
- Scope refs: `packet:go-support-explore-20260726T003411Z-v2`, `strategy:single-batch`, `scope:extensions/code-research/**`, `artifact:openspec/changes/code-research-go-support/mini-sdd.md`, `acceptance:criteria-1-10`, `validation:code-research-typecheck-and-full-tests`
- Scope fingerprint: `sha256:87db928ea2b7422eaf300b86d650358521bbb50271b4d0e1e695b3b08ea49709`
- Approval record ref: `openspec/changes/code-research-go-support/mini-sdd.md#apply-approval-record`
- Recorded at: `2026-07-26T00:39:19Z`
- Approved scope summary: Implement the approved Tree-sitter Go parity packet within the code-research extension as one TDD batch.
- Approval summary redacted: `true`

This approval does not authorize archive, commit, branch, tag, or push operations.

## Initial acceptance direction

(Kept from initial packet; now refined into the measurable acceptance criteria above.)

## Security and boundaries

(Kept from initial packet; now refined into the constraints above.)

## Explore questions

1. **What exact existing language module is the best structural template for each Go capability?**
   - Java for symbol model/extraction, find-symbol, find-references, call-tree, and graph coverage proofs.
   - TypeScript for cross-file import resolution and tool schema patterns.

2. **Which Go declarations and expression forms are necessary for practical Java/TS-JS parity?**
   - `package_clause`, `function_declaration`, `method_declaration`, `type_declaration`, `var_declaration`, `const_declaration`, interface `method_spec`, `call_expression`, `selector_expression`, `import_declaration`/`import_spec`.

3. **Which graph schema/version and compatibility updates are required?**
   - Add `go` to language literals and supported sets; add `goSymbolCoverage` proof block. No schema version bump needed.

4. **What focused test order and commands will provide red-green-refactor evidence and regression coverage?**
   - Dependency/parser wiring → symbol extraction → graph indexing → call trees → find references → schemas/docs → full regression.

5. **Are generated files, `_test.go`, build tags, or `go.work` already governed adequately by generic source/project policy, or does parity require a small explicit rule?**
   - Generic exclusions cover generated/cache directories. `go.work` and `go.mod` are added as project markers. `_test.go` files are treated as regular `.go` source files.

## Apply result

- Status: `complete`
- Approval ID: `apply-go-support-20260726T003919Z`
- Approved packet revision: `go-support-explore-20260726T003411Z-v2`
- Scope fingerprint: `sha256:87db928ea2b7422eaf300b86d650358521bbb50271b4d0e1e695b3b08ea49709`
- Files changed:
  - `extensions/code-research/package.json`
  - `extensions/code-research/package-lock.json`
  - `extensions/code-research/src/types.ts`
  - `extensions/code-research/src/core/parser.ts`
  - `extensions/code-research/src/core/source-policy.ts`
  - `extensions/code-research/src/core/project-detector.ts`
  - `extensions/code-research/src/core/graph-policy.ts`
  - `extensions/code-research/src/core/graph-schema.ts`
  - `extensions/code-research/src/core/find-symbol-resolver.ts`
  - `extensions/code-research/src/core/find-references-resolver.ts`
  - `extensions/code-research/src/core/function-call-tree-resolver.ts`
  - `extensions/code-research/src/core/reverse-function-call-tree-resolver.ts`
  - `extensions/code-research/src/core/workspace-graph.ts`
  - `extensions/code-research/src/languages/go/*`
  - `extensions/code-research/src/tools/find-symbol.ts`
  - `extensions/code-research/src/tools/find-references.ts`
  - `extensions/code-research/src/tools/function-call-tree.ts`
  - `extensions/code-research/src/tools/reverse-function-call-tree.ts`
  - `extensions/code-research/src/tools/workspace-graph.ts`
  - `extensions/code-research/test/find-symbol-go.test.ts`
  - `extensions/code-research/test/find-references-go.test.ts`
  - `extensions/code-research/test/function-call-tree-go.test.ts`
  - `extensions/code-research/test/reverse-function-call-tree-go.test.ts`
  - `extensions/code-research/test/workspace-graph/shard-content-go.test.ts`
  - `extensions/code-research/docs/go-symbol-coverage-v1.md`
  - `extensions/code-research/docs/go-symbol-contract-v1.md`
  - `extensions/code-research/README.md`
- Validation evidence:
  - `cd extensions/code-research && npm run typecheck`
  - `cd extensions/code-research && npm test`
  - `cd extensions/code-research && npm test -- test/find-symbol-go.test.ts test/find-references-go.test.ts test/function-call-tree-go.test.ts test/reverse-function-call-tree-go.test.ts test/workspace-graph/shard-content-go.test.ts`
- Deviations from explore packet: none
- Security alignment: preserved existing workspace-only parsing, path exclusions, bounded output, and no external transmission/toolchain use
- Engram cursor update: blocked by unavailable Engram HTTP service; OpenSpec remains authoritative for this hybrid flow

## Phase results

- `sdd-explore` completed.
- `sdd-apply` completed.
- Packet revision: `go-support-explore-20260726T003411Z-v2`.
- Recommended next phase: `verify`.

## Verify result

## Verification Report

**Change**: code-research-go-support
**Mode**: Strict TDD

### Completeness
| Metric | Value |
|--------|-------|
| Acceptance criteria total | 10 |
| Acceptance criteria satisfied | 9 |
| Acceptance criteria incomplete | 1 |

### Build & Tests Execution
- `cd extensions/code-research && npm run typecheck`: passed; `tsc --noEmit` completed with zero reported errors.
- `cd extensions/code-research && npm test -- test/find-symbol-go.test.ts test/find-references-go.test.ts test/function-call-tree-go.test.ts test/reverse-function-call-tree-go.test.ts test/workspace-graph/shard-content-go.test.ts`: passed; 5 files, 6 tests passed.
- `cd extensions/code-research && npm test`: passed; 30 files, 234 tests passed.
- `cd extensions/code-research && npm ls tree-sitter-go --depth=0`: passed; `tree-sitter-go@0.23.3` is owned by `pi-code-research-extension`.

### Metadata Compliance
| Metadata Constraint / Validation Expectation | Evidence | Result |
|---------------------------------------------|----------|--------|
| Hybrid mini-SDD authoritative OpenSpec state | `metadata.yaml` and this `mini-sdd.md` read; Engram observation `1348` is compact cursor only | PASS |
| Apply approval matches packet revision and scope fingerprint | Approval `apply-go-support-20260726T003919Z`, packet `go-support-explore-20260726T003411Z-v2`, fingerprint `sha256:87db928ea2b7422eaf300b86d650358521bbb50271b4d0e1e695b3b08ea49709` match metadata and apply result | PASS |
| Validation expectations | Typecheck, focused Go tests, and full test suite executed and passed | PASS |
| Strict TDD expectation | New Go tests exist for symbol, references, call trees, reverse call trees, and graph shard coverage; apply handoff records focused and full validation | PASS |

### PRD Compliance Matrix
| PRD Requirement / Acceptance Criterion | Evidence | Result |
|----------------------------------------|----------|--------|
| PRD waived for this mini-SDD | `prd_policy: waived`; no formal PRD is in scope | NOT APPLICABLE |

### Spec / Task Packet Compliance Matrix
| Requirement/Scenario or Acceptance Criterion | Implementation Evidence | Runtime/Build/Test Evidence | Result |
|----------------------------------------------|-------------------------|-----------------------------|--------|
| 1. `npm run typecheck` passes | TypeScript code compiles after Go wiring | `npm run typecheck` passed | PASS |
| 2. Full `npm test` passes | Go implementation did not regress existing package suite | `npm test` passed: 30 files, 234 tests | PASS |
| 3. `find_symbol` supports Go package, function, method, type, and interface symbols | Go symbol extractor and find-symbol adapter; dispatch in `find-symbol-resolver.ts` | `find-symbol-go.test.ts` passed | PASS |
| 4. Go interface implementation locations are returned | Go interface/method-set matching and explicit assertion handling | `find-symbol-go.test.ts` graph-mode interface implementation test passed | PASS |
| 5. `find_references` supports Go calls, imports, and local usages | `languages/go/find-references.ts`; resolver branch for `go` | `find-references-go.test.ts` passed | PASS |
| 6. `function_call_tree` supports Go internal same-package calls | `executeGoFunctionCallTree` and resolver branch | `function-call-tree-go.test.ts` passed | PASS |
| 7. `reverse_function_call_tree` supports Go callers | `executeGoReverseFunctionCallTree` and resolver branch | `reverse-function-call-tree-go.test.ts` passed | PASS |
| 8. Workspace graph emits Go shard nodes, calls edges, and `goSymbolCoverage` | Go graph builder, schema validation, coverage proof | `workspace-graph/shard-content-go.test.ts` passed | PASS |
| 9. `workspace_graph_status` reports Go language coverage and counts Go files/symbols | Implementation adds a `go` language bucket to status summary, but the status summary does not expose per-language Go file or symbol counts; no focused test exercises Go status counts | Typecheck/full suite passed but no criterion-specific runtime evidence | FAIL |
| 10. README documents Go support | Supported-language table includes Go for public tools and graph indexing | Full suite/typecheck passed; documentation inspected | PASS |

### Security Compliance Matrix
| Security / Privacy / Abuse Requirement | Implementation Evidence | Validation Evidence | Result |
|----------------------------------------|-------------------------|---------------------|--------|
| No auth, secret, network, or external transmission changes | Changed files are limited to parser/language dispatch, graph, tests, docs, and package dependency; no auth/network surfaces found in approved changed set | Typecheck and tests passed | PASS |
| Dependency independence | `tree-sitter-go@0.23.3` is declared in `extensions/code-research/package.json` dependencies | `npm ls tree-sitter-go --depth=0` confirms package-local dependency | PASS |
| Preserve workspace-only parsing, path exclusions, and source-size limits | Go is added to existing source policy and parser paths; generic exclusions and `MAX_GRAPH_SOURCE_BYTES` remain in `source-policy.ts` | Typecheck and graph shard tests passed | PASS |
| No Go toolchain / gopls / CHA-RTA-VTA | Implementation uses Tree-sitter Go only; no Go toolchain invocation was used in validation | Validation commands were npm/typecheck/Vitest only | PASS |

### Scope Compliance
| Allowed/Forbidden Scope | Evidence | Result |
|-------------------------|----------|--------|
| Allowed `extensions/code-research/**` implementation/test/docs/package surfaces | Changed Go support files are within approved extension surfaces | PASS |
| Forbidden other extension/shared runtime changes | `git status --short` shows other workflow/config files are dirty, but Go implementation evidence is confined to `extensions/code-research/**`; those unrelated dirty files are outside this verify verdict | WARNING |
| No commit/branch/tag/push | No Git mutation commands run | PASS |

### Handoff Compliance
| Applicable handoff expectation | Evidence | Result |
|--------------------------------|----------|--------|
| Durable apply approval record and applied packet revision | Metadata and mini-SDD approval record match apply result | PASS |
| Mini approved scope | Apply-result file list and inspected implementation align with approved Go-support packet except criterion 9 | FAIL |
| Expected files/symbols addressed | Go language module, resolver dispatch, parser/source policy, graph schema/builder, tests, docs, and dependency are present | PASS |
| Validation plan executed or justified | Focused Go tests, full test suite, typecheck, and dependency ownership check executed | PASS |
| Deviations explained | Verification found missing Go file/symbol counts in `workspace_graph_status`; remediation required | FAIL |

### Design Coherence
| Decision | Followed? | Notes |
|----------|-----------|-------|
| Mirror existing Java/TypeScript code-research architecture | Yes | Go module follows parser/extractor/resolver/graph patterns. |
| Tree-sitter-only Go support | Yes | Uses `tree-sitter-go`; no Go toolchain or language server. |
| Graph schema additive Go coverage proof | Yes | `goSymbolCoverage` is validated and tested. |
| Public tool parity | Mostly | Core four query tools and graph indexing are covered; status reporting lacks requested Go file/symbol counts. |

### Issues Found
**CRITICAL**
- AC9 incomplete: `workspace_graph_status` does not report per-language Go file and symbol counts, and there is no focused runtime test for those counts.

**WARNING**
- Worktree contains unrelated dirty workflow/config files; they were not treated as implementation scope evidence for this mini-SDD.

**SUGGESTION**
- Update README detailed tool parameter prose to mention `go` consistently, not only in the supported-language table.

### Verdict
FAIL

## Remediation apply-ready packet

- Packet revision: `go-support-remediation-ac9-20260726T011048Z-v1`
- Trigger: failed acceptance criterion 9 from the independent verification above.
- Goal: make `workspace_graph_status` report Go file and symbol counts with focused runtime evidence, and align detailed README tool descriptions with the already-supported `go` language value.
- Allowed implementation surfaces:
  - `extensions/code-research/src/tools/workspace-graph.ts`
  - focused tests under `extensions/code-research/test/**`
  - `extensions/code-research/README.md`
- Forbidden surfaces: all other implementation/package/config surfaces unless a concrete compile/test blocker makes them unavoidable and the apply returns blocked for a new decision.
- Required TDD sequence: add a focused failing status-count test, implement the minimum status summary change, pass the focused test, then update README prose.
- Required validation:
  - focused workspace graph status test;
  - `cd extensions/code-research && npm run typecheck`;
  - `cd extensions/code-research && npm test`.
- Acceptance:
  1. `workspace_graph_status` exposes deterministic Go file and symbol counts from persisted graph data.
  2. A focused runtime test proves those counts for a representative Go graph.
  3. Detailed English and Spanish README tool descriptions and parameter lists mention Go consistently where applicable.
  4. Existing tests and typecheck remain green.

## Remediation apply approval record

- Approval ID: `apply-go-support-remediation-ac9-20260726T011048Z`
- Type: `apply`
- Approved packet revision: `go-support-remediation-ac9-20260726T011048Z-v1`
- Execution strategy: `single-batch-remediation`
- Scope refs: `packet:go-support-remediation-ac9-20260726T011048Z-v1`, `strategy:single-batch-remediation`, `issue:acceptance-criterion-9-go-file-symbol-counts`, `acceptance:workspace-graph-status-reports-go-file-and-symbol-counts`, `acceptance:focused-runtime-test-covers-go-status-counts`, `docs:readme-go-tool-descriptions-consistent`, `scope:extensions/code-research/src/tools/workspace-graph.ts`, `scope:extensions/code-research/test/**`, `scope:extensions/code-research/README.md`, `validation:typecheck-focused-status-test-full-suite`
- Scope fingerprint: `sha256:4cccc46dd56238c0580a1a4939724ef1f06699c86bb0e77f98fa5b15f7c7d8b7`
- Approval record ref: `openspec/changes/code-research-go-support/mini-sdd.md#remediation-apply-approval-record`
- Recorded at: `2026-07-26T01:10:48Z`
- Approved scope summary: Remediate Go workspace status file and symbol counts, add focused runtime coverage, and align detailed README Go descriptions.
- Approval summary redacted: `true`

This approval does not authorize archive, commit, branch, tag, or push operations.

## Remediation apply result

- Status: `complete`
- Approval ID: `apply-go-support-remediation-ac9-20260726T011048Z`
- Approved packet revision: `go-support-remediation-ac9-20260726T011048Z-v1`
- Scope fingerprint: `sha256:4cccc46dd56238c0580a1a4939724ef1f06699c86bb0e77f98fa5b15f7c7d8b7`
- Files changed:
  - `extensions/code-research/src/tools/workspace-graph.ts`
  - `extensions/code-research/test/extension-entry.test.ts`
  - `extensions/code-research/README.md`
- What was done:
  - added persisted-shard per-language file and symbol counting to `workspace_graph_status`
  - exposed Go file and symbol counts in the compact status text and structured `languageCoverage` details
  - added a focused integration test covering Go status counts
  - aligned English and Spanish README tool descriptions and parameter lists with the supported `go` language
- Validation evidence:
  - `cd extensions/code-research && npm test -- test/extension-entry.test.ts -t "reports Go file and symbol counts in workspace_graph_status details and summary text"`
  - `cd extensions/code-research && npm run typecheck`
  - `cd extensions/code-research && npm test`
- Deviations from remediation packet: none
- Security alignment: preserved existing workspace-only parsing, persisted-graph boundaries, bounded status output, and no external transmission/toolchain use
- Engram cursor update: blocked by unavailable Engram HTTP service; OpenSpec remains authoritative for this hybrid flow
- Remaining work: independent `sdd-verify` rerun for the remediation packet

## Updated phase result

- `sdd-apply` remediation completed for packet `go-support-remediation-ac9-20260726T011048Z-v1`.
- Recommended next phase: `verify`.

## Remediation verify result

## Verification Report

**Change**: code-research-go-support
**Mode**: Strict TDD

### Completeness
| Metric | Value |
|--------|-------|
| Remediation acceptance criteria total | 4 |
| Remediation acceptance criteria satisfied | 4 |
| Remediation acceptance criteria incomplete | 0 |

### Build & Tests Execution
- `cd extensions/code-research && npm test -- test/extension-entry.test.ts -t "reports Go file and symbol counts in workspace_graph_status details and summary text"`: passed; 1 targeted test passed and 14 skipped in `extension-entry.test.ts`.
- `cd extensions/code-research && npm run typecheck`: passed; `tsc --noEmit` completed with zero reported errors.
- `cd extensions/code-research && npm test -- test/find-symbol-go.test.ts test/find-references-go.test.ts test/function-call-tree-go.test.ts test/reverse-function-call-tree-go.test.ts test/workspace-graph/shard-content-go.test.ts`: passed; 5 Go-focused files and 6 tests passed.
- `cd extensions/code-research && npm test`: passed; 30 files and 235 tests passed.
- `cd extensions/code-research && npm ls tree-sitter-go --depth=0`: passed; `tree-sitter-go@0.23.3` is owned by `pi-code-research-extension`.

### Metadata Compliance
| Metadata Constraint / Validation Expectation | Evidence | Result |
|---------------------------------------------|----------|--------|
| Hybrid mini-SDD authoritative OpenSpec state | `metadata.yaml` and this `mini-sdd.md` were read; Engram is compact cursor only | PASS |
| Remediation apply approval matches packet revision and scope fingerprint | Approval `apply-go-support-remediation-ac9-20260726T011048Z`, packet `go-support-remediation-ac9-20260726T011048Z-v1`, fingerprint `sha256:4cccc46dd56238c0580a1a4939724ef1f06699c86bb0e77f98fa5b15f7c7d8b7` match metadata and remediation apply result | PASS |
| Validation expectations | Typecheck, focused status-count test, focused Go tests, full test suite, and dependency ownership check executed and passed | PASS |
| Strict TDD expectation | Remediation added a focused status-count regression test in the existing extension entry integration suite | PASS |

### PRD Compliance Matrix
| PRD Requirement / Acceptance Criterion | Evidence | Result |
|----------------------------------------|----------|--------|
| PRD waived for this mini-SDD | `prd_policy: waived`; no formal PRD is in scope | NOT APPLICABLE |

### Spec / Task Packet Compliance Matrix
| Requirement/Scenario or Acceptance Criterion | Implementation Evidence | Runtime/Build/Test Evidence | Result |
|----------------------------------------------|-------------------------|-----------------------------|--------|
| Remediation 1. `workspace_graph_status` exposes deterministic Go file and symbol counts from persisted graph data | `src/tools/workspace-graph.ts` reads persisted subproject graph shards and populates `languageCoverage.go.fileCount`, `languageCoverage.go.symbolCount`, per-project `symbolCount`, and compact text `go_files` / `go_symbols` | Focused status-count test passed | PASS |
| Remediation 2. Focused runtime test proves counts for representative Go graph | `test/extension-entry.test.ts` builds a Go fixture graph and asserts `go` subproject, file count `1`, symbol count `5`, and summary text counts | Focused status-count test passed | PASS |
| Remediation 3. Detailed English and Spanish README tool descriptions and parameter lists mention Go consistently where applicable | README supported-language tables and public tool descriptions/parameter lists include Go in English and Spanish; workspace status result documentation includes `go` language coverage counts | Documentation inspection; typecheck/full suite passed | PASS WITH WARNING |
| Remediation 4. Existing tests and typecheck remain green | No implementation regression detected | `npm run typecheck` and full `npm test` passed | PASS |

### Security Compliance Matrix
| Security / Privacy / Abuse Requirement | Implementation Evidence | Validation Evidence | Result |
|----------------------------------------|-------------------------|---------------------|--------|
| Preserve workspace-only parsing and persisted-graph boundaries | Status summary reads local persisted graph shards only through existing graph persistence helpers | Focused status-count test, full suite, and typecheck passed | PASS |
| Preserve bounded status output | Compact status text adds only two deterministic count fields; detailed counts remain structured in `details` | Focused status-count test passed | PASS |
| No auth, secret, network, external transmission, Go toolchain, gopls, or CHA/RTA/VTA changes | Remediation touched only status reporting, test, and README surfaces | Validation commands were npm/Vitest/TypeScript only | PASS |

### Scope Compliance
| Allowed/Forbidden Scope | Evidence | Result |
|-------------------------|----------|--------|
| Allowed remediation surfaces | Changed remediation files are `extensions/code-research/src/tools/workspace-graph.ts`, `extensions/code-research/test/extension-entry.test.ts`, and `extensions/code-research/README.md` | PASS |
| Forbidden broader remediation changes | `git status --short` includes the original broader Go-support implementation files and unrelated workflow/config dirty files; no additional remediation evidence required outside the approved remediation surfaces | WARNING |
| No commit/branch/tag/push | No Git mutation commands run | PASS |

### Handoff Compliance
| Applicable handoff expectation | Evidence | Result |
|--------------------------------|----------|--------|
| Durable apply approval record and applied packet revision | Remediation approval record and apply result match metadata | PASS |
| Mini approved scope | Status-count implementation, focused test, and README updates align with remediation packet | PASS |
| Expected files/symbols addressed | Status summarizer and existing integration test were updated; README public tool details include Go | PASS |
| Validation plan executed or justified | Focused status test, typecheck, focused Go tests, full suite, and dependency ownership check executed | PASS |
| Deviations explained | No functional deviations; documentation has one minor lingering note that omits Go from a non-parameter support sentence | WARNING |

### Design Coherence
| Decision | Followed? | Notes |
|----------|-----------|-------|
| Tree-sitter-only Go support | Yes | Verification used package-local `tree-sitter-go`; no Go toolchain. |
| Existing code-research graph/status pattern | Yes | Status reporting remains a compact tool wrapper over workspace state and graph shards. |
| Dependency independence | Yes | `npm ls tree-sitter-go --depth=0` confirms package-owned dependency. |
| Public tool parity | Yes with warning | Go status file/symbol counts are now exposed; README still has a minor non-blocking note omission. |

### Issues Found
**CRITICAL**
- None.

**WARNING**
- README `Notes` sections in English and Spanish still omit Go in one broad workspace graph indexing sentence even though tables, tool descriptions, parameter lists, and workspace status result docs include Go.
- Worktree contains unrelated dirty workflow/config files; they were not treated as implementation evidence for this mini-SDD.

**SUGGESTION**
- Update the README `Structure` examples and final graph-indexing note to include `languages/go/` and Go in the broad supported-indexing sentence before or during archive cleanup.

### Verdict
PASS WITH WARNINGS

## Remediation verify phase state

- Status: `success`
- Phase: `verify`
- Executor: `mini_sdd_verify`
- Packet revision: `go-support-remediation-ac9-20260726T011048Z-v1`
- Verdict: `PASS WITH WARNINGS`
- Alignment: metadata `aligned`, PRD `not-applicable`, spec `not-applicable`, security `aligned`
- Apply approval evidence: approval `apply-go-support-remediation-ac9-20260726T011048Z`, approval record `openspec/changes/code-research-go-support/mini-sdd.md#remediation-apply-approval-record`, fingerprint `sha256:4cccc46dd56238c0580a1a4939724ef1f06699c86bb0e77f98fa5b15f7c7d8b7`
- Next recommended: `completion_summary_and_archive_approval`

## README warning remediation packet

- Packet revision: `go-support-remediation-readme-notes-20260726T012630Z-v1`
- Trigger: the non-blocking documentation warning from remediation verification.
- Goal: make the broad workspace graph indexing note include Go consistently in both English and Spanish.
- Allowed implementation surface: `extensions/code-research/README.md` only.
- Required change: update the two corresponding Notes sentences without unrelated rewriting.
- Acceptance: both broad indexing notes mention Go alongside the other supported indexed languages.
- Validation: focused documentation inspection plus the existing package regression validation selected by the apply/verify executors.
- Forbidden: source, tests, dependencies, configuration, commit, branch, tag, push, or archive changes.

## README warning remediation approval record

- Approval ID: `apply-go-support-readme-notes-20260726T012630Z`
- Type: `apply`
- Approved packet revision: `go-support-remediation-readme-notes-20260726T012630Z-v1`
- Execution strategy: `single-file-documentation-remediation`
- Scope refs: `packet:go-support-remediation-readme-notes-20260726T012630Z-v1`, `issue:english-spanish-readme-notes-omit-go`, `scope:extensions/code-research/README.md`, `acceptance:both-broad-indexing-notes-include-go`, `validation:readme-inspection-and-regression`
- Scope fingerprint: `sha256:bdc0c6e46c6a9524fae07a4f28f47500fcfeae6a1f0bc8e5e902c409fa8ed627`
- Recorded at: `2026-07-26T01:26:30Z`
- Approved scope summary: Correct the two non-blocking README notes that omit Go.
- Approval summary redacted: `true`

This approval does not authorize archive, commit, branch, tag, or push operations.

## README warning remediation apply result

- Status: `complete`
- Approval ID: `apply-go-support-readme-notes-20260726T012630Z`
- Approved packet revision: `go-support-remediation-readme-notes-20260726T012630Z-v1`
- Scope fingerprint: `sha256:bdc0c6e46c6a9524fae07a4f28f47500fcfeae6a1f0bc8e5e902c409fa8ed627`
- Files changed:
  - `extensions/code-research/README.md`
- What was done:
  - updated the English `Notes` workspace-graph indexing sentence to include Go
  - updated the Spanish `Notas` workspace-graph indexing sentence to include Go
- Validation evidence:
  - `grep` inspection confirmed both updated README notes mention Go
  - `cd extensions/code-research && npm run typecheck`
  - `cd extensions/code-research && npm test`
- Deviations from remediation packet: none
- Security alignment: preserved the existing documentation-only scope and introduced no auth, data, dependency, network, or execution changes
- Engram cursor update: completed after authoritative OpenSpec update
- Remaining work: independent `sdd-verify` rerun for the README warning remediation packet

## Updated phase result

- `sdd-apply` README warning remediation completed for packet `go-support-remediation-readme-notes-20260726T012630Z-v1`.
- Recommended next phase: `verify`.

## README warning remediation verify result

## Verification Report

**Change**: code-research-go-support
**Mode**: Strict TDD

### Completeness
| Metric | Value |
|--------|-------|
| README remediation acceptance criteria total | 1 |
| README remediation acceptance criteria satisfied | 1 |
| README remediation acceptance criteria incomplete | 0 |

### Build & Tests Execution
- `cd extensions/code-research && grep -n "Workspace graph indexing supports" README.md && grep -n "El indexado de workspace graph soporta" README.md`: passed; English and Spanish broad workspace-graph indexing notes both mention Go.
- `cd extensions/code-research && npm run typecheck`: passed; `tsc --noEmit` completed with zero reported errors.
- `cd extensions/code-research && npm test`: passed; 30 files and 235 tests passed.

### Metadata Compliance
| Metadata Constraint / Validation Expectation | Evidence | Result |
|---------------------------------------------|----------|--------|
| Hybrid mini-SDD authoritative OpenSpec state | `metadata.yaml` and this `mini-sdd.md` were read; Engram is compact cursor only | PASS |
| README remediation apply approval matches packet revision and scope fingerprint | Approval `apply-go-support-readme-notes-20260726T012630Z`, packet `go-support-remediation-readme-notes-20260726T012630Z-v1`, fingerprint `sha256:bdc0c6e46c6a9524fae07a4f28f47500fcfeae6a1f0bc8e5e902c409fa8ed627` match metadata and apply result | PASS |
| Validation expectations | README inspection, typecheck, and full package regression suite executed and passed | PASS |
| Strict TDD expectation | This remediation is documentation-only; existing regression suite remains green and no source/test change was authorized | PASS |

### PRD Compliance Matrix
| PRD Requirement / Acceptance Criterion | Evidence | Result |
|----------------------------------------|----------|--------|
| PRD waived for this mini-SDD | `prd_policy: waived`; no formal PRD is in scope | NOT APPLICABLE |

### Spec / Task Packet Compliance Matrix
| Requirement/Scenario or Acceptance Criterion | Implementation Evidence | Runtime/Build/Test Evidence | Result |
|----------------------------------------------|-------------------------|-----------------------------|--------|
| README remediation acceptance: both broad indexing notes mention Go alongside the other supported indexed languages | `README.md` English Notes sentence says `TypeScript, JavaScript, Java, Go, and Python`; Spanish Notas sentence says `TypeScript, JavaScript, Java, Go y Python` | Grep inspection passed; typecheck and full `npm test` passed | PASS |

### Security Compliance Matrix
| Security / Privacy / Abuse Requirement | Implementation Evidence | Validation Evidence | Result |
|----------------------------------------|-------------------------|---------------------|--------|
| Documentation-only scope introduces no auth, secret, network, external transmission, dependency, Go toolchain, gopls, or CHA/RTA/VTA changes | Only approved changed file for this remediation is `extensions/code-research/README.md`; no source/test/dependency/config changes were authorized for the README packet | README inspection, typecheck, and full suite passed | PASS |
| Preserve workspace-only parsing, bounded output, and existing graph/data policy | README wording documents existing Go indexing support and does not alter runtime behavior | Typecheck and full suite passed | PASS |

### Scope Compliance
| Allowed/Forbidden Scope | Evidence | Result |
|-------------------------|----------|--------|
| Allowed README-only remediation surface | Apply result lists only `extensions/code-research/README.md`; README inspection confirms the intended two Notes updates are present | PASS |
| Forbidden source, tests, dependencies, configuration, commit, branch, tag, push, or archive changes for this packet | `git status --short` contains the broader active Go-support implementation and unrelated workflow/config dirty files from the larger flow, but this remediation verification found no need for additional packet scope evidence outside README | WARNING |
| No commit/branch/tag/push | No Git mutation commands run | PASS |

### Handoff Compliance
| Applicable handoff expectation | Evidence | Result |
|--------------------------------|----------|--------|
| Durable apply approval record and applied packet revision | README remediation approval record and apply result match metadata packet revision and scope fingerprint | PASS |
| Mini approved scope | README notes now include Go exactly as required; no unrelated README rewrite was needed for acceptance | PASS |
| Expected files/symbols addressed | `extensions/code-research/README.md` was inspected and contains the required English and Spanish Notes updates | PASS |
| Validation plan executed or justified | Focused README inspection, typecheck, and full regression suite executed | PASS |
| Deviations explained | No deviations from the README remediation packet | PASS |

### Design Coherence
| Decision | Followed? | Notes |
|----------|-----------|-------|
| Documentation-only remediation | Yes | Verification is limited to README acceptance plus regression validation. |
| Tree-sitter-only Go support remains documented | Yes | README continues to document Go support without adding gopls/Go toolchain claims. |
| Public tool parity documentation consistency | Yes | Broad indexing notes now match supported-language tables and tool descriptions. |

### Issues Found
**CRITICAL**
- None.

**WARNING**
- Worktree contains unrelated dirty workflow/config files and the broader active Go-support implementation files; they were not treated as additional evidence for this README-only packet.

**SUGGESTION**
- Consider adding `languages/go/` to the README structure examples during a future documentation cleanup; it is not part of this packet's acceptance criteria.

### Verdict
PASS

## README warning remediation verify phase state

- Status: `success`
- Phase: `verify`
- Executor: `mini_sdd_verify`
- Packet revision: `go-support-remediation-readme-notes-20260726T012630Z-v1`
- Verdict: `PASS`
- Alignment: metadata `aligned`, PRD `not-applicable`, spec `not-applicable`, security `not-applicable`
- Apply approval evidence: approval `apply-go-support-readme-notes-20260726T012630Z`, approval record `openspec/changes/code-research-go-support/mini-sdd.md#readme-warning-remediation-approval-record`, fingerprint `sha256:bdc0c6e46c6a9524fae07a4f28f47500fcfeae6a1f0bc8e5e902c409fa8ed627`
- Next recommended: `completion_summary_and_archive_approval`

## Go examples validation packet

- Packet revision: `go-support-examples-20260726T020121Z-v1`
- Trigger: user-requested real validation against permanent source examples before archive.
- Goal: add a realistic Go fixture project and prove all five public code-research capabilities against it.
- Allowed surfaces:
  - `examples/go/**`
  - `examples/README.md`
- Required fixture coverage:
  - packages, functions, receiver methods, structs, interfaces, interface methods, and syntactic implementations;
  - top-level variables and constants;
  - same-package calls across files and deep reverse-caller chains;
  - local package imports and aliases;
  - local variable reads and writes;
  - external/package-qualified calls;
  - graph containment, calls, imports, implementation relations, and Go status counts.
- Required documentation: explain the Go fixtures in English and Spanish and provide suggested Go queries.
- Required validation:
  - establish a failing pre-fixture check for at least one expected Go symbol or path;
  - run real `find_symbol`, `find_references`, `function_call_tree`, `reverse_function_call_tree`, and `workspace_graph_status` checks against `examples/go/`;
  - run `cd extensions/code-research && npm run typecheck` and `npm test` for regression safety.
- Constraint: do not invoke `go build`, `go test`, `go vet`, `gopls`, or any Go toolchain command.
- Forbidden: changes outside the allowed surfaces, archive, commit, branch, tag, or push.

## Go examples validation approval record

- Approval ID: `apply-go-support-examples-20260726T020121Z`
- Type: `apply`
- Approved packet revision: `go-support-examples-20260726T020121Z-v1`
- Execution strategy: `example-fixtures-and-real-tool-validation`
- Scope refs: `packet:go-support-examples-20260726T020121Z-v1`, `scope:examples/go/**`, `scope:examples/README.md`, `acceptance:go-contract-fixtures-and-five-real-tool-validations`, `forbidden:go-toolchain-archive-git-writes`
- Scope fingerprint: `sha256:a6713cdcb99ca8feccecb4c038f183ad8e117cf6ecd4887a21a2a9de342ed6d7`
- Recorded at: `2026-07-26T02:01:21Z`
- Approved scope summary: Add permanent Go example fixtures and validate every public code-research capability against them.
- Approval summary redacted: `true`

This approval does not authorize archive, commit, branch, tag, or push operations.

## Go examples validation apply result

- Status: `complete`
- Approval ID: `apply-go-support-examples-20260726T020121Z`
- Approved packet revision: `go-support-examples-20260726T020121Z-v1`
- Scope fingerprint: `sha256:a6713cdcb99ca8feccecb4c038f183ad8e117cf6ecd4887a21a2a9de342ed6d7`
- Files changed:
  - `examples/README.md`
  - `examples/go/go.mod`
  - `examples/go/app/contracts.go`
  - `examples/go/app/service.go`
  - `examples/go/app/helpers.go`
  - `examples/go/app/workflow.go`
  - `examples/go/cmd/demo/main.go`
- What was done:
  - added a permanent Go fixture subproject with interfaces, structs, receiver methods, top-level variables/constants, helper chains, and a local-package import alias
  - documented the Go fixtures and added suggested English/Spanish Go queries in `examples/README.md`
  - ran a failing pre-fixture check, then executed all five public code-research capabilities against the new Go fixtures
- Validation evidence:
  - pre-fixture failure: `find_symbol path:examples/go symbol:StartWorkflow language:go scope:directory` → `Path not found: examples/go`
  - real tool validation: `find_symbol`, `find_references`, `function_call_tree`, `reverse_function_call_tree`, and `workspace_graph_status` executed against `examples/go/**`; `workspace_graph_status` reported `examples/go` with `go_files=5` and `go_symbols=27`
  - `cd extensions/code-research && npm run typecheck`
  - `cd extensions/code-research && npm test`
- Deviations from packet: none
- Security alignment: preserved the documentation-and-fixtures-only scope, used no Go toolchain commands, and kept validation inside the existing workspace-only code-research boundaries
- Engram cursor update: blocked by unavailable Engram HTTP service; OpenSpec remains authoritative for this hybrid flow
- Remaining work: independent `sdd-verify` rerun for the Go examples validation packet

## Updated phase result

- `sdd-apply` Go examples validation completed for packet `go-support-examples-20260726T020121Z-v1`.
- Recommended next phase: `verify`.

## Go examples validation verify result

## Verification Report

**Change**: code-research-go-support
**Mode**: Strict TDD

### Completeness
| Metric | Value |
|--------|-------|
| Go examples validation acceptance criteria total | 5 |
| Go examples validation acceptance criteria satisfied | 5 |
| Go examples validation acceptance criteria incomplete | 0 |

### Build & Tests Execution
- `workspace_graph_status`: passed; graph is fresh and usable, and includes `examples/go` among indexed workspace projects.
- `find_symbol path:examples/go/app symbol:Greeter language:go kind:interface`: passed; returned `Greeter` with syntactic implementations `FriendlyGreeter` and `Service`.
- `find_symbol path:examples/go symbol:StartWorkflow language:go`: passed; returned `examples/go/app/workflow.go` function signature.
- `find_references path:examples/go/app/workflow.go symbol:GlobalCounter language:go kind:variable`: passed; returned definition plus read/write references.
- `function_call_tree path:examples/go/app/workflow.go symbol:StartWorkflow language:go kind:function`: passed; expanded internal calls through `NewService`, `deliverGreeting`, `auditResult`, `wrapMessage`, and `formatMessage`.
- `reverse_function_call_tree path:examples/go/app/helpers.go symbol:formatMessage language:go kind:function`: passed; returned caller chain `wrapMessage` -> `auditResult` -> `StartWorkflow`.
- `python3` inspection of `.pi/workspace-code-graph/graphs/17c6dfe0b548.json`: passed; persisted `examples/go` shard has `go_files=5`, `go_symbols=27`, `calls=17`, `imports=1`, `implements=3`, and 5 `goSymbolCoverage.completeFiles`.
- `cd extensions/code-research && npm run typecheck`: passed; `tsc --noEmit` completed with zero reported errors.
- `cd extensions/code-research && npm test`: passed; 30 files and 235 tests passed.

### Metadata Compliance
| Metadata Constraint / Validation Expectation | Evidence | Result |
|---------------------------------------------|----------|--------|
| Hybrid mini-SDD authoritative OpenSpec state | `metadata.yaml` and this `mini-sdd.md` were read; Engram observation `1348` is a compact cursor and was stale before this verify update | PASS WITH WARNING |
| Go examples apply approval matches packet revision and scope fingerprint | Approval `apply-go-support-examples-20260726T020121Z`, packet `go-support-examples-20260726T020121Z-v1`, fingerprint `sha256:a6713cdcb99ca8feccecb4c038f183ad8e117cf6ecd4887a21a2a9de342ed6d7` match metadata and apply result | PASS |
| Validation expectations | Real code-research tools, persisted graph evidence, package typecheck, and full package tests executed and passed | PASS |
| Skill plan continuity | Original flow skill plan lacked `examples/**`; fallback registry resolution kept `sdd-workflow`, `tdd`, and `pi-extension-authoring` applicable and added no approval-changing scope or safety assumptions | PASS WITH WARNING |

### PRD Compliance Matrix
| PRD Requirement / Acceptance Criterion | Evidence | Result |
|----------------------------------------|----------|--------|
| PRD waived for this mini-SDD | `prd_policy: waived`; no formal PRD is in scope | NOT APPLICABLE |

### Spec / Task Packet Compliance Matrix
| Requirement/Scenario or Acceptance Criterion | Implementation Evidence | Runtime/Build/Test Evidence | Result |
|----------------------------------------------|-------------------------|-----------------------------|--------|
| Add realistic permanent Go fixture project | `examples/go/go.mod`, `app/contracts.go`, `app/service.go`, `app/helpers.go`, `app/workflow.go`, and `cmd/demo/main.go` exist and contain package, functions, receiver methods, structs, interfaces, top-level variable/constant, local import alias, same-package calls, local variable reads/writes, and external selector calls | Source inspection plus code-research tool runs passed | PASS |
| Document Go fixtures in English and Spanish with suggested Go queries | `examples/README.md` has English and Spanish Go fixture sections and suggested Go queries for `find_symbol`, `find_references`, `function_call_tree`, and `reverse_function_call_tree` | Documentation inspection passed | PASS |
| Establish failing pre-fixture check | Apply result records `find_symbol path:examples/go symbol:StartWorkflow language:go scope:directory` failed with `Path not found: examples/go` before fixture creation | Durable apply handoff plus current fixture presence supports the expected red-to-green progression | PASS |
| Validate all five public code-research capabilities against Go examples | Public tool evidence covers `find_symbol`, `find_references`, `function_call_tree`, `reverse_function_call_tree`, and `workspace_graph_status`; persisted graph shard validates containment, calls, imports, implements, and Go file/symbol counts | Tool runs and graph inspection passed | PASS |
| Package regression safety remains green | No source changes were made in this examples packet; package remains type-safe and test suite is green | `npm run typecheck` and full `npm test` passed | PASS |

### Security Compliance Matrix
| Security / Privacy / Abuse Requirement | Implementation Evidence | Validation Evidence | Result |
|----------------------------------------|-------------------------|---------------------|--------|
| No Go toolchain, gopls, or compiler validation | The fixture is static source plus documentation; verification ran code-research tools, TypeScript typecheck, Vitest, and JSON inspection only | Command log contains no `go build`, `go test`, `go vet`, or `gopls` invocation | PASS |
| Documentation-and-fixtures-only scope introduces no auth, secret, network, dependency, or data-policy changes | Changed files are under `examples/go/**` and `examples/README.md`; fixture content contains no secrets and no runtime network behavior | Source/docs inspection and regression validation passed | PASS |
| Preserve workspace-only bounded code-research analysis | Tool validation used local workspace paths and persisted local graph shards only | `workspace_graph_status` fresh/usable; package tests passed | PASS |

### Scope Compliance
| Allowed/Forbidden Scope | Evidence | Result |
|-------------------------|----------|--------|
| Allowed `examples/go/**` and `examples/README.md` surfaces | Apply result lists only those example files for this packet; inspected files are within allowed surfaces | PASS |
| Forbidden Go toolchain/archive/git writes | No Go toolchain, archive, commit, branch, tag, or push commands were run | PASS |
| Broader dirty worktree isolation | `git status --short` includes prior Go-support implementation files and unrelated workflow/config changes; they are outside this examples-packet verdict | WARNING |

### Handoff Compliance
| Applicable handoff expectation | Evidence | Result |
|--------------------------------|----------|--------|
| Durable apply approval record and applied packet revision | Examples approval record and metadata phase state match packet revision and fingerprint | PASS |
| Mini approved scope | Fixture, documentation, and validation evidence align with the approved examples packet | PASS |
| Expected files/symbols addressed | All listed example files exist and contain the required Go constructs | PASS |
| Validation plan executed or justified | Real tools, graph evidence, typecheck, and full regression suite executed; pre-fixture red check was preserved in apply handoff | PASS |
| Deviations explained | No deviations from the examples validation packet | PASS |

### Design Coherence
| Decision | Followed? | Notes |
|----------|-----------|-------|
| Permanent examples instead of implementation changes | Yes | The packet adds only fixtures/docs under `examples/`. |
| Tree-sitter/code-research validation only | Yes | No Go compiler/language-server dependency was introduced or invoked. |
| All public code-research capabilities demonstrated | Yes | Direct tool runs plus graph shard/status evidence cover the five public capabilities. |

### Issues Found
**CRITICAL**
- None.

**WARNING**
- The flow-local skill plan did not originally cover `examples/**`, so verify used fallback registry resolution; no approval-changing skill or policy mismatch was found.
- The worktree contains unrelated dirty workflow/config files and prior active Go-support implementation changes; they were not treated as implementation evidence for this examples-only packet.
- Built-in compact `workspace_graph_status` output lists `examples/go` as indexed but does not expose all per-language counts in the terse tool rendering; persisted graph shard inspection confirmed the recorded counts.

**SUGGESTION**
- Consider adding future example queries for `workspace_graph_status` once a user-facing query syntax for detailed status output is documented.

### Verdict
PASS

## Go examples validation verify phase state

- Status: `success`
- Phase: `verify`
- Executor: `mini_sdd_verify`
- Packet revision: `go-support-examples-20260726T020121Z-v1`
- Verdict: `PASS`
- Alignment: metadata `aligned`, PRD `not-applicable`, spec `not-applicable`, security `aligned`
- Apply approval evidence: approval `apply-go-support-examples-20260726T020121Z`, approval record `openspec/changes/code-research-go-support/mini-sdd.md#go-examples-validation-approval-record`, fingerprint `sha256:a6713cdcb99ca8feccecb4c038f183ad8e117cf6ecd4887a21a2a9de342ed6d7`
- Next recommended: `completion_summary_and_archive_approval`

## Archive approval record

- Approval ID: `archive-code-research-go-support-20260726T021726Z`
- Type: `archive`
- Approved completion revision: `go-support-examples-verified-20260726T231200Z-v14`
- Approved packet revision: `go-support-examples-20260726T020121Z-v1`
- Approved verdict: `PASS`
- Artifact store: `hybrid`
- Scope refs: `flow:code-research-go-support`, `completion:go-support-examples-verified-20260726T231200Z-v14`, `packet:go-support-examples-20260726T020121Z-v1`, `verdict:PASS`, `store:hybrid`
- Scope fingerprint: `sha256:efb8d8a13374c259d3401720c39189b3ca6e43f1473b4120aa57390efb9acfbe`
- Recorded at: `2026-07-26T02:17:26Z`
- Approval summary: Archive the verified Go support mini-SDD flow.
- Approval summary redacted: `true`

This approval authorizes archive only. It does not authorize commit, branch, tag, or push operations.

## Archive recovery approval record

- Authorization ID: `archive-recovery-code-research-go-support-20260726T022129Z`
- Original archive approval ID: `archive-code-research-go-support-20260726T021726Z`
- Source path: `openspec/changes/code-research-go-support/`
- Target path: `openspec/changes/archive/2026-07-26-code-research-go-support/`
- Required recovery: remove the byte-identical stale active source and close or redirect the invocation cursor consistently.
- Scope fingerprint: `sha256:eda5686477b538a8561b6c5a6a2e4835b555cdb7b21c0d3b777a6ee8c9cb33c0`
- Recorded at: `2026-07-26T02:21:29Z`
- Approved by user: `true`
- Approval summary redacted: `true`

This authorization is limited to idempotent archive recovery. It does not authorize commit, branch, tag, or push operations.
