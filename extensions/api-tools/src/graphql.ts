import { classifyError, graphqlFailure, httpFailure } from './error-classify.js';
import { ApiClientError } from './client.js';
import { failureDocument, frameText, record, successDocument } from './result-format.js';
import { redactDeep } from './security.js';
import type { ApiActionDocument, ApiClient, ApiGraphqlRequest, ApiToolsConfig } from './types.js';
import { buildGraphqlDetailDocument, buildGraphqlSchemaDocument } from './graphql/detail.js';
import { buildGraphqlDiscoverDocument, unwrapType } from './graphql/discovery.js';

function clampDepth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 3;
  return Math.max(0, Math.min(5, Math.floor(value)));
}

const DISCOVER_ROOT_QUERY = `query ApiToolsGraphqlDiscoverRoot($root: String!) {
  __type(name: $root) {
    fields {
      name
      type { kind name ofType { kind name ofType { kind name } } }
    }
  }
}`;

const ROOT_FIELD_QUERY = `query ApiToolsGraphqlRootField($root: String!) {
  __type(name: $root) {
    fields {
      name
      description
      args { name description defaultValue type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
      type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
    }
  }
}`;

const TYPE_BY_NAME_QUERY = `query ApiToolsGraphqlTypeByName($name: String!) {
  __type(name: $name) {
    name
    kind
    fields { name description type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
    inputFields { name description type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
  }
}`;

function splitSelector(selector: string): { root: 'Query' | 'Mutation'; field: string } {
  const match = /^(Query|Mutation)\.(.+)$/.exec(selector);
  if (!match) throw new ApiClientError('validation', `GraphQL selector must use Query.field or Mutation.field: ${selector}.`);
  return { root: match[1] as 'Query' | 'Mutation', field: match[2]! };
}

async function graphqlJson(client: ApiClient, request: ApiGraphqlRequest, action: string, useToken: boolean, signal?: AbortSignal): Promise<any> {
  const response = await client.graphql({ ...request, useToken }, signal);
  const json = JSON.parse(response.bodyText);
  if (response.status >= 400) throw httpFailure('api_graphql', action, response.status, response.statusText, `GraphQL request failed with ${response.status} ${response.statusText}.`);
  if (Array.isArray(json?.errors) && json.errors.length > 0) {
    const first = json.errors[0] ?? {};
    throw graphqlFailure('api_graphql', action, first?.extensions?.code, typeof first?.message === 'string' ? first.message : 'GraphQL returned top-level errors.');
  }
  return json;
}

async function fetchRootFields(client: ApiClient, root: 'Query' | 'Mutation', action: string, useToken: boolean, signal?: AbortSignal): Promise<any[] | null> {
  const json = await graphqlJson(client, { query: DISCOVER_ROOT_QUERY, variables: { root } }, action, useToken, signal);
  const type = json?.data?.__type;
  if (type == null) return null;
  if (!Array.isArray(type.fields)) throw new ApiClientError('validation', `GraphQL introspection did not include ${root} fields.`);
  return type.fields;
}

async function fetchRootFieldDetails(client: ApiClient, root: 'Query' | 'Mutation', action: string, useToken: boolean, signal?: AbortSignal): Promise<any[]> {
  const json = await graphqlJson(client, { query: ROOT_FIELD_QUERY, variables: { root } }, action, useToken, signal);
  const fields = json?.data?.__type?.fields;
  if (!Array.isArray(fields)) throw new ApiClientError('validation', `GraphQL introspection did not include ${root} detail fields.`);
  return fields;
}

async function fetchTypeByName(client: ApiClient, name: string, action: string, useToken: boolean, signal?: AbortSignal): Promise<any | null> {
  const json = await graphqlJson(client, { query: TYPE_BY_NAME_QUERY, variables: { name } }, action, useToken, signal);
  return json?.data?.__type ?? null;
}

async function collectTypeEntries(client: ApiClient, startingNames: Array<string | undefined>, depth: number, action: string, useToken: boolean, signal?: AbortSignal): Promise<any[]> {
  const queued = startingNames.filter((name): name is string => typeof name === 'string' && name.length > 0).map((name) => ({ name, depth }));
  const visited = new Set<string>();
  const entries: any[] = [];

  while (queued.length > 0) {
    const next = queued.shift()!;
    if (next.depth <= 0 || visited.has(next.name)) continue;
    visited.add(next.name);
    const type = await fetchTypeByName(client, next.name, action, useToken, signal);
    if (!type) continue;
    entries.push(type);
    if (next.depth <= 1) continue;
    const nested = [
      ...(Array.isArray(type.fields) ? type.fields : []),
      ...(Array.isArray(type.inputFields) ? type.inputFields : []),
    ];
    for (const field of nested) {
      const childName = unwrapType(field?.type);
      if (childName && !visited.has(childName)) queued.push({ name: childName, depth: next.depth - 1 });
    }
  }

  return entries;
}

