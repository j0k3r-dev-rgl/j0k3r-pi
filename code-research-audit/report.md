# Pi Code Research Extension Audit

## Executive Summary

**Recommendation (HIGH confidence): reduce the public surface from five tools to two:**

1. **`code_find`** — the normal entry point for locating declarations, implementations, and references of symbols across TypeScript/JavaScript, Java, and Go.
2. **`code_call_hierarchy`** — a single directional call-relationship tool (`direction: "outgoing" | "incoming"`).

Merge the current definition/reference pair into `code_find`, merge the two call-tree tools, and make graph health an internal execution concern reported as provenance instead of a model-facing tool. Do not add a generic text, regex, or structural-search tool: Pi already has built-in `grep`, and ripgrep/ast-grep are useful optional host tools rather than a reason to expand this extension. [S-001] [S-002] [S-008] [S-013] [S-014]

The local implementation already has useful parsers, direct fallbacks, workspace-bound paths, and a Go implementation. Its main gaps are an over-sliced public contract, inconsistent language defaults/autodetection, unsupported Python scope retained in the graph, potentially unbounded results, hard-coded UI key hints, and project configuration/lifecycle behavior that needs review before adding features. [S-002] [S-003] [S-004] [S-005] [S-006] [S-007]

## Research Question

How should the local Pi Code Research extension become excellent with the smallest useful public tool set, restricted to TypeScript/JavaScript, Java, and Go, while providing a universal symbol finder?

## Recommendation or Answer

Adopt the two-tool surface above. Implement **`code_find` first**, without changing parsers or introducing an LSP service/dependency. It should unify existing direct resolvers behind a stable, bounded result contract. Only after parity and output-bound tests pass should `code_call_hierarchy` replace the two tree tools.

**Interpretation:** LSP defines separate protocol requests for workspace symbols, definitions, references, implementations, and incoming/outgoing call hierarchy. That is a useful implementation taxonomy, not a requirement to expose five model-facing tools. A single discriminated query tool plus one hierarchy tool preserves these capabilities while reducing tool-selection ambiguity. [S-015] [S-016]

## Key Findings

| Finding | Evidence | Confidence |
|---|---|---|
| Five public tools are registered: symbol, references, forward tree, reverse tree, and graph status. | `index.ts:1-20`; individual registrations. [S-001] [S-002] | HIGH |
| The first four share `path`, `symbol`, language, kind, scope/depth concerns, and graph/direct routing; forward/reverse are a direction split. | `src/tools/*.ts`; resolver dispatch. [S-002] [S-006] | HIGH |
| Go is implemented in core resolvers, despite several descriptions/README passages emphasizing only TS/JS/Java. | `find-symbol-resolver.ts:16-17,74-76`; `function-call-tree-resolver.ts:2,37-38`; tool descriptions. [S-002] [S-006] | HIGH |
| `find_symbol` alone defaults to `auto`; references and both hierarchy tools default to `java` and reject `auto` in their resolvers. | `find-symbol.ts:25`; `find-references.ts:25,49`; hierarchy tools/resolvers. [S-002] [S-006] | HIGH |
| Python is still a dependency and graph-indexed language, although it is out of the requested language boundary and has no public query mode. | `package.json`; `source-policy.ts:5,29-35`; `types.ts:1`. [S-003] [S-007] | HIGH |
| Current results can grow with matches/tree size and have no schema-level `limit`/cursor continuation. Symbol results serialize the complete location array; call trees serialize the complete tree. | `find-symbol.ts:61`; `find-references.ts:55`; hierarchy tools: `55`; Pi output guidance. [S-002] [S-008] | HIGH |
| The custom renderer hard-codes `ctrl+o`, rather than consulting Pi’s configured `app.tools.expand` keybinding. | `src/render.ts:63,74,93,113`; Pi renderer guidance. [S-005] [S-008] | HIGH |

## Evidence Review

### Current local inventory

