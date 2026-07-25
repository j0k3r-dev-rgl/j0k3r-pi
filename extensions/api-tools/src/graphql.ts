import { redactDeep } from './security.js';
import type { ApiClient, ApiToolResult, ApiToolsConfig } from './types.js';

function buildFailure(code: string, message: string, details: Record<string, unknown> = {}): ApiToolResult {
  return {
    content: [{ type: 'text', text: message }],
    details: { status: 'failure', error: { code, message, recoverable: true }, ...details },
    isError: true,
  };
}

function buildSuccess(text: string, details: Record<string, unknown>): ApiToolResult {
  return { content: [{ type: 'text', text }], details: { status: 'success', ...details } };
}

function classifyError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unexpected GraphQL tool failure.';
  if (/cancelled|canceled|aborted/i.test(message)) return { code: 'cancelled', message };
  if (/timed out/i.test(message)) return { code: 'timeout', message };
  return { code: 'validation_error', message };
}

function clampDepth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 3;
  return Math.max(0, Math.min(6, Math.floor(value)));
}

async function graphqlJson(client: ApiClient, query: string, useToken: boolean, signal?: AbortSignal): Promise<any> {
  const response = await client.graphql({ query, useToken }, signal);
  return JSON.parse(response.bodyText);
}

function formatType(type: any): string {
  if (!type) return 'Unknown';
  if (type.kind === 'NON_NULL') return `${formatType(type.ofType)}!`;
  if (type.kind === 'LIST') return `[${formatType(type.ofType)}]`;
  return type.name ?? 'Unknown';
}

function unwrapType(type: any): string | undefined {
  if (!type) return undefined;
  if (type.name) return type.name;
  return unwrapType(type.ofType);
}

function describeFields(typeName: string | undefined, typesByName: Map<string, any>, depth: number): Array<Record<string, unknown>> | undefined {
  if (!typeName || depth <= 0) return undefined;
  const target = typesByName.get(typeName);
  if (!target) return undefined;
  const rawFields = [...(target.fields ?? []), ...(target.inputFields ?? [])];
  if (rawFields.length === 0) return undefined;
  return rawFields.map((field: any) => {
    const nextTypeName = unwrapType(field.type);
    const described: Record<string, unknown> = {
      name: field.name,
      description: field.description ?? undefined,
      type: formatType(field.type),
      type_name: nextTypeName,
    };
    const nested = describeFields(nextTypeName, typesByName, depth - 1);
    if (nested) described.fields = nested;
    return described;
  });
}

const DISCOVER_QUERY = `query ApiToolsGraphqlDiscover {
  __schema {
    queryType { fields { name type { kind name ofType { kind name ofType { kind name } } } } }
    mutationType { fields { name type { kind name ofType { kind name ofType { kind name } } } } }
  }
}`;

const TYPE_QUERY = `query ApiToolsGraphqlTypes {
  __schema {
    types {
      name
      kind
      fields { name description type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
      inputFields { name description type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
    }
  }
}`;

export async function executeGraphqlAction(
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  client: ApiClient,
  config: ApiToolsConfig,
): Promise<ApiToolResult> {
  const action = typeof params.action === 'string' ? params.action : '';
  const useToken = params.use_token === false ? false : true;

  try {
    if (action === 'discover') {
      const json = await graphqlJson(client, DISCOVER_QUERY, useToken, signal);
      const filter = typeof params.filter === 'string' ? params.filter.toLowerCase() : undefined;
      const queries = (json?.data?.__schema?.queryType?.fields ?? [])
        .filter((entry: any) => !filter || String(entry.name ?? '').toLowerCase().includes(filter))
        .map((entry: any) => ({ name: entry.name, type: 'query', return_type: formatType(entry.type) }));
      const mutations = (json?.data?.__schema?.mutationType?.fields ?? [])
        .filter((entry: any) => !filter || String(entry.name ?? '').toLowerCase().includes(filter))
        .map((entry: any) => ({ name: entry.name, type: 'mutation', return_type: formatType(entry.type) }));
      return buildSuccess(`api_graphql discover: ${queries.length + mutations.length} operations`, { data: { operations: [...queries, ...mutations] } });
    }

    if (action === 'schema') {
      const name = typeof params.name === 'string' ? params.name : '';
      if (!name) return buildFailure('validation_error', 'A GraphQL schema name is required.');
      const maxDepth = clampDepth(params.max_depth);
      const json = await graphqlJson(client, TYPE_QUERY, useToken, signal);
      const allTypes = (json?.data?.__schema?.types ?? []) as Array<Record<string, any>>;
      const typesByName = new Map<string, Record<string, any>>(
        allTypes.filter((entry) => typeof entry?.name === 'string').map((entry) => [String(entry.name), entry]),
      );
      const type = typesByName.get(name);
      if (!type) return buildFailure('not_found', `GraphQL schema name not found: ${name}.`);
      const fields = describeFields(String(type.name), typesByName, maxDepth) ?? [];
      return buildSuccess(`api_graphql schema: ${name}`, { data: { name: type.name, kind: type.kind, fields } });
    }

    if (action === 'execute') {
      const query = typeof params.query === 'string' ? params.query : '';
      if (!query) return buildFailure('validation_error', 'A GraphQL query is required.');
      const response = await client.graphql({
        query,
        variables: params.variables,
        operationName: typeof params.operationName === 'string' ? params.operationName : undefined,
        headers: params.headers as Record<string, string> | undefined,
        useToken,
      }, signal);
      return buildSuccess('api_graphql execute', {
        request: redactDeep({ query, variables: params.variables, operation_name: params.operationName, use_token: useToken }, config.secretValues),
        response: redactDeep({ status: response.status, status_text: response.statusText, headers: response.headers, body: response.bodyText }, config.secretValues),
      });
    }

    return buildFailure('validation_error', 'Unsupported GraphQL action.');
  } catch (error) {
    const safe = classifyError(error);
    return buildFailure(safe.code, safe.message);
  }
}
