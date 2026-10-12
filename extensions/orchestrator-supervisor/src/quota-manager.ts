import {
  MODEL_CANDIDATES,
  CODEX_QUOTA_THRESHOLD,
  QUOTA_CACHE_TTL_MS,
} from './config.ts';
import type {
  ModelCandidate,
  ModelCandidateId,
  CandidateQuotaStatus,
  WhamQuotaResult,
  GeminiQuotaResult,
} from './types.ts';

export interface QuotaManagerOptions {
  baseUrl?: string;
  retryDelayMs?: number;
  maxRetries?: number;
}

interface AccountAuthMapping {
  authIndex: number;
  projectId?: string;
}

export class QuotaManager {
  readonly baseUrl: string;
  readonly retryDelayMs: number;
  readonly maxRetries: number;

  private accountMappings = new Map<string, AccountAuthMapping>(); // prefix -> mapping
  private ambiguousPrefixes = new Set<string>();
  private whamCache = new Map<string, WhamQuotaResult>(); // prefix -> result
  private geminiCache = new Map<string, GeminiQuotaResult>(); // prefix -> result
  private trackedResetAt = new Map<'main' | 'second', number>(); // prefix -> unix seconds
  private staleQuotaCandidates = new Set<ModelCandidateId>();

  constructor(options?: QuotaManagerOptions) {
    this.baseUrl = (options?.baseUrl || process.env.CLIPROXYAPI_BASE_URL || 'http://127.0.0.1:8317').replace(/\/+$/, '');
    this.retryDelayMs = options?.retryDelayMs ?? 1000;
    this.maxRetries = options?.maxRetries ?? 3;
  }

  clearCache(): void {
    this.whamCache.clear();
    this.geminiCache.clear();
  }

  hasResetAtExpired(prefix: 'main' | 'second', nowSec = Math.floor(Date.now() / 1000)): boolean {
    const resetAt = this.trackedResetAt.get(prefix);
    if (resetAt === undefined) return false;
    return nowSec >= resetAt;
  }

