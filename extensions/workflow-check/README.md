# Workflow tools

Global Pi extension providing structured calls for every operation of the Planned Workflow checker. Run `/reload` after installation or editing; `index.ts` is auto-discovered. No settings, credentials, network, timers, child processes, or extra runtime dependencies are needed.

## Tools and ownership

| Tool | Caller | Purpose |
|---|---|---|
| `workflow_check({ change_dir, phase })` | Orchestrator and authorized workers | Read-only boundary check; phases: `plan`, `apply`, `verify`, `deliver`. |
| `workflow_record({ change_dir, action, ... })` | Orchestrator only | Update the change directory's `flow.json`; actions: `authorize`, `candidate`, `verify`. |

The planner uses check/plan, implementer check/apply, and independent verifier check/verify before READY. Workers must not have `workflow_record` in their allowlists. All tools return the next permitted action; none advances phases, delegates, implements, runs tests, or archives automatically. Role separation is through caller permissions/worker allowlists, not an authenticated role claim in arguments or an OS sandbox.

```text
workflow_check({ change_dir: "/workspace/openspec/changes/example", phase: "plan" })
workflow_record({ change_dir: "/workspace/openspec/changes/example", action: "authorize", author: "j0k3r", reference: "actual user approval message", plan_sha256: "digest returned by the reviewed plan check" })
workflow_check({ change_dir: "/workspace/openspec/changes/example", phase: "apply" })
workflow_record({ change_dir: "/workspace/openspec/changes/example", action: "candidate", executors: ["actual implementation session ID"], files: ["/workspace/src/code.js"] })
workflow_check({ change_dir: "/workspace/openspec/changes/example", phase: "verify" })
workflow_record({ change_dir: "/workspace/openspec/changes/example", action: "verify", executor: "actual independent reviewer session ID" })
workflow_check({ change_dir: "/workspace/openspec/changes/example", phase: "deliver" })
```

Use actual values, never the example identities/digest. `authorize` requires previously granted user consent and the actual reviewed plan digest. `candidate` requires every baseline-relative deliverable (including deletions) and every implementation session; it invalidates previous verification. `verify` requires the independent review artifact and current candidate. Receipt writes use Pi's file mutation queue plus sequential execution and atomic replacement; separate processes remain outside that queue.

## Boundaries and results

`change_dir` may be absolute, workspace-relative, or prefixed with `@`. Candidate files must be absolute. The installed engine is fixed: tools never execute project scripts, shell text, user-supplied executables, or arbitrary commands. There is no project-local configuration to trust. The engine rejects unexpected symlink redirects and keeps receipt-format, evidence, digest, scope, drift, and executor-independence checks. It can read candidate paths explicitly authorized by the plan; callers must stay within assigned scope.

`PASS` proves only the checks implemented at that boundary. In particular, check/apply validates authorization, not completed implementation; check/verify validates candidate continuity, not the verification artifact. Tests, Surface Check, independent acceptance, runtime identity provenance, archive consent, and Archive Safety Checks remain separate obligations. Historical changes are not migrated automatically.

Check results include `status`, `phase`, `change_dir`, the plan digest and contract count on success, and `next_action`. Blocked checks use a native error result with the diagnostic. Diagnostics from either tool are paged at 4,000 UTF-16 units or 100 lines: `next_offset` tells callers to repeat the same failed operation with `diagnostic_offset` and unchanged inputs/artifacts. Never repeat a successful receipt write just to retrieve output. No diagnostic content is silently dropped. Invalid arguments throw. Cancellation is checked before/after synchronous local validation; a large synchronous check cannot be interrupted mid-read. No session resources require shutdown cleanup.

Both tools use Pi's native tool shell and Text components: collapsed status/counts and configured expansion hint, expanded complete returned content, partial/error/empty handling. No custom keyboard state or framing. Manual visual validation after `/reload` is still needed.

## Implementation and validation

`src/core/flow-check.mjs` owns the single dependency-free engine, shared by both tools and the historical `skills/work-workflow/scripts/flow-check.mjs` CLI. The extension never imports a sibling extension or its dependency tree. Host-provided Pi packages are declared peers; no npm install is required for the Node test suite.

```bash
cd extensions/workflow-check && npm test
# From the repository root:
node --test skills/work-workflow/scripts/flow-check.test.mjs
```

To include the actual Pi loader/render smoke check, run the package-local tests with `PI_WORKFLOW_TEST_HOST` set to the installed Pi package directory (not another extension). Without that explicit host path, only the loader/render test is skipped; all dependency-free functional and worker-allowlist tests still run.

CLI receipt operations remain available for explicit automation; normal agents should use the tools. Neither a receipt nor a tool result authenticates user consent or the truth of supplied executor identities.
