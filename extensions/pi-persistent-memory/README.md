# Pi Persistent Memory

Independent TypeScript extension work area for Pi persistent memory.

Status: **MINI-005 completed** (nine agent-facing memory tools, progressive get/deleted/context readers, runtime scope and lease operation ownership, native collapsed/expanded TUI rendering with native Pi mouse and keyboard interaction). Public root extension discovery (`index.ts`) and production activation remain deferred to MINI-006; this package is currently non-discovered.

## Architecture and Scope (MINI-001)

- **Storage Foundation**: Single shared SQLite database at `~/.memory/memories.db` (directory mode `0700`, file mode `0600`), accessed on demand via `withDatabase` (`node:sqlite` DatabaseSync) with WAL journal mode, `foreign_keys = ON`, `busy_timeout = 5000`, and `sqlite-vec 0.1.9` loaded natively and locked down.
- **Schema v1**: Versioned metadata (`schema_meta`), `sessions`, `memories` with unconditional `topic_key` uniqueness, `chunks`, `memory_vectors` (vec0 float[384] cosine embedding with partition key), `memory_fts` (FTS5 lexical index), `entities`, `relations`, and `memory_entity_links`.
- **Project Identity**: Exact home directory resolves to global scope (`["global"]`); descendant directories resolve via trusted `.pi/memory.json` (actionable error if invalid or empty), name-ordered normalized git remote (standard SSH/HTTPS only, unsupported remotes reject explicitly), or folder name fallback.
- **Session Lifecycle**: Normal sessions activate only on first user message (`message_start` where role is user), never on load/start/selection. Normal shutdown (`new`, `quit`, `resume`, `fork`) closes activated sessions. Reload preserves parent session state.
- **Subagent Invocation Lease Protocol**: Optional runtime-local lease rendezvous (`memory:invocation:bind:v1`) over child EventBus. Immutable per-attempt identity, activation on first user message, in-flight operation fencing, terminal child session cleanup (empty sessions deleted; sessions with retained active or soft-deleted knowledge preserved closed). Reload coordinates clean runner drain and lease termination without timeouts or deadlocks.

## Architecture and Scope (MINI-002)

- **E5 HTTP Contract Client**: Package-local `E5Client` consuming the local English E5 service at `http://127.0.0.1:8000` via Node built-in `fetch`. Enforces single total 120s embedding deadline and 3s health deadline across headers and body read, zero retries, and caller/lease cancellation precedence. Validates canonical metadata (`intfloat/e5-small-v2`, revision `ffb93f3bd4047442299a41ebb6fa998a38507c52`, 384 dimensions, L2 normalization within 1e-4, 512 max input tokens). Enforces Unicode code point spans (`Array.from(source)`), contiguous coverage, ordered chunk indices, token count <= 512, query exactly 1 chunk, bounded response body ceiling (4 MiB), and client-side preflight body byte check (<= 1 MiB). Errors classified into `unavailable`, `input_error`, `integration_error`, and `cancelled`.
- **Passage Input Mapping**: Composed source for passage embeddings is strictly `title + '\n' + content`. Original title and content are stored separately in `memories`, while chunk text and spans refer to this composed text.
- **Save & Publication Pipeline**: Internal `saveAndIndexMemory` prevalidates targets (`target_not_found`, `target_deleted` requiring explicit restore, `target_conflict`) and commits text and FTS5 in a single atomic `BEGIN IMMEDIATE` transaction; POSTs to E5 outside any database connection; publishes validated chunks and vec0 rows in a fresh short transaction conditional on unchanged `content_version`, owner, and active state. In-flight generation failures leave text and FTS intact with status `pending` (not `failed`) and conditional sanitized `pending_reason` so diagnostics and recovery find them.
- **Sequential Recovery & Continuation**: Internal `reindexMemories` supports explicit ID targeting, current scope pending, or all-project pending with explicit `explicitAllProjects: true`. Processes at most 5 memories strictly sequentially per invocation, committing each before proceeding. Unavailability stops batch immediately. Output envelopes <= 6 KiB UTF-8, counts include earlier failed records, and continuation cursor binds scope, operation, high-water ID, last ID, and a SHA-256 dataset fingerprint that invalidates if records are modified externally. No automatic traversal.
- **Post-Message Diagnostics**: Detached nonblocking activation diagnostics trigger only on first user message in normal or child runtime, never on load/startup/reload. Checks active pending count (exact-home reports total database pending; project reports scope count and elsewhere boolean notice) and performs one GET `/health` with a 3s deadline. Emits a concise notice via `ctx.ui.notify` when available, or a bounded noninteractive `stderr` notice in headless/noninteractive mode. Canceled immediately on reload, session change, or child lease termination, suppressing late notifications.

