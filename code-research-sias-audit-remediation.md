# Code Research SIAS Audit — Remediation Roadmap

Date: 2026-09-02
Repo audited: `/home/j0k3r/sias/app`
Planning mode: four independent Mini-SDD slices

## Decision

Do **not** remediate the full audit in one large change. Advance through **four Mini-SDDs**, each with a bounded scope, fixtures, validation matrix, and explicit regression target.

Until all slices are fixed, the user-facing contract remains:

> Use Code Research first for semantic symbol navigation and call flow. Use targeted `rg`/`grep` afterward for exhaustive/textual validation.

## Current Graph Health Baseline

Observed consistently by the audit subagents:

```text
fresh | usable=yes | monorepo=yes | shards=5 | indexed_files=1465
workspace_projects=lab,back,front,back_ia,back_files
partial_projects=0 | empty_projects=0 | unreadable_dirs=4
```

## Execution Order

| Order | Mini-SDD | Priority | Main risk reduced |
|---:|---|---|---|
| 1 | `fix-java-type-references` | P0 | Java impact analysis false negatives |
| 2 | `fix-ts-optional-chain-calls` | P0 | TypeScript call/reference false negatives |
| 3 | `fix-java-mockito-and-dedupe` | P0/P1 | Missed Mockito calls and duplicate Java refs |
| 4 | `fix-usability-status-and-docs` | P1/P2/P3 | Noise, transparency, and guidance gaps |

## Mini-SDD 1 — `fix-java-type-references`

### Goal

Make Java `code_find relation=references` reliable for class, record, DTO, and utility type usages.

### Scope

Fix Java references for `kind=class` and equivalent type declarations so semantic references include:

- imports;
- field types;
- method parameter types;
- method return types;
- constructor calls;
- generic type arguments;
- record constructor calls;
- static member/class-qualified usages.

### Real SIAS examples

- `ReviewPersistenceModel`
  - Code Research before: 0 references
  - `rg` baseline: 48 textual usages
- `MongoIdUtils`
  - Code Research before: 0 references
  - `rg` baseline: 313 textual usages
- `DocumentationItemDTO`
  - Code Research before: too few or missing type/constructor usages

### Fixtures to add

1. Java class/type reference fixture:
   - import;
   - field type;
   - constructor call;
   - static utility call;
   - generic type argument;
   - method return type;
   - method parameter type.
2. Java record/DTO fixture:
   - record constructor call;
   - list/map generic usage;
   - nested DTO field/reference.

### Validation

For each fixture and selected SIAS symbol, compare:

- `code_find relation=declaration`
- `code_find relation=references`
- `code_find relation=references reference_kinds=["call"]` where relevant
- targeted `rg` baseline

Pass criteria:

- Declarations still point to exact declaration file/line.
- Type references include all supported semantic usages above.
- Static qualified usages are reported as references.
- No string-only/test-description matches are counted as semantic references.

### Out of scope

- TypeScript extraction.
- Call hierarchy changes unless directly required by Java type reference extraction.
- UI/documentation copy.

## Mini-SDD 2 — `fix-ts-optional-chain-calls`

### Goal

Detect optional-chained TypeScript calls in both references and outgoing call hierarchy.

### Scope

Support optional call expressions such as:

```ts
obj?.save()
await this.repo?.save({})
obj.method?.()
```

They must be included in:

- `code_find relation=references query=<method> kind=method reference_kinds=["call"]`
- `code_call_hierarchy direction=outgoing`

### Real SIAS example

```ts
await this.aiLogRepository?.save({ ... })
```

File:

```text
back_ia/src/application/use-cases/analyze-image-readability.use-case.ts:26
```

Missed before by both:

- `code_find relation=references query=save kind=method reference_kinds=["call"]`
- `code_call_hierarchy AnalyzeImageReadabilityUseCase.execute outgoing`

### Fixtures to add

