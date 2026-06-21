import { ProviderFailure } from '../../security.js';
import type { Provider } from '../../types.js';

type McpContent = { type?: string; text?: string; _meta?: Record<string, unknown> };
type McpResponse = {
  result?: { content?: McpContent[]; structuredContent?: unknown };
  error?: { code?: number; message?: string };
};

export type McpTextPayload = {
  text: string;
  contentMeta?: Record<string, unknown>;
  structuredContent?: unknown;
};

export function mcpHeaders(apiKey?: string): Record<string, string> {
  return {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey, authorization: `Bearer ${apiKey}` } : {}),
  };
}

function parseJsonCandidate(candidate: string): McpResponse | undefined {
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as McpResponse;
  } catch {
    // Ignore non-JSON event lines.
  }
  return undefined;
}

function parseMcpResponse(provider: Provider, body: string): McpResponse {
  const trimmed = body.trim();
  const candidates: string[] = [];
  if (trimmed.startsWith('{')) candidates.push(trimmed);
  for (const line of trimmed.split(/\r?\n/)) {
    if (line.startsWith('data: ')) candidates.push(line.slice(6).trim());
  }

  for (const candidate of candidates) {
    const parsed = parseJsonCandidate(candidate);
    if (parsed?.error) {
      throw new ProviderFailure({
        code: 'provider_error',
        category: 'provider_payload',
        message: `${provider} MCP returned an error: ${parsed.error.message ?? parsed.error.code ?? 'unknown error'}.`,
        recoverable: true,
        provider,
      });
    }
    if (parsed?.result) return parsed;
  }

  throw new ProviderFailure({
    code: 'provider_error',
    category: 'provider_payload',
    message: `${provider} MCP returned an unexpected payload shape.`,
    recoverable: true,
    provider,
  });
}

export function extractMcpTextPayload(provider: Provider, body: string): McpTextPayload {
  const parsed = parseMcpResponse(provider, body);
  const content = parsed.result?.content ?? [];
  const textParts = content.filter((part) => part.type === 'text' && typeof part.text === 'string');
  const contentMeta = textParts.find((part) => part._meta && typeof part._meta === 'object')?._meta;
  return {
    text: textParts.map((part) => part.text).join('\n').trim(),
    contentMeta,
    structuredContent: parsed.result?.structuredContent,
  };
}

export function extractMcpText(provider: Provider, body: string): string {
  return extractMcpTextPayload(provider, body).text;
}
