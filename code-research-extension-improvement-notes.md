# Code Research Extension Status

The functional issues previously tracked here are now fixed.

## Fixed

### TypeScript interface / dependency-injection references

`code_find` now resolves calls made through interface-typed dependencies, for example:

```ts
this.repository.transitionToTerminal(...)
```

In the SIAS `back_ia` regression case, it now finds the expected `ReviewAnalysisProcessor` call sites:

- `cancelActiveReviewAnalysis`
- `beginTerminalTransition`

### Duplicate TypeScript references

`code_find references transitionToTerminal` no longer returns duplicate rows for the same logical call expression.

### Interface incoming call hierarchy

`code_call_hierarchy` incoming for `ReviewAnalysisRepository.transitionToTerminal` now includes both expected callers:

- `cancelActiveReviewAnalysis`
- `beginTerminalTransition`

### Concrete implementation expansion

`code_call_hierarchy` incoming for `MongoReviewAnalysisRepository.transitionToTerminal` now connects interface-mediated callers back to the concrete implementation when appropriate.

It also keeps useful `reason` metadata, such as:

- `receiver-type-contract-method`
- `ambiguous-interface-implementation`

## Remaining improvement

### Restore visible confidence classification

The latest output no longer visibly shows fields like:

- `classification: confirmed`
- `classification: probable`
- `classification counts`

This is useful for agents because `reason` explains **why** a relationship was inferred, but `classification` explains **how much to trust it**.

Expected behavior:

- Keep `reason` metadata.
- Also show explicit confidence classification in `code_find` and `code_call_hierarchy` output.

Example ideal output:

```txt
classification: probable
reason: ambiguous-interface-implementation
```

Why this matters:

- `confirmed` means the agent can trust the edge more directly.
- `probable` means the edge is useful but should be verified before risky edits.
- `framework` means the edge comes from framework convention rather than a normal direct call.

## Regression check

Use this SIAS case to verify future updates:

```bash
code_find references transitionToTerminal in back_ia
code_call_hierarchy incoming ReviewAnalysisRepository.transitionToTerminal
code_call_hierarchy incoming MongoReviewAnalysisRepository.transitionToTerminal
```

Passing result:

- No duplicate rows for the same call expression.
- Interface incoming hierarchy includes both `cancelActiveReviewAnalysis` and `beginTerminalTransition`.
- Concrete implementation hierarchy includes interface-mediated callers where appropriate.
- Output shows both `classification` and `reason` when inference metadata is available.
