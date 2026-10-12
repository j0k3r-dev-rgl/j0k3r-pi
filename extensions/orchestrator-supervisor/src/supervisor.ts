import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  SUPERVISOR_EXTENSION_NAME,
  MEMORY_CHECKPOINT_CHANNEL,
  MODEL_CANDIDATES,
  QUOTA_POLL_INTERVAL_MS,
  ALL_UNAVAILABLE_BACKOFF_MIN_MS,
  ALL_UNAVAILABLE_BACKOFF_MAX_MS,
  computeFlowIdentity,
  resolveSupervisorDir,
  isExtensionEnabled,
} from './config.ts';
import { FlowLock } from './lock.ts';
import { FlowJournal } from './journal.ts';
import { SubagentMonitor } from './subagent-monitor.ts';
import { QuotaManager } from './quota-manager.ts';
import { ErrorClassifier, type ClassificationAction } from './error-classifier.ts';
import { ContextGuard } from './context-guard.ts';
import type {
  ModelCandidateId,
  SupervisorState,
  ReloadGuardQuery,
} from './types.ts';

export interface SupervisorRuntimeOptions {
  boundFlowKey?: string;
  baseUrl?: string;
  events?: any;
}

export interface GitStateSnapshot {
  branch?: string;
  headSha?: string;
  baseCommit?: string;
  statusDiffHash?: string;
}

export class SupervisorRuntime {
  readonly cwd: string;
  readonly flowIdentity: string;
  readonly flowDir: string;
  readonly lock: FlowLock;
  readonly journal: FlowJournal;
  readonly subagentMonitor: SubagentMonitor;
  readonly quotaManager: QuotaManager;
  readonly errorClassifier: ErrorClassifier;
  readonly contextGuard: ContextGuard;

  private sessionId: string;
  private state: SupervisorState;
  private quotaTimer?: NodeJS.Timeout;
  private rotationPending = false;
  private rotationReason = '';
  private isDisposed = false;
  private isSupervisorRotating = false;
  private lastRotatedGeneration = -1;
  private currentBackoffMs = QUOTA_POLL_INTERVAL_MS;
  private unavailablePollCount = 0;
  private staleQuotaStopNewWork = false;
  private lastAssistantSummary?: string;
  private pendingContinuationInstruction?: string;
  private pendingStandaloneRetry?: {
    delayMs: number;
    attempt: number;
    candidateId: ModelCandidateId;
  };

  constructor(cwd: string, sessionId: string, options?: SupervisorRuntimeOptions) {
    this.cwd = cwd;
    this.sessionId = sessionId;
    this.flowIdentity = computeFlowIdentity(cwd, options?.boundFlowKey);
    this.flowDir = resolveSupervisorDir(this.flowIdentity);

    this.lock = new FlowLock(this.flowDir, this.flowIdentity, sessionId);
    this.journal = new FlowJournal(this.flowDir, this.flowIdentity, sessionId);
    this.subagentMonitor = new SubagentMonitor({ events: options?.events });
    this.quotaManager = new QuotaManager({ baseUrl: options?.baseUrl });
    this.errorClassifier = new ErrorClassifier(sessionId);
    this.contextGuard = new ContextGuard();

    const existingState = this.journal.loadState();
    this.state = existingState || {
      flowIdentity: this.flowIdentity,
      sessionId,
      activeModel: 'cliproxyapi/main/gpt-6.1-sol',
      status: 'active',
      userPaused: false,
      userCancelled: false,
      activeGeneration: 1,
      uncertainMutationsCount: 0,
      updatedAt: Date.now(),
    };
  }

  getSessionId(): string {
    return this.sessionId;
  }

  setSessionId(newSessionId: string): void {
    this.sessionId = newSessionId;
    this.errorClassifier.setSessionId(newSessionId);
  }

  setActiveModel(modelId: string): void {
    this.state.activeModel = modelId as ModelCandidateId;
  }

  setLastAssistantSummary(summary: string): void {
    this.lastAssistantSummary = summary;
  }

  getLastAssistantSummary(): string | undefined {
    return this.lastAssistantSummary;
  }

  setAuthorizedContinuation(continuation: any): void {
    this.state.authorizedContinuation = continuation;
  }

  async onSessionReplaced(replacementCtx: any): Promise<void> {
    const instruction = this.pendingContinuationInstruction;
    this.pendingContinuationInstruction = undefined;
    if (instruction && typeof replacementCtx?.sendUserMessage === 'function') {
      await replacementCtx.sendUserMessage(instruction);
    }
  }

