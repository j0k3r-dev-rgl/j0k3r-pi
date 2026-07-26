# Go symbol contract v1

## Public language value

Use `language: 'go'` for Go symbol and call-analysis queries.

## Current declaration coverage

`find_symbol` can return Go records for:

- packages
- functions
- methods
- named types mapped to coarse `class` or `interface`
- interface methods
- top-level variables and constants

## Current reference coverage

`find_references` covers:

- call sites for indexed same-package functions and methods
- import aliases
- local variable reads and writes

## Current call-tree coverage

`function_call_tree` and `reverse_function_call_tree` cover:

- same-package functions
- same-package methods resolved from receiver syntax that maps to indexed types
- external/package-qualified calls as external leaves when requested
