# Code Research Future Improvements

This document tracks only future improvements. Completed parity work is archived under:

`openspec/changes/archive/2026-07-15-code-research-parity-gap-fixes/`

## Agreed execution plan

The next initiative will use **one shared PRD followed by three independent formal SDD flows**. Mini-SDD is intentionally rejected because each change affects public contracts, semantic resolution, graph authority, or persistence proofs.

### Shared PRD — Precision and graph authority

The PRD must define the common product contract before implementation:

- optional owner, qualified-name, signature, and declaration-ID selectors;
- ambiguity and no-match behavior;
- canonical signature representation by language;
- overload-family identity without collapsing declarations;
- confidence semantics for overload resolution;
- Java graph-authority boundaries by reference family;
- compatibility, fallback, diagnostics, and schema-version expectations.

The PRD is common context for all three SDDs. Approval of the PRD does not approve implementation automatically.

### Formal SDD 1 — Owner and signature selectors

**Change slug:** `code-research-owner-signature-selectors`

**Goal:** add backward-compatible precise targeting to `find_symbol`, `find_references`, forward call trees, and reverse call trees across TypeScript/TSX, JavaScript/JSX, and Java.

**Required outcomes:**

- optional `owner`, `qualified_name`, signature discriminator, or exact declaration ID;
- explicit ambiguity diagnostics;
- unchanged behavior when selectors are absent;
- direct/graph parity for selected and ambiguous cases;
- no hidden first-match selection when an exact selector is supplied.

### Formal SDD 2 — Overload families and resolution

**Change slug:** `code-research-overload-families`

**Dependency:** starts after SDD 1 establishes precise selector and ambiguity contracts.

**Goal:** model overload families additively while preserving each declaration and resolving a called overload only when evidence is authoritative.

**Required outcomes:**

- stable family metadata for TypeScript and Java;
- individual declaration IDs remain unchanged and queryable;
- language-specific compatibility rules;
- ambiguous calls link to the family or return diagnostics rather than selecting arbitrarily;
- owner/signature selectors can target one overload explicitly.

### Formal SDD 3 — Java graph-native reference authority

**Change slug:** `code-research-java-reference-graph-authority`

**Goal:** make selected Java reference families authoritative in the persisted graph while preserving truthful fallback until coverage proofs are complete.

**Implementation order:**

1. field reads and writes;
2. instantiations;
3. type references;
4. method and constructor references;
5. proof coverage, fallback removal criteria, and performance validation.

**Required outcomes:**

- one reference family per bounded apply slice;
- persisted edges only from canonical evidence;
- per-file/per-family authority proofs;
- no `graph/fresh/complete` claim for an unsupported family;
- exact direct/graph location and metadata parity;
- measurable benefit before replacing direct fallback.

### Workflow and validation policy

- Recommended SDD mode: `normal`.
- Recommended artifact store: `hybrid`.
- Each SDD has independent proposal, spec, design, tasks, apply, verify, archive, and commit decisions.
- Strict TDD applies to every implementation slice.
- Do not start dependent SDDs before the preceding contract is verified.
- After each code-research change, run three independent validators: TS/TSX, JS/JSX, and Java.
- Final release validation requires reload, fresh workspace graph, and live smoke tests for all four tools.
- Commit and push require separate explicit approval.

### Resume checklist

- [ ] Resolve the working-tree decision for this untracked roadmap document.
- [ ] Confirm SDD mode (`normal` recommended).
- [ ] Confirm artifact store (`hybrid` recommended).
- [ ] Create and approve the shared PRD.
- [ ] Execute and archive SDD 1.
- [ ] Execute and archive SDD 2.
- [ ] Execute and archive SDD 3 in bounded reference-family slices.
- [ ] Run final three-language validators and live post-reload smoke tests.

## Decision framework

| Priority | Meaning |
|---|---|
| P0 | High-value correctness or disambiguation work. Good candidate for the next change. |
| P1 | Valuable coverage improvement with a safe static subset. |
| P2 | Useful ergonomics or specialized coverage. Implement after the core model is stable. |
| P3 | Runtime-dependent or highly ambiguous behavior. Keep opt-in or unresolved by default. |

| False-positive risk | Required approach |
|---|---|
| Low | Safe to enable by default with direct/graph parity tests. |
| Medium | Support only statically provable cases; unresolved cases must remain unresolved or fall back truthfully. |
| High | Require configuration, an allowlist, compiler evidence, or explicit opt-in. Never guess by default. |
| Very high | Prefer diagnostics over inferred edges unless authoritative runtime/build metadata exists. |

## Roadmap summary