1. Optional chaining calls:
   - `obj?.save()`;
   - `await this.repo?.save({})`;
   - `obj.method?.()` if supported by parser/model.
2. Adjacent callback guard fixture if the same extractor area is touched:
   - call assigns result to a local variable;
   - next line uses local variable without the target symbol;
   - only the actual call line is returned.

### Validation

For fixtures and SIAS example:

- `code_find relation=references reference_kinds=["call"]` includes optional-chain call sites.
- `code_call_hierarchy direction=outgoing` includes optional-chain callees.
- Existing normal method calls still appear.
- No adjacent non-symbol line is introduced as a false positive.

### Out of scope

- Java extraction.
- Full TypeScript type alias classification unless touched incidentally.
- Documentation/status output changes.

## Mini-SDD 3 — `fix-java-mockito-and-dedupe`

### Goal

Make Java method reference extraction reliable in Mockito verification chains and remove duplicate references from nested lambda/assertion contexts.

### Scope

Support calls inside Mockito verification expressions:

```java
verify(mock).method(...)
verify(mock, never()).method(...)
verify(mock, times(1)).method(...)
```

Deduplicate Java references by stable tuple:

- target symbol id;
- source file;
- AST node span;
- reference kind.

### Real SIAS examples

Mockito negative verifications previously missed:

```text
back_files/src/test/java/.../UploadFileBySlotUseCaseTest.java:167
back_files/src/test/java/.../UploadFileBySlotUseCaseTest.java:185
back_files/src/test/java/.../UploadFileBySlotUseCaseTest.java:293
back_files/src/test/java/.../UploadFileBySlotUseCaseTest.java:308
```

Duplicate Java references previously observed in:

```text
back/src/test/java/.../StartReviewAnalysisUseCaseTest.java:149
back/src/test/java/.../StartReviewAnalysisUseCaseTest.java:184
back/src/test/java/.../CreateReviewUseCaseRegisterTypeScopeTest.java:26
back_files/src/test/java/.../StorageServiceTest.java:121
back_files/src/test/java/.../StorageServiceTest.java:148-150
back_files/src/test/java/.../StorageServiceTest.java:176-178
```

### Fixtures to add

1. Mockito verification calls:
   - `verify(mock).method(...)`;
   - `verify(mock, never()).method(...)`;
   - `verify(mock, times(1)).method(...)`.
2. Lambda/assertion dedupe:
   - invocation inside `assertThatThrownBy(() -> service.method())`;
   - invocation inside `assertDoesNotThrow(() -> service.method())`.

### Validation

- Mockito verification target methods are returned as call references.
- Negative verification calls are not missed.
- Nested assertion/lambda calls are returned once per actual invocation node.
- Existing Java call reference behavior remains stable.

### Out of scope

- Java class/type reference expansion already covered by Mini-SDD 1.
- TypeScript extraction.
- Workspace graph status output.

## Mini-SDD 4 — `fix-usability-status-and-docs`

### Goal

Reduce user confusion and improve audit transparency after semantic correctness fixes land.

### Scope

Address P1/P2/P3 usability and documentation issues:

1. TypeScript adjacent-line false positives.
2. Common-name query guidance.
3. TypeScript type alias classification or documented limitation.
4. Dynamic/dependency-injection call hierarchy limits.
5. `workspace_graph_status` unreadable directory transparency.
6. Safe user-facing guidance for semantic-vs-textual search.

### Problems to address

#### Adjacent-line false positives in TypeScript

Observed examples:

- `getDefaultRouteForRole` references included adjacent lines without the symbol:
  - `front/app/routes/home.tsx:31` — `return redirect(route)`
  - `front/app/routes/startup.tsx:15` — `return redirect(route)`
- `buildModulesByDependencyModuleVariables` included adjacent `fetchToGraphql(...)` line after the real call.

Expected:

- Reference location should point only to the actual AST node span or line containing the symbol/call.
- Parent/adjacent callback body lines must not be returned as separate references.

#### Common-name usability

