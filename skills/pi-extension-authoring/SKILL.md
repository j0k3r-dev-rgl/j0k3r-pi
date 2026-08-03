---
name: pi-extension-authoring
description: "create, restructure, or review independent Pi extensions, custom tools, lifecycle hooks, package dependencies, and TUI renderers with a consistent modular layout, native collapsed/expanded rendering, and lossless bounded model-facing output."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.2"
---

# Pi Extension Authoring

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "workflow",
  "domains": ["pi", "extensions", "custom-tools", "typescript", "tui", "tool-rendering"],
  "triggers": {
    "paths": [
      "extensions/*.ts",
      "extensions/*.js",
      "extensions/**/index.ts",
      "extensions/**/index.js",
      "extensions/**/src/**/*.ts",
      "extensions/**/src/**/*.js",
      "extensions/**/package.json",
      "extensions/**/README.md",
      ".pi/extensions/*.ts",
      ".pi/extensions/*.js",
      ".pi/extensions/**/index.ts",
      ".pi/extensions/**/index.js",
      ".pi/extensions/**/src/**/*.ts",
      ".pi/extensions/**/src/**/*.js",
      ".pi/extensions/**/package.json",
      ".pi/extensions/**/README.md",
      "~/.pi/agent/extensions/*.ts",
      "~/.pi/agent/extensions/*.js",
      "~/.pi/agent/extensions/**/index.ts",
      "~/.pi/agent/extensions/**/index.js",
      "~/.pi/agent/extensions/**/src/**/*.ts",
      "~/.pi/agent/extensions/**/src/**/*.js",
      "~/.pi/agent/extensions/**/package.json",
      "~/.pi/agent/extensions/**/README.md"
    ],
    "keywords": [
      "create Pi extension",
      "crear extensión de Pi",
      "Pi extension",
      "custom Pi tool",
      "ExtensionAPI",
      "registerTool",
      "renderCall",
      "renderResult",
      "tool renderer",
      "expand collapse",
      "collapsible tool output",
      "Pi TUI component",
      "extension dependency independence",
      "own node_modules",
      "cross-extension dependency",
      "independent extension package"
    ]
  },
  "sdd_phases": [],
  "related_skills": [
    "workflow-triage",
    "tdd"
  ],
  "priority": 88
}
```

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `triggers.paths`: glob-like project paths that should activate the skill.
- `triggers.keywords`: canonical English terms plus common user aliases.
- `sdd_phases`: phases where the skill is useful: `explore`, `proposal`, `spec`, `design`, `task`, `apply`, `verify`, or `archive`.
- `related_skills`: skills a future agent should realistically consider one hop away.
- `priority`: routing priority from 0 to 100. More specific skills should outrank generic helpers.

## Activation Contract

Use this skill when creating, restructuring, or reviewing a Pi extension; registering custom tools or lifecycle hooks; designing extension configuration or provider boundaries; or implementing tool-call and tool-result rendering in the Pi TUI.

Load it for extension surfaces under project-local `.pi/extensions/`, global `~/.pi/agent/extensions/`, or an extension workspace such as `extensions/<name>/`.

Do not use it for Pi skills, subagent definitions, themes, or configuration-only changes that do not implement an extension. Use the corresponding domain skill instead. This skill defines extension architecture and runtime contracts; `workflow-triage` still owns route selection, and `tdd` exclusively owns the testing workflow.

## Hard Rules

### Evidence and scope

- Read the installed Pi `docs/extensions.md` completely before implementation. Read `docs/tui.md` completely when rendering or custom UI is in scope, and follow all relevant Markdown cross-references.
- Inspect the installed Pi examples that match the requested capability. Do not rely on remembered APIs when the local Pi version is available.
- Confirm whether the extension is global, project-local, or distributable before choosing its location and package contract.
- Treat `extensions/code-research/` and `extensions/websearch/` as structural references, not as templates to copy blindly. Preserve their thin entrypoint and separated tool/core/render boundaries while correcting version-specific or duplicated implementation details.

### Canonical structure

Use this scalable baseline for an extension with multiple tools, dependencies, configuration, providers, lifecycle resources, or reusable rendering. A genuinely trivial extension may remain a single `<extension-name>.ts` or `<extension-name>.js` file only after the single-file decision gate below is satisfied. Once a second responsibility appears, adopt the modular structure instead of growing a monolith.

```text
<extension-name>/
├── index.ts                   # required for a directory extension: thin ExtensionAPI composition root
├── README.md                  # required for multi-file/package extensions: public contract
├── package.json               # when dependencies or distribution require a package
├── package-lock.json          # when npm is the selected package manager and the package is tracked
└── src/
    ├── tools/
    │   ├── index.ts           # public tool registry/composition
    │   ├── <tool-name>.ts     # one public capability or cohesive tool family per module
    │   └── common/            # optional shared result/runtime/registry helpers
    ├── render/
    │   └── index.ts           # required when tools render: compact and expanded renderers
    ├── core/                  # optional domain orchestration with no Pi registration
    ├── providers/             # optional external-system adapters
    ├── config.ts              # optional validated configuration and defaults
    ├── security.ts            # required when secrets, external input, or redaction are in scope
    └── types.ts               # shared public/internal types when warranted
