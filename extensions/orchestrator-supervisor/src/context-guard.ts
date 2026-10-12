import { CONTEXT_RESERVE_PERCENT, MODEL_CANDIDATES } from './config.ts';
import type { ModelCandidateId } from './types.ts';

export interface ContextUsageMetrics {
  tokens: number;
  contextWindow: number;
  percent: number;
  isFallback: boolean;
  isReserveExceeded: boolean;
}

export interface FallbackTokenDetails {
  systemPrompt?: string;
  compactionSummary?: string;
  entriesChars?: number;
  imageBlockCount?: number;
}

export class ContextGuard {
  private pendingBatchToolOutputBudget = 0;

  resetBatchBudget(): void {
    this.pendingBatchToolOutputBudget = 0;
  }

  getPendingBatchBudget(): number {
    return this.pendingBatchToolOutputBudget;
  }

  getProviderContextWindowCap(modelId: string, reportedWindow?: number): number {
    const candidate = MODEL_CANDIDATES.find((c) => c.id === modelId);
    if (candidate) return candidate.contextWindowCap;
    const lower = String(modelId || '').toLowerCase();
    if (lower.includes('gemini')) return 370000;
    if (lower.includes('claude')) return 200000;
    if (lower.includes('gpt') || lower.includes('codex') || lower.includes('sol') || lower.includes('astra')) return 272000;
    return reportedWindow && Number.isFinite(reportedWindow) ? Math.max(reportedWindow, 128000) : 272000;
  }

