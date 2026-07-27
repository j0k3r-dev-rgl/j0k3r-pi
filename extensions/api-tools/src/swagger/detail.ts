import { ApiClientError } from '../client.js';
import { successDocument, record } from '../result-format.js';
import { compactAuthorizationSummary, extractOpenApiAuthorizationMetadata, truncateString } from '../security.js';
import type { ApiActionDocument } from '../types.js';
import { selectSwaggerOperation, swaggerSelector } from './discovery.js';

function isLocalRef(ref: string): boolean {
  return ref.startsWith('#/');
}

function pointerSegments(ref: string): string[] {
  return ref.slice(2).split('/').map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function resolveLocalRef(document: Record<string, any>, ref: string, seen = new Set<string>()): any {
  if (!isLocalRef(ref)) throw new ApiClientError('reference', 'Encountered an unsupported external reference.');
  if (seen.has(ref)) throw new ApiClientError('reference', 'Encountered a cyclic local reference.');
  seen.add(ref);
  let current: any = document;
  for (const segment of pointerSegments(ref)) {
    current = current?.[segment];
  }
  if (!current) throw new ApiClientError('reference', 'Encountered an invalid local reference.');
  if (current && typeof current === 'object' && typeof current.$ref === 'string') return resolveLocalRef(document, current.$ref, seen);
  return current;
}

function safeResolve(document: Record<string, any>, value: any): any {
  if (!value || typeof value !== 'object' || typeof value.$ref !== 'string') return value;
  if (!isLocalRef(value.$ref)) return { unsupported_reference: true };
  return safeResolve(document, resolveLocalRef(document, value.$ref));
}

function mergeParameters(document: Record<string, any>, pathParameters: any[] = [], operationParameters: any[] = []): any[] {
  const merged = new Map<string, any>();
  for (const raw of [...pathParameters, ...operationParameters]) {
    const parameter = safeResolve(document, raw);
    const key = `${parameter?.in ?? 'unknown'}:${parameter?.name ?? 'unknown'}`;
    merged.set(key, parameter);
  }
  return [...merged.values()];
}

function renderSchemaSummary(document: Record<string, any>, raw: any): string {
  const value = safeResolve(document, raw);
  if (value?.unsupported_reference) return 'unsupported_reference';
  if (!value || typeof value !== 'object') return String(value ?? 'unknown');
  const type = typeof value.type === 'string' ? value.type : undefined;
  const format = typeof value.format === 'string' ? value.format : undefined;
  const enumeration = Array.isArray(value.enum) ? ` enum=${value.enum.slice(0, 5).join(',')}` : '';
  const constraints = [
    typeof value.minimum === 'number' ? `min=${value.minimum}` : undefined,
    typeof value.maximum === 'number' ? `max=${value.maximum}` : undefined,
    typeof value.minLength === 'number' ? `minLength=${value.minLength}` : undefined,
    typeof value.maxLength === 'number' ? `maxLength=${value.maxLength}` : undefined,
  ].filter(Boolean).join(' ');
  return [type, format].filter(Boolean).join('/') + enumeration + (constraints ? ` ${constraints}` : '');
}

function renderResponse(document: Record<string, any>, status: string, raw: any): string[] {
  const response = safeResolve(document, raw);
  if (response?.unsupported_reference) return [`response ${status}: unsupported_reference`];
  const lines = [`response ${status}: ${truncateString(String(response?.description ?? 'response'))}`];
  for (const [contentType, content] of Object.entries(response?.content ?? {})) {
    lines.push(`  content ${contentType}: ${renderSchemaSummary(document, (content as any)?.schema)}`);
  }
  for (const [headerName, header] of Object.entries(response?.headers ?? {})) {
    lines.push(`  header ${headerName}: ${renderSchemaSummary(document, (header as any)?.schema)}`);
  }
  return lines;
}

export function buildSwaggerDetailDocument(document: Record<string, any>, selector: string): ApiActionDocument {
  const entry = selectSwaggerOperation(document, selector);
  const operation = entry.operation;
  const identity = swaggerSelector(entry);
  const records = [record('operation', 'operation', `${entry.method} ${entry.path} · ${identity}`)];
  const parameters = mergeParameters(document, entry.pathItem.parameters ?? [], operation.parameters ?? []);
  const auth = extractOpenApiAuthorizationMetadata({
    document,
    effectiveSecurity: operation.security ?? entry.pathItem.security ?? document.security,
    sources: [entry.pathItem, operation],
  });

  records.push(record('authorization', 'authorization', `authorization: ${compactAuthorizationSummary(auth)}`));
  if (auth.schemes?.length) {
    for (const [index, scheme] of auth.schemes.entries()) {
      records.push(record(`scheme-${index + 1}`, 'security_scheme', `security ${scheme.name}: ${scheme.type}${scheme.scheme ? `/${scheme.scheme}` : ''}${scheme.scopes?.length ? ` scopes=${scheme.scopes.join(',')}` : ''}`));
    }
  }
  for (const group of [auth.roles?.length ? `roles=${auth.roles.join(',')}` : undefined, auth.permissions?.length ? `permissions=${auth.permissions.join(',')}` : undefined, auth.authorities?.length ? `authorities=${auth.authorities.join(',')}` : undefined, auth.scopes?.length ? `scopes=${auth.scopes.join(',')}` : undefined].filter(Boolean)) {
    records.push(record(`auth-${records.length + 1}`, 'authorization_detail', String(group)));
  }

  for (const [index, parameter] of parameters.entries()) {
    if (parameter?.unsupported_reference) {
      records.push(record(`parameter-${index + 1}`, 'parameter', 'parameter: unsupported_reference'));
      continue;
    }
    records.push(record(
      `parameter-${index + 1}`,
      'parameter',
      `parameter ${parameter.in}.${parameter.name}${parameter.required ? ' required' : ' optional'}: ${renderSchemaSummary(document, parameter.schema)}${parameter.default !== undefined ? ` default=${JSON.stringify(parameter.default)}` : ''}`,
    ));
  }

  if (operation.requestBody) {
    const requestBody = safeResolve(document, operation.requestBody);
    if (requestBody?.unsupported_reference) records.push(record('request-body', 'request_body', 'request body: unsupported_reference'));
    else {
      records.push(record('request-body', 'request_body', `request body${requestBody.required ? ' required' : ' optional'}: ${truncateString(String(requestBody.description ?? 'body'))}`));
      for (const [contentType, content] of Object.entries(requestBody.content ?? {})) {
        records.push(record(`request-content-${contentType}`, 'request_content', `request content ${contentType}: ${renderSchemaSummary(document, (content as any)?.schema)}`));
      }
    }
  }

  for (const [status, response] of Object.entries(operation.responses ?? {})) {
    for (const [index, line] of renderResponse(document, status, response).entries()) {
      records.push(record(`response-${status}-${index + 1}`, 'response', line));
    }
  }

  return successDocument({
    tool: 'api_swagger',
    action: 'detail',
    identity,
    records,
    total: records.length,
    render: { authorization: auth },
  });
}

export function buildSwaggerSchemaDocument(document: Record<string, any>, selector: string, maxDepth = 3): ApiActionDocument {
  const entry = selectSwaggerOperation(document, selector);
  const identity = swaggerSelector(entry);
  const lines = [
    `${entry.method} ${entry.path} · ${identity}`,
    `parameters: ${mergeParameters(document, entry.pathItem.parameters ?? [], entry.operation.parameters ?? []).length}`,
    `responses: ${Object.keys(entry.operation.responses ?? {}).length}`,
    `max_depth: ${maxDepth}`,
  ];
  return successDocument({
    tool: 'api_swagger',
    action: 'schema',
    identity,
    records: lines.map((line, index) => record(`schema-${index + 1}`, 'schema', line)),
    total: lines.length,
  });
}
