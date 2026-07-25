# Pi API Tools Extension

Project-local Pi extension for bounded REST, Swagger, and GraphQL API tools.

## Public tools

- `api_status`
- `api_auth_status`
- `api_login`
- `api_rest_request`
- `api_swagger`
- `api_graphql`

Legacy GraphQL tools are removed:

- `api_graphql_query`
- `api_graphql_schema_queries`
- `api_graphql_schema_query`

## Enablement

The extension reads exactly `<ctx.cwd>/.pi/api.json`.

- no parent lookup
- no global lookup
- `enabled` must be exactly `true`
- `graphql_url` alone never enables GraphQL

## Example config

```json
{
  "enabled": true,
  "url": "https://api.example.com/base/",
  "timeout_ms": 30000,
  "limits": {
    "max_response_bytes": 50000,
    "max_response_lines": 2000,
    "cursor_ttl_seconds": 3600
  },
  "swagger": {
    "enabled": true,
    "framework": "spring"
  },
  "graphql": {
    "enabled": true,
    "framework": "spring"
  },
  "graphql_url": "https://api.example.com/base/graphql"
}
```

## Tool contracts

### `api_swagger`

Actions:

- `discover`
- `schema`
- `request`

### `api_graphql`

Actions:

- `discover`
- `schema`
- `execute`

## Continuation

Oversized `api_swagger` and `api_graphql` responses return:

- bounded first chunk
- `details.continuation.has_more`
- opaque `details.continuation.next_cursor`

Continuation stays on the same tool and same action.

## Status safety

`api_status` reports only safe integration state:

- `swagger.enabled`
- `swagger.framework` when valid and enabled
- `graphql.enabled`
- `graphql.framework` when valid and enabled

It does not expose endpoint URLs, credentials, cursor internals, or filesystem paths.

## Validation

```bash
cd extensions/api-tools
npm test
npm run typecheck
```