  extractFallbackDetails(ctx: any): FallbackTokenDetails {
    const systemPrompt =
      typeof ctx?.getSystemPrompt === 'function' ? String(ctx.getSystemPrompt() ?? '') : '';
    const branch: any[] =
      typeof ctx?.sessionManager?.getBranch === 'function'
        ? (ctx.sessionManager.getBranch() ?? [])
        : [];

    let latestCompactionIndex = -1;
    let compactionSummary = '';
    let firstKeptEntryId: string | null = null;

    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry?.type === 'compaction') {
        latestCompactionIndex = i;
        compactionSummary = typeof entry.summary === 'string' ? entry.summary : '';
        firstKeptEntryId = entry.firstKeptEntryId ?? null;
        break;
      }
    }

    let startIndex = 0;
    if (latestCompactionIndex >= 0) {
      if (firstKeptEntryId !== null) {
        const foundIdx = branch.findIndex((e) => e?.id === firstKeptEntryId);
        startIndex = foundIdx >= 0 ? foundIdx : latestCompactionIndex + 1;
      } else {
        startIndex = latestCompactionIndex + 1;
      }
    }

    let entriesChars = 0;
    let imageBlockCount = 0;

    const inspectContent = (content: any) => {
      if (typeof content === 'string') {
        entriesChars += content.length;
        return;
      }
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== 'object') continue;
          if (block.type === 'text' && typeof block.text === 'string') {
            entriesChars += block.text.length;
          } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
            entriesChars += block.thinking.length;
          } else if (block.type === 'toolCall') {
            const nameLen = typeof block.name === 'string' ? block.name.length : 0;
            const argsLen = block.arguments ? JSON.stringify(block.arguments).length : 0;
            entriesChars += nameLen + argsLen;
          } else if (block.type === 'image') {
            imageBlockCount++;
          }
        }
      }
    };

    for (let i = startIndex; i < branch.length; i++) {
      if (i === latestCompactionIndex) continue;
      const entry = branch[i];
      if (!entry || typeof entry !== 'object') continue;

      if (entry.message && typeof entry.message === 'object') {
        inspectContent(entry.message.content);
        if (typeof entry.message.command === 'string') entriesChars += entry.message.command.length;
        if (typeof entry.message.output === 'string') entriesChars += entry.message.output.length;
        if (typeof entry.message.summary === 'string') entriesChars += entry.message.summary.length;
      } else {
        inspectContent(entry.content);
        if (typeof entry.summary === 'string') entriesChars += entry.summary.length;
      }
    }

    return {
      systemPrompt,
      compactionSummary,
      entriesChars,
      imageBlockCount,
    };
  }

  evaluateUsage(
    rawUsage: { tokens: number | null; contextWindow: number; percent: number | null },
    activeModelId: string,
    fallbackDetails?: FallbackTokenDetails,
  ): ContextUsageMetrics {
    const providerCap = this.getProviderContextWindowCap(activeModelId, rawUsage.contextWindow);
    const effectiveWindow = Math.min(rawUsage.contextWindow || providerCap, providerCap);

    if (rawUsage.tokens !== null && typeof rawUsage.tokens === 'number') {
      const tokens = rawUsage.tokens;
      const percent = (tokens / effectiveWindow) * 100;
      const isReserveExceeded = percent >= CONTEXT_RESERVE_PERCENT;
      return {
        tokens,
        contextWindow: effectiveWindow,
        percent,
        isFallback: false,
        isReserveExceeded,
      };
    }

    // Post-compaction null fallback estimation heuristic: Math.ceil(chars / 4)
    const systemPromptChars =
      fallbackDetails?.systemPrompt !== undefined ? fallbackDetails.systemPrompt.length : 2000;
    const compactionSummaryChars = fallbackDetails?.compactionSummary
      ? fallbackDetails.compactionSummary.length
      : 0;
    const entriesChars = fallbackDetails?.entriesChars ?? 0;
    const imageChars = (fallbackDetails?.imageBlockCount ?? 0) * 4800; // 4800 chars (1200 tokens) per image
    const totalChars = systemPromptChars + compactionSummaryChars + entriesChars + imageChars;

    const estimatedTokens = Math.max(1, Math.ceil(totalChars / 4));
    const percent = (estimatedTokens / effectiveWindow) * 100;
    const isReserveExceeded = percent >= CONTEXT_RESERVE_PERCENT;

    return {
      tokens: estimatedTokens,
      contextWindow: effectiveWindow,
      percent,
      isFallback: true,
      isReserveExceeded,
    };
  }

  estimateToolOutputBudgetTokens(toolName: string): number {
    if (toolName.startsWith('memory_')) {
      return 1536; // <= 6144 bytes (~1536 tokens)
    }
    if (['read', 'bash', 'grep', 'find', 'ls'].includes(toolName)) {
      return 12800; // DEFAULT_MAX_BYTES = 50 KiB (~12,800 tokens at chars/4)
    }
    // Unknown tools fail closed at max budget
    return 12800;
  }

  interceptToolCall(
    toolCall: any,
    currentEstimatedTokens: number,
    contextWindow: number,
  ): { block: boolean; reason: string; terminate: boolean } | null {
    const toolName =
      typeof toolCall?.toolName === 'string'
        ? toolCall.toolName
        : typeof toolCall?.name === 'string'
          ? toolCall.name
          : 'unknown';
    const estimatedOutputBudget = this.estimateToolOutputBudgetTokens(toolName);
    const candidateBatchBudget = this.pendingBatchToolOutputBudget + estimatedOutputBudget;
    const projectedTokens = currentEstimatedTokens + candidateBatchBudget;
    const ceilingTokens = Math.floor((CONTEXT_RESERVE_PERCENT / 100) * contextWindow);

    if (projectedTokens >= ceilingTokens) {
      return {
        block: true,
        terminate: true,
        reason: `Context reserve ceiling (90%) reached; blocking remaining tool calls to allow clean settlement and session rotation. Por favor, guarda un resumen del estado actual y lo pendiente usando memory_save (type: 'session_summary', title: 'Resumen de continuación'), y a continuación invoca supervisor_rotate({ memory_id: <id_guardado>, next_step: '<siguiente_paso>' }) para rotar inmediatamente a una sesión limpia y continuar la tarea automáticamente. (projected ${projectedTokens} >= ceiling ${ceilingTokens})`,
      };
    }

    this.pendingBatchToolOutputBudget = candidateBatchBudget;
    return null;
  }
}
