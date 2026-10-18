import {
  CODEX_QUOTA_THRESHOLD,
  QUOTA_CACHE_TTL_MS,
} from './config.ts';
import { isValidCandidateId } from './candidate-id.ts';
import type {
  ModelCandidate,
  ModelCandidateId,
  RegisteredModel,
  CandidateQuotaStatus,
  WhamQuotaResult,
  GeminiQuotaResult,
} from './types.ts';

/** A host-registered model with no verified quota protocol: selectable when a saved slot names it, last resort. */
export function registeredCandidate(model: RegisteredModel): ModelCandidate {
  const id = `${model.provider}/${model.id}`;
  const slug = model.id.includes('/') ? model.id.slice(model.id.lastIndexOf('/') + 1) : model.id;
  return {
    id,
    source: 'registered',
    quotaProtocol: 'none',
    modelSlug: slug,
    provider: model.provider,
    reasoningEffort: 'high',
    contextWindowCap: model.contextWindow,
  };
}

export interface QuotaManagerOptions {
  baseUrl?: string;
  retryDelayMs?: number;
  maxRetries?: number;
  /** Codex window percentage above which a route is not eligible. Defaults to 95. */
  codexQuotaThresholdPercent?: number;
  /**
   * The routing slots in force: the first `modelCount` entries of the saved list, most
   * important first. Empty means no automatic routing at all.
   */
  priorityCandidateIds?: string[];
}

interface AccountAuthMapping {
  authIndex: string | number;
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
  private accountCandidates: ModelCandidate[] = [];
  private registeredModels: RegisteredModel[] = [];
  private candidates: ModelCandidate[] = [];
  private trackedResetAt = new Map<string, number>(); // prefix -> unix seconds
  private staleQuotaCandidates = new Set<ModelCandidateId>();
  private codexQuotaThresholdPercent: number;
  private priorityCandidateIds: string[] = [];

  constructor(options?: QuotaManagerOptions) {
    this.baseUrl = (options?.baseUrl || process.env.CLIPROXYAPI_BASE_URL || 'http://127.0.0.1:8317').replace(/\/+$/, '').replace(/\/v1$/, '');
    this.retryDelayMs = options?.retryDelayMs ?? 1000;
    this.maxRetries = options?.maxRetries ?? 3;
    this.codexQuotaThresholdPercent = options?.codexQuotaThresholdPercent ?? CODEX_QUOTA_THRESHOLD;
    if (options?.priorityCandidateIds) this.setPriorityCandidateIds(options.priorityCandidateIds);
    this.recomputeCandidates();
  }

  getPriorityCandidateIds(): string[] { return [...this.priorityCandidateIds]; }

  /**
   * Adopts a quota threshold changed from the control panel, so eligibility decisions made
   * after the change use the value the operator just chose. Fresh status reads are needed
   * for the change to be reflected: callers invalidate the cache as they already do.
   */
  setCodexQuotaThresholdPercent(percent: number): void {
    this.codexQuotaThresholdPercent = percent;
  }

  /**
   * Stores the routing slots in force. IDs are deduped and kept verbatim, in order: the
   * manager never truncates, because `modelCount` (2..10) already decided how many of the
   * saved entries are active. A route that has not been discovered yet is kept as well, so
   * an inventory outage cannot silently erase the user's order; resolution happens when
   * routing asks for the order.
   */
  setPriorityCandidateIds(ids: string[]): void {
    const seen = new Set<string>();
    const next: string[] = [];
    for (const id of Array.isArray(ids) ? ids : []) {
      if (typeof id !== 'string' || seen.has(id)) continue;
      seen.add(id);
      next.push(id);
    }
    this.priorityCandidateIds = next;
  }

  /**
   * Candidates automatic routing may select, most important first.
   *
   * Only the saved slots compete. An empty selection returns nothing on purpose: there is
   * no computed-order fallback, so clearing every slot really does disable routing.
   */
  effectiveRoutingOrder(): ModelCandidate[] {
    const byId = new Map(this.candidates.map(candidate => [candidate.id, candidate]));
    const ordered: ModelCandidate[] = [];
    for (const id of this.priorityCandidateIds) {
      const candidate = byId.get(id);
      if (candidate && !ordered.some(existing => existing.id === candidate.id)) ordered.push(candidate);
    }
    return ordered;
  }