  getCurrentBackoffMs(): number {
    return this.currentBackoffMs;
  }

  isNewWorkStoppedByStaleQuota(): boolean {
    return this.staleQuotaStopNewWork;
  }

  init(options?: { reason?: 'startup' | 'reload' | 'new' | string }): boolean {
    const hasHandover = Boolean(this.state.rotationHandoverToken);
    const isReload = options?.reason === 'reload';
    const isNewWithHandover = options?.reason === 'new' && hasHandover;

    this.lock.acquire({
      enforceDistinctSession: !(isReload || isNewWithHandover || hasHandover),
    });
    if (isReload || isNewWithHandover || hasHandover) {
      this.lock.handover(this.sessionId);
    }

    // Check crash recovery on startup (not on reload or rotation handover)
    if (!isReload && !isNewWithHandover) {
      const recovery = this.journal.recoverOnStartup();
      const uncertainCount = this.journal.getUncertainEntries().length;
      this.state.uncertainMutationsCount = uncertainCount;
      if (recovery.recovered || uncertainCount > 0) {
        this.state.status = 'paused'; // unclosed crash transitions to paused
      }
    }

    // User pause/cancel always dominates restart or toggle
    if (this.state.userCancelled) {
      this.state.status = 'cancelled';
    } else if (this.state.userPaused || this.state.uncertainMutationsCount > 0) {
      this.state.status = 'paused';
    } else if (this.state.status !== 'idle') {
      this.state.status = 'active';
    }

    this.state.sessionId = this.sessionId;
    this.state.updatedAt = Date.now();
    this.journal.saveState(this.state);
    return true;
  }

  startPeriodicPolling(onStatusUpdate?: (text: string) => void, intervalOverrideMs?: number): void {
    this.stopPeriodicPolling();
    const intervalMs = intervalOverrideMs ?? this.currentBackoffMs;
    this.quotaTimer = setInterval(async () => {
      if (this.isDisposed || !isExtensionEnabled(SUPERVISOR_EXTENSION_NAME, this.cwd)) {
        this.stopPeriodicPolling();
        return;
      }
      await this.runPeriodicPollTick(onStatusUpdate);
    }, intervalMs);
  }

  async runPeriodicPollTick(onStatusUpdate?: (text: string) => void): Promise<void> {
    if (this.isDisposed || !isExtensionEnabled(SUPERVISOR_EXTENSION_NAME, this.cwd)) {
      this.stopPeriodicPolling();
      return;
    }
    try {
      // If currently in all-unavailable idle state, check if any candidate is now available
      if (this.state.status === 'idle') {
        const sel = await this.quotaManager.selectBestCandidate(
          this.errorClassifier.getCooldowns(),
          { forceFresh: true, excluded: this.errorClassifier.getExcludedCandidates() },
        );
        if (!sel.allUnavailable && sel.candidate) {
          this.unavailablePollCount = 0;
          this.currentBackoffMs = QUOTA_POLL_INTERVAL_MS;
          this.state.activeModel = sel.candidate.id;
          this.state.status = this.canAutoContinue() ? 'active' : 'paused';
          this.journal.saveState(this.state);
          onStatusUpdate?.(`supervisor · ${this.state.activeModel.split('/')[1]} · normal`);
        } else {
          this.unavailablePollCount++;
          this.currentBackoffMs = Math.min(
            ALL_UNAVAILABLE_BACKOFF_MIN_MS * Math.pow(2, Math.max(0, this.unavailablePollCount - 1)),
            ALL_UNAVAILABLE_BACKOFF_MAX_MS,
          );
          onStatusUpdate?.(
            `supervisor · idle (all candidates unavailable, backoff ${Math.round(this.currentBackoffMs / 1000)}s)`,
          );
        }
        return;
      }

      // Check active candidate freshness (stale quota expiry stops new work while allowing in-flight finish)
      const activeCandidate =
        MODEL_CANDIDATES.find((c) => c.id === this.state.activeModel) ?? MODEL_CANDIDATES[0]!;
      const activeStatus = await this.quotaManager.checkCandidateStatus(
        activeCandidate,
        this.errorClassifier.getCooldowns(),
        { forceFresh: true, excluded: this.errorClassifier.getExcludedCandidates() },
      );
      if (activeStatus.isUnknown && this.quotaManager.isQuotaStale(this.state.activeModel)) {
        this.staleQuotaStopNewWork = true;
      } else {
        this.staleQuotaStopNewWork = false;
        if (!activeStatus.isEligible) {
          this.requestRotation(activeStatus.reason || 'active_quota_ineligible');
        }
      }

      // Check reset return to main / second
      const returnCheck = await this.quotaManager.checkResetReturn(
        this.state.activeModel,
        this.errorClassifier.getCooldowns(),
        this.errorClassifier.getExcludedCandidates(),
      );
      if (returnCheck.shouldReturn && returnCheck.targetCandidate) {
        this.rotationPending = true;
        this.rotationReason = returnCheck.reason || 'quota_reset_return';
      }
      if (onStatusUpdate) {
        onStatusUpdate(`supervisor · ${this.state.activeModel.split('/')[1]} · normal`);
      }
    } catch {}
  }