## Architecture and Scope (MINI-003)

- **Internal Scoped Search Engine (`src/search/`)**: Implements scoped multi-modal retrieval over active SQLite memories with zero public tool registrations. Supports `hybrid` (default), `semantic`, and `fts5` modes. Read authorization strictly validates resolved `Scope` and explicit global flag: project scope searches only the resolved project key (`scope_key = '["project", "..."]'`); explicit `explicitGlobal: true` or exact-home `["global"]` scope searches across all projects and global records. Read selection never grants write authority.
- **Option B Literal Technical Term Extraction & Matching**: Case-folding with Unicode identifier preservation (including 1–2 char terms like `Go`, `TS`). Maximal technical tokens retain internal connectors (`.`, `-`, `/`, `:`, `_`) and trailing `+`/`#` suffixes (`C++`, `C#`, `node:sqlite`, `foo_bar`, `package-name`, `src/tools/index.ts`). Plain punctuation alone produces no terms. Fixed small English function-word stoplist (preserves technical terms such as `use` or `using`). Compound identifiers match constituent segments ONLY when the query requests those constituents; queries requiring compounds do not match separated parts. Coverage threshold >= 0.35 enforced via registered SQLite deterministic function `memory_literal_coverage` in the WHERE clause BEFORE `LIMIT 100`, eliminating near-match candidate starvation.
- **Exact Scoped Vector Admission & Deduplication**: Vector search evaluates exact scalar cosine distance via `vec_distance_cosine(v.embedding, ?)` in a SQL join with `chunks` and `memories`. WHERE filters scope, `deleted_at IS NULL`, `indexing_status = 'indexed'`, source version matching (`c.content_version = m.content_version`), and strict canonical model metadata (`intfloat/e5-small-v2`, revision `ffb93f3bd4047442299a41ebb6fa998a38507c52`, 384 dims, normalized with no compatibility exceptions) BEFORE `ORDER BY distance ASC LIMIT 200`. Chunks are deduplicated to distinct memories by minimum distance (best chunk). Semantic similarity floor >= 0.86; memories below floor excluded; longer memories receive no chunk-count bonus. Candidate budget reached notice emitted when 200 chunks or 100 lexical candidates are reached.
- **Hybrid Fusion & Lexical Cosine Admission**: For hybrid mode, top 100 lexical candidates (coverage >= 0.35) are admitted only if they possess current valid vectors with strict canonical model metadata and cosine similarity >= 0.82 against the query vector (evaluated using scalar SQL without generating missing embeddings). Admitted semantic (floor 0.86) and lexical (floor 0.82 + coverage 0.35) candidates are fused using equal-weight Reciprocal Rank Fusion ($k = 60$): $\sum 1 / (60 + \text{rank})$.
- **Visible Availability Fallback**: Pure FTS5 mode makes zero calls to E5 client. For semantic and hybrid modes, only E5 client error category `unavailable` (500, 503, network offline) triggers fallback to `actual_mode: 'fts5'` with warning `'semantic_unavailable'`. Input errors (such as 422 `query_too_long`), integration errors, and caller cancellations propagate distinctly without fallback. HTTP requests occur outside database transactions.
- **Stateless Fingerprinted Cursors & Read Snapshots**: Pagination cursors are base64url encoded payloads binding `op: 'search'`, `query_hash`, requested and actual modes, scope identity, profile version (1), offset, and a SHA-256 dataset fingerprint computed from memories and vector blobs in scope during a single consistent SQLite read snapshot (`BEGIN DEFERRED`). Changes to memory content, deletions, or vector updates in same-content reindex invalidate the cursor (`cursor_dataset_modified`). Edits to unrelated projects do not invalidate project-local cursors. Tampered, corrupted, or mismatched cursors are rejected.
- **Bounded Result Envelopes**: Complete JSON serialized response envelope strictly bounded <= 6144 bytes UTF-8 and at most 5 memories per page. Relevant excerpts centered around best matching chunk (semantic/hybrid) or matched literal terms (lexical) using code-point safe slicing (never splitting multibyte characters). Display fields abbreviated when oversized with guidance notice. Empty result set is valid; if metadata leaves no room for any record, an explicit limit error is thrown rather than an empty progress loop.

