# Pi Persistent Memory

Independent TypeScript extension work area for Pi persistent memory.

Status: **MINI-001 completed** (storage foundation, schema v1, project identity, session lifecycle, and runtime-local subagents lease protocol). Public tools and root extension discovery (`index.ts`) remain deferred to subsequent increments; this package is currently non-discovered.

## Architecture and Scope (MINI-001)

- **Storage Foundation**: Single shared SQLite database at `~/.memory/memories.db` (directory mode `0700`, file mode `0600`), accessed on demand via `withDatabase` (`node:sqlite` DatabaseSync) with WAL journal mode, `foreign_keys = ON`, `busy_timeout = 5000`, and `sqlite-vec 0.1.9` loaded natively and locked down.
- **Schema v1**: Versioned metadata (`schema_meta`), `sessions`, `memories` with unconditional `topic_key` uniqueness, `chunks`, `memory_vectors` (vec0 float[384] cosine embedding with partition key), `memory_fts` (FTS5 lexical index), `entities`, `relations`, and `memory_entity_links`.
- **Project Identity**: Exact home directory resolves to global scope (`["global"]`); descendant directories resolve via trusted `.pi/memory.json` (actionable error if invalid or empty), name-ordered normalized git remote (standard SSH/HTTPS only, unsupported remotes reject explicitly), or folder name fallback.
- **Session Lifecycle**: Normal sessions activate only on first user message (`message_start` where role is user), never on load/start/selection. Normal shutdown (`new`, `quit`, `resume`, `fork`) closes activated sessions. Reload preserves parent session state.
- **Subagent Invocation Lease Protocol**: Optional runtime-local lease rendezvous (`memory:invocation:bind:v1`) over child EventBus. Immutable per-attempt identity, activation on first user message, in-flight operation fencing, terminal child session cleanup (empty sessions deleted; sessions with retained active or soft-deleted knowledge preserved closed). Reload coordinates clean runner drain and lease termination without timeouts or deadlocks.

## Package Dependencies

- Pinned runtime dependency: `sqlite-vec: 0.1.9`
- Peer dependency: `@earendil-works/pi-coding-agent: *`
- Exact local devDependencies: `typescript: 5.9.3`, `@types/node: 24.10.1`, `@earendil-works/pi-coding-agent: 1.0.2`

## Commands

```bash
cd ~/.pi/agent/extensions/pi-persistent-memory
npm test           # Runs unit/integration tests and benchmark regression tests
npm run typecheck  # Typecheck via package-local TypeScript 5.9.3 (erasable types)
npm run test:benchmark # Runs established benchmark tests
npm run benchmark -- --command import
npm run benchmark -- --command index
npm run benchmark -- --command status
npm run benchmark -- --command evaluate --fixtures benchmark/tasks.json \
  --report ~/.cache/e5-memory-benchmark/report-v2.json
```

`import` creates a fixed snapshot of **all active observations** across projects in a read-only transaction against `~/.engram/engram.db`. It does not copy prompts, session transcripts or deleted observations; the original database is never mutated. Existing snapshots are reused, not silently refreshed.

`index` sends original titles/content to the local English E5 API at `http://127.0.0.1:8000`, in sequential batches of at most eight. Every memory's source hash/chunks/vectors are committed atomically. Rerun after interruption: already indexed memories are skipped. Model metadata changes require a new evaluation database rather than mixing models. Original languages and project aliases are preserved; this does not guarantee English-model quality on non-English memories.

`evaluate` generates real query embeddings and uses native vec0 cosine KNN, best-chunk memory deduplication, real FTS5 (`unicode61`) and equal-weight RRF k=60. Project candidates are filtered inside KNN/FTS before ranking; a global comparison spans the full snapshot. Task fixtures reuse prior manually reviewed positive IDs and contexts; they are **not a new independently labeled holdout**. Records discovered only in the larger snapshot are unjudged, not automatically irrelevant. Complete judging is needed before adopting thresholds.

The snapshot preserves Engram's project and scope independently. This initial benchmark's project filter selects the stored project association regardless of scope; it is not the final extension's complete project/global entity policy. No alias merging, graph retrieval, production pagination or language enforcement is claimed.

## Private evaluation data

Default database: `~/.cache/e5-memory-benchmark/engram.db`, not `~/.memory/memories.db`.

Runtime data stays outside the repository. Directories use 0700 and files 0600; reports contain candidate IDs/project metadata but not memory text or vector arrays. No Git mutations. Earlier root-level evaluation files are separate existing artifacts and are not cleaned up here.

The benchmark does not export full memories to console, translate them, download weights, manage the model, or modify service/systemd/settings. API calls use a 120-second client timeout for evaluation only; this is not an approved production timeout. Use `--db`, `--source`, `--url`, `--batch`, `--limit` only when intentionally changing the evaluation inputs. Any new data location must stay private/outside Git.

## Validation evidence and limits

Owning tests use Node's native test runner and real temporary file-backed SQLite/vec0, not a mock database. They cover active-only import, WAL, integer bindings, scope-before-KNN, chunk deduplication and stale-hash rejection. Synthetic vectors in storage tests validate mechanics only; actual corpus/query vectors come from the HTTP API.

First complete snapshot: 4,124 active observations, 58 stored project identities, 4,620 embedding chunks. Indexing resumed successfully after the harness's 900-second command timeout. A subsequent index run processed zero records and issued zero embedding requests.

First report: `~/.cache/e5-memory-benchmark/report-v1.json`. Its calibration selected a diagnostic semantic floor 0.86, lexical floor 0.82 and lexical term coverage 0.35. This is **not a production recommendation**: the prior known-label pool is incomplete for the full snapshot, the queries were previously inspected in small-corpus tests, and newly discovered valid memories were initially unjudged. Historical/superseded knowledge also requires provenance review.

## Judged second round

`benchmark/tasks-v2.json` contains 12 new agent-task queries (six calibration/six validation). `collect` pools the union of candidates returned by a fixed parameter grid plus semantic/lexical top-eight; private reports include source content only for local judging. Never commit these private pools.

```bash
npm run benchmark -- --command collect --fixtures benchmark/tasks-v2.json \
  --report ~/.cache/e5-memory-benchmark/pool-new.json
# Review candidates and add judgments (2=central recall, 1=supporting, 0=irrelevant)
# plus positiveIds. Do not assign zero to records that have not been reviewed.
npm run benchmark -- --command assess \
  --fixtures ~/.cache/e5-memory-benchmark/judged-v2.json \
  --report ~/.cache/e5-memory-benchmark/assessment-new.json
```

The second round reviewed 166 task-memory pairs before selection. Unjudged results are explicit, and calibration selection refuses incomplete judgment coverage. New regression tests prove the selector ignores validation rows. The frozen calibration-selected policy stayed at semantic floor 0.86, lexical floor 0.82 and coverage 0.35: validation returned 17 useful/20, with three irrelevant and 12/18 pooled central memories recovered. Only one negative query per split was used; this is not a universal threshold guarantee or independent human evaluation.

An additional **exploratory** reformulation (`tasks-v2-refinements.json`) recovered useful CodeGraph memories missed by a broad task query without lowering thresholds; another skills query retained unrelated lexical additions. Its report is separate and must not be described as fresh holdout validation. Inspect both noise and missing memories before changing production policies. No production parameters were changed.

No TypeScript typecheck environment, real Pi lifecycle integration, general semantic-quality guarantee, or final implementation readiness is claimed. Stop at benchmark evidence; extension implementation needs separate approved scope.
