import { ApiClientError } from '../client.js';
import { successDocument, record } from '../result-format.js';
import { compactAuthorizationSummary } from '../security.js';
import type { ApiActionDocument, ApiAuthorizationMetadata } from '../types.js';

export const DISCOVERY_PAGE_SIZE = 50;

export function formatType(type: any): string {
  if (!type) return 'Unknown';
  if (type.kind === 'NON_NULL') return `${formatType(type.ofType)}!`;
  if (type.kind === 'LIST') return `[${formatType(type.ofType)}]`;
  return type.name ?? 'Unknown';
}

export function unwrapType(type: any): string | undefined {
  if (!type) return undefined;
  if (type.name) return type.name;
  return unwrapType(type.ofType);
}

export function buildGraphqlDiscoverDocument(json: any, filterValue?: string): ApiActionDocument {
  const schema = json?.data?.__schema;
  if (!schema || typeof schema !== 'object') {
    throw new ApiClientError('validation', 'GraphQL introspection did not include __schema.');
  }

  const filter = filterValue?.toLowerCase();
  const rows: Array<{ selector: string; kind: string; auth: ApiAuthorizationMetadata }> = [];
  let sawRoot = false;
  for (const [rootName, kind] of [['queryType', 'query'], ['mutationType', 'mutation']] as const) {
    const root = schema[rootName];
    if (root == null) continue;
    sawRoot = true;
    if (!root || !Array.isArray(root.fields)) {
      throw new ApiClientError('validation', `GraphQL introspection did not include ${rootName} fields.`);
    }
    for (const field of root.fields) {
      const selector = `${kind === 'query' ? 'Query' : 'Mutation'}.${field.name}`;
      if (filter && !selector.toLowerCase().includes(filter)) continue;
      rows.push({ selector, kind, auth: { state: 'unavailable', reason: 'Standard introspection does not expose applied directives.' } });
    }
  }
  if (!sawRoot) {
    throw new ApiClientError('validation', 'GraphQL introspection did not expose queryType or mutationType fields.');
  }
  rows.sort((a, b) => a.selector.localeCompare(b.selector));
  return successDocument({
    tool: 'api_graphql',
    action: 'discover',
    identity: `${rows.length} operation${rows.length === 1 ? '' : 's'}`,
    records: rows.map((row, index) => record(`operation-${index + 1}`, 'operation', `${row.selector} · ${row.kind} · auth: ${compactAuthorizationSummary(row.auth)}`)),
    total: rows.length,
    render: { count_label: 'operations' },
  });
}