| ID | Improvement | Languages | Priority | Value | False-positive risk | Feasibility |
|---|---|---|---|---|---|---|
| A | Owner and signature selectors | TS/JS/Java | P0 | High | Low | High |
| B | Overload family grouping and resolution | TS/Java | P0 | High | Medium | High for grouping; medium for call resolution |
| C | Conservative polymorphic dispatch | Java | P0 | High | High | Medium with bounded candidate sets |
| D | Graph-native Java references | Java | P0 | High | Low–medium | High by incremental reference family |
| E | Nested object-member linking | TS/JS | P1 | High | Medium | High for immutable static paths |
| F | CommonJS `require` linking | JS/TS | P1 | High in Node/CJS | Medium | High for literal paths |
| G | Callable class-field body references | TS/JS | P1 | Medium–high | Low–medium | High for stable initializers |
| H | Inherited, overridden, default, and `super` calls | Java | P1 | High | Medium | Medium–high |
| I | Method and constructor references | Java | P1 | Medium–high | Medium | High for resolved target types |
| J | Lambda and anonymous-class callable nodes | Java | P1 | Medium | Medium | Medium |
| K | Configured HOC/wrapper inference | TS/JS | P2 | Medium | High | High with allowlists only |
| L | Generic and wildcard target refinement | Java | P2 | Medium | Medium–high | Medium |
| M | Framework-aware Java relationships | Java | P2 | Medium–high in framework projects | High | Medium with explicit adapters |
| N | Stable call-tree path representation | TS/JS/Java | P2 | Medium | None; compatibility risk instead | High |
| O | JSX `called_as` metadata parity | TSX/JSX | P2 | Low–medium | Low | High |
| P | Dynamic computed-name linking | TS/JS | P3 | Low–medium | Very high | Low without constant evaluation |
| Q | Reflection, `ServiceLoader`, and generated Java code | Java | P3 | Specialized | Very high | Low without build/runtime metadata |

## P0 — Recommended next work

### A. Owner and signature selectors

**Problem**

A query such as `run` can match multiple owners or overloads:

```text
UserService.run(String)
AuditService.run(Event)
```

**Proposed capability**

Add optional selectors such as:

- `owner`
- `qualified_name`
- parameter/signature discriminator
- exact declaration ID

Apply them consistently to `find_symbol`, `find_references`, forward call trees, and reverse call trees.

**Value:** High. Removes ambiguity and reduces accidental cross-owner results.

**False-positive risk:** Low. Explicit user input narrows results rather than inferring new edges.

**Safe implementation strategy**

1. Add optional, backward-compatible tool fields.
2. Preserve current behavior when selectors are absent.
3. Return explicit ambiguity diagnostics when multiple declarations remain.
4. Never silently choose the first matching owner when an exact selector was supplied.

**Acceptance checks**

- Same-file same-name methods can be selected independently.
- Direct and graph modes return the same selected declaration and references.
- Invalid selectors return no result plus useful diagnostics.
- Existing unqualified queries remain compatible.

### B. Overload family grouping and resolution

**Problem**

Overloads are correctly preserved as separate declarations, but callers cannot request their family relationship explicitly.

```ts
parse(value: string): Result;
parse(value: Buffer): Result;
parse(value: unknown): Result { /* ... */ }
```

```java
Result parse(String value)
Result parse(byte[] value)
```

**Proposed capability**

Separate two concerns:

1. Additive overload-family metadata for navigation and provenance.
2. Conservative call-to-overload resolution when argument evidence is sufficient.

**Value:** High for impact analysis and refactoring.

**False-positive risk:**

- Grouping: Low–medium.
- Selecting one called overload: Medium–high with generics, conversions, varargs, or unknown types.

**Safe implementation strategy**

- Group only declarations with the same language, owner, source name, and compatible callable family.
- Never collapse declaration IDs.
- Resolve a unique overload only when argument count/types make one candidate authoritative.
- Otherwise link to the family or return ambiguity diagnostics.

**Acceptance checks**

- Exact declarations remain independently queryable.
- Family metadata is stable across direct and graph modes.
- Ambiguous calls do not select an arbitrary overload.
- Java and TypeScript rules remain language-specific.

### C. Conservative polymorphic dispatch

**Languages:** Java

**Problem**

Interface and abstract-type calls can have multiple runtime targets:

```java
Service service = createService();
service.run();
```

**Value:** High. This is a major limitation in Java call graphs and impact analysis.

**False-positive risk:** High. Listing every implementation can create noisy and misleading trees.

**Safe implementation strategy**

Use explicit confidence levels:

1. **Exact:** final class, final method, local `new ConcreteType()`, or uniquely known receiver.
2. **Bounded candidates:** sealed hierarchy or closed workspace hierarchy.
3. **Unknown:** open interface hierarchy, external implementations, reflection, or dependency injection without evidence.

