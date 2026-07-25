export const API_WARNING_CODES = [
  'invalid_config',
  'api_json_unignored',
  'api_json_tracked',
  'git_status_unknown',
  'unsupported_auth_metadata',
  'limit_default_applied',
  'limit_fallback_applied',
  'invalid_swagger_config',
  'invalid_graphql_config',
] as const;

export type ApiWarningCode = (typeof API_WARNING_CODES)[number];
export type ApiFramework = 'spring' | 'node';

export const GIT_API_JSON_STATES = ['ignored', 'unignored_untracked', 'tracked', 'unknown'] as const;
export type GitApiJsonState = (typeof GIT_API_JSON_STATES)[number];

export interface ApiWarning {
  code: ApiWarningCode;
  message?: string;
}

export type ApiAuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'api_key'; header: string; value: string }
  | { type: 'headers'; headers: Record<string, string> }
  | { type: 'login'; login_path: string; username: string; password: string; access_token?: string };

export interface ApiIntegrationState {
  configured: boolean;
  enabled: boolean;
  framework?: ApiFramework;
  url?: string;
  valid: boolean;
}

export interface ApiToolsConfig {
  configPath?: string;
  exists: boolean;
  enabled: boolean;
  url?: string;
  port?: number;
  graphqlUrl?: string;
  swagger: ApiIntegrationState;
  graphql: ApiIntegrationState;
  headers: Record<string, string>;
  auth: ApiAuthConfig;
  timeoutMs: number;
  limits: {
    maxResponseBytes: number;
    maxResponseLines: number;
    cursorTtlSeconds: number;
  };
  warnings: ApiWarning[];
  secretValues: string[];
  git: {
    state: GitApiJsonState;
  };
}

export interface ApiRestRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  path: string;
  headers?: Record<string, string>;
  body?: string;
  useToken?: boolean;
}

export interface ApiGraphqlRequest {
  query: string;
  variables?: unknown;
  operationName?: string;
  headers?: Record<string, string>;
  useToken?: boolean;
}

export interface SwaggerDocumentResponse {
  url: string;
  document: Record<string, any>;
}

export interface ApiHttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
  url?: string;
}

export interface ApiClient {
  login(signal?: AbortSignal): Promise<ApiHttpResponse>;
  rest(request: ApiRestRequest, signal?: AbortSignal): Promise<ApiHttpResponse>;
  graphql(request: ApiGraphqlRequest, signal?: AbortSignal): Promise<ApiHttpResponse>;
  fetchSwaggerDocument(signal?: AbortSignal): Promise<SwaggerDocumentResponse>;
  resolveGraphqlUrl(): string;
}

export interface ApiTruncationMetadata {
  truncated: boolean;
  limit_bytes: number;
  limit_lines: number;
  original_bytes_known: boolean;
  original_lines_known: boolean;
  returned_bytes: number;
  returned_lines: number;
  reason?: 'byte_limit' | 'line_limit' | 'byte_and_line_limit';
}

export interface ApiContinuationMetadata {
  has_more: boolean;
  next_cursor?: string;
  returned_bytes: number;
  returned_lines: number;
  total_bytes: number;
  total_lines: number;
}

export interface ApiJsonGitInspection {
  state: GitApiJsonState;
}

export interface ApiJsonGitInspector {
  inspectApiJson(input: { cwd: string }): Promise<ApiJsonGitInspection>;
}

export interface ApiToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details?: Record<string, any>;
  isError?: boolean;
}
