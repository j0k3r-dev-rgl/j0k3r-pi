import { quietSync } from './syncCommon.js';

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((entry: any) => entry?.text ?? JSON.stringify(entry)).join('\n');
  return content ? JSON.stringify(content) : '';
}

export function isRelevantOpenSpecToolResult(event: { input?: unknown; content?: unknown; details?: unknown }): boolean {
  const haystack = `${stringifyContent(event.input)}\n${stringifyContent(event.content)}\n${stringifyContent(event.details)}`;
  return /openspec[\\/]changes[\\/]|openspec[\\/]workflows\.json|openspec[\\/].*\.md/i.test(haystack);
}

export async function syncOnToolResult(event: { input?: unknown; content?: unknown; details?: unknown }, ctx: { cwd: string; ui?: { notify?: (message: string, level?: string) => void } }): Promise<void> {
  if (!isRelevantOpenSpecToolResult(event)) return;
  await quietSync(ctx);
}
