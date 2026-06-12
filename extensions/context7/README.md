# Pi Context7 Extension

Native Pi extension for fetching up-to-date library and framework documentation from Context7 using `@upstash/context7-sdk`. It exposes safe, bounded Context7 tools to the agent without requiring MCP.

## What it provides

- Context7 readiness/status tool that never exposes API keys.
- Library search by human package/framework name and focused query.
- Documentation fetch for known Context7 library IDs.
- Convenience resolver that searches, selects an unambiguous candidate, and fetches docs.
- Optional user-local TTL cache for repeated queries.
- Secret redaction in tool content, structured details, and formatted errors.
- Output truncation with explicit metadata to protect LLM context.
- Offline unit-testable client/tool design using injectable clients.

## Extension location

In this agent-dir checkout the extension lives at:

```txt
extensions/context7/index.ts
```

When copied into a project-local Pi setup, the equivalent path is:

```txt
.pi/extensions/context7/index.ts
```

Pi auto-discovers project-local extensions from `.pi/extensions/*/index.ts` once the project is trusted. Use `/reload` after changing extension code during an interactive session.

## Required environment

Live Context7 calls require:

```bash
CONTEXT7_API_KEY=your_context7_api_key
```

Rules:

- Set the key in the Pi process environment.
- Do not store `CONTEXT7_API_KEY` in `.pi/context7.json` or any repository file.
- `context7_status` reports only whether the key is present, never its value.

## Project configuration

Optional project config lives in `.pi/context7.json` at the project root or an ancestor directory.

Example:

```json
{
  "cache": {
    "enabled": true,
    "ttl_seconds": 86400
  },
  "defaults": {
    "max_chars": 12000,
    "result_limit": 5
  }
}
```

### Config fields

| Field | Default | Range | Description |
|---|---:|---:|---|
| `cache.enabled` | `false` | boolean | Enables user-local file cache. |
| `cache.ttl_seconds` | `86400` | positive integer | TTL for cached Context7 responses. |
| `defaults.max_chars` | `12000` | `1000`-`50000` | Default maximum chars returned by documentation tools. |
| `defaults.result_limit` | `5` | `1`-`10` | Default candidate limit for library searches. |

Invalid numeric values produce warnings and fall back to defaults.

### Secret-like keys

Any config key that looks like `apiKey`, `token`, `secret`, or `password` is ignored and reported as a warning. Use environment variables for secrets.

## Cache behavior

Cache is disabled by default.

When enabled, cache files are stored outside the active workspace/configured repository root passed to the extension:

```txt
$XDG_CACHE_HOME/pi/context7
```

Fallback:

```txt
~/.cache/pi/context7
```

Safety rules:

- Cache directory must not resolve inside the active workspace/configured repository root; if it does, cache is disabled.
- Cache keys omit secret-like fields and are SHA-256 hashed.
- Cache files use mode `0600`; directories use mode `0700`.
- Cache entries expire according to `cache.ttl_seconds`.

## Tools exposed to the agent

| Tool | Purpose |
|---|---|
| `context7_status` | Report readiness, API-key presence, cache state, defaults, and warnings without network calls. |
| `context7_search_library` | Search Context7 libraries and return compact candidates. |
| `context7_get_context` | Fetch focused documentation for a known Context7 library ID. |
| `context7_resolve_and_get_context` | Resolve a library and fetch focused documentation when the candidate is unambiguous. |

This extension does not register slash commands.

## Tool details

### `context7_status`

Parameters: none.

Use it to check whether the extension is ready before live calls.

Returns:

- SDK availability;
- whether `CONTEXT7_API_KEY` is present;
- cache enabled/disabled state;
- effective defaults;
- non-secret warnings.

### `context7_search_library`

Parameters:

```ts
{
  libraryName: string; // required, non-empty
  query: string;       // required, non-empty
  limit?: number;      // integer 1-10
}
```

Use when the agent does not know the exact Context7 library ID.

Returns compact candidates with fields such as:

- `id`;
- `name`;
- `description` capped for compactness;
- `totalSnippets`;
- `trustScore`;
- `benchmarkScore`;
- `versions`.

### `context7_get_context`

Parameters:

```ts
{
  libraryId: string;      // required, non-empty
  query: string;          // required, non-empty
  type?: "json" | "txt"; // default: json
  max_chars?: number;     // clamped/floored to 1000-50000
}
```

Use when the correct Context7 library ID is already known, for example `/vercel/next.js`.

Output:

- `json`: formatted snippets with title/source/content; snippet content is bounded per snippet, so total JSON output can exceed `max_chars` when multiple snippets are returned.
- `txt`: text output with a Context7 header, truncated to the effective total max char limit.

### `context7_resolve_and_get_context`

Parameters:

```ts
{
  libraryName: string;
  query: string;
  version?: string;
  max_chars?: number;
}
```

Behavior:

1. Searches candidates using the configured `defaults.result_limit`; callers cannot pass a per-call `limit` to the resolver.
2. Scores candidates by name/id match, optional version match, trust score, benchmark score, snippet coverage, and description overlap.
3. Returns `no_results`, `ambiguous`, or `selected`.
4. If unambiguous, fetches JSON documentation for the selected library ID.

Use this tool for convenience only when ambiguity is acceptable to handle in the result. For high-risk implementation decisions, prefer explicit `context7_search_library` followed by `context7_get_context` after confirming the selected ID.

## Output safety

All tool outputs are designed to be safe for LLM context:

- exact API key values are redacted;
- secret-looking text patterns are redacted;
- private key blocks are redacted;
- `txt` documentation output is truncated by `max_chars`; JSON snippet content is bounded per snippet and may exceed `max_chars` in total;
- search descriptions are capped;
- errors are formatted with actionable messages;
- upstream `401`, `403`, `404`, `429`, and `5xx` failures get user-actionable wording.

## Recommended workflow

1. Run `context7_status` if readiness is uncertain.
2. Run `context7_search_library` for the dependency and focused topic.
3. Pick the correct `libraryId` from candidates.
4. Run `context7_get_context` with a narrow query.
5. Summarize only the relevant facts in the answer or SDD artifact.
6. Do not store full Context7 dumps in Pi Memory or OpenSpec artifacts.

Example focused query:

```txt
libraryName: next.js
query: app router route handlers cookies api
```

## SDD usage policy

Use Context7 during SDD only when current external dependency documentation materially affects a requirement, design decision, implementation detail, or verification judgment.

When Context7 influences an SDD artifact, record concise source metadata, not full documentation dumps:

- library ID;
- focused query;
- source title or URL when available;
- retrieval date;
- relevance summary.

## Development

Install dependencies once:

```bash
cd extensions/context7
npm install
```

Run tests:

```bash
cd extensions/context7
npm test
```

Run typecheck:

```bash
cd extensions/context7
npm run typecheck
```

The test suite is designed to run without live Context7 network access or a real API key by using mocked clients/fixtures.

## Related project docs

- `skills/context7-configuration/SKILL.md` — agent-facing Context7 configuration and usage policy.
- `extensions/context7/src/config.ts` — config parsing and defaults.
- `extensions/context7/src/tools.ts` — tool schemas and output shaping.
- `extensions/context7/src/cache.ts` — cache location and safety behavior.
- `extensions/context7/src/security.ts` — redaction and safe output helpers.
