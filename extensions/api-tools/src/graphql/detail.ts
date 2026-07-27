import { ApiClientError } from '../client.js';
import { record, successDocument } from '../result-format.js';
import { extractGraphqlAuthorizationMetadata, truncateString } from '../security.js';
import type { ApiActionDocument } from '../types.js';
import { formatType, unwrapType } from './discovery.js';

function splitSelector(selector: string): { root: 'Query' | 'Mutation'; field: string } {
  const match = /^(Query|Mutation)\.(.+)$/.exec(selector);
  if (!match) throw new ApiClientError('validation', `GraphQL selector must use Query.field or Mutation.field: ${selector}.`);
  return { root: match[1] as 'Query' | 'Mutation', field: match[2]! };
}

function typeMap(json: any): Map<string, any> {
  const types = json?.data?.__schema?.types ?? [];
  return new Map(types.filter((entry: any) => typeof entry?.name === 'string').map((entry: any) => [entry.name, entry]));
}

function describeTypeFields(typeName: string | undefined, typesByName: Map<string, any>, depth: number, seen = new Set<string>()): string[] {
  if (!typeName || depth <= 0) return [];
  const target = typesByName.get(typeName);
  if (!target) return [];
  if (seen.has(typeName)) return [`field ${typeName}: cycle_reference`];
  const nextSeen = new Set(seen).add(typeName);
  const rawFields = Array.isArray(target.fields) ? target.fields : Array.isArray(target.inputFields) ? target.inputFields : [];
  const lines: string[] = [];
  for (const field of rawFields) {
    const nextTypeName = unwrapType(field.type);
    lines.push(`field ${field.name}: ${formatType(field.type)}${field.description ? ` — ${truncateString(field.description)}` : ''}`);
    if (nextTypeName && nextSeen.has(nextTypeName)) {
      lines.push(`field ${field.name}: cycle_reference`);
      continue;
    }
    lines.push(...describeTypeFields(nextTypeName, typesByName, depth - 1, nextSeen));
  }
  return lines;
}

export const GRAPHQL_FIELD_PAGE_SIZE = 200;

export function buildGraphqlDetailDocument(json: any, selector: string, depth = 3): ApiActionDocument {
  const { root, field } = splitSelector(selector);
  const rootFields = json?.data?.__schema?.[root === 'Query' ? 'queryType' : 'mutationType']?.fields ?? [];
  const target = rootFields.find((entry: any) => entry.name === field);
  if (!target) throw new ApiClientError('validation', `GraphQL selector not found: ${selector}.`);
  const typesByName = typeMap(json);
  const auth = extractGraphqlAuthorizationMetadata(target.appliedDirectives ?? target.directives);
  const lines = [
    `${root === 'Query' ? 'query' : 'mutation'} ${selector}`,
  ];

  for (const arg of target.args ?? []) {
    lines.push(`argument ${arg.name}: ${formatType(arg.type)}${arg.defaultValue != null ? ` default=${arg.defaultValue}` : ''}${arg.description ? ` — ${truncateString(arg.description)}` : ''}`);
  }
  lines.push(`return: ${formatType(target.type)}`);
  for (const line of describeTypeFields(unwrapType(target.type), typesByName, depth)) lines.push(line);
  if (auth.reason) lines.push(`authorization: ${auth.state} · ${auth.reason}`);
  else lines.push(`authorization: ${auth.state}`);
  if (auth.roles?.length) lines.push(`roles=${auth.roles.join(',')}`);
  if (auth.permissions?.length) lines.push(`permissions=${auth.permissions.join(',')}`);
  if (auth.authorities?.length) lines.push(`authorities=${auth.authorities.join(',')}`);
  if (auth.scopes?.length) lines.push(`scopes=${auth.scopes.join(',')}`);

  return successDocument({
    tool: 'api_graphql',
    action: 'detail',
    identity: selector,
    records: lines.map((line, index) => record(`detail-${index + 1}`, index === 0 ? 'operation' : line.startsWith('argument ') ? 'argument' : line.startsWith('field ') ? 'field' : 'detail', line)),
    total: lines.length,
    render: { authorization: auth },
  });
}

export function buildGraphqlSchemaDocument(json: any, name: string, depth = 3): ApiActionDocument {
  const typesByName = typeMap(json);
  const type = typesByName.get(name);
  if (!type) throw new ApiClientError('validation', `GraphQL schema name not found: ${name}.`);
  const lines = [`type ${name}: ${type.kind}`,
    ...describeTypeFields(name, typesByName, depth),
  ];
  return successDocument({
    tool: 'api_graphql',
    action: 'schema',
    identity: name,
    records: lines.map((line, index) => record(`schema-${index + 1}`, index === 0 ? 'type' : 'field', line)),
    total: lines.length,
  });
}