  /**
   * A slot holding a route without verified quota must not jump ahead of a verified account
   * that is available further down the user's own order (`S2`).
   */
  private async hasEligibleVerifiedCandidateBelow(
    order: ModelCandidate[],
    index: number,
    cooldowns?: Map<ModelCandidateId, number>,
    excluded?: Set<ModelCandidateId>,
  ): Promise<boolean> {
    for (const candidate of order.slice(index + 1)) {
      if (candidate.quotaProtocol === 'none') continue;
      // The caller already cleared the cache for this selection, so reusing what this
      // same selection fetched avoids a second round of quota probes.
      const status = await this.checkCandidateStatus(candidate, cooldowns, { forceFresh: false, excluded });
      if (status.isEligible) return true;
    }
    return false;
  }

  /**
   * A model is selected when the saved slots name it and the Pi registry can address it.
   * The catalogue is built from Pi's chat registry (plus account metadata that only
   * enriches quota attributes), so an unknown route is never a selected model.
   */
  isSelected(id: string): boolean {
    if (!this.priorityCandidateIds.includes(id)) return false;
    return this.candidates.some(candidate => candidate.id === id);
  }

  getCandidates(): ModelCandidate[] { return [...this.candidates]; }

  /**
   * Replace the host-registered catalog. Entries whose `<provider>/<modelId>` route is
   * not addressable, and duplicate routes, are dropped so a malformed registry snapshot
   * can never poison the selector. Account routes win on an id collision.
   */
  setRegisteredModels(models: RegisteredModel[]): void {
    const seen = new Set<string>();
    const registered: RegisteredModel[] = [];
    for (const model of Array.isArray(models) ? models : []) {
      if (!model || typeof model.provider !== 'string' || typeof model.id !== 'string') continue;
      const id = `${model.provider}/${model.id}`;
      if (!isValidCandidateId(id) || seen.has(id)) continue;
      seen.add(id);
      registered.push({ ...model });
    }
    this.registeredModels = registered;
    this.recomputeCandidates();
  }

  private recomputeCandidates(): void {
    // Account metadata enriches registered routes with verified quota protocols.
    // Automatic selection is constrained separately by the configured active prefix.
    const accountIds = new Set(this.accountCandidates.map(c => c.id));
    const registeredOnly = this.registeredModels
      .filter(model => !accountIds.has(`${model.provider}/${model.id}`))
      .map(registeredCandidate)
      .sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
    this.candidates = [...this.accountCandidates, ...registeredOnly];
  }

  private family(candidate: ModelCandidate): 'codex' | 'gemini' {
    return candidate.family ?? (candidate.modelSlug.startsWith('gemini') ? 'gemini' : 'codex');
  }