  stopPeriodicPolling(): void {
    if (this.quotaTimer) {
      clearInterval(this.quotaTimer);
      this.quotaTimer = undefined;
    }
  }

  getState(): SupervisorState {
    return { ...this.state };
  }

  isLockHeld(): boolean {
    return this.lock.isHeld();
  }

  markInternalAbort(reason: string): void {
    this.state.lastInternalAbort = {
      reason,
      generation: this.state.activeGeneration,
      timestamp: Date.now(),
    };
    this.state.updatedAt = Date.now();
    this.journal.saveState(this.state);
  }

  handleSettledAbort(aborted: boolean): { isUserAbort: boolean } {
    if (!aborted) {
      if (this.state.lastInternalAbort) {
        delete this.state.lastInternalAbort;
        this.journal.saveState(this.state);
      }
      return { isUserAbort: false };
    }

    // Precedence Rule: User pause or cancel always dominates
    if (this.state.userPaused || this.state.userCancelled) {
      delete this.state.lastInternalAbort;
      this.rotationPending = false;
      this.journal.saveState(this.state);
      return { isUserAbort: true };
    }

    const internalAbort = this.state.lastInternalAbort;
    if (
      internalAbort &&
      internalAbort.generation === this.state.activeGeneration &&
      Date.now() - internalAbort.timestamp < 30000
    ) {
      // Consumed internal supervisor abort attribution
      delete this.state.lastInternalAbort;
      this.journal.saveState(this.state);
      return { isUserAbort: false };
    }

    // Unknown or Escape abort fails closed as user pause
    delete this.state.lastInternalAbort;
    this.rotationPending = false;
    this.setUserPaused(true);
    return { isUserAbort: true };
  }

  setUserPaused(paused: boolean): void {
    this.state.userPaused = paused;
    if (paused) {
      this.rotationPending = false;
      this.state.status = 'paused';
    } else if (!this.state.userCancelled && this.state.uncertainMutationsCount === 0) {
      this.state.status = 'active';
    }
    this.state.updatedAt = Date.now();
    this.journal.saveState(this.state);
  }

  setUserCancelled(cancelled: boolean): void {
    this.state.userCancelled = cancelled;
    if (cancelled) {
      this.rotationPending = false;
      this.state.status = 'cancelled';
    } else if (!this.state.userPaused && this.state.uncertainMutationsCount === 0) {
      this.state.status = 'active';
    }
    this.state.updatedAt = Date.now();
    this.journal.saveState(this.state);
  }

  acknowledgeUncertainMutations(): void {
    this.journal.acknowledgeUncertainEntries();
    this.state.uncertainMutationsCount = 0;
    if (!this.state.userPaused && !this.state.userCancelled) {
      this.state.status = 'active';
    }
    this.state.updatedAt = Date.now();
    this.journal.saveState(this.state);
  }

  canAutoContinue(): boolean {
    if (this.state.userPaused || this.state.userCancelled) return false;
    if (this.state.uncertainMutationsCount > 0) return false;
    if (this.staleQuotaStopNewWork) return false;
    return true;
  }

  checkQuiescence(): void {
    const enabled = isExtensionEnabled(SUPERVISOR_EXTENSION_NAME, this.cwd);
    if (!enabled) {
      this.stopPeriodicPolling();
      this.rotationPending = false;
      this.pendingStandaloneRetry = undefined;
      // Only release lock if all observed tool calls have settled
      const pendingCalls = this.journal.getEntries().filter((e) => e.status === 'pending');
      if (pendingCalls.length === 0) {
        this.lock.release();
        this.state.status = 'stopped';
        this.journal.saveState(this.state);
      }
    }
  }

