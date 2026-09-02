# Java symbol coverage v1

This document owns the Java-specific public contract for `extensions/code-research`. Generic tool registration, shared graph behavior, and TypeScript-specific compatibility notes stay in `README.md` and the TypeScript v1 documents.

## Versioned scope

- grammar: `tree-sitter-java@0.23.5`
- graph schema floor: workspace graph schema `v3`
- Java coverage model: `javaSymbolCoverage.modelVersion = 1`

## Public declaration coverage

Direct lookup and fresh-graph lookup share one canonical Java declaration model for:

- compilation units: `package`, `module`
- types: `class`, `interface`, `enum`, `record`, `annotation`
- callables: `method`, `constructor`, `compact_constructor`, `annotation_element`
- members: `field`, `enum_constant`, `record_component`
- bindings: `parameter`, `receiver_parameter`, `lambda_parameter`, `local_variable`, `enhanced_for_variable`, `catch_parameter`, `resource_variable`, `pattern_variable`, `type_parameter`

Coarse `kind` compatibility remains additive:

- class-like Java declarations map to coarse `class` or `interface`
- callable Java declarations map to coarse `method`
- package/module/member/binding declarations map to coarse `variable`

## Supported relationship behavior

- direct and fresh graph parity for supported `find_symbol` queries
- canonical `extends`, `implements`, and `permits` graph edges
- Java references and forward/reverse call trees preserve canonical owner identity
- overload resolution stays syntax-only and deterministic; ambiguous cases do not claim compiler certainty

## Unsupported or relationship-only policy

- anonymous classes: relationship-only internal identity, not public `find_symbol`
- lambdas: relationship-only scope, not public synthetic declarations
- initializer blocks: unsupported as public declarations
- compiler-generated members: not surfaced as source declarations

## Graph authority and unavailable diagnostics

Java graph-backed lookup is authoritative only when the persisted shard is local, bounded, schema-compatible, fresh for the current snapshot, and coverage-proven for the queried files.

Expected unavailable reasons in `find_symbol.details` include:

- `graph_stale`
- `graph_partial`
- `shard_missing`
- `shard_corrupt`
- `shard_incompatible`
- `shard_oversized`
- `snapshot_mismatch`
- `coverage_unproven`

`graph_status` remains one of the shared statuses (`fresh`, `stale`, `partial`, `missing`, `incompatible`, `error`, `disabled`).

## Security rules

- persisted Java shards do not store method bodies, field initializer literals, annotation arguments, or secret-like canaries
- per-result `include_code` is allowed only for executable `method`, `constructor`, and `compact_constructor` results with bodies
- directory-scoped binding searches stay gated by granular `declaration_kind`
- shard reads remain bounded to `<= 256 MiB` per artifact

## Benchmarks

The maintained benchmark surface is the existing generalized script pair:

- `scripts/typescript-symbol-corpus.js`
- `scripts/benchmark-typescript-symbols.js`

Java benchmark commands reuse that surface:

```bash
npm run benchmark:java-symbols -- --size medium
npm run benchmark:java-symbols -- --size large --baseline-graph-p95 <recorded-large-p95>
```

Acceptance targets:

- medium corpus: `1000` files and `>= 25000` declarations
- large corpus: `10000` files and `>= 250000` declarations
- `5` cold + `20` warm repetitions
- direct/fresh graph normalized parity
- graph warm p95 faster than direct warm p95
- final graph warm p95 within `110%` of the recorded baseline for the same size
- every persisted shard `<= 256 MiB`

## Examples corpus expectations

`examples/java` remains the integration corpus for verified parity work:

- `32/32` Java file nodes in a fresh graph
- direct/fresh graph parity for supported declarations
- the five formerly missing type declarations are present
- the sixteen formerly direct-only fields are present in the graph
