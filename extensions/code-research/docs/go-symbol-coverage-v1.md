# Go symbol coverage v1

This document defines the persisted workspace-graph coverage proof for Go files.

## Coverage proof

Each indexed Go shard stores:

- grammar package `tree-sitter-go`
- grammar version `0.23.3`
- generation timestamp
- `completeFiles`
- `skippedFiles`
- `fileProofs[file] = { sourceHash, symbolCount }`

## Indexed declarations

The current Go coverage includes:

- package clauses
- top-level functions
- methods with receivers
- named types, including structs and interfaces
- interface methods
- top-level vars and consts

## Indexed relationships

The current Go workspace graph includes:

- file containment
- symbol containment
- same-package call edges for resolved functions and methods
- import edges for local package imports that resolve inside the indexed workspace
- syntactic interface implementation edges