  recordToolCallPre(params: {
    toolCallId: string;
    parentToolCallId?: string;
    sessionId: string;
    turnIndex: number;
    toolName: string;
    args: any;
  }) {
    this.subagentMonitor.recordToolCallStart(params.sessionId, params.toolCallId, params.toolName);
    return this.journal.recordToolCallPre(params);
  }

  recordToolCallResult(toolCallId: string, isError: boolean, result: any): void {
    this.subagentMonitor.recordToolCallEnd(this.sessionId, toolCallId);
    this.journal.recordToolCallResult(toolCallId, isError, result);
    this.checkQuiescence();
  }

  handleBeforeSwitch(): { cancel: boolean; reason?: string } | undefined {
    // Allow supervisor's own rotation after completion fence and WAL settlement have passed
    if (this.isSupervisorRotating) {
      return undefined;
    }

    const fence = this.subagentMonitor.checkFence(this.sessionId, this.cwd);
    if (!fence.satisfied) {
      return { cancel: true, reason: fence.reason };
    }

    const unsettledMutations = this.journal
      .getEntries()
      .filter((e) => (e.status === 'pending' || e.status === 'uncertain') && e.isMutating);
    if (unsettledMutations.length > 0 || this.state.uncertainMutationsCount > 0) {
      return {
        cancel: true,
        reason: `Unsettled or uncertain mutating tool call in flight (${Math.max(unsettledMutations.length, this.state.uncertainMutationsCount)} unsettled)`,
      };
    }

    return undefined;
  }

  handleReloadGuardQuery(query: ReloadGuardQuery): void {
    const fence = this.subagentMonitor.checkFence(this.sessionId, this.cwd);
    if (!fence.satisfied) {
      query.defer(fence.reason || 'Active subagents in flight');
      return;
    }

    const unsettledMutations = this.journal
      .getEntries()
      .filter((e) => (e.status === 'pending' || e.status === 'uncertain') && e.isMutating);
    if (unsettledMutations.length > 0 || this.state.uncertainMutationsCount > 0) {
      query.defer(
        `Unsettled or uncertain mutating tool call in flight (${Math.max(unsettledMutations.length, this.state.uncertainMutationsCount)} unsettled)`,
      );
    }
  }

  requestRotation(reason: string): void {
    if (this.state.userCancelled) return;
    if (this.state.userPaused && reason !== 'context_reserve_90_reached') return;
    if (!isExtensionEnabled(SUPERVISOR_EXTENSION_NAME, this.cwd)) return;
    this.rotationPending = true;
    this.rotationReason = reason;
  }

  requestRotationFromTool(memoryId: number, nextStep?: string): void {
    if (this.state.userCancelled) return;
    this.rotationPending = true;
    this.rotationReason = 'tool_requested_rotate';
    this.state.lastCheckpointMemoryId = memoryId;
    this.state.authorizedContinuation = {
      action: 'continue_from_tool',
      memoryId,
      nextStep: nextStep || 'Continuar exactamente donde quedó la tarea anterior',
      timestamp: Date.now(),
    };
    if (nextStep) {
      this.lastAssistantSummary = nextStep;
    }
    this.journal.saveState(this.state);
  }

  async classifyTurnMessage(
    message: any,
    ctx: { mode?: string; sessionId?: string },
    pi?: any,
  ): Promise<ClassificationAction> {
    const activeModel = this.state.activeModel;
    const rawError = String(message?.errorMessage ?? message?.error ?? '');
    const isRateLimit429 =
      message?.role === 'assistant' &&
      message?.stopReason === 'error' &&
      /\b429\b|rate.?limit|too many requests/i.test(rawError) &&
      !/insufficient_quota|quota exceeded|out of budget|quota_exhausted/i.test(rawError);

    let freshQuotaStatus;
    if (isRateLimit429) {
      const candidate =
        MODEL_CANDIDATES.find((c) => c.id === activeModel) ?? MODEL_CANDIDATES[0]!;
      freshQuotaStatus = await this.quotaManager.checkCandidateStatus(
        candidate,
        this.errorClassifier.getCooldowns(),
        { forceFresh: true, excluded: this.errorClassifier.getExcludedCandidates() },
      );
    }

    const action = this.errorClassifier.handleMessageEnd(message, activeModel, ctx, {
      freshQuotaStatus,
    });

    if (action.type === 'transient_retry' && action.retryDelayMs) {
      const settings = pi?.getSettings?.();
      const nativeRetryEnabled = settings?.retry?.enabled !== false;
      if (!nativeRetryEnabled) {
        this.pendingStandaloneRetry = {
          delayMs: action.retryDelayMs,
          attempt: action.consecutiveErrors ?? 1,
          candidateId: activeModel,
        };
      }
    } else if (action.type === 'success' || action.type === 'immediate_failover' || action.type === 'cooldown_failover') {
      this.pendingStandaloneRetry = undefined;
    }

    return action;
  }