  async discoverCandidates(isRegistered: (id: string) => boolean): Promise<void> {
    // Build an atomic snapshot. Never publish partial inventory on an HTTP/schema failure.
    const response = await this.fetchWithRetry(`${this.baseUrl}/v0/management/auth-files`);
    if (!response.ok) throw new Error('Account inventory unavailable');
    const payload = await response.json();
    if (!Array.isArray(payload.files)) throw new Error('Unsupported account inventory');
    const routes = new Map<string, { candidate: ModelCandidate; mapping: AccountAuthMapping }[]>();
    for (const file of payload.files) {
      if (file.disabled || typeof file.name !== 'string' || !['string', 'number'].includes(typeof file.auth_index)) continue;
      const res = await this.fetchWithRetry(`${this.baseUrl}/v0/management/auth-files/models?name=${encodeURIComponent(file.name)}`);
      if (!res.ok) throw new Error('Account model inventory unavailable');
      const data = await res.json();
      if (!Array.isArray(data.models)) throw new Error('Unsupported account model inventory');
      for (const model of data.models) {
        if (typeof model.id !== 'string') continue;
        const match = model.id.match(/^([^/]+)\/(gpt-[^/]+|gemini-[^/]+)$/);
        if (!match) continue; // Unprefixed/shared aliases cannot prove account attribution.
        const [, prefix, slug] = match;
        const family = slug.startsWith('gemini-') ? 'gemini' : 'codex';
        const provider = String(file.provider ?? file.type ?? '').toLowerCase();
        if (provider && !(family === 'codex' ? ['codex', 'openai', 'chatgpt'] : ['antigravity', 'gemini', 'google']).includes(provider)) continue;
        const candidate: ModelCandidate = { id: `cliproxyapi/${model.id}`, source: 'account',
          quotaProtocol: family === 'codex' ? 'wham' : 'gemini', prefix, modelSlug: slug, family,
          provider: 'cliproxyapi', reasoningEffort: 'high', contextWindowCap: family === 'codex' ? 272000 : 370000 };
        const entries = routes.get(prefix) ?? [];
        entries.push({ candidate, mapping: { authIndex: file.auth_index, projectId: file.project_id || 'aicode-consumers' } });
        routes.set(prefix, entries);
      }
    }
    const candidates: ModelCandidate[] = [];
    const mappings = new Map<string, AccountAuthMapping>();
    const ambiguous = new Set<string>();
    for (const [prefix, entries] of routes) {
      if (new Set(entries.map(e => String(e.mapping.authIndex))).size !== 1) { ambiguous.add(prefix); continue; }
      const ranked = entries.filter(e => isRegistered(e.candidate.id)).sort((a, b) => {
        const preferred = (c: ModelCandidate) => c.modelSlug === 'gpt-6.1-sol' || c.modelSlug === 'gemini-3.8-flash-high' ? 0 : c.modelSlug.includes('flash') ? 1 : 2;
        return preferred(a.candidate) - preferred(b.candidate) || a.candidate.modelSlug.localeCompare(b.candidate.modelSlug);
      });
      if (!ranked.length) continue;
      candidates.push(ranked[0].candidate); mappings.set(prefix, ranked[0].mapping);
    }
    const priority = (c: ModelCandidate) => c.family === 'codex' ? c.prefix === 'main' ? 0 : c.prefix === 'second' ? 1 : 2 : 3;
    candidates.sort((a, b) => priority(a) - priority(b) || a.prefix.localeCompare(b.prefix));
    this.accountCandidates = candidates;
    this.recomputeCandidates();
    this.accountMappings = mappings; this.ambiguousPrefixes = ambiguous;
    this.clearCache();
  }

  clearCache(): void {
    this.whamCache.clear();
    this.geminiCache.clear();
  }

  hasResetAtExpired(prefix: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
    const resetAt = this.trackedResetAt.get(prefix);
    if (resetAt === undefined) return false;
    return nowSec >= resetAt;
  }

