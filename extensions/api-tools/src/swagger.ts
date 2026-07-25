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
  const message = error instanceof Error ? error.message : 'Unexpected Swagger tool failure.';
  if (/cancelled|canceled|aborted/i.test(message)) return { code: 'cancelled', message };
  if (/timed out/i.test(message)) return { code: 'timeout', message };
  return { code: 'validation_error', message };
}

function operationEntries(document: Record<string, any>) {
  const entries: Array<{ method: string; path: string; operation: Record<string, any> }> = [];
  for (const [path, value] of Object.entries(document.paths ?? {})) {
    if (!value || typeof value !== 'object') continue;
    for (const [method, operation] of Object.entries(value as Record<string, any>)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) continue;
      entries.push({ method: method.toUpperCase(), path, operation: operation as Record<string, any> });
    }
  }
  return entries;
}

function summaryForOperation(entry: { method: string; path: string; operation: Record<string, any> }) {
  return {
    method: entry.method,
    path: entry.path,
    summary: entry.operation.summary,
    id: entry.operation.operationId ?? `${entry.method} ${entry.path}`,
    tags: Array.isArray(entry.operation.tags) ? entry.operation.tags : [],
  };
}

function clampDepth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 3;
  return Math.max(0, Math.min(6, Math.floor(value)));
}

function pruneSchema(value: any, depth: number): any {
  if (depth < 0 || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => pruneSchema(entry, depth - 1));
  if (depth === 0) return '[Truncated]';
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, pruneSchema(entry, depth - 1)]));
}

export async function executeSwaggerAction(
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  client: ApiClient,
  config: ApiToolsConfig,
): Promise<ApiToolResult> {
  const action = typeof params.action === 'string' ? params.action : '';
  try {
    if (action === 'discover') {
      const { document } = await client.fetchSwaggerDocument(signal);
      const operations = operationEntries(document)
        .map(summaryForOperation)
        .filter((entry) => typeof params.tag !== 'string' || entry.tags.includes(params.tag))
        .filter((entry) => typeof params.operation !== 'string' || entry.id === params.operation);
      const tags = [...new Set(operations.flatMap((entry) => entry.tags))];
      const lines = operations.map((entry) => `${entry.method} ${entry.path} · ${entry.id}`);
      return buildSuccess(
        `api_swagger discover: ${operations.length} operations\n${lines.join('\n')}`,
        {
          data: {
            title: document.info?.title,
            version: document.info?.version,
            tags,
            operations,
          },
        },
      );
    }

    if (action === 'schema') {
      const operationId = typeof params.operation === 'string' ? params.operation : '';
      if (!operationId) return buildFailure('validation_error', 'A Swagger operation is required.');
      const maxDepth = clampDepth(params.max_depth);
      const { document } = await client.fetchSwaggerDocument(signal);
      const operation = operationEntries(document).find((entry) => (entry.operation.operationId ?? `${entry.method} ${entry.path}`) === operationId);
      if (!operation) return buildFailure('not_found', `Swagger operation not found: ${operationId}.`);
      return buildSuccess(
        `api_swagger schema: ${operationId}`,
        {
          data: pruneSchema({
            id: operation.operation.operationId ?? operationId,
            method: operation.method,
            path: operation.path,
            summary: operation.operation.summary,
            parameters: operation.operation.parameters ?? [],
            requestBody: operation.operation.requestBody,
            responses: operation.operation.responses ?? {},
          }, maxDepth),
        },
      );
    }

    if (action === 'request') {
      const method = typeof params.method === 'string' ? params.method.toUpperCase() : '';
      const path = typeof params.path === 'string' ? params.path : '';
      const response = await client.rest({
        method: method as any,
        path,
        headers: params.headers as Record<string, string> | undefined,
        body: typeof params.body === 'string' ? params.body : undefined,
        useToken: params.use_token === false ? false : true,
      }, signal);
      return buildSuccess(`api_swagger request: ${method} ${path}`, {
        request: { method, path },
        response: redactDeep({ status: response.status, status_text: response.statusText, headers: response.headers, body: response.bodyText }, config.secretValues),
      });
    }

    return buildFailure('validation_error', 'Unsupported Swagger action.');
  } catch (error) {
    const safe = classifyError(error);
    return buildFailure(safe.code, safe.message);
  }
}
