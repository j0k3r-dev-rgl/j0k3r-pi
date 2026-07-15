# TypeScript symbol contract v1

`find_symbol` now uses one TypeScript/TSX declaration model for direct lookup and workspace-graph persistence. A schema-v2 graph may answer only for files whose generation, snapshot metadata, source hash, and canonical symbol shape are current; all other files use direct fallback.

## Public compatibility

- Existing coarse `kind` values remain populated: `function`, `class`, `method`, `interface`, `variable`, or `unknown`.
- `declaration_kind` and identity/naming fields are additive.
- `declaration_kind` accepts: `function`, `function_overload`, `callable_variable`, `variable`, `class`, `constructor`, `method`, `getter`, `setter`, `field`, `interface`, `interface_method`, `property`, `call_signature`, `construct_signature`, `index_signature`, `type_alias`, `enum`, `enum_member`, `namespace`, `module`, `import_alias`, `export_alias`, `object_method`, `object_property`, `assignment`, `commonjs_export`, and `unknown`.
- `symbol_id` identifies a declaration constituent. `relationship_id` may group overloads or accessor pairs but never deduplicates them.
- `owner` is the nearest named container; `qualified_name` joins the full owner chain and symbol name.

## Query and payload rules

`path`, `scope`, `glob`, `language`, coarse `kind`, `declaration_kind`, and name matching are conjunctive. Exact matching checks simple and qualified names; prefix/contains matching checks both and disables code payloads.

`include_code` is evaluated per result. Code is available only for executable `function`, `callable_variable`, `constructor`, `method`, `getter`, `setter`, and `object_method` declarations. It is never persisted in graph artifacts.

## Diagnostics

Tool `details` always includes:

- `source_mode`: `graph`, `direct`, or `hybrid`;
- `graph_status`: `disabled`, `fresh`, `stale`, `partial`, `missing`, `incompatible`, or `error`;
- `completeness`: `complete`, `partial`, or `fallback`;
- `fallback_reason`: stable enum or `null`;
- file, skipped-input, and unreadable-shard counts;
- `graph_generation` when graph state contributes.

Fallback reasons are `graph_disabled`, `graph_missing`, `graph_stale`, `graph_partial`, `graph_incompatible`, `graph_read_error`, `shard_missing`, `shard_unreadable`, `shard_incompatible`, `snapshot_mismatch`, `coverage_unproven`, `parse_error`, and `input_unreadable`. Diagnostics contain counts and stable enums—not source text or raw parser/filesystem errors.

## Graph migration and rebuild

The workspace graph schema is version 2. Version 1 and future incompatible artifacts are not reinterpreted. Queries fall back to direct analysis until the existing workspace graph lifecycle rebuilds state/manifest/shards. Removing `.pi/workspace-code-graph/` is a safe manual reset when a rebuild is required; source files are never stored there.

## Security and rollback

Targets are realpath-bounded to the workspace, scope is validated before scanning, and each graph artifact is capped at 256 MiB and schema-validated. Canonical graph symbols persist names, ranges, hashes, flags, and redacted signatures only—never AST nodes, code snippets, or full source bodies.

If graph acceleration must be disabled, direct extraction preserves the same semantic contract and reports truthful fallback diagnostics. Never roll back by accepting incompatible shards, suppressing direct-supported declarations, or broadening code payloads.
