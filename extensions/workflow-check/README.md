# Workflow tools

Global Pi extension providing structured calls for every operation of the Planned Workflow checker. Run `/reload` after installation or editing; `index.ts` is auto-discovered. No settings, credentials, network, timers, child processes, or extra runtime dependencies are needed.

## Tools and ownership

| Tool | Caller | Purpose |
|---|---|---|
| `workflow_check({ change_dir, phase, baseline_id?, diagnostic_offset? })` | Orchestrator and authorized workers | Read-only boundary check, continuity snapshot, and Surface Check attribution; phases: `plan`, `apply`, `verify`, `deliver`, `snapshot`, `surface`. |
| `workflow_record({ change_dir, action, ..., diagnostic_offset? })` | Orchestrator only | Update the change directory's `flow.json` or atomically archive a verified change; actions: `authorize`, `baseline`, `candidate`, `verify`, `archive` (`diagnostic_offset` pages failed diagnostics only). |

The planner uses `check`/`plan`, implementer `check`/`apply`, and independent verifier `check`/`verify` plus `check`/`snapshot` before READY. Workers must not have `workflow_record` in their allowlists. All tools return the next permitted action; none advances phases, delegates, implements, runs tests, or infers user consent automatically. Role separation is through caller permissions/worker allowlists, not an authenticated role claim in arguments or an OS sandbox.

```text
workflow_check({ change_dir: "/workspace/openspec/changes/example", phase: "plan" })
workflow_record({ change_dir: "/workspace/openspec/changes/example", action: "authorize", author: "j0k3r", reference: "actual user approval message", plan_sha256: "digest returned by the reviewed plan check" })
workflow_check({ change_dir: "/workspace/openspec/changes/example", phase: "apply" })
workflow_record({ change_dir: "/workspace/openspec/changes/example", action: "baseline", label: "pre-apply" })
# ... delegate authorized implementation ...
workflow_check({ change_dir: "/workspace/openspec/changes/example", phase: "surface", baseline_id: "pre-apply" })
workflow_record({ change_dir: "/workspace/openspec/changes/example", action: "candidate", executors: ["actual implementation session ID"], files: ["/workspace/src/code.js"] })
workflow_check({ change_dir: "/workspace/openspec/changes/example", phase: "verify" })
workflow_check({ change_dir: "/workspace/openspec/changes/example", phase: "snapshot" })
workflow_record({ change_dir: "/workspace/openspec/changes/example", action: "verify", executor: "actual independent reviewer session ID" })
workflow_check({ change_dir: "/workspace/openspec/changes/example", phase: "deliver" })
workflow_record({ change_dir: "/workspace/openspec/changes/example", action: "archive", author: "j0k3r", reference: "actual user archive approval message" })
```

Use actual values, never the example identities/digest. `authorize` requires previously granted user consent and the actual reviewed plan digest. `baseline` captures a metadata-only snapshot (`[absPath, 'present'|'absent'|'symlink', sha256]`, never raw file contents or secrets, zero `/tmp/` files) under `flow.json` `baselines` (supporting optional `label`). `surface` compares current workspace state against a captured baseline (`baseline_id` matches `id` or `label`, defaulting to the latest entry), ignores unchanged pre-existing dirty files/symlinks, attributes deltas to `Writable Paths`, `UNIT-*`, or `Preparation/Integration`, flags violations (`out_of_surface`, `overlap`, `unassigned_writable`, `unexpected_symlink`, read-only `project_contract_drift`), and outputs sorted `candidate_files`. `candidate` requires every baseline-relative deliverable (including deletions) and every implementation session; it invalidates previous verification while preserving `baselines`. `snapshot` recomputes canonical deliverable + deduplicated read-only Project Contract records and `sha256(JSON.stringify(sortedRecords))`, reporting `MATCH` or `DRIFT` with concrete per-path drift details. `verify` requires the independent review artifact and current candidate. `archive` requires explicit user archive `author` and `reference` (plus optional `date` `YYYY-MM-DD`, defaulting to UTC today), executes full `deliver` + fresh `snapshot` continuity + symlink/destination-absence/same-filesystem checks, performs an atomic `renameSync` to `openspec/archive/YYYY-MM-DD/<slug>/` (never copying/deleting across devices), verifies every moved file post-move, records `archive` metadata in `flow.json`, and rechecks `deliver` on the destination. Receipt and archive writes use Pi's file mutation queue plus sequential execution and atomic replacement; separate processes remain outside that queue.

## Parallel apply and project contracts

Planning assesses parallelism from user decisions and actual project boundaries, not a fixed frontend/backend or HTTP template. Canonical syntax and dispatch rules live in `skills/work-workflow/references/parallel-apply.md` and the artifact contract. Existing sequential and legacy parallel plans remain valid; no historical/active plan is migrated automatically.

Optional `Apply Sequence` assigns Preparation and Integration MINI groups around at least two Parallel Units. Each MINI has exactly one owner. Preparation may depend only on preparation; units may depend on preparation/themselves but never peers or integration; integration joins the units. Unit Writable surfaces accept exact files or directory roots, separated by ` ; `, and must be disjoint and inside Execution Scope. This permits separate server/UI files in one framework directory without allowing concurrent edits to the same file. Staged plans require Integrated Validation Owner and Command. The checker validates structure, not whether a split is useful or commands are safe; the parent checks Allowed Bash and resource isolation.

