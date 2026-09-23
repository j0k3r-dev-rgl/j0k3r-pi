/**
 * Security and privacy sanitization layer for TypeSafe payloads and SQLite telemetry.
 * Ensures secrets, tokens, passwords, and sensitive keys are redacted recursively
 * before network transmission or storage.
 */

const SENSITIVE_KEY_REGEX = /(api[_-]?key|auth|bearer|secret|password|token|private[_-]?key|credential)/i;
const BEARER_REGEX = /Bearer\s+[a-zA-Z0-9_\-\.]{8,}/gi;
const GENERIC_API_KEY_REGEX = /\b(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|glpat-[a-zA-Z0-9_\-]{20,})\b/g;
const PRIVATE_KEY_BLOCK_REGEX = /-----BEGIN [A-Z\s]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z\s]+ PRIVATE KEY-----/g;
const PASSWORD_ASSIGNMENT_REGEX = /(?:password|passwd|secret)\s*[:=]\s*['"][^'"]+['"]/gi;
const ENV_SECRET_ASSIGNMENT_REGEX = /[A-Z0-9_]*(?:KEY|SECRET|TOKEN|AUTH|PASSWORD)[A-Z0-9_]*\s*=\s*[^\s\n\r]+/gi;

export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '***REDACTED***';
  return `${value.slice(0, 3)}***REDACTED***${value.slice(-3)}`;
}

export function sanitizeString(text: string): string {
  if (!text || typeof text !== 'string') return text;

  let sanitized = text;

  // Redact active TYPESAFE_API_KEY if present in environment
  const currentApiKey = process.env.TYPESAFE_API_KEY;
  if (currentApiKey && currentApiKey.length > 5) {
    sanitized = sanitized.split(currentApiKey).join('[REDACTED_TYPESAFE_API_KEY]');
  }

  // Redact Bearer tokens
  sanitized = sanitized.replace(BEARER_REGEX, 'Bearer [REDACTED_TOKEN]');

  // Redact Private keys
  sanitized = sanitized.replace(PRIVATE_KEY_BLOCK_REGEX, '[REDACTED_PRIVATE_KEY]');

  // Redact Generic API key patterns (sk-, ghp_, glpat-)
  sanitized = sanitized.replace(GENERIC_API_KEY_REGEX, '[REDACTED_API_KEY]');

  // Redact password assignments
  sanitized = sanitized.replace(PASSWORD_ASSIGNMENT_REGEX, 'password: "[REDACTED]"');

  // Redact env secret lines
  sanitized = sanitized.replace(ENV_SECRET_ASSIGNMENT_REGEX, (match) => {
    const parts = match.split('=');
    return `${parts[0]}=[REDACTED]`;
  });

  return sanitized;
}

export function sanitizeState<T>(input: T, seen = new WeakSet()): T {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    return sanitizeString(input) as unknown as T;
  }

  if (typeof input === 'number' || typeof input === 'boolean' || typeof input === 'bigint') {
    return input;
  }

  if (typeof input === 'object') {
    if (seen.has(input as object)) {
      return '[CIRCULAR]' as unknown as T;
    }
    seen.add(input as object);

    if (Array.isArray(input)) {
      return input.map((item) => sanitizeState(item, seen)) as unknown as T;
    }

    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = sanitizeState(val, seen);
      }
    }
    return output as unknown as T;
  }

  return input;
}

export function sanitizeError(error: unknown): string {
  if (!error) return '';
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeString(message);
}