Only exact targets should appear as ordinary application edges. Bounded candidates should be labeled as potential dispatch targets. Unknown dispatch must remain unresolved.

**Acceptance checks**

- Final/local concrete receivers resolve exactly.
- Sealed hierarchies return only permitted implementations.
- Open interfaces do not produce every implementation as a definite call.
- Direct and graph results expose the same confidence semantics.

### D. Graph-native Java references

**Problem**

Some Java reference families currently rely on truthful direct or hybrid fallback rather than authoritative persisted graph edges.

Candidate families:

- field reads and writes;
- instantiations;
- type references;
- imports;
- method references;
- selected inheritance relationships.

**Value:** High. Improves performance, provenance, and consistency for large Java workspaces.

**False-positive risk:** Low–medium when implemented one reference family at a time.

**Safe implementation strategy**

- Add one reference family per slice.
- Persist only edges proven by canonical extraction.
- Extend graph coverage proofs to declare exactly which reference families are authoritative per file.
- Keep hybrid fallback until proof coverage is complete.
- Never return `graph/fresh/complete` for an unsupported reference family.

**Acceptance checks**

- Graph and direct locations plus metadata match exactly.
- Zero-result graph queries are authoritative only when coverage proves the family.
- Corrupt, stale, or incomplete shards fall back truthfully.
- Benchmarks show a material improvement before removing fallback.

## P1 — Valuable bounded coverage

### E. Nested object-member linking

**Languages:** TS/JS

```ts
api.users.repository.save();
```

**Value:** High in object-as-module and service-container patterns.

**False-positive risk:** Medium because reassignment, mutation, spreading, and aliasing can change ownership.

**Safe subset**

- Object literals bound to stable `const` declarations.
- Static identifier or literal property paths.
- No reassignment, spread from unknown values, dynamic computed names, or escaping mutation.

**Mitigation**

Represent a canonical owner path such as `api.users.repository.save`. Stop resolution at the first unstable segment.

### F. CommonJS `require` linking

**Languages:** JS/TS

```js
const service = require('./service');
service.run();
```

**Value:** High for legacy Node and mixed ESM/CJS repositories.

**False-positive risk:** Medium.

**Safe subset**

- Literal relative module paths.
- Direct namespace binding and static destructuring.
- Stable, non-reassigned bindings.

**Do not infer by default**

- `require(dynamicExpression)`;
- conditional module paths;
- monkey-patched exports;
- mixed interop whose target is not unique.

### G. Callable class-field body references

**Languages:** TS/JS

```ts
class Service {
  execute = () => helper();
}
```

**Value:** Medium–high in React and modern TypeScript.

**False-positive risk:** Low–medium for stable initializers.

**Safe subset**

- Arrow or function-expression initializer.
- No later reassignment.
- Normal lexical `this` rules preserved.

**Mitigation**

Index the initializer body as one callable node but keep the declaration kind and class-field lifecycle explicit.

### H. Inherited, overridden, default, and `super` calls

**Languages:** Java

```java
@Override
public Result execute() {
    return super.execute();
}
```

**Value:** High for framework and layered Java applications.

**False-positive risk:** Medium.

**Safe subset**

- Exact `super.method()` target.
- Unique inherited method after Java visibility and override rules.
- Interface default methods only when one target is unambiguous.

**Mitigation**

Return ambiguity diagnostics for conflicting defaults or unresolved external ancestors. Do not guess based only on method name.

### I. Method and constructor references

**Languages:** Java

```java
users.stream().map(User::name);
factory.map(Service::new);
```

**Value:** Medium–high for functional Java code.

**False-positive risk:** Medium because target overloads depend on the functional interface type.

**Safe subset**

- Receiver type is resolved.
- Functional-interface arity is known.
- One compatible method or constructor remains.

**Mitigation**

If overload selection remains ambiguous, link to an overload family or preserve the reference as unresolved metadata.

### J. Lambda and anonymous-class callable nodes

**Languages:** Java

**Problem**

Lambda and anonymous-class scopes are preserved, but representing them as complete callable nodes would produce deeper call trees.

**Value:** Medium.

**False-positive risk:** Medium, especially when assigning synthetic names or owners.

**Safe implementation strategy**

- Keep stable synthetic IDs based on file and range.
- Preserve the functional-interface or anonymous superclass relationship.
- Expose synthetic nodes only when explicitly requested or when expanding a known callback edge.
- Do not present synthetic callables as ordinary named declarations.

## P2 — Specialized or ergonomic improvements

### K. Configured HOC/wrapper inference

**Languages:** TS/JS

