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

export const API_CONTRACT_VERSION = 2 as const;

export type ApiWarningCode = (typeof API_WARNING_CODES)[number];
export type ApiFramework = 'spring' | 'node';
export type ApiToolName = 'api_rest_request' | 'api_swagger' | 'api_graphql';
export type ApiActionStatus = 'success' | 'failure';

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

export interface ApiJsonGitInspection {
  state: GitApiJsonState;
}

export interface ApiJsonGitInspector {
  inspectApiJson(input: { cwd: string }): Promise<ApiJsonGitInspection>;
}

export type ApiFailureCategory =
  | 'http_error'
  | 'graphql_error'
  | 'validation_error'
  | 'provider_error'
  | 'configuration_error'
  | 'timeout_error'
  | 'cancellation_error'
  | 'continuation_error'
  | 'reference_error'
  | 'authorization_metadata_error'
  | 'unknown_error';

export interface ApiFailureEnvelope {
  category: ApiFailureCategory;
  code: string;
  message: string;
  http_status?: number;
  graphql_classification?: string;
  retryable: boolean;
  next_step?: string;
}

export type ApiAuthorizationState = 'declared' | 'not_declared' | 'unavailable' | 'unknown';
export type ApiAuthorizationSource = 'openapi_security' | 'oauth_scope' | 'openapi_vendor' | 'graphql_applied_directive';

export interface ApiAuthorizationScheme {
  name: string;
  type: string;
  scheme?: string;
  scopes?: string[];
}

export interface ApiAuthorizationMetadata {
  state: ApiAuthorizationState;
  sources?: ApiAuthorizationSource[];
  schemes?: ApiAuthorizationScheme[];
  roles?: string[];
  permissions?: string[];
  authorities?: string[];
  scopes?: string[];
  reason?: string;
  truncated?: boolean;
  unsupported_metadata?: boolean;
}

export interface ApiLogicalRecord {
  id: string;
  kind: string;
  text: string;
}

export interface ApiActionDocument {
  contract_version: typeof API_CONTRACT_VERSION;
  tool: ApiToolName;
  action: string;
  identity?: string;
  status: ApiActionStatus;
  records: ApiLogicalRecord[];
  total?: number;
  failure?: ApiFailureEnvelope;
  render?: {
    authorization?: ApiAuthorizationMetadata;
    count_label?: string;
  };
}

export interface ApiContinuationMetadata {
  returned_count: number;
  total?: number;
  has_more: boolean;
  next_cursor?: string;
  follow_up: { tool: string; action: string; cursor_parameter: 'cursor' };
  returned_bytes: number;
  returned_lines: number;
}

export interface ApiResultDetails {
  contract_version: typeof API_CONTRACT_VERSION;
  status: ApiActionStatus;
  action: string;
  identity?: string;
  failure?: ApiFailureEnvelope;
  continuation: ApiContinuationMetadata;
  render?: {
    authorization_state?: ApiAuthorizationState;
    count_label?: string;
  };
}

export interface ApiToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details?: ApiResultDetails & Record<string, any>;
  isError?: boolean;
}
