import type { Provider } from './provider.js';

export type ErrorCategory =
  | 'validation'
  | 'rate_limit'
  | 'quota_exhausted'
  | 'auth'
  | 'not_found'
  | 'provider_unavailable'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'provider_payload'
  | 'unexpected';

export type ToolError = {
  code:
    | 'validation_error'
    | 'missing_configuration'
    | 'provider_error'
    | 'rate_limited'
    | 'quota_exhausted'
    | 'not_found'
    | 'source_unavailable'
    | 'cancelled'
    | 'timeout';
  message: string;
  recoverable: boolean;
  retry_after_seconds?: number;
  backoff_seconds?: number;
  provider?: Provider;
  category?: ErrorCategory;
  status?: number;
  request_id?: string;
};
