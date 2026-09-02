# TypeScript symbol coverage v1

Coverage is versioned against `tree-sitter-typescript` / TSX grammar `0.23.2`; runtime extraction uses the installed TypeScript parser while fixtures preserve the same source-level declaration contract. Fixture coverage—not line coverage—is the completeness metric.

## Normative syntax matrix

Every supported row below is executed table-first in direct, fresh-graph, stale, partial, and corrupt-shard modes. The all-mode runner also requires exact direct-result parity and failure diagnostics. Negative callable and naming cases are embedded in the listed fixtures.

| Normative family | Fixture ID | Parser/declaration family | Supported forms | Query behavior |
|---|---|---|---|---|
| Functions | `TS-FUNCTION-OVERLOAD-AMBIENT`, `TS-FUNCTION-FORMS` | function declarations/signatures | named, exported, named default, generic, nested, overload, implementation, ambient, `.d.ts` | separate overload constituents; bodies are implementations |
| Callable bindings | `TS-CALLABLE-BINDINGS` | variable declarations and transparent expressions | function/arrow, multiple declarators, parentheses, `as`, `satisfies`, assertion, non-null | callback-consuming call results remain ordinary variables |
| Classes | `TS-CLASS-FORMS`, `TS-CLASS-MEMBERS` | class declarations | concrete, abstract, generic, decorated, exported/default | class identity remains distinct from member identity |
| Class members | `TS-CLASS-MEMBERS`, `TS-ANONYMOUS-COMPUTED-PRIVATE` | class elements | constructor, method, abstract method, accessor, static/private/computed member, callable/ordinary field | owner-qualified; abstract/signature-only members are not implementations |
| Interfaces | `TS-INTERFACE-SIGNATURES` | interface members/signatures | property, method, function property, call/construct/index signatures, generic/ambient forms | definition-only compatibility kinds |
| Type declarations | `TS-INTERFACE-SIGNATURES`, `TS-ENUM-NAMESPACE-ALIASES` | aliases/enums/modules | type alias, enum/member, namespace, internal/external module | constituent semantics are preserved |
| Aliases and exports | `TS-ENUM-NAMESPACE-ALIASES` | import/export declarations | default/named/namespace imports, export aliases, re-exports | stable source aliases are definition-only |
| Objects | `TS-BINDINGS-OBJECTS-ASSIGNMENTS` | object literal members | shorthand method, callable/ordinary/literal-computed/dynamic-computed property | stable bound object owner required |
| Assignments | `TS-BINDINGS-OBJECTS-ASSIGNMENTS` | binary/CommonJS assignments | identifier/property assignment, `exports.x`, `module.exports.x`, object-valued `module.exports` | stable source property identities are emitted |
| Destructuring | `TS-BINDINGS-OBJECTS-ASSIGNMENTS` | object/array binding patterns | every declarator; shorthand, rename, default, nested, rest, known/unknown source | every stable bound name is searchable |
| TSX | `TSX-COMPONENTS-WRAPPERS` | TSX declarations/expressions | function, generic arrow, transparent wrappers | equivalent to TypeScript declarations |
| Declaration merging | `TS-NAMING-MERGING`, `TS-MERGED-FAMILIES` | merged declarations | function/namespace, class/namespace, interface/class, repeated interface, overload groups | constituents remain separate |
| Anonymous/computed names | `TS-NAMING-MERGING`, `TS-ANONYMOUS-COMPUTED-PRIVATE` | anonymous defaults/private/computed names | anonymous function/class, private, literal and dynamic computed names | synthetic/default and source spelling policies apply |

The table-driven source is `test/fixtures/typescript-symbol-cases.ts`; parity assertions are in `test/typescript-symbol-parity.test.ts`. Fixture IDs, public unavailable enums, schema/model versions, grammar versions, and README links are checked for documentation consistency.

## Naming policy

- Named defaults keep the local name and set `exported_name: "default"`; anonymous defaults use `default` plus `anonymous: true`.
- `#private` names are searchable without `#` while modifiers/source spelling remain available.
- String, numeric, and no-substitution-template computed names use their decoded literal spelling.
- Dynamic computed names retain normalized source spelling such as `[dynamicName]`, set `dynamic_name: true`, and are never evaluated.

## Callable policy

Direct arrow/function expressions and transparent parentheses, `as`, `satisfies`, type assertions, and non-null wrappers are callable. Call expressions are not callable merely because they contain a callback. The default configured callable-wrapper list is empty.

## Intentionally unsupported or partial parser-recognized forms

| Node family | Status | Reason | Expected query behavior | Intended phase |
|---|---|---|---|---|
| arbitrary runtime-generated computed property identity | unsupported | requires expression evaluation/type resolution | searchable only by normalized source spelling when a stable syntax name exists | out of scope |
| framework/HOC call-result callable inference | unsupported by default | no approved wrapper evidence; false-positive risk | ordinary `variable`; explicit wrapper configuration may be proposed separately | future opt-in |
| type-checker-resolved aliases/runtime reflection | unsupported | requires TypeScript semantic/type-checker execution | source alias declaration remains searchable; resolved runtime target is not invented | out of scope |
| anonymous object literals without a stable bound owner | partial | no stable public owner identity | named members are emitted only when a stable bound object owner exists | future contract revision |

Unsupported cases are explicit and do not authorize graph-only omission: an unproven, stale, partial, corrupt, or incompatible graph returns graph-only results instead of falling back to canonical direct analysis with structured diagnostics.

## Benchmark corpus

`scripts/typescript-symbol-corpus.js` deterministically generates mixed TypeScript cohorts:

- medium: 1,000 files and at least 25,000 symbols;
- large: 10,000 files and at least 250,000 symbols.

`npm run benchmark:typescript-symbols -- --size medium|large` performs five cold and twenty warm direct/graph queries, checks normalized parity and repeatability, and reports median/p95 plus machine/process metadata. `--baseline-graph-p95 <ms>` additionally enforces the 110% pre-change baseline threshold.