```

- Keep `index.ts` registration-only: compose tool modules and lifecycle hooks, but do not place provider calls, parsing, formatting, or domain algorithms there.
- Register only intentionally public tools. Keep provider helpers and internal orchestration unregistered unless the public contract explicitly exposes them.
- Add optional folders only when their responsibility exists. Do not create empty architecture or merge unrelated responsibilities into one large file.
- Keep public tool names, schemas, configuration keys, result metadata, and README documentation synchronized.

### Pi runtime and lifecycle

- Use the installed Pi extension API and imports supported by that version.
- Keep extension initialization cheap. Do not start watchers, timers, child processes, sockets, or other long-lived resources directly in the extension factory.
- Start session-scoped resources from the appropriate lifecycle event or lazily on first use. Stop them idempotently during `session_shutdown`.
- Respect the execution `AbortSignal` and pass it through nested I/O. Cancellation must not be converted into an ordinary provider failure.
- Throw from tool execution when Pi should render a native failed tool result. Return structured domain failures only when they are an intentional, documented tool contract.
- Use strict TypeBox input schemas. Use Pi's compatible string-enum helper where provider compatibility requires it.
- Tool names, labels, descriptions, and prompt guidance must be specific enough that the model can choose the tool without guessing.

### Configuration and security

- Give configuration explicit defaults, strict validation, bounded numeric/string values, and actionable error messages.
- Honor project-local configuration only after applying Pi's project-trust boundary.
- Keep credentials out of committed configuration, schemas, tool results, details, logs, and rendered errors. Use environment or Pi authentication facilities appropriate to the installed version.
- Redact secret-like values recursively before returning provider payloads or error details.
- Separate provider/network adapters from tool registration so SSRF, redirects, response limits, retries, and provider-specific errors have one enforceable boundary.
- Never expose sensitive host details, debugger URLs, raw credentials, or unrestricted local paths merely to improve rendering.

### Model-facing output: complete but bounded

- Treat tool `content` as model-facing data and `details` as structured metadata for rendering and follow-up. Never let collapsed/expanded UI state mutate the execution result.
- Return the complete result directly when it fits the extension's documented output budget.
- For oversized results, preserve information without returning it all in one context-heavy response:
  - use stable pagination, cursors, offsets/limits, or bounded chunks; or
  - store a safe artifact and return an explicit retrieval path/tool when pagination is not practical.
- Never silently discard the remainder. Every bounded response must state the returned range or count, total when known, whether more data exists, and the exact continuation action (`next_cursor`, next offset/page, or follow-up tool/artifact reference).
- Continuation must be deterministic and must not duplicate or skip items under the documented consistency model.
- Apply redaction and authorization before persistence or pagination. A continuation mechanism must not become a bypass around security or project boundaries.
- Distinguish terminal-width clipping in a collapsed renderer from model-output truncation. Visual clipping is allowed; data loss without continuation is not.

### Collapsed and expanded rendering

- Every public tool result must support Pi's collapsed/expanded tool-row contract.
- Implement `renderResult(result, { expanded, isPartial }, theme, context)` using the callback shape supported by the installed Pi version.
- Let Pi own expansion state. Tool rows start collapsed; do not create a competing state variable or custom expand key handler.
- The collapsed view must be a bounded, useful summary: tool name, status, key counts/identity, and a native keybinding hint for expansion.
- The expanded view must render all model-facing content returned in the current page/chunk, plus relevant structured metadata. It must not reveal redacted or intentionally non-model-facing sensitive details.
- Handle `isPartial`, success, failure, empty, and continuation states deliberately.
- Use Pi's keybinding hint API for `app.tools.expand`; never hardcode `ctrl+o` or another physical key.
- Prefer native Pi TUI components such as `Text`, `Container`, `Box`, and `Markdown`, plus Pi's default tool shell. Use `renderShell: "self"` only when the extension truly needs to own framing, padding, and background.
- Prefer wrapping over clipping in expanded output. Keep every rendered line within the supplied width using Pi's ANSI-aware width/wrapping helpers.

### Custom component fallback

Use a custom reusable component only when native components cannot express the required layout or behavior.

- Document why native components are insufficient before introducing the component.
- Implement `render(width): string[]` and `invalidate()`; clear cached and theme-derived output during invalidation.
- Guarantee that every rendered line fits `width`, accounting for ANSI escapes, graphemes, combining characters, and wide characters. Prefer Pi's `truncateToWidth`, `wrapTextWithAnsi`, and `visibleWidth` helpers over hand-written width logic.
- Implement `handleInput` only for interaction independent from Pi's tool-row expansion. Never intercept or duplicate `app.tools.expand`.
- Guard TUI-only custom UI with the runtime mode when the extension can also run through RPC or non-interactive modes.
- Keep the fallback in `src/render/` and reuse it across the extension instead of embedding anonymous component implementations in each tool.

### Dependency independence

- Every extension MUST be independently installable, removable, testable, reloadable, and distributable. Its operation MUST NOT depend on another extension being present.
- Every external package imported or resolved by an extension MUST be declared by that extension's own `package.json` under the category required by the installed Pi package contract. Runtime third-party packages belong in `dependencies`; Pi-bundled core packages belong in `peerDependencies` with the documented range, and package-local development declarations/installations MUST provide the extension's own test and typecheck environment when needed.
- An extension MUST resolve packages from its own package installation or from Pi's documented bundled-core package contract. It MUST NOT import, resolve, probe, search, or fall back to another extension's directory, `package.json`, package tree, or `node_modules`, whether through relative paths, absolute paths, `createRequire`, custom search paths, dynamic imports, symlinks, environment-specific fallbacks, or test-only adapters.
- Never use a sibling extension as an implicit dependency provider. Shared runtime code is allowed only through an explicitly declared standalone package or a deliberately designed repository-level shared package with its own ownership and dependency contract.
- Tests MUST NOT pass merely because another extension happens to have installed a required module. Validate package ownership statically and run the extension's test/typecheck commands from its own directory with its own package installation.
- Any cross-extension dependency borrowing is a release blocker, not an acceptable temporary fallback.

### Package and documentation contract

- Put runtime third-party packages in `dependencies`. For a distributable Pi package, declare Pi core packages as peer dependencies according to the installed packaging documentation and ensure the extension's own local package environment supports its tests and typecheck.
- Keep package-manager choice and lockfile handling consistent with the containing repository.
- The README must document public tools, inputs, configuration location and trust behavior, credentials, output bounds/continuation, cancellation, lifecycle resources, rendering behavior, and known limits.
- Do not duplicate a testing process in this skill or in extension-specific agent guidance. Load `tdd` and let it own test selection, red-green-refactor behavior, and validation strategy.

## Decision Gates

- If intent, public tool contract, result size, extension scope, or configuration source is unclear, ask before creating files.
- A single-file extension is allowed only when it has one small cohesive responsibility, no third-party package contract, no reusable renderer, no configuration/security/provider boundary, and no long-lived resources. Otherwise use the modular directory structure; when uncertain, choose the modular structure.
- If the work changes an existing extension's public tool names, schemas, result shape, configuration, persisted state, or security boundary, let `workflow-triage` choose the appropriate design/apply/review route before editing.
- If output can exceed the direct-response budget, define pagination/chunk/artifact semantics and continuation metadata before implementation.
- If a custom component, `renderShell: "self"`, or custom keyboard handling appears necessary, first document why native components and Pi-owned expansion are insufficient.
- If long-lived resources are required, define ownership, startup, cancellation, restart, and idempotent shutdown before implementation.
- If project-local configuration is desired, define trusted-project behavior and safe behavior for untrusted projects before reading it.
- If the extension is distributable, read the installed package documentation and decide package metadata, dependencies, entrypoints, and included files explicitly.
- If an import resolves only because a sibling extension has the package installed, stop and repair the current extension's own package contract; never add a sibling-path resolver or fallback.
- If shared code is genuinely required across extensions, create or select an explicitly owned shared package and declare it normally in each consumer. Do not use filesystem reach-through as sharing.
- Before any implementation, load `tdd`; this skill must not substitute its own testing workflow.

## Execution Steps

1. Apply `workflow-triage`, confirm scope and public behavior, and inspect the current worktree for overlap.
2. Read the installed Pi extension documentation completely; load TUI, keybinding, theme, package, and SDK documentation only when the touched surface requires them, following relevant cross-references.
3. Inspect the closest official example and the existing extension if one is being changed.
4. Load `tdd` and hand off all testing decisions to it.
5. Define the public contract: tool names, schemas, result `content`, structured `details`, errors, cancellation, output bounds, and continuation.
6. Create or align the canonical folder structure. Keep the entrypoint thin and dependencies directed from registration toward tools, core/providers, rendering, configuration, security, and shared types.
7. Implement lifecycle, configuration, provider, and security boundaries before wiring public registration.
8. Implement native collapsed/expanded rendering for every public tool result, including partial, error, empty, and continuation states.
9. Add a custom reusable component only after the native-component decision gate is satisfied.
10. Keep the README and package contract aligned with the implementation.
11. Validate dependency independence: inspect the extension's own `package.json` and lockfile, reject sibling-extension paths or custom resolver fallbacks, and run tests/typecheck from the extension directory using only its own declared package environment and Pi's documented bundled-core contract.
12. Run the validation selected by `tdd` and the repository, then review every changed file for structure, public-contract drift, secret exposure, cancellation, cleanup, output continuation, and width-safe rendering.
13. Reload Pi or restart the relevant session when required by the installed extension-loading contract, then report any manual TUI validation still needed.

## Output Contract

Return:

- Skill applied: `pi-extension-authoring`.
- Extension scope and path.
- Pi documentation and examples inspected.
- Public tools and canonical folder structure created or changed.
- Dependency-independence evidence: extension-owned declarations/install environment, no sibling-extension package resolution, and package-local validation.
- Lifecycle, configuration, security, and provider boundaries considered.
- Model-facing output budget and lossless continuation strategy.
- Native collapsed/expanded rendering used, including `isPartial` and error behavior.
- Any custom component introduced and why native components were insufficient.
- Confirmation that `tdd` owned the testing workflow and the validation it selected.
- Review findings, manual TUI checks, remaining risks, and reload requirements.

## References

- Installed Pi `docs/extensions.md` — extension API, custom tools, lifecycle, rendering, trust, and output contracts.
- Installed Pi `docs/tui.md` — component interface, native components, width guarantees, input, and invalidation.
- Installed Pi `docs/keybindings.md` — namespaced actions and `app.tools.expand`.
- Installed Pi `docs/themes.md` — theme colors and Markdown themes.
- Installed Pi `docs/packages.md` — package discovery, extension-owned dependencies, bundled Pi core peer dependencies, isolated module roots, and distribution.
- Installed Pi `examples/extensions/` — version-matched implementation examples.
- `extensions/code-research/index.ts`, `extensions/code-research/src/tools/`, and `extensions/code-research/src/render.ts` — thin entrypoint and tool/core/render separation.
- `extensions/websearch/index.ts`, `extensions/websearch/src/tools/`, `extensions/websearch/src/render/index.ts`, and `extensions/websearch/src/security.ts` — modular tool registry, rendering, provider, and security boundaries.
- `skills/tdd/SKILL.md` — exclusive testing workflow companion.
- `skills/workflow-triage/SKILL.md` — route selection and review gate.