function normalizeFailure(toolAction: string, error: unknown): ApiActionDocument {
  if (error && typeof error === 'object' && 'category' in error && 'code' in error && 'message' in error) {
    return failureDocument({ tool: 'api_graphql', action: toolAction, failure: error as any });
  }
  return failureDocument({ tool: 'api_graphql', action: toolAction, failure: classifyError('api_graphql', toolAction, error) });
}

export async function executeGraphqlAction(
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  client: ApiClient,
  config: ApiToolsConfig,
): Promise<ApiActionDocument> {
  const action = typeof params.action === 'string' ? params.action : '';
  const useToken = params.use_token === false ? false : true;

  try {
    if (action === 'discover') {
      const [queryFields, mutationFields] = await Promise.all([
        fetchRootFields(client, 'Query', action, useToken, signal),
        fetchRootFields(client, 'Mutation', action, useToken, signal),
      ]);
      return buildGraphqlDiscoverDocument({
        data: {
          __schema: {
            queryType: queryFields ? { fields: queryFields } : null,
            mutationType: mutationFields ? { fields: mutationFields } : null,
          },
        },
      }, typeof params.filter === 'string' ? params.filter : undefined);
    }

    if (action === 'detail') {
      const selector = typeof params.operation === 'string' ? params.operation : '';
      if (!selector) return normalizeFailure(action, new Error('A GraphQL operation selector is required.'));
      const depth = clampDepth(params.max_depth);
      const { root, field } = splitSelector(selector);
      const rootFields = await fetchRootFieldDetails(client, root, action, useToken, signal);
      const target = rootFields.find((entry: any) => entry?.name === field);
      if (!target) throw new ApiClientError('validation', `GraphQL selector not found: ${selector}.`);
      const types = await collectTypeEntries(client, [unwrapType(target.type)], depth, action, useToken, signal);
      return buildGraphqlDetailDocument({
        data: {
          __schema: {
            queryType: root === 'Query' ? { fields: rootFields } : { fields: [] },
            mutationType: root === 'Mutation' ? { fields: rootFields } : { fields: [] },
            types,
          },
        },
      }, selector, depth);
    }

    if (action === 'schema') {
      const name = typeof params.name === 'string' ? params.name : '';
      if (!name) return normalizeFailure(action, new Error('A GraphQL schema name is required.'));
      const depth = clampDepth(params.max_depth);
      const types = await collectTypeEntries(client, [name], depth, action, useToken, signal);
      return buildGraphqlSchemaDocument({ data: { __schema: { types } } }, name, depth);
    }

    if (action === 'execute') {
      const query = typeof params.query === 'string' ? params.query : '';
      if (!query) return normalizeFailure(action, new Error('A GraphQL query is required.'));
      const response = await client.graphql({
        query,
        variables: params.variables,
        operationName: typeof params.operationName === 'string' ? params.operationName : undefined,
        headers: params.headers as Record<string, string> | undefined,
        useToken,
      }, signal);
      const safe = redactDeep({ status: response.status, status_text: response.statusText, headers: response.headers, body: response.bodyText }, config.secretValues);
      let bodyJson: any;
      try {
        bodyJson = JSON.parse(response.bodyText);
      } catch {
        bodyJson = undefined;
      }
      const records = [
        record('request-1', 'request', typeof params.operationName === 'string' ? `operation ${params.operationName}` : 'operation execute'),
        record('response-1', 'response', `status: ${response.status} ${response.statusText}`),
        ...frameText('response-body', 'text_frame', typeof safe.body === 'string' ? safe.body : JSON.stringify(safe.body, null, 2)),
      ];
      if (response.status >= 400) {
        return failureDocument({ tool: 'api_graphql', action, failure: httpFailure('api_graphql', action, response.status, response.statusText, `GraphQL request failed with ${response.status} ${response.statusText}.`), records });
      }
      if (Array.isArray(bodyJson?.errors) && bodyJson.errors.length > 0) {
        const first = bodyJson.errors[0] ?? {};
        return failureDocument({ tool: 'api_graphql', action, failure: graphqlFailure('api_graphql', action, first?.extensions?.code, typeof first?.message === 'string' ? first.message : 'GraphQL returned top-level errors.'), records });
      }
      return successDocument({ tool: 'api_graphql', action, identity: typeof params.operationName === 'string' ? params.operationName : 'execute', records, total: records.length });
    }

    return normalizeFailure(action || 'unknown', new Error('Unsupported GraphQL action.'));
  } catch (error) {
    return normalizeFailure(action || 'unknown', error);
  }
}
