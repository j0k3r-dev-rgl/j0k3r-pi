# Pi API Tools Extension

Project-local Pi extension for bounded REST, Swagger, and GraphQL API tools.

## Public tools

- `api_status`
- `api_auth_status`
- `api_login`
- `api_rest_request`
- `api_swagger`
- `api_graphql`

Legacy GraphQL tools remain removed:

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
  "auth": {
    "type": "login",
    "login_path": "/api/v1/auth/login",
    "identifier_field": "identifier",
    "accounts_file": "core-api/dev/.seed-credentials.json",
    "account_alias": "PLATFORM_ADMIN"
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

### Authentication configuration

`auth` supports `none`, `bearer`, `basic`, `api_key`, `headers`, and `login`.

For `type: "login"`:
- `login_path`: relative login path (required)
- `identifier_field`: JSON property name for the identifier in the login body (optional, defaults to `"username"`)
- `password_field`: JSON property name for the password in the login body (optional, defaults to `"password"`)
- `accounts_file`: project-relative path to a git-ignored accounts JSON file (optional)
- `account_alias`: default alias to authenticate with if no alias argument is supplied (optional)
- `username` / `password`: fixed static credentials for legacy backward compatibility (optional)

### Local accounts and alias resolution

When `accounts_file` is configured:
- Path security: strictly project-relative; path traversal (`..`, `%2e`), backslashes, control characters, and symlinks escaping project root are rejected.
- Git safety: the file must not be tracked by git and must be explicitly git-ignored.
- Alias matching: case-insensitive against `role`, `username`, or `email`.
- Secret protection: all passwords parsed from the file are dynamically registered in the redaction list; raw passwords never appear in tool parameters, results, or logs.

## Contract version 2

All revised tool results now report `details.contract_version = 2`.

Version 2 intentionally replaces the prior envelopes in place. There is no parallel legacy result shape.

### Shared v2 result behavior

- `content` contains only the current bounded page.
- `details` contains status, action, identity, failure metadata, and continuation metadata.
- `details` does not duplicate the full payload.
- oversized results continue on the same tool and same action.

### Shared failure envelope

Failure results use:

- `details.failure.category`
- `details.failure.code`
- `details.failure.message`
- optional `http_status` or `graphql_classification`
- `retryable`
- `next_step`

Primary categories:

- `http_error`
- `graphql_error`
- `validation_error`
- `provider_error`
- `configuration_error`
- `timeout_error`
- `cancellation_error`
- `continuation_error`
- `reference_error`
- `authorization_metadata_error`
- `unknown_error`

## Tool contracts

### `api_login`

Authenticates against the configured login endpoint and persists `access_token` into `.pi/api.json`.

Parameters:
- `alias` (optional string): account alias (role, username, or email) to resolve from `accounts_file`.

Direct passwords or tokens are disallowed in tool inputs. If `alias` is omitted, the configured `account_alias` default or legacy fixed credentials are used.

### `api_swagger`

Actions:

- `discover`
- `detail`
- `schema`
- `request`

`discover` returns compact operation rows only:

- selector (`operationId` when present)
- method and path
- compact authorization summary

`detail` returns one selected executable operation contract:

- parameters by location
- request body content
- response status/content/header contracts
- declared security schemes and scopes
- safe allowlisted authorization metadata
- `unsupported_reference` markers for unsupported external refs

`schema` remains separate from executable detail.

### `api_graphql`

Actions:

- `discover`
- `detail`
- `schema`
- `execute`

`discover` returns compact root-field rows only:

- canonical selector (`Query.field` / `Mutation.field`)
- operation kind
- compact authorization summary

`detail` returns one selected executable root field contract:

- arguments
- return type
- bounded nested field contract
- cycle markers
- authorization provenance (`declared`, `not_declared`, `unavailable`, `unknown`)

`schema` remains separate from executable detail.

### `api_rest_request`

Uses the same bounded response and truthful failure semantics as Swagger request execution.

## Authorization provenance

Swagger and GraphQL report only contract-derived authorization metadata.

States:

- `declared`
- `not_declared`
- `unavailable`
- `unknown`

The extension does not infer runtime access from endpoint names, tokens, or successful execution.

## Continuation

Oversized `api_rest_request`, `api_swagger`, and `api_graphql` responses return:

- `details.continuation.returned_count`
- `details.continuation.total` when known
- `details.continuation.has_more`
- opaque `details.continuation.next_cursor`
- `details.continuation.follow_up`

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