  async onAgentSettled(pi: any, ctx: any): Promise<void> {
    if (!isExtensionEnabled(SUPERVISOR_EXTENSION_NAME, this.cwd)) {
      this.checkQuiescence();
      ctx?.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, undefined);
      return;
    }

    // User pause/cancel dominates automatic operations, except when context reserve is physically exceeded (>90%)
    if (this.state.userCancelled || (this.state.userPaused && this.rotationReason !== 'context_reserve_90_reached')) {
      this.rotationPending = false;
      this.pendingStandaloneRetry = undefined;
      return;
    }

    // Check context usage at settlement if rotation is not yet pending
    if (!this.rotationPending && typeof ctx?.getContextUsage === 'function') {
      const usage = ctx.getContextUsage();
      if (usage) {
        const fallbackDetails = this.contextGuard.extractFallbackDetails(ctx);
        const evaluated = this.contextGuard.evaluateUsage(
          usage,
          this.state.activeModel,
          fallbackDetails,
        );
        if (evaluated.isReserveExceeded) {
          this.requestRotation('context_reserve_90_reached');
        }
      }
    }

    // Handle standalone retry progression when native retry is disabled
    if (!this.rotationPending && this.pendingStandaloneRetry) {
      const retryInfo = this.pendingStandaloneRetry;
      this.pendingStandaloneRetry = undefined;
      await new Promise((r) => setTimeout(r, Math.min(retryInfo.delayMs, 30000)));
      if (
        !this.isDisposed &&
        isExtensionEnabled(SUPERVISOR_EXTENSION_NAME, this.cwd) &&
        this.canAutoContinue()
      ) {
        pi?.sendUserMessage?.('Continue interrupted step.');
      }
      return;
    }

    if (!this.rotationPending) return;

    // Prevent duplicate or recursive rotation for the same generation
    if (this.isSupervisorRotating || this.lastRotatedGeneration === this.state.activeGeneration) {
      return;
    }

    // 1. Strict subagent completion fence
    const fence = this.subagentMonitor.checkFence(this.sessionId, this.cwd);
    if (!fence.satisfied) {
      ctx?.ui?.setStatus?.(
        SUPERVISOR_EXTENSION_NAME,
        `supervisor · waiting for subagents (${fence.activeCount} active)`,
      );
      return; // will recheck on next settlement
    }

    // 1b. Do not rotate while mutating WAL entries are pending or uncertain
    const unsettledMutations = this.journal
      .getEntries()
      .filter((e) => (e.status === 'pending' || e.status === 'uncertain') && e.isMutating);
    if (unsettledMutations.length > 0 || this.state.uncertainMutationsCount > 0) {
      return;
    }

    // 2. Select target model for next session (always fetching fresh quotas prior to failover)
    const selection = await this.quotaManager.selectBestCandidate(
      this.errorClassifier.getCooldowns(),
      {
        forceFresh: true,
        excluded: this.errorClassifier.getExcludedCandidates(),
      },
    );

