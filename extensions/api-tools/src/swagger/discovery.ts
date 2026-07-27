import { ApiClientError } from '../client.js';
import { successDocument, record } from '../result-format.js';
import { compactAuthorizationSummary, extractOpenApiAuthorizationMetadata } from '../security.js';
import type { ApiActionDocument } from '../types.js';

export const DISCOVERY_PAGE_SIZE = 50;

export interface SwaggerOperationEntry {
  method: string;
  path: string;
  operation: Record<string, any>;
  pathItem: Record<string, any>;
}

export function operationEntries(document: Record<string, any>): SwaggerOperationEntry[] {
  const entries: SwaggerOperationEntry[] = [];
  for (const [path, value] of Object.entries(document.paths ?? {})) {
    if (!value || typeof value !== 'object') continue;
    for (const [method, operation] of Object.entries(value as Record<string, any>)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) continue;
      entries.push({ method: method.toUpperCase(), path, operation: operation as Record<string, any>, pathItem: value as Record<string, any> });
    }
  }
  return entries.sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}

export function swaggerSelector(entry: SwaggerOperationEntry): string {
  return typeof entry.operation.operationId === 'string' && entry.operation.operationId.length > 0
    ? entry.operation.operationId
    : `${entry.method} ${entry.path}`;
}

export function selectSwaggerOperation(document: Record<string, any>, selector: string): SwaggerOperationEntry {
  const entries = operationEntries(document);
  const exactOperationId = entries.filter((entry) => entry.operation.operationId === selector);
  if (exactOperationId.length === 1) return exactOperationId[0]!;
  if (exactOperationId.length > 1) throw new ApiClientError('validation', `Swagger selector is ambiguous: ${selector}.`);
  const canonical = entries.filter((entry) => `${entry.method} ${entry.path}` === selector);
  if (canonical.length === 1) return canonical[0]!;
  throw new ApiClientError('validation', `Swagger operation not found: ${selector}.`);
}

export function buildSwaggerDiscoverDocument(document: Record<string, any>, params: Record<string, unknown>): ApiActionDocument {
  const tag = typeof params.tag === 'string' ? params.tag : undefined;
  const filterSelector = typeof params.operation === 'string' ? params.operation : undefined;
  const rows = operationEntries(document)
    .filter((entry) => !tag || (Array.isArray(entry.operation.tags) && entry.operation.tags.includes(tag)))
    .filter((entry) => !filterSelector || swaggerSelector(entry) === filterSelector)
    .map((entry, index) => {
      const auth = extractOpenApiAuthorizationMetadata({
        document,
        effectiveSecurity: entry.operation.security ?? entry.pathItem.security ?? document.security,
        sources: [entry.pathItem, entry.operation],
      });
      return record(`operation-${index + 1}`, 'operation', `${entry.method} ${entry.path} · ${swaggerSelector(entry)} · auth: ${compactAuthorizationSummary(auth)}`);
    });

  return successDocument({
    tool: 'api_swagger',
    action: 'discover',
    identity: `${rows.length} operation${rows.length === 1 ? '' : 's'}`,
    records: rows,
    total: rows.length,
    render: { count_label: 'operations' },
  });
}