| Current tool | Current responsibility | Decision |
|---|---|---|
| `find_symbol` | Declaration/implementation lookup; exact, prefix, contains; optional signature/code. | **Merge into `code_find`**; retain its resolver and canonical symbol records. |
| `find_references` | Usage lookup, including call/import/read/write-like categories where implemented. | **Merge into `code_find`**; retain as `relation: "references"`. |
| `function_call_tree` | Recursive outgoing calls. | **Merge into `code_call_hierarchy`** with `direction: "outgoing"`. |
| `reverse_function_call_tree` | Recursive incoming callers. | **Merge into `code_call_hierarchy`** with `direction: "incoming"`. |
| `workspace_graph_status` | Graph availability, freshness, coverage, and monorepo diagnostics. | **Remove from public surface; keep internal** and return concise provenance/coverage in the other two tools. |

The extension’s graph policy is deliberately conservative: symbol queries validate snapshots and coverage, while references can fall back to direct analysis when graph coverage is not sufficient. Preserve that correctness preference. [S-004] [S-006]

### Local quality and duplication issues

1. **Surface duplication — HIGH.** The entry point registers five tools independently (`index.ts:1-20`). The two hierarchy schemas are near-identical; reverse-only `include_external` and `compacted` are explicitly “reserved for API parity” (`reverse-function-call-tree.ts:28-29`). A `direction` enum is clearer than two separately described tools. [S-001] [S-002]
2. **Language contract drift — HIGH.** Schemas allow Go, but user-facing descriptions omit it in multiple places; `find_symbol` auto-detects while other public paths default to Java. The README also advertises Python graph work. This makes tool selection and expected behavior inconsistent. [S-002] [S-006] [S-007]
3. **Python is unauthorized retained scope — HIGH.** The package depends on `tree-sitter-python`; the source walker admits `.py`; shared types expose `py`. Remove all Python indexing and documentation rather than preserving a future-facing foundation. [S-003] [S-007]
4. **Unbounded model payloads — HIGH.** The current tool schemas lack result limits/pagination, and results are rendered/serialized as complete JSON or trees. Pi requires bounded output with an explicit deterministic continuation; visual clipping is not a substitute. [S-002] [S-008]
5. **Renderer does not follow installed Pi’s keybinding contract — HIGH.** It hard-codes `ctrl+o` (`src/render.ts:63,74,93,113`) while Pi documents `keyHint("app.tools.expand", ...)`. It also uses a hand-rolled component/wrapper instead of the recommended native renderer primitives; the keybinding defect is actionable first. [S-005] [S-008]
6. **Trust/lifecycle review needed — MEDIUM.** `.pi/code-research.json` is read solely from `cwd` (`config.ts:20-61`); graph scheduling on `session_start`/`turn_end` uses it without a visible `ctx.isProjectTrusted()` check or `session_shutdown` cleanup for pending timers (`graph-scheduler.ts:28-39`). Pi documents trust gating for project-local configuration and idempotent shutdown for session resources. The config is small, but graph refresh/write behavior means this is not merely cosmetic. [S-004] [S-008]
7. **Syntax-based precision limit — MEDIUM.** Go direct reference analysis includes line-pattern matching for variable reads/writes (`languages/go/find-references.ts:40-52`), and local documentation describes syntactic resolution. Results must retain truthful provenance and never imply compiler/LSP certainty. gopls itself documents build-configuration and dynamic-call limits for semantic navigation. [S-006] [S-016]

### External comparison: high-signal lessons

