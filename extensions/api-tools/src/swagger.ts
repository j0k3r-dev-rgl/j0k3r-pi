import { classifyError, httpFailure } from './error-classify.js';
import { failureDocument, frameText, record, successDocument } from './result-format.js';
import { redactDeep } from './security.js';
import type { ApiActionDocument, ApiClient, ApiToolsConfig } from './types.js';
import { buildSwaggerDetailDocument, buildSwaggerSchemaDocument } from './swagger/detail.js';
import { buildSwaggerDiscoverDocument } from './swagger/discovery.js';

function clampDepth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 3;
  return Math.max(0, Math.min(5, Math.floor(value)));
}

export async function executeSwaggerAction(
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  client: ApiClient,
  config: ApiToolsConfig,
): Promise<ApiActionDocument> {
  const action = typeof params.action === 'string' ? params.action : '';
  try {
    if (action === 'discover') {
      const { document } = await client.fetchSwaggerDocument(signal);
      return buildSwaggerDiscoverDocument(document, params);
    }

    if (action === 'detail') {
      const selector = typeof params.operation === 'string' ? params.operation : '';
      if (!selector) return failureDocument({ tool: 'api_swagger', action, failure: classifyError('api_swagger', action, new Error('A Swagger operation selector is required.')) });
      const { document } = await client.fetchSwaggerDocument(signal);
      return buildSwaggerDetailDocument(document, selector);
    }

    if (action === 'schema') {
      const selector = typeof params.operation === 'string' ? params.operation : '';
      if (!selector) return failureDocument({ tool: 'api_swagger', action, failure: classifyError('api_swagger', action, new Error('A Swagger operation selector is required.')) });
      const { document } = await client.fetchSwaggerDocument(signal);
      return buildSwaggerSchemaDocument(document, selector, clampDepth(params.max_depth));
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
      const safe = redactDeep({ status: response.status, status_text: response.statusText, headers: response.headers, body: response.bodyText }, config.secretValues);
      const records = [
        record('request-1', 'request', `${method} ${path}`),
        record('response-1', 'response', `status: ${response.status} ${response.statusText}`),
        ...frameText('response-body', 'text_frame', typeof safe.body === 'string' ? safe.body : JSON.stringify(safe.body, null, 2)),
      ];
      if (response.status >= 400) {
        return failureDocument({
          tool: 'api_swagger',
          action,
          identity: `${method} ${path}`,
          failure: httpFailure('api_swagger', action, response.status, response.statusText, `Swagger request failed with ${response.status} ${response.statusText}.`),
          records,
        });
      }
      return successDocument({ tool: 'api_swagger', action, identity: `${method} ${path}`, records, total: records.length });
    }

    return failureDocument({ tool: 'api_swagger', action, failure: classifyError('api_swagger', action || 'unknown', new Error('Unsupported Swagger action.')) });
  } catch (error) {
    return failureDocument({ tool: 'api_swagger', action: action || 'unknown', failure: classifyError('api_swagger', action || 'unknown', error) });
  }
}