## Architecture and Scope (MINI-004)

- **Internal Scoped Graph Engine (`src/graph/`)**: Implements memory-owned entity, relation, and explicit association operations with zero public tool registrations. Strictly enforces the 5-entity (`project`, `technology`, `concept`, `file`, `memory`) and 6-relation (`uses`, `about`, `references`, `depends_on`, `related_to`, `contradicts`) vocabulary. Graph signals never participate in semantic/FTS5/hybrid search ranking.
- **Conservative Identity, Aliases, and Immutability**:
  - `project`: exact resolved project name, case preserved, whitespace collapsed. Project-scoped.
  - `technology` & `concept`: deterministic lowercase canonical key, punctuation preserved (`C++`, `C#`, `Node.js` distinct), whitespace collapsed. May be project-owned or shared global nodes.
  - `file`: normalized project-relative lexical path (rejects absolute, UNC, drive letter, NUL bytes, and `..` escaping root). Project-scoped.
  - `memory`: canonical key is stringified memory ID (`String(memoryId)`). Positive integer `memoryId` required for `memory`, forbidden for other types.
  - Explicit aliases: checked atomically against canonical names and aliases in the same namespace; collisions throw actionable `alias_conflict` or `identity_conflict`.
  - Immutability on update: entity ID, `session_id`, and `created_at` are preserved; `type`, `scope_key`, and `memory_id` cannot be moved. No entity delete/purge primitive.
- **Serialized BEGIN IMMEDIATE Transactional Invariants**:
  - Business uniqueness for relations `(source_entity_id, relation_type, target_entity_id, scope_key)` is enforced in serialized write transactions without DDL changes; concurrent identical saves return the stable relation ID.
  - Endpoint existence, active memory state, and scope compatibility (project edges allow same project or shared global technology/concept; global edges allow global endpoints only) are verified before mutation.
  - Creator-session attribution is preserved on upsert/update, ensuring `countAssociatedKnowledge` accurately protects child sessions with knowledge upon terminal cleanup.
- **Option B Bidirectional BFS Traversal**:
  - Explores both incoming (`direction: 'incoming'`) and outgoing (`direction: 'outgoing'`) edges from an authorized root entity while strictly preserving original stored `source` and `target` direction.
  - Traversal bounded to max 2 hops and max 20 unique explored entities INCLUDING root.
  - Scoped SQL predicates query only edges matching the authorized scope before entity admission, preventing foreign-neighbor starvation (e.g., a shared node like React with >20 foreign edges does not starve current project edges).
  - Keyset bounded neighbor reads with explicit SQL LIMIT dynamically sized to remaining capacity terminate as budgets are reached, preventing unbounded queries on high-degree nodes.
  - Frontier edges connecting to unadmitted entities are strictly excluded: only edges with both endpoints admitted into nodes are emitted.
  - Cumulative serialized budget accounting during admission: edges between admitted nodes (including high-degree parallel relations, legacy duplicates, and self-cycles) are budgeted against the 6KiB ceiling during admission, immediately terminating keyset paged reads and BFS exploration when serialized capacity is reached. This bounds total SQL queries and fetched rows, prevents table-exhaustion loops, and preserves admitted connected nodes and directed edges without dropping them in post-traversal trimming cascades.
  - Cycle and self-link protection: visited nodes are never duplicated in budgets or returned arrays. Deterministic ordering: nodes sorted by depth then ID, edges by ID.
  - Explicit limits metadata: reports `depth_limit`, `entity_limit`, `byte_limit`, `has_more`, and guidance notice (`Recommend a new focused root query`). `byte_limit` accurately reflects real payload omission rather than frontier cleanup. No graph cursor or auto-exhaustion.
- **Ordinary Graph Visibility & Soft-Deletion**:
  - Memory entities referencing soft-deleted memories, as well as incident edges and associations to them, are hidden across `getEntity`, `listEntities`, and `traverseGraph`.
  - Recoverable state is retained in SQLite; `restoreMemory` immediately re-enables visibility without data duplication or repair. Active memories pending embeddings remain graph-visible without requiring E5.