| Source/tool | Material capability | Design lesson for this extension |
|---|---|---|
| Pi extension docs | Strict schemas, bounded result continuation, dynamic tool loading, configured key hints, trust and lifecycle contracts. | Two always-active tools are simpler than a tool-loader; follow Pi’s output/trust/rendering rules. [S-008] |
| GitHub Code Navigation | Tree-sitter-based definitions/references and symbol panes across Go, Java, JS, and TS; documented limits. | Symbol navigation is valuable, but state scope/coverage limits plainly. [S-009] |
| GitHub Code Search | `symbol:` searches definitions, not references; search is bounded and incomplete in known cases. | Keep declaration and reference relations explicit in one tool; return limits/continuation. [S-010] |
| Sourcegraph Symbol Search | Declaration-oriented symbol index, categorized by symbol kind. | Use kind filters and qualified/owner identity; do not confuse text search with symbols. [S-011] |
| Sourcegraph Structural Search | Structural search is disabled by default, has performance limits, and is not actively developed. | Do not add an in-extension structural-search surface. [S-012] |
| ripgrep guide | Mature text/regex search supports file-type and glob filtering plus JSON summaries. | Leave text/regex to Pi’s built-in grep/host tools; reuse familiar path/glob semantics. [S-013] |
| ast-grep docs | Tree-sitter structural matching is useful but is a distinct pattern/rule product. | Do not overload `code_find` with arbitrary AST-pattern search. [S-014] |
| LSP specification | Standardizes workspace symbols, navigation, references, implementations, and incoming/outgoing call hierarchy as distinct capabilities. | Internally retain distinct resolvers; expose two model-facing contracts. [S-015] |
| gopls navigation | Workspace symbols use fuzzy matching; hierarchy is non-exhaustive for dynamic calls and references have configuration limits. | Offer explicit fuzzy mode and preserve incompleteness/provenance. [S-016] |

## Universal Search Proposal

### Tool: `code_find`

**Purpose:** find a supported-language symbol and, after a candidate is identified, navigate its declaration, implementations, or references. It is not text search and not a generic AST-pattern tool.

**Inputs**

```text
path: string = "."                         # workspace-relative file or directory
query?: string                              # required unless target_id is supplied
target_id?: string                          # returned symbol_id; disambiguates follow-ups
relation: "declaration" | "implementation" | "references" = "declaration"
language: "auto" | "ts" | "js" | "java" | "go" = "auto"
kinds?: ("function" | "method" | "class" | "interface" | "variable" | "type" | "enum" | "field" | "constructor")[]
match: "exact" | "prefix" | "fuzzy" = "exact"
scope?: "file" | "directory"             # infer from path when omitted
glob?: string
include_signature: boolean = false
limit: integer = 50                         # 1..100
cursor?: opaque string
```

**Language behavior and autodetection**

- Detect language from the file extension for a file path. For a directory and `auto`, scan only `.ts/.tsx`, `.js/.jsx/.mjs/.cjs`, `.java`, and `.go`; return per-language counts.
- `language` is a filter/override, not a promise that an incompatible file can be parsed as that language.
- Do not accept, index, document, or silently scan Python or other languages.
- Use an internal graph only when it is fresh, coverage-proven, and appropriate for the relation; otherwise direct analysis is the supported fallback. Return provenance, never a fabricated semantic-confidence score. [S-004] [S-006]

**Matching**

- `exact` compares simple and qualified symbol names case-sensitively by default; this is the deterministic default.
- `prefix` returns starts-with names, ranked by qualified exact-prefix then lexical location.
- `fuzzy` is **symbol-name only**, case-insensitive, deterministic, and returns a match score/reason. It must not search source text, comments, or string literals. This follows the useful workspace-symbol pattern documented by gopls without conflating finder with grep. [S-016]
- For ambiguous declarations, return candidates with stable `symbol_id`, owner, qualified name, kind, and range. The caller supplies `target_id` before a reference/implementation follow-up.

**Result shape**

```json
{
  "items": [{
    "relation": "declaration",
    "symbol": {"id":"…","name":"parse","qualified_name":"Parser.parse","kind":"method","owner":"Parser"},
    "location": {"file":"src/parser.ts","start_line":12,"start_column":3,"end_line":28,"end_column":4},
    "signature": "parse(input: string): Ast",
    "match": {"mode":"exact","score":1,"reason":"qualified-name exact"}
  }],
  "summary": {"returned":1,"total_known":1,"has_more":false,"next_cursor":null,"languages":{"ts":1}},
  "provenance": {"source_mode":"direct","graph_status":"disabled","completeness":"fallback","limitations":[]}
}
```

