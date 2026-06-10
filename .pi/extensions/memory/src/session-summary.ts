import { redactSecrets } from './security.js';

type ContentBlock = {
  type?: string;
  text?: string;
  name?: string;
  arguments?: Record<string, unknown>;
};

type SessionEntry = {
  type?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
};

export type SessionSummaryEvidence = {
  reason: string;
  promptCount: number;
  durableMemories: Array<{ kind: string; title?: string | null; summary?: string | null }>;
  decisions: Array<{ title?: string | null; summary?: string | null }>;
  todos: Array<{ title?: string | null; summary?: string | null }>;
  progress: Array<{ title?: string | null; summary?: string | null }>;
  validations: Array<string | null | undefined>;
  filesTouched?: string[];
  semanticSummaryDisabled?: boolean;
};

function extractTextParts(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  const textParts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const block = part as ContentBlock;
    if (block.type === 'text' && typeof block.text === 'string') textParts.push(block.text);
  }
  return textParts;
}

function extractToolCallLines(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const lines: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const block = part as ContentBlock;
    if (block.type !== 'toolCall' || typeof block.name !== 'string') continue;
    lines.push(`tool ${block.name} called with args ${JSON.stringify(block.arguments ?? {})}`);
  }
  return lines;
}

export function extractConversationFacts(entries: SessionEntry[]): { commands: string[]; files: string[] } {
  const commands = new Set<string>();
  const files = new Set<string>();
  for (const entry of entries) {
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const block = part as ContentBlock;
      if (block.type !== 'toolCall' || typeof block.name !== 'string') continue;
      const args = block.arguments ?? {};
      if (block.name === 'bash' && typeof args.command === 'string') commands.add(args.command.slice(0, 200));
      for (const key of ['path', 'file', 'target_file']) {
        if (typeof args[key] === 'string') files.add(args[key] as string);
      }
    }
  }
  return { commands: [...commands], files: [...files] };
}

export function buildConversationText(entries: SessionEntry[], maxChars = 24000): string {
  const sections: string[] = [];
  for (const entry of entries) {
    if (entry.type !== 'message' || !entry.message?.role) continue;
    const role = entry.message.role;
    if (!['user', 'assistant', 'system'].includes(role)) continue;
    const lines: string[] = [];
    const text = extractTextParts(entry.message.content).join('\n').trim();
    if (text) lines.push(`${role}: ${text}`);
    if (role === 'assistant') lines.push(...extractToolCallLines(entry.message.content));
    if (lines.length) sections.push(lines.join('\n'));
  }
  const full = redactSecrets(sections.join('\n\n')).text;
  if (full.length <= maxChars) return full;
  return `${full.slice(0, Math.floor(maxChars * 0.4))}\n\n[...conversation truncated...]\n\n${full.slice(-Math.floor(maxChars * 0.6))}`;
}

export function buildSemanticSessionSummaryPrompt(conversationText: string, evidence: SessionSummaryEvidence): string {
  const memoryLines = evidence.durableMemories
    .map((m) => `- ${m.kind}: ${m.title ?? m.summary ?? 'untitled'}`)
    .join('\n') || '- none';

  return [
    'create a durable memory session summary for a software development agent.',
    'write in english lowercase only.',
    'do not include secrets, tokens, passwords, private keys, or long raw logs.',
    'use the exact headings below so the summary is useful for sdd/tdd resume:',
    '',
    'summary:',
    '  what changed:',
    '  decisions made:',
    '  progress:',
    '  validations:',
    '  open todos:',
    '',
    'learned:',
    '  reusable learnings:',
    '',
    'memory candidates:',
    '  decisions:',
    '  learnings:',
    '  todos:',
    '',
    'prefer semantic facts from the conversation over mechanical statistics. mention validations only when they actually happened. if none happened, say none recorded.',
    '',
    '<durable_memories_recorded_this_session>',
    memoryLines,
    '</durable_memories_recorded_this_session>',
    '',
    '<conversation>',
    conversationText,
    '</conversation>',
  ].join('\n');
}

export function buildHeuristicSessionSummary(evidence: SessionSummaryEvidence): { summary: string; learned: string } {
  const memoryLines = evidence.durableMemories.map((m) => `- ${m.kind}: ${m.title ?? m.summary ?? 'untitled'}`).join('\n') || '- none';
  const summary = [
    'summary:',
    `  what changed: memory session closed automatically on ${evidence.reason}. captured ${evidence.promptCount} prompt(s) and ${evidence.durableMemories.length} durable memory item(s) during this session. ${evidence.semanticSummaryDisabled ? 'semantic shutdown summary disabled by configuration.' : 'semantic model summary was unavailable.'}`,
    `  decisions made: ${evidence.decisions.length ? evidence.decisions.map((m) => m.title ?? m.summary).join('; ') : 'none recorded as durable memories'}.`,
    `  progress: ${evidence.progress.length ? evidence.progress.map((m) => m.title ?? m.summary).join('; ') : 'no progress memories recorded'}.`,
    `  validations: ${evidence.validations.length ? evidence.validations.join('; ') : 'no validation command memory recorded'}.`,
    `  open todos: ${evidence.todos.length ? evidence.todos.map((m) => m.title ?? m.summary).join('; ') : 'none recorded as durable memories'}.`,
    `  files touched: ${evidence.filesTouched?.length ? evidence.filesTouched.join('; ') : 'none detected'}.`,
    '',
    'memory candidates:',
    memoryLines,
  ].join('\n').toLowerCase();
  const learned = [
    'reusable learnings:',
    evidence.durableMemories.filter((m) => m.kind === 'learning').map((m) => `- ${m.title ?? m.summary}`).join('\n') || '- none recorded as durable memories',
  ].join('\n').toLowerCase();
  return { summary, learned };
}

export async function buildSemanticSessionSummary(ctx: any, evidence: SessionSummaryEvidence): Promise<{ summary: string; learned: string } | null> {
  const entries = ctx?.sessionManager?.getBranch?.() ?? ctx?.sessionManager?.getEntries?.() ?? [];
  const conversationText = buildConversationText(entries);
  if (!conversationText.trim() || !ctx?.model || !ctx?.modelRegistry?.getApiKeyAndHeaders) return null;

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
  if (!auth?.ok || !auth.apiKey) return null;

  const moduleName = '@earendil-works/pi-ai';
  const { complete } = await import(moduleName) as any;
  const response = await complete(
    ctx.model,
    { messages: [{ role: 'user', content: [{ type: 'text', text: buildSemanticSessionSummaryPrompt(conversationText, evidence) }], timestamp: Date.now() }] },
    { apiKey: auth.apiKey, headers: auth.headers, maxTokens: 2048 },
  );
  const text = (response.content ?? [])
    .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
    .map((c: any) => c.text)
    .join('\n')
    .trim()
    .toLowerCase();
  if (!text) return null;

  const learnedIndex = text.indexOf('\nlearned:');
  if (learnedIndex === -1) return { summary: text, learned: 'reusable learnings:\n- none extracted' };
  return {
    summary: text.slice(0, learnedIndex).trim(),
    learned: text.slice(learnedIndex + 1).trim(),
  };
}