Candidate capture requires READY `apply-preparation.md`/`apply-integration.md` when their stages have items, every declared `apply-UNIT-ID.md`, and at least one distinct actual implementation executor per summary. The orchestrator must supply all real identities, including remediation. There is still only one final independent verifier. Receipt checks neither schedule work nor prove preparation actually preceded fan-out; the parent owns ordering, baselines and real integrated validation.

Optional `Project Contracts` lists exact canonical project files inside Root/Allowed Paths, outside openspec/workflow artifacts, including relevant modular fragments. It is stack-neutral: HTTP schemas, server function/action interfaces or desktop IPC contracts can all be referenced without new dependencies. Missing files are permitted during planning/authorization for approved creation in apply; all must be regular files at candidate capture. Their sorted path/state/SHA-256 records are saved in `implementation.contracts`, including unchanged read-only inputs, and checked for drift before verification/delivery. New/changed contract files must also appear in the complete deliverable set. References are explicit, not recursively followed; no semantic schema or compatibility validation is implied.

## Boundaries and results

`change_dir` may be absolute, workspace-relative, or prefixed with `@`. Candidate files must be absolute. The installed engine is fixed: tools never execute project scripts, shell text, user-supplied executables, or arbitrary commands. There is no project-local configuration to trust. The engine rejects unexpected symlink redirects and keeps receipt-format, evidence, digest, scope, drift, and executor-independence checks. Baseline scanning excludes `.git`, `node_modules`, the active change directory, `openspec/` unless explicitly targeted by `Writable Paths`, and secret file patterns (`.env`, `.env.local`, `.env.*.local`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`), enforces a 5,000-file safety cap and 2 MiB `flow.json` ceiling, and never dereferences symlinks or stores raw file contents. Archive requires `<base>/openspec/changes/<slug>`, strictly absent destination outside source, zero symlinks along source/destination/internal paths, and same-filesystem device equality (`EXDEV` fails closed with no copy/delete fallback). It can read candidate paths explicitly authorized by the plan; callers must stay within assigned scope.

`PASS` proves only the checks implemented at that boundary. In particular, check/apply validates authorization, not completed implementation; check/verify validates candidate continuity, not the verification artifact; check/snapshot proves continuity match, not functional acceptance; check/surface proves baseline-relative attribution within scanned roots, not write provenance. Tests, independent acceptance, runtime identity provenance, and explicit archive approval remain separate obligations. Historical changes are not migrated automatically.

Check results include `status`, `phase`, `change_dir`, the plan digest and contract count on success, operation-specific structured metadata (`continuity_status`, `contracts_status`, `candidate_sha256`, `snapshot_sha256`, `snapshot_records`, `drift` for `snapshot`; `baseline_id`, `surface_status`, `by_owner`, `violations`, `candidate_files` for `surface`), and `next_action`. Blocked checks (including `snapshot` `DRIFT` and `surface` violations) return `status: "BLOCKED"` (`isError: true`) while still providing the complete paged report. Outputs and diagnostics from either tool are losslessly paged at 4,000 UTF-16 units or 100 lines: for 70–100+ files in `snapshot` or `surface`, `next_offset` tells callers to repeat the same read-only call with `diagnostic_offset` and unchanged inputs/artifacts until `next_offset` is omitted. Never repeat a successful `workflow_record` write just to retrieve output. No diagnostic or record data is silently dropped. Invalid arguments throw. Cancellation is checked before/after synchronous local validation; a large synchronous check cannot be interrupted mid-read. No session resources require shutdown cleanup.

Both tools use compact tool rendering (`compactToolRenderingVersion = 1`, `compactLeftMargin = 1`, `renderShell = 'self'`) with width-safe ANSI wrapping: collapsed rows show status and concise operation summaries (`plan`/`apply`/`verify`/`deliver` contract counts; `snapshot` `MATCH`/`DRIFT` + record count; `surface` delta + violation counts; `baseline` ID + file count; `archive` destination path) without truncation hints or cards, while expanded views show the full returned page body. Manual visual validation after `/reload` is still needed.

## Implementation and validation

`src/core/flow-check.ts` owns the single dependency-free engine, shared by both tools and the `skills/work-workflow/scripts/flow-check.mjs` CLI (`check --phase plan|apply|verify|deliver|snapshot|surface [--baseline-id ID]`, `authorize`, `baseline [--label LABEL]`, `candidate`, `verify`, `archive --author NAME --reference MSG [--date YYYY-MM-DD]`). The extension never imports a sibling extension or its dependency tree. Host-provided Pi packages are declared peers; no npm install is required for the Node test suite.

```bash
cd extensions/workflow-check && npm test
# From the repository root:
node --test skills/work-workflow/scripts/flow-check.test.mjs
```

To include the actual Pi loader/render smoke check, run the package-local tests with `PI_WORKFLOW_TEST_HOST` set to the installed Pi package directory (not another extension). Without that explicit host path, only the loader/render test is skipped; all dependency-free functional and worker-allowlist tests still run.

The CLI and Node tests require Node 22.19+ (native TypeScript loading). Internal engine/tool modules use `.ts` imports so Pi's extension loader can refresh them during `/reload`; native JavaScript module caching can otherwise retain obsolete exports after in-process updates. Regression tests exercise both an in-process update/reload and the full lifecycle through the actual Pi loader.

CLI receipt operations remain available for explicit automation; normal agents should use the tools. Neither a receipt nor a tool result authenticates user consent or the truth of supplied executor identities.