```tsx
const Page = memo(() => <View />);
```

**Value:** Medium in React and framework-heavy projects.

**False-positive risk:** High for arbitrary function calls.

**Safe implementation strategy**

- Explicit allowlist/configuration only.
- Built-in transparent syntax wrappers remain separate from semantic HOCs.
- Each configured wrapper declares which argument preserves callable/component identity.
- Callback-consuming functions remain negative cases.

### L. Generic and wildcard target refinement

**Languages:** Java

```java
Repository<? extends User> repository;
T extends Service;
```

**Value:** Medium for owner and overload refinement.

**False-positive risk:** Medium–high because erasure and unknown substitutions limit certainty.

**Safe implementation strategy**

- Use generic bounds to eliminate impossible candidates, not to invent a unique target.
- Preserve unresolved type variables in diagnostics.
- Prefer compiler/build metadata when available.

### M. Framework-aware Java relationships

**Languages:** Java

Potential adapters:

- Spring/Jakarta dependency injection;
- controller/service/repository relationships;
- event listeners and scheduled methods;
- annotation-driven handlers;
- Lombok-generated members.

**Value:** Medium–high in matching projects, low elsewhere.

**False-positive risk:** High because framework configuration, profiles, generated code, and runtime wiring affect targets.

**Safe implementation strategy**

- Explicit opt-in adapters.
- Detect framework version and annotations.
- Prefer compiler output, annotation-processor output, or build metadata.
- Label framework-derived edges separately from language-level edges.
- Never infer a unique injected implementation when multiple beans/candidates remain.

### N. Stable call-tree path representation

**Languages:** TS/JS/Java

**Value:** Medium for scripts, snapshots, and integrations.

**False-positive risk:** None. The risk is backward compatibility.

**Options**

1. Always project-relative inside the workspace, absolute outside.
2. Always absolute.
3. Return both `file` and `workspace_relative_file` additively.

**Recommendation:** Option 3 first, then deprecate ambiguity only after compatibility review.

### O. JSX `called_as` metadata parity

**Languages:** TSX/JSX

**Value:** Low–medium. Improves display and auditability, not reference correctness.

**False-positive risk:** Low.

**Safe implementation strategy**

Preserve exact bounded source text when available and define whether whitespace is normalized. Keep location parity as the authoritative contract.

## P3 — Avoid speculative defaults

### P. Dynamic computed-name linking

**Languages:** TS/JS

```ts
object[prefix + 'Handler']();
```

**Value:** Low–medium.

**False-positive risk:** Very high.

**Recommendation**

Only resolve expressions reduced by bounded constant evaluation: literals, immutable local constants, and simple literal templates. Everything else remains dynamic and unresolved.

### Q. Reflection, `ServiceLoader`, and generated Java code

**Languages:** Java

```java
Class.forName(className);
ServiceLoader.load(Service.class);
```

**Value:** Specialized but potentially important.

**False-positive risk:** Very high without runtime/build evidence.

**Safe approaches**

- consume explicit service-provider configuration;
- inspect compiled classes or annotation-processor output;
- accept user-provided mappings;
- label reflective candidates separately;
- never infer from arbitrary strings by default.

## Recommended implementation batches

### Batch 1 — Precise query targeting

- A. Owner and signature selectors
- B. Overload family metadata

**Why first:** High value, low default false-positive risk, and useful to every language.

### Batch 2 — Java graph authority and dispatch

- D. Graph-native Java references, one family at a time
- H. Exact inherited and `super` calls
- C. Conservative polymorphic dispatch after confidence semantics are designed

**Why second:** Largest remaining Java correctness and performance gain.

### Batch 3 — Static TS/JS linking

- E. Nested object members
- F. Literal CommonJS `require`
- G. Callable class fields

**Why third:** Broad practical coverage with safe static subsets.

### Batch 4 — Callable relationships

- I. Java method/constructor references
- J. Java lambda/anonymous callable nodes
- K. Configured HOCs

### Batch 5 — Metadata and integration ergonomics

- N. Stable path representation
- O. JSX `called_as`
- L. Generic/wildcard refinement

### Batch 6 — Explicit opt-in only

- M. Framework-aware Java adapters
- P. Dynamic computed names
- Q. Reflection/generated code

## Global acceptance policy

Every future item must include:

- direct-versus-graph parity tests;
- negative ambiguity and false-positive tests;
- diagnostics for unresolved or fallback behavior;
- compatibility review for tool-schema or output changes;
- one independent validator per affected language;
- fresh temporary graph validation;
- performance evidence before replacing direct fallback with graph authority.

A feature must not be declared graph-complete unless its reference/declaration family is covered by persisted proofs.