Noisy symbols include:

```text
loader, start, save, generate, execute, toResponse, ok
```

Docs/help should recommend:

- smallest path possible;
- explicit `language`;
- explicit `kind`;
- declaring file path for common methods;
- `reference_kinds=["call"]` only when call-only impact is needed.

#### TypeScript type aliases

Observed with `ReviewAnalysisStatus`, where TS type aliases may be reported as `[variable]`.

Expected:

- Prefer `type_alias` classification when possible.
- If the underlying model normalizes aliases to variables, expose a note or declaration-kind hint.

#### Dynamic/dependency-injection call hierarchy

Observed:

- `startSiasAi` call hierarchy found local `registerShutdown`, but not injected calls like `deps.loadConfig()` / `deps.buildServer()`.

Expected:

- Document limits around injected/dynamic receiver calls.
- Optionally classify unresolved dynamic calls as probable/external leaves when requested.

#### Graph status transparency

Observed:

```text
unreadable_dirs=4
```

Expected:

- Include bounded unreadable directory paths or categories in `workspace_graph_status`.
- Keep secrets safe: do not print `.env` contents or credential-bearing path contents.

### Fixtures/docs to add or update

- TypeScript adjacent-line false-positive fixture.
- Type alias classification fixture or documented expected output.
- Status-output test for unreadable directory summaries if a test harness exists.
- Code Research docs/help text with best-practice query recipes.

### Validation

- Adjacent false positives are removed.
- Common-name guidance appears in docs/help text.
- `workspace_graph_status` identifies unreadable directories in bounded, secret-safe form.
- Existing status output remains concise and stable.

### Out of scope

- P0 Java/TS semantic extraction already covered by Mini-SDDs 1–3.
- New text-search mode.
- Broad UI redesign.

## Shared Regression Matrix

Use this matrix in each Mini-SDD as applicable:

| Check | Expected result |
|---|---|
| `code_find relation=declaration` | exact file/line match |
| `code_find relation=references` | no known semantic false negatives for supported constructs |
| `code_find relation=references reference_kinds=["call"]` | only call references when call-only requested |
| `code_call_hierarchy direction=outgoing` | includes supported direct and optional calls |
| targeted `rg` baseline | used as audit-grade fallback comparator |
| duplicate check | no duplicate same-node call references |
| non-symbol text check | string literals and test names excluded from semantic refs |

## Safe User-Facing Guidance Until Fixed

```text
Code Research is semantic, not a replacement for exhaustive text search.
Use it first for declarations, implementations, references, and call hierarchy.
For audit-grade completeness, validate with targeted rg/grep, especially for imports,
tests, mocks, Java DTO/type references, optional chaining, framework-reflection entrypoints,
generated files, and common names.
```

## Best-Practice Query Recipes

### Java declaration

```text
code_find path=back query=ReviewRestController language=java kind=class
```

### Java implementation

```text
code_find path=back_files query=DocumentationSlotRepository relation=implementation language=java kind=interface
```

### Java common method call hierarchy

```text
code_call_hierarchy path=back/src/main/java/.../StartReviewAnalysisUseCase.java symbol=start direction=incoming language=java kind=method max_depth=2
```

### TypeScript route loader

```text
code_call_hierarchy path=front/app/routes/startup.tsx symbol=loader direction=outgoing language=ts kind=function max_depth=2
```

### Exhaustive fallback with rg

```bash
rg -n 'SymbolName\b' path --glob '!node_modules/**' --glob '!dist/**' --glob '!target/**'
```

### Optional-chain fallback

```bash
rg -n '\?\.\w+\s*\(' back_ia/src back_ia/test --glob '!node_modules/**' --glob '!dist/**'
```

## Source Audit Coverage

Original audit coverage:

- `front` TypeScript/React Router
- `back` Java backend
- `back_files` Java service
- `back_ia` TypeScript service
- monorepo cross-service duplicate/common symbols

No SIAS source files were modified during the audit.
