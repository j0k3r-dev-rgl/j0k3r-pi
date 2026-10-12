import { COOLDOWN_DURATION_MS, MAX_TRANSIENT_FAILURES } from './config.ts';
import type { CandidateQuotaStatus, ModelCandidateId } from './types.ts';

export type ErrorClassificationType =
  | 'ignored'
  | 'success'
  | 'transient_retry'
  | 'cooldown_failover'
  | 'immediate_failover'
  | 'fatal_proxy_key';

export interface ClassificationAction {
  type: ErrorClassificationType;
  consecutiveErrors?: number;
  retryDelayMs?: number;
  isHardQuota?: boolean;
  shouldAbortRetry?: boolean;
  shouldHalt?: boolean;
  excludedUntilRestored?: boolean;
  reason?: string;
}

export class ErrorClassifier {
  private activeOrchestratorSessionId: string;
  private consecutiveErrors = new Map<ModelCandidateId, number>();
  private cooldowns = new Map<ModelCandidateId, number>();
  private excludedUntilRestored = new Map<
    ModelCandidateId,
    { reason: 'auth_revoked' | 'model_not_found'; timestamp: number }
  >();

  constructor(activeOrchestratorSessionId: string) {
    this.activeOrchestratorSessionId = activeOrchestratorSessionId;
  }

  setSessionId(sessionId: string): void {
    this.activeOrchestratorSessionId = sessionId;
  }

  getConsecutiveErrors(candidateId: ModelCandidateId): number {
    return this.consecutiveErrors.get(candidateId) ?? 0;
  }

  isInCooldown(candidateId: ModelCandidateId): boolean {
    const until = this.cooldowns.get(candidateId);
    if (!until) return false;
    if (Date.now() >= until) {
      this.cooldowns.delete(candidateId);
      return false;
    }
    return true;
  }

  isCandidateExcluded(candidateId: ModelCandidateId): boolean {
    return this.excludedUntilRestored.has(candidateId);
  }

  getExcludedCandidates(): Set<ModelCandidateId> {
    return new Set(this.excludedUntilRestored.keys());
  }

  recordPositiveRestorationEvidence(candidateId: ModelCandidateId): void {
    this.excludedUntilRestored.delete(candidateId);
    this.cooldowns.delete(candidateId);
    this.consecutiveErrors.set(candidateId, 0);
  }

  getCooldowns(): Map<ModelCandidateId, number> {
    // Purge expired
    const now = Date.now();
    for (const [id, until] of this.cooldowns.entries()) {
      if (now >= until) {
        this.cooldowns.delete(id);
      }
    }
    return new Map(this.cooldowns);
  }

  setCooldown(candidateId: ModelCandidateId, durationMs = COOLDOWN_DURATION_MS): void {
    this.cooldowns.set(candidateId, Date.now() + durationMs);
  }

  clearCooldown(candidateId: ModelCandidateId): void {
    this.cooldowns.delete(candidateId);
  }