    let targetModelId: ModelCandidateId;
    if (selection.candidate) {
      this.unavailablePollCount = 0;
      this.currentBackoffMs = QUOTA_POLL_INTERVAL_MS;
      targetModelId = selection.candidate.id;
    } else if (this.rotationReason === 'context_reserve_90_reached') {
      // Safety: context reserve exceeded (>90%), must rotate to prevent context overflow even if quota status is unverified
      this.unavailablePollCount = 0;
      this.currentBackoffMs = QUOTA_POLL_INTERVAL_MS;
      targetModelId = (MODEL_CANDIDATES.find((c) => c.id === this.state.activeModel)?.id ?? MODEL_CANDIDATES[0]!.id);
    } else {
      // All 3 candidates are exhausted, unverified, excluded, or in cooldown for a provider failover:
      // Enter safe idle state with 60s -> 300s progressive polling backoff and zero prompt dispatch
      this.unavailablePollCount++;
      this.currentBackoffMs = Math.min(
        ALL_UNAVAILABLE_BACKOFF_MIN_MS * Math.pow(2, Math.max(0, this.unavailablePollCount - 1)),
        ALL_UNAVAILABLE_BACKOFF_MAX_MS,
      );
      this.rotationPending = false;
      this.state.status = 'idle';
      this.state.updatedAt = Date.now();
      this.journal.saveState(this.state);
      ctx?.ui?.setStatus?.(
        SUPERVISOR_EXTENSION_NAME,
        `supervisor · idle (all candidates unavailable, backoff ${Math.round(this.currentBackoffMs / 1000)}s)`,
      );
      if (this.quotaTimer) {
        this.startPeriodicPolling((text) => {
          ctx?.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, text);
        }, this.currentBackoffMs);
      }
      return;
    }

    // 3. Save memory checkpoint over pi.events bridge
    let checkpointId: number | undefined;
    if (this.rotationReason === 'tool_requested_rotate' && this.state.lastCheckpointMemoryId) {
      checkpointId = this.state.lastCheckpointMemoryId;
    } else if (pi?.events?.emit) {
      const gitState = this.getGitState();
      const artifactHashes = this.getArtifactHashes();
      const checkpointContent = JSON.stringify({
        flowIdentity: this.flowIdentity,
        sessionId: this.sessionId,
        previousModel: this.state.activeModel,
        targetModel: targetModelId,
        rotationReason: this.rotationReason,
        gitState,
        artifactHashes,
        authorizedContinuation: this.state.authorizedContinuation ?? null,
        timestamp: Date.now(),
      });

      const saveRes: any = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, error: 'save_timeout' }), 10000);
        pi.events.emit(MEMORY_CHECKPOINT_CHANNEL, {
          action: 'save',
          cwd: this.cwd,
          sessionId: this.sessionId,
          title: `Supervisor Checkpoint: Rotation to ${targetModelId}`,
          content: checkpointContent,
          type: 'session_summary',
          respond: (res: any) => {
            clearTimeout(timer);
            resolve(res);
          },
        });
      });

      if (!saveRes.ok || !saveRes.readbackVerified) {
        // Failed memory save safety invariant: STOP IMMEDIATELY, preserve old session and WAL
        ctx?.ui?.notify?.(
          'Error al guardar checkpoint de memoria verificado; rotación abortada para proteger el estado.',
          'error',
        );
        this.rotationPending = false;
        return;
      }
      checkpointId = saveRes.id;
    }

    // 4. Update state and retain lock across rotation handover
    this.lastRotatedGeneration = this.state.activeGeneration;
    this.state.lastCheckpointMemoryId = checkpointId;
    this.state.rotationHandoverToken = `token_${this.state.activeGeneration + 1}_${Date.now()}`;
    this.state.activeModel = targetModelId;
    this.state.activeGeneration++;
    this.state.status = 'rotating';
    this.state.updatedAt = Date.now();
    this.journal.saveState(this.state);

    this.rotationPending = false;
    this.isSupervisorRotating = true;

    ctx?.ui?.notify?.(
      `Límite de contexto alcanzado (90%). Guardando memoria e iniciando nueva sesión automáticamente...`,
      'info',
    );

    // 5. Schedule deferred command execution without LLM invocation
    setImmediate(() => {
      pi.sendUserMessage('/supervisor-rotate', { expandPromptTemplates: true });
    });
  }

  async onNewSessionStart(pi: any, ctx: any): Promise<void> {
    const newSessionId = ctx.sessionManager?.getSessionId?.() ?? ctx.sessionId ?? this.sessionId;
    this.sessionId = newSessionId;
    this.errorClassifier.setSessionId(newSessionId);

    // Handover single-owner lock to fresh session
    if (!this.lock.isHeld()) {
      this.lock.acquire({ enforceDistinctSession: false });
    }
    this.lock.handover(newSessionId);

    const handoverToken = this.state.rotationHandoverToken;
    // Consume and clear rotationHandoverToken immediately so manual /new does not replay old checkpoints
    delete this.state.rotationHandoverToken;
    this.isSupervisorRotating = false;

    if (!handoverToken) {
      // Manual /new session without an active supervisor rotation handover
      this.state.sessionId = newSessionId;
      this.state.status = this.canAutoContinue() ? 'active' : 'paused';
      this.state.updatedAt = Date.now();
      this.journal.saveState(this.state);
      return;
    }

    // Apply target model candidate (resolving Model object via ctx.modelRegistry) and thinking effort "high"
    const targetModelId = this.state.activeModel;
    const providerModelId = targetModelId.startsWith('cliproxyapi/')
      ? targetModelId.slice('cliproxyapi/'.length)
      : targetModelId;
    const resolvedModel =
      ctx?.modelRegistry?.getModel?.('cliproxyapi', providerModelId) ??
      ctx?.modelRegistry?.getModel?.('cliproxyapi', targetModelId) ??
      ctx?.modelRegistry?.find?.('cliproxyapi', providerModelId) ??
      ctx?.modelRegistry?.find?.('cliproxyapi', targetModelId) ?? {
        id: providerModelId,
        provider: 'cliproxyapi',
        name: providerModelId,
        api: 'openai-completions',
        baseUrl: process.env.CLIPROXYAPI_BASE_URL || 'http://127.0.0.1:8317/v1',
        reasoning: true,
        input: ['text', 'image'],
        thinkingLevelMap: {
          off: null,
          minimal: null,
          low: 'low',
          medium: 'medium',
          high: 'high',
          xhigh: 'high',
          max: 'high',
        },
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: this.contextGuard.getProviderContextWindowCap(targetModelId),
        maxTokens: 16384,
      };

    await pi.setModel?.(resolvedModel);
    pi.setThinkingLevel?.('high');

    // Owner readback preflight of checkpoint memory across all pages
    const checkpointId = this.state.lastCheckpointMemoryId;
    let preflightVerified = true;

    if (checkpointId && pi?.events?.emit) {
      let fullContent = '';
      let cursor: string | undefined;
      let getOk = false;
      let pageCount = 0;

      while (pageCount < 50) {
        pageCount++;
        const getRes: any = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ ok: false, error: 'get_timeout' }), 5000);
          pi.events.emit(MEMORY_CHECKPOINT_CHANNEL, {
            action: 'get',
            cwd: this.cwd,
            sessionId: newSessionId,
            id: checkpointId,
            cursor,
            respond: (res: any) => {
              clearTimeout(timer);
              resolve(res);
            },
          });
        });

        if (!getRes || !getRes.ok) {
          getOk = false;
          break;
        }
        getOk = true;
        if (typeof getRes.content === 'string') {
          fullContent += getRes.content;
        }
        if (getRes.has_more && getRes.next_cursor) {
          cursor = getRes.next_cursor;
        } else {
          break;
        }
      }

      if (!getOk) {
        preflightVerified = false;
      } else if (fullContent.trim().length > 0) {
        try {
          const parsedCheckpoint = JSON.parse(fullContent);
          const verification = this.verifyCheckpointPreflight(parsedCheckpoint);
          if (!verification.verified) {
            preflightVerified = false;
            this.setUserPaused(true);
            ctx?.ui?.notify?.(
              `Checkpoint preflight verification failed (${verification.reason}); halting automatic continuation.`,
              'error',
            );
          }
        } catch {
          preflightVerified = false;
          this.setUserPaused(true);
          ctx?.ui?.notify?.(
            'Checkpoint preflight JSON parse failed; halting automatic continuation.',
            'error',
          );
        }
      }

      if (getOk) {
        const shouldTrigger =
          this.canAutoContinue() &&
          Boolean(this.state.authorizedContinuation) &&
          preflightVerified;

        const summaryText = this.lastAssistantSummary
          ? `\nÚltimo estado reportado:\n"""\n${this.lastAssistantSummary.slice(0, 800)}\n"""\n`
          : '';
        const instruction = `[supervisor-continuity] Rotated to fresh session on ${targetModelId} (effort: high). Read verified checkpoint memory ID ${checkpointId} via memory_get and paginate completely before continuing.${summaryText}`;

        if (shouldTrigger) {
          this.pendingContinuationInstruction = instruction;
          ctx?.ui?.notify?.(
            `Nueva sesión iniciada automáticamente con modelo ${targetModelId}. Reanudando tarea desde memoria ID ${checkpointId}...`,
            'info',
          );
          setImmediate(() => {
            if (this.pendingContinuationInstruction) {
              const instr = this.pendingContinuationInstruction;
              this.pendingContinuationInstruction = undefined;
              pi.sendUserMessage?.(instr);
            }
          });
        } else if (typeof pi.sendMessage === 'function') {
          pi.sendMessage(
            {
              customType: 'supervisor-continuity',
              content: instruction,
              display: true,
              details: {
                checkpointId,
                targetModel: targetModelId,
                triggerTurn: false,
              },
            },
            { triggerTurn: false },
          );
        } else if (typeof ctx?.ui?.setEditorText === 'function') {
          ctx.ui.setEditorText(instruction);
        }
      }
    }

    this.state.sessionId = newSessionId;
    this.state.status = this.canAutoContinue() && preflightVerified ? 'active' : 'paused';
    this.state.updatedAt = Date.now();
    this.journal.saveState(this.state);
  }

  verifyCheckpointPreflight(parsed: any): { verified: boolean; reason?: string } {
    if (!parsed || typeof parsed !== 'object') {
      return { verified: false, reason: 'invalid_checkpoint_object' };
    }

    const reasons: string[] = [];

    if (parsed.gitState && typeof parsed.gitState === 'object') {
      const currentGit = this.getGitState();
      if (parsed.gitState.branch && currentGit.branch && parsed.gitState.branch !== currentGit.branch) {
        reasons.push('git_branch_mismatch');
      }
      if (parsed.gitState.headSha && currentGit.headSha && parsed.gitState.headSha !== currentGit.headSha) {
        reasons.push('git_head_sha_mismatch');
      }
      if (parsed.gitState.baseCommit && currentGit.baseCommit && parsed.gitState.baseCommit !== currentGit.baseCommit) {
        reasons.push('git_base_commit_mismatch');
      }
      if (
        parsed.gitState.statusDiffHash &&
        currentGit.statusDiffHash &&
        parsed.gitState.statusDiffHash !== currentGit.statusDiffHash
      ) {
        reasons.push('git_working_tree_diff_mismatch');
      }
    }

    if (parsed.artifactHashes && typeof parsed.artifactHashes === 'object') {
      for (const [artifactPath, expectedHash] of Object.entries(parsed.artifactHashes)) {
        if (typeof expectedHash !== 'string') continue;
        const resolved = isAbsolute(artifactPath) ? artifactPath : join(this.cwd, artifactPath);
        if (!existsSync(resolved)) {
          reasons.push(`missing_artifact:${artifactPath}`);
          continue;
        }
        try {
          const actualHash = createHash('sha256').update(readFileSync(resolved)).digest('hex');
          if (actualHash !== expectedHash) {
            reasons.push(`artifact_hash_mismatch:${artifactPath}`);
          }
        } catch {
          reasons.push(`unreadable_artifact:${artifactPath}`);
        }
      }
    }

    if (reasons.length > 0) {
      return { verified: false, reason: reasons.join(', ') };
    }

    return { verified: true };
  }

  getArtifactHashes(): Record<string, string> {
    const hashes: Record<string, string> = {};
    const paths = new Set<string>(this.state.referencedArtifacts ?? []);
    const slug = this.state.authorizedContinuation?.changeSlug;
    if (slug) {
      paths.add(join('openspec', 'changes', slug, 'plan.md'));
      paths.add(join('openspec', 'changes', slug, 'apply.md'));
    }

    for (const p of paths) {
      const resolved = isAbsolute(p) ? p : join(this.cwd, p);
      if (existsSync(resolved)) {
        try {
          hashes[p] = createHash('sha256').update(readFileSync(resolved)).digest('hex');
        } catch {}
      }
    }
    return hashes;
  }

  getGitState(): GitStateSnapshot {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const headSha = execSync('git rev-parse HEAD', {
        cwd: this.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      let baseCommit = headSha;
      try {
        baseCommit = execSync('git merge-base HEAD main', {
          cwd: this.cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() || headSha;
      } catch {}
      const statusOut = execSync('git status --porcelain', {
        cwd: this.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const diffOut = execSync('git diff HEAD', {
        cwd: this.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const statusDiffHash = createHash('sha256')
        .update(`${statusOut}\n${diffOut}`)
        .digest('hex');
      return { branch, headSha, baseCommit, statusDiffHash };
    } catch {
      return {};
    }
  }

  dispose(reason?: 'quit' | 'reload' | 'new' | 'resume' | 'fork' | string): void {
    this.isDisposed = true;
    this.stopPeriodicPolling();
    this.subagentMonitor.dispose();

    const retainLock =
      reason === 'reload' ||
      (reason === 'new' && (Boolean(this.state.rotationHandoverToken) || this.isSupervisorRotating));

    if (!retainLock) {
      this.lock.release();
    }
  }
}