- **Bounded Envelopes & List Cursor**:
  - All graph traversal, list, get, and write confirmations strictly bounded <= 6144 bytes UTF-8. Giant names and aliases are safely abbreviated in envelopes with explicit `truncated` / `aliases_truncated` notices.
  - `listEntities` supports deterministic pagination with stateless cursors binding scope, type, and SHA-256 dataset fingerprint; modifications in scope invalidate cursors with `cursor_expired`.


## Architecture and Scope (MINI-005)

- **Nine Agent-Facing Tools (`src/tools/`)**:
  - `memory_save`: Saves durable English memory or executes reindex. Save requires `title`, `content`, `type`; returns compact confirmation without echoing submitted text. Reindex rejects textual fields and supports specific ID or sequential bulk (<= 5 memories). Explicit user request required for `session_summary` saving with reserved key `session/<session-id>/summary`.
  - `memory_search`: Multi-modal search (`hybrid` default, `semantic`, `fts5`, `graph`). Enforces query for non-graph and `entity_id` for graph. Contradictory arguments rejected. Excerpts bounded <= 5 memories per page.
  - `memory_get`: Retrieves full active memory title and content progressively. Bounded pages sliced on Unicode code-point boundaries with opaque stateless cursors. Soft-deleted memories hidden.
  - `memory_context`: Retrieves prioritized context: active `session_summary` first, project summary second, recent authorized memories third. Deduplicated by memory ID and topic key. Missing summaries normal (no automatic generation).
  - `memory_delete` & `memory_restore`: Recoverable soft-deletion and restoration. Requires `owner_scope` assertion ('project' or 'global') verified against target record before mutation.
  - `memory_deleted_list`: Recovery audit page returning recovery metadata only (`id`, `title`, `owner`, `type`, `deleted_at`); deleted text remains hidden.
  - `memory_entity`: Canonical graph entity operations (`save`, `get`, `list`). Strict type vocabulary and immutable entity properties.
  - `memory_relation`: Directed graph relation operations (`save`, `delete`). Validates endpoints and enforces business uniqueness.
- **Progressive Unicode Readers (`src/reading/`)**:
  - Stateless cursors encoding operation, ID, version, offsets, and SHA-256 dataset fingerprints.
  - Slices text on Unicode code-point boundaries, preventing surrogate pair splits.
  - Concurrent mutations or deletions invalidate cursors with `cursor_expired`.
- **Runtime Lifecycle & Operation Gateway (`src/lifecycle.ts`)**:
  - Child subagent invocations execute through exact captured `InvocationLease.perform(signal, op)` with immutable identity provenance.
  - Normal sessions require first user message activation; calls before first message fail with `session_not_active` without touching SQLite.
  - Shutdown or reload aborts active operation signals and marks generation unusable.
- **Native Pi Collapsed, Mouse, and Keyboard Rendering (`src/render/`)**:
  - Default shell (`renderShell: 'default'`); rows start collapsed.
  - Native `ToolExecutionComponent` and `MouseRegion` handle primary click expand/collapse in fullscreen TUI mode; terminal scrollback preserved in regular mode.
  - Collapsed view displays concise one-line summary and native `app.tools.expand` key hint.
  - Expanded view renders complete current page content within ANSI-safe width bounds.
  - Pure visual toggle: expansion never triggers database queries, model calls, or network requests.
- **Output Budget Ceiling**: Complete serialized `AgentToolResult` (`content` + `details` + `isError`) strictly bounded <= 6144 bytes UTF-8 across all tools.

## Package Dependencies

- Pinned runtime dependency: `sqlite-vec: 0.1.9`
- Peer dependencies: `@earendil-works/pi-coding-agent: *`, `@earendil-works/pi-tui: *`, `typebox: *`
- Exact local devDependencies: `typescript: 5.9.3`, `@types/node: 24.10.1`, `@earendil-works/pi-coding-agent: 1.0.2`, `@earendil-works/pi-tui: 1.0.3`, `typebox: 1.3.27`

## Commands

```bash
cd ~/.pi/agent/extensions/pi-persistent-memory
npm test           # Runs 100% offline unit/integration and benchmark regression tests
npm run typecheck  # Typecheck via package-local TypeScript 5.9.3 (erasable types)
npm run test:benchmark # Runs established benchmark tests
LIVE_SMOKE=1 node --test test/integration/e5-live.test.ts # Dedicated 1-query/1-passage live smoke test (opt-in)
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