  handleMessageEnd(
    message: any,
    candidateId: ModelCandidateId,
    ctx: { mode?: string; sessionId?: string },
    options?: { freshQuotaStatus?: CandidateQuotaStatus },
  ): ClassificationAction {
    // 1. Strict filter: TUI mode and active orchestrator session only
    if (ctx.mode !== 'tui' || ctx.sessionId !== this.activeOrchestratorSessionId) {
      return { type: 'ignored' };
    }

    // 2. Only assistant role messages represent provider responses
    if (message?.role !== 'assistant') {
      return { type: 'ignored' };
    }

    // 3. Normal / successful response resets error counter
    if (message?.stopReason !== 'error' && message?.stopReason !== 'aborted') {
      this.consecutiveErrors.set(candidateId, 0);
      return { type: 'success' };
    }

    if (message?.stopReason === 'aborted') {
      return { type: 'ignored' };
    }

    // 4. Inspect error message
    const rawError = String(message?.errorMessage ?? message?.error ?? '');
    const lower = rawError.toLowerCase();

    // Check fatal proxy key error (HTTP 401 with "Invalid API key")
    if (lower.includes('invalid api key') || (lower.includes('401') && lower.includes('api key'))) {
      return {
        type: 'fatal_proxy_key',
        shouldHalt: true,
        reason: 'Fatal proxy API key error. Check CLIPROXYAPI_API_KEY configuration.',
      };
    }

    // Check account OAuth revocation (HTTP 401/403 specific to account OAuth grant)
    const isAuthRevoked =
      lower.includes('token_revoked') ||
      lower.includes('invalid_grant') ||
      lower.includes('unauthorized_client') ||
      lower.includes('invalid_token') ||
      (lower.includes('oauth') && (lower.includes('revoked') || lower.includes('401') || lower.includes('403'))) ||
      (/\b(401|403)\b/.test(lower) && !lower.includes('api key'));

    if (isAuthRevoked) {
      this.excludedUntilRestored.set(candidateId, {
        reason: 'auth_revoked',
        timestamp: Date.now(),
      });
      return {
        type: 'immediate_failover',
        isHardQuota: false,
        shouldAbortRetry: true,
        excludedUntilRestored: true,
        reason: 'Account OAuth credential revoked or unauthorized; excluding candidate until positive restoration evidence.',
      };
    }

    // Check model not found (HTTP 400 with model_not_found)
    if (lower.includes('model_not_found') || lower.includes('unknown provider for model')) {
      this.excludedUntilRestored.set(candidateId, {
        reason: 'model_not_found',
        timestamp: Date.now(),
      });
      return {
        type: 'immediate_failover',
        isHardQuota: false,
        shouldAbortRetry: true,
        excludedUntilRestored: true,
        reason: 'Model not found on provider account; excluding candidate until positive restoration evidence.',
      };
    }

    // Check hard quota exhaustion (literal OR HTTP 429 where fresh quota check confirms exhaustion)
    const isLiteralHardQuota =
      lower.includes('insufficient_quota') ||
      lower.includes('quota exceeded') ||
      lower.includes('out of budget') ||
      lower.includes('quota_exhausted');

    const isRateLimit429 = /\b429\b|rate.?limit|too many requests/i.test(rawError);
    const isQuotaConfirmedExhausted =
      isRateLimit429 &&
      options?.freshQuotaStatus !== undefined &&
      options.freshQuotaStatus.isEligible === false &&
      !options.freshQuotaStatus.isUnknown;

    if (isLiteralHardQuota || isQuotaConfirmedExhausted) {
      this.setCooldown(candidateId, COOLDOWN_DURATION_MS);
      return {
        type: 'immediate_failover',
        isHardQuota: true,
        shouldAbortRetry: true,
        reason: 'Immediate hard quota exhaustion detected; canceling retry sleep for instant failover.',
      };
    }

    // Check transient error (5xx, 429 RPM throttling, overloaded)
    const current = (this.consecutiveErrors.get(candidateId) ?? 0) + 1;
    this.consecutiveErrors.set(candidateId, current);

    if (current >= MAX_TRANSIENT_FAILURES) {
      this.setCooldown(candidateId, COOLDOWN_DURATION_MS);
      return {
        type: 'cooldown_failover',
        consecutiveErrors: current,
        shouldAbortRetry: true,
        reason: `3 consecutive transient provider errors on ${candidateId}; putting into 15m cooldown and failing over.`,
      };
    }

    // Standalone progressive retry delay: 1s, 2s capped at 30s (with Retry-After bounded)
    const retryAfterMatch = rawError.match(/retry-after:\s*(\d+)/i);
    const retryAfterMs = retryAfterMatch ? Number.parseInt(retryAfterMatch[1]!, 10) * 1000 : 0;
    const baseDelayMs = Math.min(1000 * Math.pow(2, current - 1), 30000);
    const retryDelayMs = Math.min(Math.max(baseDelayMs, retryAfterMs), 30000);
    return {
      type: 'transient_retry',
      consecutiveErrors: current,
      retryDelayMs,
      shouldAbortRetry: false,
      reason: `Transient provider error (attempt ${current}/${MAX_TRANSIENT_FAILURES}). Retrying in ${retryDelayMs}ms.`,
    };
  }
}