  isQuotaStale(candidateId: ModelCandidateId, nowMs = Date.now()): boolean {
    if (this.staleQuotaCandidates.has(candidateId)) return true;
    const candidate = this.candidates.find((c) => c.id === candidateId);
    if (!candidate) return false;
    if (this.family(candidate) === 'codex') {
      const cached = this.whamCache.get(candidate.prefix!);
      if (!cached) return false;
      return nowMs - cached.cachedAt >= QUOTA_CACHE_TTL_MS || this.hasResetAtExpired(candidate.prefix!, Math.floor(nowMs / 1000));
    }
    const cached = this.geminiCache.get(candidate.prefix!);
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
    const mergedInit: RequestInit = { ...init, headers, signal: AbortSignal.timeout(5000) };

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

  async resolvePrefixMapping(prefix: string): Promise<AccountAuthMapping | undefined> {
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
    prefix: string,
    options?: { forceFresh?: boolean },
  ): Promise<WhamQuotaResult | undefined> {
    const candidateId = this.candidates.find(c => c.prefix === prefix && this.family(c) === 'codex')?.id ?? `cliproxyapi/${prefix}/gpt-6.1-sol`;
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

      if (primaryUsed >= this.codexQuotaThresholdPercent && secondaryUsed < this.codexQuotaThresholdPercent) {
        this.trackedResetAt.set(prefix, primaryReset);
      } else if (secondaryUsed >= this.codexQuotaThresholdPercent && primaryUsed < this.codexQuotaThresholdPercent) {
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
    prefix: string,
    options?: { forceFresh?: boolean },
  ): Promise<GeminiQuotaResult | undefined> {
    const candidateId = this.candidates.find(c => c.prefix === prefix && this.family(c) === 'gemini')?.id ?? `cliproxyapi/${prefix}/gemini-3.8-flash-high`;
    const cached = this.geminiCache.get(prefix);
    if (!options?.forceFresh && cached && Date.now() - cached.cachedAt < QUOTA_CACHE_TTL_MS) {
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
    // 0. Check the saved routing slots: a route the user did not select never competes.
    if (!this.isSelected(candidate.id)) {
      return {
        candidateId: candidate.id,
        isEligible: false,
        reason: 'not_selected',
      };
    }

    // 0b. Check permanent exclusion until positive restoration evidence
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

    // 2. Registered host models without a verified quota protocol are eligible when enabled.
    // They are ordered after every account route, so they only win as a last resort.
    if (candidate.quotaProtocol === 'none') {
      return {
        candidateId: candidate.id,
        isEligible: true,
        reason: 'registered_without_quota_protocol',
      };
    }

    // 3. Codex models (main, second)
    if (candidate.quotaProtocol === 'wham') {
      const wham = await this.fetchWhamQuota(candidate.prefix!, { forceFresh: options?.forceFresh });
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

      // Mandatory dual-window threshold with strict comparison, at the configured policy value.
      if (wham.primary_window.used_percent >= this.codexQuotaThresholdPercent) {
        return {
          candidateId: candidate.id,
          isEligible: false,
          whamUsage: wham,
          reason: `primary_window_ineligible (>= ${this.codexQuotaThresholdPercent}% policy threshold: ${wham.primary_window.used_percent}%)`,
        };
      }

      if (wham.secondary_window.used_percent >= this.codexQuotaThresholdPercent) {
        return {
          candidateId: candidate.id,
          isEligible: false,
          whamUsage: wham,
          reason: `secondary_window_ineligible (>= ${this.codexQuotaThresholdPercent}% policy threshold: ${wham.secondary_window.used_percent}%)`,
        };
      }

      return {
        candidateId: candidate.id,
        isEligible: true,
        whamUsage: wham,
        reason: 'eligible',
      };
    }

    // 4. Gemini tertiary models
    if (candidate.quotaProtocol === 'gemini') {
      const gemini = await this.fetchGeminiQuota(candidate.prefix!, { forceFresh: options?.forceFresh });
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

    const order = this.effectiveRoutingOrder();
    for (let index = 0; index < order.length; index++) {
      const candidate = order[index];
      const status = await this.checkCandidateStatus(candidate, cooldowns, {
        forceFresh,
        excluded: options?.excluded,
      });
      if (!status.isEligible) continue;
      if (candidate.quotaProtocol === 'none' && await this.hasEligibleVerifiedCandidateBelow(order, index, cooldowns, options?.excluded)) {
        continue;
      }
      return { candidate, allUnavailable: false, reason: status.reason };
    }

    // All candidates are exhausted, unverified, excluded, or in cooldown
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
    const order = this.effectiveRoutingOrder();
    const index = order.findIndex(c => c.id === currentCandidateId);
    const higher = index < 0 ? order : order.slice(0, index);
    for (const candidate of higher) {
      const status = await this.checkCandidateStatus(candidate, cooldowns, { forceFresh: true, excluded });
      if (status.isEligible) return { shouldReturn: true, targetCandidate: candidate, reason: 'higher_priority_account_available' };
    }
    return { shouldReturn: false };
  }
}