  isQuotaStale(candidateId: ModelCandidateId, nowMs = Date.now()): boolean {
    if (this.staleQuotaCandidates.has(candidateId)) return true;
    const candidate = MODEL_CANDIDATES.find((c) => c.id === candidateId);
    if (!candidate) return false;
    if (candidate.prefix === 'main' || candidate.prefix === 'second') {
      const cached = this.whamCache.get(candidate.prefix);
      if (!cached) return false;
      return nowMs - cached.cachedAt >= QUOTA_CACHE_TTL_MS || this.hasResetAtExpired(candidate.prefix, Math.floor(nowMs / 1000));
    }
    const cached = this.geminiCache.get(candidate.prefix);
    if (!cached) return false;
    return nowMs - cached.cachedAt >= QUOTA_CACHE_TTL_MS;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private async fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
    const key = (process.env.CLIPROXYAPI_MANAGEMENT_KEY || process.env.CLIPROXYAPI_API_KEY || '').trim();
    const headers = Object.assign(
      {},
      key ? { Authorization: `Bearer ${key}` } : {},
      init?.headers,
    );
    const mergedInit: RequestInit = { ...init, headers };

    let lastError: any;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(url, mergedInit);
        if (res.ok) {
          return res;
        }
        if (attempt < this.maxRetries) {
          const delay = Math.min(this.retryDelayMs * Math.pow(2, attempt - 1), 10000);
          await this.sleep(delay);
          continue;
        }
        return res;
      } catch (err) {
        lastError = err;
        if (attempt < this.maxRetries) {
          const delay = Math.min(this.retryDelayMs * Math.pow(2, attempt - 1), 10000);
          await this.sleep(delay);
        }
      }
    }
    throw lastError || new Error(`Fetch failed for ${url}`);
  }

  async resolvePrefixMapping(prefix: 'main' | 'second' | 'j0k3r'): Promise<AccountAuthMapping | undefined> {
    if (this.ambiguousPrefixes.has(prefix)) {
      return undefined;
    }
    if (this.accountMappings.has(prefix)) {
      return this.accountMappings.get(prefix);
    }

    try {
      const authFilesRes = await this.fetchWithRetry(`${this.baseUrl}/v0/management/auth-files`);
      if (!authFilesRes.ok) return undefined;
      const authFilesData = await authFilesRes.json();
      const files: any[] = authFilesData.files || [];

      let matchedMapping: AccountAuthMapping | undefined;

      for (const file of files) {
        if (file.disabled || !file.name || file.auth_index === undefined) continue;

        const modelsRes = await this.fetchWithRetry(
          `${this.baseUrl}/v0/management/auth-files/models?name=${encodeURIComponent(file.name)}`,
        );
        if (!modelsRes.ok) continue;
        const modelsData = await modelsRes.json();
        const models: any[] = modelsData.models || [];

        for (const model of models) {
          const modelId: string = model.id || '';
          if (modelId.startsWith(`${prefix}/`)) {
            if (matchedMapping && matchedMapping.authIndex !== file.auth_index) {
              // Ambiguous prefix shared across distinct active auth_index credentials
              this.ambiguousPrefixes.add(prefix);
              this.accountMappings.delete(prefix);
              return undefined;
            }
            matchedMapping = {
              authIndex: file.auth_index,
              projectId: file.project_id || 'aicode-consumers',
            };
          }
        }
      }

      if (matchedMapping) {
        this.accountMappings.set(prefix, matchedMapping);
        return matchedMapping;
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  async fetchWhamQuota(
    prefix: 'main' | 'second',
    options?: { forceFresh?: boolean },
  ): Promise<WhamQuotaResult | undefined> {
    const candidateId: ModelCandidateId =
      prefix === 'main' ? 'cliproxyapi/main/gpt-6.1-sol' : 'cliproxyapi/second/gpt-6.1-sol';
    const cached = this.whamCache.get(prefix);
    const resetExpired = this.hasResetAtExpired(prefix);

    if (!options?.forceFresh && !resetExpired && cached && Date.now() - cached.cachedAt < QUOTA_CACHE_TTL_MS) {
      return cached;
    }

    const mapping = await this.resolvePrefixMapping(prefix);
    if (!mapping) {
      if (cached) this.staleQuotaCandidates.add(candidateId);
      return undefined;
    }

    try {
      const res = await this.fetchWithRetry(`${this.baseUrl}/v0/management/api-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_index: mapping.authIndex,
          method: 'GET',
          url: 'https://chatgpt.com/backend-api/wham/usage',
          header: {
            Authorization: 'Bearer $TOKEN$',
            'Content-Type': 'application/json',
            'User-Agent': 'codex-tui/0.149.1 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.149.1)',
          },
        }),
      });

      if (!res.ok) {
        if (cached) this.staleQuotaCandidates.add(candidateId);
        return undefined;
      }
      const rawData = await res.json();
      let data = rawData;
      if (typeof rawData.body === 'string') {
        try {
          data = JSON.parse(rawData.body);
        } catch {
          data = rawData;
        }
      }

      const rateLimit = data.rate_limit;
      if (!rateLimit || !rateLimit.primary_window || !rateLimit.secondary_window) {
        if (cached) this.staleQuotaCandidates.add(candidateId);
        return undefined;
      }

      const primaryWindowSec = Number(rateLimit.primary_window.limit_window_seconds);
      const secondaryWindowSec = Number(rateLimit.secondary_window.limit_window_seconds);
      const primaryUsed = Number(rateLimit.primary_window.used_percent);
      const secondaryUsed = Number(rateLimit.secondary_window.used_percent);
      const primaryReset = Number(rateLimit.primary_window.reset_at);
      const secondaryReset = Number(rateLimit.secondary_window.reset_at);

      if (
        !Number.isFinite(primaryWindowSec) ||
        !Number.isFinite(secondaryWindowSec) ||
        primaryWindowSec !== 18000 ||
        secondaryWindowSec !== 604800 ||
        !Number.isFinite(primaryUsed) ||
        !Number.isFinite(secondaryUsed) ||
        !Number.isFinite(primaryReset) ||
        !Number.isFinite(secondaryReset)
      ) {
        if (cached) this.staleQuotaCandidates.add(candidateId);
        return undefined;
      }

      const result: WhamQuotaResult = {
        primary_window: {
          limit_window_seconds: primaryWindowSec,
          used_percent: primaryUsed,
          reset_at: primaryReset,
        },
        secondary_window: {
          limit_window_seconds: secondaryWindowSec,
          used_percent: secondaryUsed,
          reset_at: secondaryReset,
        },
        allowed: rateLimit.allowed !== false,
        limit_reached: rateLimit.limit_reached === true,
        cachedAt: Date.now(),
      };

      if (primaryUsed >= CODEX_QUOTA_THRESHOLD && secondaryUsed < CODEX_QUOTA_THRESHOLD) {
        this.trackedResetAt.set(prefix, primaryReset);
      } else if (secondaryUsed >= CODEX_QUOTA_THRESHOLD && primaryUsed < CODEX_QUOTA_THRESHOLD) {
        this.trackedResetAt.set(prefix, secondaryReset);
      } else {
        this.trackedResetAt.set(prefix, Math.min(primaryReset, secondaryReset));
      }

      this.staleQuotaCandidates.delete(candidateId);
      this.whamCache.set(prefix, result);
      return result;
    } catch {
      if (cached) this.staleQuotaCandidates.add(candidateId);
      return undefined;
    }
  }

  async fetchGeminiQuota(
    prefix = 'j0k3r',
    options?: { forceFresh?: boolean },
  ): Promise<GeminiQuotaResult | undefined> {
    const candidateId: ModelCandidateId = 'cliproxyapi/j0k3r/gemini-3.8-flash-high';
    const cached = this.geminiCache.get(prefix);
    if (!options?.forceFresh && cached && Date.now() - cached.cachedAt < QUOTA_CACHE_TTL_MS) {
      return cached;
    }

    const mapping = await this.resolvePrefixMapping('j0k3r');
    if (!mapping) {
      if (cached) this.staleQuotaCandidates.add(candidateId);
      return undefined;
    }

    try {
      const res = await this.fetchWithRetry(`${this.baseUrl}/v0/management/api-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_index: mapping.authIndex,
          method: 'POST',
          url: 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
          header: {
            Authorization: 'Bearer $TOKEN$',
            'Content-Type': 'application/json',
            'User-Agent': 'antigravity/cli/1.0.13 (aidev_client; os_type=darwin; arch=arm64)',
          },
          data: JSON.stringify({ project: mapping.projectId || 'aicode-consumers' }),
        }),
      });

      if (!res.ok) {
        if (cached) this.staleQuotaCandidates.add(candidateId);
        return undefined;
      }
      const rawData = await res.json();
      let data = rawData;
      if (typeof rawData.body === 'string') {
        try {
          data = JSON.parse(rawData.body);
        } catch {
          data = rawData;
        }
      }

      const groups = data.groups || [];
      const geminiGroup = groups.find((g: any) =>
        /gemini|google models/i.test(`${g.displayName ?? ''} ${g.name ?? ''}`),
      );

      const rawBuckets: any[] = geminiGroup?.buckets || [];
      const buckets: Array<{ window?: string; remainingFraction: number; resetTime?: string }> = [];
      for (const b of rawBuckets) {
        const rem = Number(b.remainingFraction);
        if (!Number.isFinite(rem)) {
          if (cached) this.staleQuotaCandidates.add(candidateId);
          return undefined;
        }
        buckets.push({
          window: b.window,
          remainingFraction: rem,
          resetTime: b.resetTime,
        });
      }

      const result: GeminiQuotaResult = {
        buckets,
        cachedAt: Date.now(),
      };

      this.staleQuotaCandidates.delete(candidateId);
      this.geminiCache.set(prefix, result);
      return result;
    } catch {
      if (cached) this.staleQuotaCandidates.add(candidateId);
      return undefined;
    }
  }

  async checkCandidateStatus(
    candidate: ModelCandidate,
    cooldowns?: Map<ModelCandidateId, number>,
    options?: { forceFresh?: boolean; excluded?: Set<ModelCandidateId> },
  ): Promise<CandidateQuotaStatus> {
    // 0. Check permanent exclusion until positive restoration evidence
    if (options?.excluded && options.excluded.has(candidate.id)) {
      return {
        candidateId: candidate.id,
        isEligible: false,
        reason: 'excluded_until_restored',
      };
    }

    // 1. Check cooldown
    if (cooldowns && cooldowns.has(candidate.id)) {
      const until = cooldowns.get(candidate.id)!;
      if (Date.now() < until) {
        return {
          candidateId: candidate.id,
          isEligible: false,
          reason: `in_cooldown (until ${new Date(until).toISOString()})`,
          cooldownUntil: until,
        };
      }
    }

    // 2. Codex models (main, second)
    if (candidate.prefix === 'main' || candidate.prefix === 'second') {
      const wham = await this.fetchWhamQuota(candidate.prefix, { forceFresh: options?.forceFresh });
      if (!wham) {
        return {
          candidateId: candidate.id,
          isEligible: false,
          isUnknown: true,
          reason: 'unverified_quota_fetch_failed',
        };
      }

      if (wham.limit_reached || !wham.allowed) {
        return {
          candidateId: candidate.id,
          isEligible: false,
          whamUsage: wham,
          reason: 'upstream_limit_reached',
        };
      }

      // Mandatory dual-window 95% threshold with strict comparison
      if (wham.primary_window.used_percent >= CODEX_QUOTA_THRESHOLD) {
        return {
          candidateId: candidate.id,
          isEligible: false,
          whamUsage: wham,
          reason: `primary_window_ineligible (>= ${CODEX_QUOTA_THRESHOLD}% policy threshold: ${wham.primary_window.used_percent}%)`,
        };
      }

      if (wham.secondary_window.used_percent >= CODEX_QUOTA_THRESHOLD) {
        return {
          candidateId: candidate.id,
          isEligible: false,
          whamUsage: wham,
          reason: `secondary_window_ineligible (>= ${CODEX_QUOTA_THRESHOLD}% policy threshold: ${wham.secondary_window.used_percent}%)`,
        };
      }

      return {
        candidateId: candidate.id,
        isEligible: true,
        whamUsage: wham,
        reason: 'eligible',
      };
    }

    // 3. Gemini tertiary model (j0k3r)
    if (candidate.prefix === 'j0k3r') {
      const gemini = await this.fetchGeminiQuota('j0k3r', { forceFresh: options?.forceFresh });
      if (!gemini) {
        return {
          candidateId: candidate.id,
          isEligible: false,
          isUnknown: true,
          reason: 'unverified_quota_fetch_failed',
        };
      }

      if (gemini.buckets.length === 0) {
        return {
          candidateId: candidate.id,
          isEligible: false,
          isUnknown: true,
          geminiUsage: gemini,
          reason: 'gemini_quota_window_unknown',
        };
      }

      const exhausted = gemini.buckets.some((b) => b.remainingFraction <= 0.0);
      if (exhausted) {
        return {
          candidateId: candidate.id,
          isEligible: false,
          geminiUsage: gemini,
          reason: 'gemini_bucket_exhausted',
        };
      }

      return {
        candidateId: candidate.id,
        isEligible: true,
        geminiUsage: gemini,
        reason: 'eligible',
      };
    }

    return {
      candidateId: candidate.id,
      isEligible: false,
      reason: 'unknown_candidate_prefix',
    };
  }

  async selectBestCandidate(
    cooldowns?: Map<ModelCandidateId, number>,
    options?: { forceFresh?: boolean; excluded?: Set<ModelCandidateId> },
  ): Promise<{ candidate: ModelCandidate; allUnavailable?: boolean; reason: string }> {
    const forceFresh = options?.forceFresh !== false;
    if (forceFresh) {
      this.clearCache();
    }

    for (const candidate of MODEL_CANDIDATES) {
      const status = await this.checkCandidateStatus(candidate, cooldowns, {
        forceFresh,
        excluded: options?.excluded,
      });
      if (status.isEligible) {
        return { candidate, allUnavailable: false, reason: status.reason };
      }
    }

    // All 3 candidates are exhausted, unverified, excluded, or in cooldown
    return {
      candidate: null as unknown as ModelCandidate,
      allUnavailable: true,
      reason: 'all_candidates_unavailable',
    };
  }

  async checkResetReturn(
    currentCandidateId: ModelCandidateId,
    cooldowns?: Map<ModelCandidateId, number>,
    excluded?: Set<ModelCandidateId>,
  ): Promise<{ shouldReturn: boolean; targetCandidate?: ModelCandidate; reason?: string }> {
    if (currentCandidateId === 'cliproxyapi/main/gpt-6.1-sol') {
      return { shouldReturn: false };
    }

    // Always force a fresh uncached quota fetch when checking reset return
    const mainCandidate = MODEL_CANDIDATES[0]!;
    const mainStatus = await this.checkCandidateStatus(mainCandidate, cooldowns, {
      forceFresh: true,
      excluded,
    });
    if (mainStatus.isEligible) {
      return {
        shouldReturn: true,
        targetCandidate: mainCandidate,
        reason: 'main_quota_reset_eligible',
      };
    }

    // If currently on Gemini and second is eligible, return to second
    if (currentCandidateId === 'cliproxyapi/j0k3r/gemini-3.8-flash-high') {
      const secondCandidate = MODEL_CANDIDATES[1]!;
      const secondStatus = await this.checkCandidateStatus(secondCandidate, cooldowns, {
        forceFresh: true,
        excluded,
      });
      if (secondStatus.isEligible) {
        return {
          shouldReturn: true,
          targetCandidate: secondCandidate,
          reason: 'second_quota_reset_eligible',
        };
      }
    }

    return { shouldReturn: false };
  }
}
