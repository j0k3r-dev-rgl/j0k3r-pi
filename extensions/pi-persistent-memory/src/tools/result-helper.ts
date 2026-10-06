import type { AgentToolResult } from '@earendil-works/pi-coding-agent';

export const MAX_TOOL_RESULT_BYTES = 6144;

export function sanitizeErrorMessage(raw: string): string {
  let cleaned = raw.replace(/\/[a-zA-Z0-9_\-\.\/]+(?:\.db|\.sqlite|\.ts|\.js|\.json)/g, '[path]');
  cleaned = cleaned.replace(/ERR_SQLITE_[A-Z_]+/g, 'storage_error');
  return cleaned;
}

export function formatToolContentText(
  contentData: any,
  details: Record<string, any> = {},
  isError: boolean = false,
): string {
  if (typeof contentData === 'string') {
    return contentData;
  }
  const pretty = JSON.stringify(contentData, null, 2);
  const prettyLen = Buffer.byteLength(
    JSON.stringify({ content: [{ type: 'text', text: pretty }], details, isError }),
    'utf8',
  );
  if (prettyLen <= MAX_TOOL_RESULT_BYTES) {
    return pretty;
  }
  return JSON.stringify(contentData);
}

export function measureSerializedToolResult(
  contentData: any,
  details: Record<string, any> = {},
  isError: boolean = false,
): number {
  const text = formatToolContentText(contentData, details, isError);
  const result: AgentToolResult = {
    content: [{ type: 'text', text }],
    details,
    isError,
  };
  return Buffer.byteLength(JSON.stringify(result), 'utf8');
}

export function formatSuccessResult(
  contentData: any,
  details: Record<string, any> = {},
): AgentToolResult {
  const text = formatToolContentText(contentData, details, false);
  const result: AgentToolResult = {
    content: [{ type: 'text', text }],
    details,
    isError: false,
  };

  const serialized = JSON.stringify(result);
  const byteLen = Buffer.byteLength(serialized, 'utf8');

  if (byteLen <= MAX_TOOL_RESULT_BYTES) {
    return result;
  }

  // If plain string, slice code points safely with isError: false
  if (typeof contentData === 'string') {
    const codePoints = Array.from(contentData);
    let truncatedText = '';
    for (const cp of codePoints) {
      const candidate = truncatedText + cp + '\n... [truncated to fit budget]';
      const trialResult: AgentToolResult = {
        content: [{ type: 'text', text: candidate }],
        details: { ...details, truncated: true },
        isError: false,
      };
      if (Buffer.byteLength(JSON.stringify(trialResult), 'utf8') > MAX_TOOL_RESULT_BYTES) {
        break;
      }
      truncatedText += cp;
    }
    truncatedText += '\n... [truncated to fit budget]';
    return {
      content: [{ type: 'text', text: truncatedText }],
      details: { ...details, truncated: true },
      isError: false,
    };
  }

  // For structured objects, callers MUST structurally budget during admission.
  // Never slice raw JSON strings into broken syntax!
  return result;
}

export function formatErrorResult(
  errorMessage: string,
  details: Record<string, any> = {},
): AgentToolResult {
  const safeMessage = sanitizeErrorMessage(errorMessage);
  const result: AgentToolResult = {
    content: [{ type: 'text', text: `Error: ${safeMessage}` }],
    details: { ...details, error: safeMessage },
    isError: true,
  };

  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_TOOL_RESULT_BYTES) {
    const compactText = `Error: ${safeMessage.slice(0, 500)}... [error truncated]`;
    return {
      content: [{ type: 'text', text: compactText }],
      details: { isError: true, error: safeMessage.slice(0, 500) },
      isError: true,
    };
  }

  return result;
}