For a reference item, retain `reference_kind`, call/receiver/context fields where available. Omit code bodies by default; if a later need proves necessary, add a separately bounded `include_code` mode with strict per-item and total byte limits. [S-008]

**Explicit non-goals:** full-text/regex search; structural-query DSL; rename/refactoring; compiler-accurate cross-language resolution; repository-wide indexing for languages outside the boundary; watches, services, embeddings, remote search, and enterprise dashboards.

### Tool: `code_call_hierarchy`

Retain the existing call-tree implementation behind `direction: "outgoing" | "incoming"`, `path`, `symbol`/`target_id`, `language: auto`, `max_depth` (bounded 1..10), `include_external`, `limit`, and cursor/chunk semantics. Mark cycles and depth truncation. It should state that dynamic dispatch/callbacks may be incomplete. Do not run it automatically from `code_find`; the explicit second tool keeps routine lookup cheap and predictable. [S-015] [S-016]

## Trade-offs and Risks

- **A public graph-status removal conflicts with current local agent guidance.** `AGENTS.md` currently tells agents to call `workspace_graph_status` before graph-backed supported-language lookup. The proposed internal provenance model requires a coordinated, explicitly authorized update to that operational guidance; until then, retain a compatibility alias or keep status public temporarily.
- **A name-based finder is not a semantic server.** TS/JS uses TypeScript APIs in some paths; Java/Go use syntax/tree-sitter-based logic in this extension. Overloads, import aliases, dynamic calls, reflection, and build tags can be ambiguous or incomplete. State this in provenance rather than adding an LSP daemon prematurely. [S-006] [S-016]
- **Python removal requires a clean graph rebuild.** Existing graph artifacts containing `py` become incompatible/stale by design; remove/rebuild them safely rather than interpret them. This is an authorized language-boundary correction, not support expansion. [S-003] [S-007]
- **Compatibility cost.** Renaming public tools breaks existing sessions/prompts. Use `prepareArguments` only if backward resume compatibility is required by an approved migration; otherwise make one clean breaking change and update README/tests together. Pi supports argument preparation for old stored calls, but it should not inflate the new schema. [S-008]

## Alternatives Considered

1. **Keep all five tools and improve descriptions — rejected.** It preserves duplicate selection decisions and the “reserved for parity” parameters.
2. **One mega-tool including call hierarchy — rejected.** It would combine low-cost lookup with recursive graph expansion, create a larger schema, and make outputs harder to bound.
3. **Add generic text/regex/structural-search tools — rejected.** Pi already supplies grep; ripgrep and ast-grep demonstrate separate, mature problem spaces. Sourcegraph’s structural-search caution reinforces avoiding speculative scope. [S-008] [S-012] [S-013] [S-014]
4. **Replace parsing with per-language LSP servers now — rejected for this task.** It adds processes, configuration, lifecycle, dependency, and platform complexity before the two-tool contract and existing behavior are proven insufficient.

## Unknowns and Limits

- No test suite, benchmark, extension reload, or live Pi TUI execution was run: the authorized environment exposed read/write research tools only, not a shell/test runner. Claims here are source-review findings, not runtime verification.
- The local `test/` directory could not be enumerated through the available read API; exact language-parity/fixture coverage remains unverified.
- External live docs were accessed during the audit, but several do not expose a publication date/version in extraction. They are recorded as live/current documentation with date/version `Unknown`; no claim is made that they prove future state on 2026-08-31.

## Recommended Next Actions

1. Approve the two-tool public contract and decide whether a temporary compatibility alias is warranted for existing sessions.
2. Before implementation, resolve the `AGENTS.md` graph-status preflight conflict and specify the output limit/cursor encoding.
3. Create contract tests first: auto language detection, Python exclusion, exact/prefix/fuzzy ranking, ambiguous `target_id` follow-up, bounded continuation, provenance fallback, configured key hint, trusted/untrusted config, and incoming/outgoing hierarchy parity.
4. Implement `code_find` as a wrapper over existing resolvers; remove Python graph scope/dependency; then merge hierarchy registrations and update README/tool guidance in the same change.
