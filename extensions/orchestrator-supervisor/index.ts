import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { randomUUID } from 'node:crypto';
import { SUPERVISOR_EXTENSION_NAME, computeFlowIdentity, isExtensionEnabled, resolveSupervisorDir } from './src/config.ts';
import { ContextGuard } from './src/context-guard.ts';
import { ErrorClassifier, type ClassificationAction } from './src/error-classifier.ts';
import { FlowJournal, isMutatingTool } from './src/journal.ts';
import { FlowLock } from './src/lock.ts';
import { QuotaManager } from './src/quota-manager.ts';
import { isSupervisorEnabled, loadSupervisorConfig, updateSupervisorConfig, selectSupervisorConfigScope, getActiveCandidateIds, type SupervisorConfig } from './src/supervisor-config.ts';
import { assertWorkSettled, verifiedCheckpoint, defaultSubagentTaskRegistry } from './src/bridge.ts';
import { type SupervisorPanelState } from './src/supervisor-panel.ts';
import { createSupervisorDashboard } from './src/supervisor-dashboard.ts';
import { loadSubagentConfig, updateSubagentConfig, selectSubagentConfigScope } from './src/subagent-config.ts';
import { resolveConfigurationLocation } from './src/configuration-scope.ts';
import { registerSubagentAssignment } from './src/subagent-assignment.ts';
import { isValidCandidateId } from './src/candidate-id.ts';
import { applyLiveSupervisorConfig } from './src/supervisor-live-config.ts';
import { supportedModelEfforts, type ModelEffort } from './src/model-effort.ts';
import type { ModelCandidate, RegisteredModel, SupervisorSafetyFaultKind, SupervisorState } from './src/types.ts';

interface ReadyRotation {
  token: string;
  sessionId: string;
  checkpoint: { id: number; content: string };
  continueTask: boolean;
}

/**
 * `@earendil-works/pi-tui` is a host virtual module, not a dependency of this directory,
 * so it is loaded only when this host actually offers custom components. Failure keeps
 * the command working through its plain dialog instead of breaking the `/supervisor` panel.
 */
async function loadRoutingSelectorLib(): Promise<any | undefined> {
  try { return await import('@earendil-works/pi-tui'); } catch { return undefined; }
}

interface Runtime {
  sessionId: string;
  cwd: string;
  state: SupervisorState;
  journal: FlowJournal;
  lock: FlowLock;
  errors: ErrorClassifier;
  quotas: QuotaManager;
  guard: ContextGuard;
  /** Automatic rotation at the measured boundary; false leaves only the explicit command. */
  autoRotate: boolean;
  /** Automatic model assignment (startup, failover, provider recovery). */
  autoSwitchModel: boolean;
  timer?: ReturnType<typeof setInterval>;
  /** Interval the current timer was created with; panel edits compare against it. */
  pollMs: number;
  polling: boolean;
  inventoryReady: boolean;
  inventoryError?: string;
  inventoryRefresh?: Promise<void>;
  disposed: boolean;
  ready?: ReadyRotation;
  dispatched: boolean;
  checkpointPrompted: boolean;
  pendingAction?: ClassificationAction;
  pendingTurnTrigger?: boolean;
  modelRevision: number;
  applyingModel?: string;
  /**
   * Explicit per-model reasoning effort (S1, S2), keyed by full candidate ID. An absent
   * entry for a given model preserves the former behaviour: the Orchestrator keeps
   * applying `high` for that model exactly as before this feature existed.
   */
  modelEfforts: Record<string, ModelEffort>;
  ctx: any;
}

// The host caches this module's factory, but invokes it for each new session.
// Key by the actual manager, not a session-id string, to avoid cross-session lookup.
const sessionRuntimes = new WeakMap<object, Runtime>();
const sessionId = (ctx: any) => ctx.sessionManager?.getSessionId?.();
// The environment opt-in gates loading; the persisted per-project flag gates acting.
// Both are re-read on every bind so a live toggle takes effect before the next handler.
const boundRuntime = (r: Runtime | undefined, ctx: any): Runtime | undefined => r && !r.disposed &&
  ctx.mode === 'tui' && r.sessionId === sessionId(ctx) && r.cwd === ctx.cwd &&
  (!ctx.isProjectTrusted || ctx.isProjectTrusted()) &&
  isExtensionEnabled(SUPERVISOR_EXTENSION_NAME, ctx.cwd) && isSupervisorEnabled(ctx.cwd) ? r : undefined;

/**
 * Host capabilities the suite injects explicitly. `@earendil-works/pi-tui` is a virtual
 * module resolved only by a live host, so `npm test` can never import it.
 */
export interface SupervisorHostOverrides {
  panelLib?: any;
}

export default function supervisor(pi: ExtensionAPI, overrides: SupervisorHostOverrides = {}): void {
  registerSubagentAssignment(pi);

  if ((pi as any).events) {
    defaultSubagentTaskRegistry.attach((pi as any).events);
  }

  let runtime: Runtime | undefined;
  let switching = false;
  let preparing = false;
  let reportedConfigError: string | undefined;

  // Listen to reload guard query on pi.events
  if ((pi as any).events && typeof (pi as any).events.on === 'function') {
    (pi as any).events.on('supervisor:reload-guard:v1', (query: { cwd?: string; defer: (reason: string) => void }) => {
      const r = runtime && !runtime.disposed ? runtime : undefined;
      if (!r) return;
      if (query?.cwd && r.cwd !== query.cwd) return;

      if (hasPending(r)) {
        query.defer?.('Unsettled mutating tool in flight');
        return;
      }
      if (r.ready || switching || preparing) {
        query.defer?.('Supervisor session rotation in progress');
        return;
      }
      if (r.state.uncertainMutationsCount > 0) {
        query.defer?.('Uncertain prior mutation effects unconfirmed');
        return;
      }
      if (defaultSubagentTaskRegistry.hasActiveTasksForSession(r.sessionId)) {
        query.defer?.('Active subagent task in flight');
        return;
      }
    });
  }

  // Live enable/disable: a persisted flag turned off while this session runs tears the
  // runtime down before any handler can act, and turning it back on recreates the
  // runtime with its timer on the next interaction, without a reload.
  const bound = (ctx: any): Runtime | undefined => {
    if (runtime && !runtime.disposed && !isSupervisorEnabled(ctx.cwd)) teardownRuntime(ctx);
    if (!runtime || runtime.disposed) ensureRuntime(ctx);
    return boundRuntime(runtime, ctx);
  };
  const persist = (r: Runtime) => {
    r.state.updatedAt = Date.now();
    r.state.pendingTaskDeliveries = defaultSubagentTaskRegistry.getActiveTasksForSession(r.sessionId).map(t => t.taskId);
    r.journal.saveState(r.state);
  };
  /**
   * The only fences that stop a live runtime: interrupted mutation effects that a human has
   * not confirmed yet, and a real safety fault (credentials, handover, WAL).
   */
  const halted = (r: Runtime) => r.state.uncertainMutationsCount > 0 || Boolean(r.state.safetyFault);
  const haltedMessage = (r: Runtime) => r.state.uncertainMutationsCount > 0
    ? 'Supervisor halted: interrupted mutation effects are unconfirmed. Inspect them, then switch the supervisor off and on in the configuration panel (/supervisor).'
    : `Supervisor halted by a ${r.state.safetyFault?.kind ?? 'safety'} fault. Resolve it, then switch the supervisor off and on in the configuration panel (/supervisor).`;
  const fault = (r: Runtime, kind: SupervisorSafetyFaultKind, message: string) => {
    r.state.safetyFault = { kind, message, at: Date.now() };
  };
  const notify = (ctx: any, message: string, level: 'info' | 'warning' | 'error' = 'info') => ctx.ui?.notify?.(message, level);
  const status = (r: Runtime, label: string) => r.ctx.ui?.setStatus?.('orchestrator-supervisor', `supervisor · ${label}`);
  const modelId = (ctx: any) => ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
  const selected = (r: Runtime, id?: string): boolean => {
    if (typeof id !== 'string' || !id) return false;
    try {
      if (r.quotas.getPriorityCandidateIds().includes(id)) return true;
      return r.quotas.isSelected(id);
    }
    catch { return false; }
  };
  const refreshCandidates = async (r: Runtime, ctx: any) => {
    if (r.inventoryRefresh) return r.inventoryRefresh;
    const refresh = (async () => {
      if (runtime !== r || r.disposed) return;
      if (typeof ctx.modelRegistry?.refresh === 'function') {
        try { await ctx.modelRegistry.refresh({ providers: ['cliproxyapi'] }); }
        catch { /* Optional refresh failure */ }
      }
      try { r.quotas.setRegisteredModels(hostRegisteredModels(ctx)); }
      catch { /* No host catalogue available. */ }
      try {
        await r.quotas.discoverCandidates(id => Boolean(ctx.modelRegistry?.find?.('cliproxyapi', id.slice('cliproxyapi/'.length))));
        if (runtime !== r || r.disposed) return;
        r.inventoryReady = true;
        r.inventoryError = undefined;
      } catch (error) {
        if (runtime === r && !r.disposed) r.inventoryError = inventoryFailure(error);
        throw error;
      }
    })();
    r.inventoryRefresh = refresh;
    try { await refresh; }
    finally { if (r.inventoryRefresh === refresh) r.inventoryRefresh = undefined; }
  };
  const exceeded = (r: Runtime, ctx: any): boolean => {
    const usage = ctx.getContextUsage?.();
    return Boolean(usage && Number.isFinite(usage.tokens) && usage.tokens !== null &&
      r.guard.evaluateUsage(usage, modelId(ctx) || r.state.activeModel).isReserveExceeded);
  };
  const cancelReady = (r: Runtime) => { r.ready = undefined; r.dispatched = false; };

  function ensureRuntime(ctx: any): Runtime | undefined {
    if (ctx.mode !== 'tui' || !sessionId(ctx) || (ctx.isProjectTrusted && !ctx.isProjectTrusted()) ||
        !isExtensionEnabled(SUPERVISOR_EXTENSION_NAME, ctx.cwd)) return undefined;
    const loaded = loadSupervisorConfig(ctx.cwd);
    const stopOwnLiveRuntime = (): boolean => {
      if (!runtime || runtime.disposed || runtime.cwd !== ctx.cwd) return false;
      teardownRuntime(ctx);
      return true;
    };
    if (loaded.error) {
      stopOwnLiveRuntime();
      if (reportedConfigError !== loaded.error) {
        reportedConfigError = loaded.error;
        notify(ctx, `Supervisor disabled: ${loaded.error}`, 'warning');
      }
      return undefined;
    }
    reportedConfigError = undefined;
    if (!loaded.config.enabled) { stopOwnLiveRuntime(); return undefined; }
    if (runtime && !runtime.disposed) { runtime.ctx = ctx; return runtime; }
    let lock: FlowLock | undefined;
    try {
      const id = sessionId(ctx)!;
      const identity = computeFlowIdentity(ctx.cwd, id);
      const dir = resolveSupervisorDir(identity);
      lock = new FlowLock(dir, identity, id); lock.acquire({ enforceDistinctSession: true });
      const journal = new FlowJournal(dir, identity, id);
      const state: SupervisorState = journal.loadState() || { flowIdentity: identity, sessionId: id, activeModel: modelId(ctx) ?? '', status: 'active', activeGeneration: 1, uncertainMutationsCount: 0, updatedAt: Date.now() };
      if (state.flowIdentity !== identity || state.sessionId !== id) throw new Error('Invalid supervisor state identity');
      const legacy = state as unknown as Record<string, unknown>;
      delete legacy.userPaused; delete legacy.userCancelled;
      if (state.status !== 'idle') state.status = 'active';
      journal.recoverOnStartup(); state.uncertainMutationsCount = journal.getUncertainEntries().length;
      const { config } = loaded;
      const errors = new ErrorClassifier(id, { maxTransientFailures: config.maxTransientFailures, cooldownMs: config.cooldownMinutes * 60_000 });
      const quotas = new QuotaManager({ codexQuotaThresholdPercent: config.codexQuotaThresholdPercent, priorityCandidateIds: getActiveCandidateIds(config) });
      const guard = new ContextGuard({ rotationThresholdPercent: config.rotationThresholdPercent });
      guard.setAutoRotate(config.autoRotate);
      const r: Runtime = { sessionId: id, cwd: ctx.cwd, state, journal, lock, errors, quotas, guard, autoRotate: config.autoRotate, autoSwitchModel: config.autoSwitchModel, polling: false, inventoryReady: false, modelRevision: 0, disposed: false, dispatched: false, checkpointPrompted: false, pollMs: config.pollIntervalSeconds * 1000, modelEfforts: config.modelEfforts ?? {}, ctx };
      r.state.pendingTaskDeliveries = defaultSubagentTaskRegistry.getActiveTasksForSession(id).map(t => t.taskId);
      runtime = r; persist(r);
      sessionRuntimes.set(ctx.sessionManager, r);
      status(r, state.safetyFault ? `halted: ${state.safetyFault.kind}` : state.uncertainMutationsCount ? 'uncertain effects' : 'active');
      if (state.uncertainMutationsCount) notify(ctx, 'Interrupted mutations detected. Inspect their effects, then confirm them by switching the supervisor off and on in the configuration panel (/supervisor). Read-only tools remain available.', 'warning');
      if (state.safetyFault) notify(ctx, `${haltedMessage(r)} (${state.safetyFault.message})`, 'warning');
      r.timer = setInterval(() => poll(r), config.pollIntervalSeconds * 1000); r.timer.unref();
      return r;
    } catch (error) { lock?.release(); notify(ctx, `Supervisor initialization failed: ${String(error)}`, 'error'); return undefined; }
  }

  function teardownRuntime(ctx?: any): void {
    const r = runtime;
    runtime = undefined;
    if (r) {
      if (r.timer) { clearInterval(r.timer); r.timer = undefined; }
      cancelReady(r);
      r.state.owedProviderTurn = false;
      r.state.status = 'stopped';
      try { persist(r); } catch { /* Teardown must not fail on a persistence error. */ }
      try { sessionRuntimes.delete(r.ctx.sessionManager); } catch { /* Context may already be disposed. */ }
      try { r.lock.release(); } catch { /* Lock cleanup is best effort. */ }
      r.disposed = true;
      try { r.ctx?.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, undefined); } catch { /* Stale context. */ }
    }
    try { ctx?.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, undefined); } catch { /* Stale context. */ }
  }

  const applyLiveConfig = (ctx: any, next: SupervisorConfig): void => {
    const live = boundRuntime(runtime, ctx);
    if (!live) return;
    live.modelEfforts = next.modelEfforts ?? {};
    applyLiveSupervisorConfig({
      quotas: live.quotas,
      guard: live.guard,
      errors: live.errors,
      setAutoSwitchModel: (enabled: boolean) => { live.autoSwitchModel = enabled; },
      pollMs: live.pollMs,
      restartPollTimer: (intervalMs: number) => {
        if (live.timer) clearInterval(live.timer);
        live.timer = setInterval(() => poll(live), intervalMs);
        live.timer.unref();
        live.pollMs = intervalMs;
      },
    }, next);
  };

  async function enrichWithSupportedEfforts(ctx: any, candidates: ModelCandidate[]): Promise<ModelCandidate[]> {
    return Promise.all(candidates.map(async candidate => {
      let model: any;
      try {
        const modelSlug = candidate.id.slice(candidate.provider.length + 1);
        model = ctx.modelRegistry?.find?.(candidate.provider, modelSlug);
      } catch { model = undefined; }
      if (!model) return candidate;
      let supportedEfforts: ModelEffort[];
      try { supportedEfforts = await supportedModelEfforts(model); }
      catch { supportedEfforts = []; }
      if (!supportedEfforts.length) return candidate;
      return { ...candidate, supportedEfforts };
    }));
  }

  async function panelCatalogue(ctx: any): Promise<{ candidates: ModelCandidate[]; discoveryFailed: boolean }> {
    const live = boundRuntime(runtime, ctx);
    if (live) {
      try { await refreshCandidates(live, ctx); } catch { /* Reported through inventoryError. */ }
      if (boundRuntime(runtime, ctx) === live) {
        return { candidates: await enrichWithSupportedEfforts(ctx, live.quotas.getCandidates()), discoveryFailed: Boolean(live.inventoryError) };
      }
    }
    const loaded = loadSupervisorConfig(ctx.cwd);
    const probe = new QuotaManager({
      codexQuotaThresholdPercent: loaded.config.codexQuotaThresholdPercent,
      priorityCandidateIds: getActiveCandidateIds(loaded.config),
    });
    try { probe.setRegisteredModels(hostRegisteredModels(ctx)); } catch { /* Host catalogue unavailable. */ }
    let discoveryFailed = false;
    try {
      await probe.discoverCandidates(id => Boolean(ctx.modelRegistry?.find?.('cliproxyapi', id.slice('cliproxyapi/'.length))));
    } catch { discoveryFailed = true; }
    return { candidates: await enrichWithSupportedEfforts(ctx, probe.getCandidates()), discoveryFailed };
  }

  const persistedUncertain = (ctx: any): number => {
    const id = sessionId(ctx);
    if (!id) return 0;
    try {
      const identity = computeFlowIdentity(ctx.cwd, id);
      const journal = new FlowJournal(resolveSupervisorDir(identity), identity, id);
      return journal.getEntries().filter(entry => entry.isMutating && entry.status !== 'settled').length;
    } catch {
      return 0;
    }
  };

  const panelState = (ctx: any): SupervisorPanelState => {
    const live = boundRuntime(runtime, ctx);
    const enabled = isSupervisorEnabled(ctx.cwd);
    if (!live) return { enabled, running: false, uncertain: persistedUncertain(ctx), activeModel: modelId(ctx) };
    let ids: string[] = [];
    try { ids = live.quotas.getCandidates().map(candidate => candidate.id); } catch { /* No inventory to report. */ }
    return {
      enabled,
      running: true,
      status: live.state.safetyFault ? `halted: ${live.state.safetyFault.kind}`
        : live.state.uncertainMutationsCount > 0 ? 'halted: uncertain effects' : live.state.status,
      activeModel: modelId(ctx) || live.state.activeModel,
      checkpoint: live.ready?.checkpoint.id,
      lastCheckpoint: live.state.lastCheckpointMemoryId,
      uncertain: live.state.uncertainMutationsCount,
      inventory: live.inventoryReady ? (ids.join(', ') || 'none') : 'not discovered yet',
      inventoryError: live.inventoryError,
    };
  };

  async function openSupervisorPanel(ctx: any): Promise<void> {
    if (ctx.mode !== 'tui' || (ctx.isProjectTrusted && !ctx.isProjectTrusted())) return;
    const loaded = loadSupervisorConfig(ctx.cwd);
    const lib = overrides.panelLib ?? await loadRoutingSelectorLib();
    if (!lib || typeof ctx.ui?.custom !== 'function') {
      notify(ctx, 'The configuration panel needs a host with custom components; this session cannot configure the supervisor.', 'warning');
      return;
    }
    const owner = sessionId(ctx);
    const current = (): boolean => {
      try {
        return ctx.mode === 'tui' && sessionId(ctx) === owner && (!ctx.isProjectTrusted || ctx.isProjectTrusted());
      } catch {
        return false;
      }
    };
    const catalogue = await panelCatalogue(ctx);
    if (!current()) return;
    const subagents = loadSubagentConfig(ctx.cwd);
    const locationFor = (kind: 'supervisor' | 'subagents') => {
      try { return resolveConfigurationLocation(ctx.cwd, kind); }
      catch (error) { return { scope: 'unavailable' as const, path: String(error) }; }
    };
    const subagentCandidates: ModelCandidate[] = await enrichWithSupportedEfforts(ctx, hostRegisteredModels(ctx)
      .filter(model => isValidCandidateId(`${model.provider}/${model.id}`))
      .map(model => ({
        id: `${model.provider}/${model.id}`,
        provider: model.provider,
        modelSlug: model.id,
        source: 'registered',
        quotaProtocol: 'none',
        reasoningEffort: 'high',
        contextWindowCap: model.contextWindow,
      })));
    if (!current()) return;
    try {
      await ctx.ui.custom((tui: any, theme: any, keybindings: any, done: () => void) => createSupervisorDashboard({
        orchestrator: {
          lib,
          tui,
          theme,
          keybindings,
          config: loaded.config,
          error: loaded.error,
          scopeControl: {
            location: locationFor('supervisor'),
            select: scope => {
              if (!current()) throw new Error('The supervisor panel session was replaced.');
              const selected = selectSupervisorConfigScope(ctx.cwd, scope);
              if (!selected.config.enabled) teardownRuntime(ctx);
              else { ensureRuntime(ctx); applyLiveConfig(ctx, selected.config); }
              return selected;
            },
          },
          state: () => panelState(ctx),
          candidates: catalogue.candidates,
          discoveryFailed: catalogue.discoveryFailed,
          isBound: current,
          applyConfig: (patch: Partial<SupervisorConfig>) => {
            if (!current()) throw new Error('The supervisor panel session was replaced.');
            const next = updateSupervisorConfig(ctx.cwd, patch);
            applyLiveConfig(ctx, next);
            return next;
          },
          onEnabledChange: (enabled: boolean, acknowledgeUncertain = false) => {
            if (!enabled) { teardownRuntime(ctx); return; }
            const r = ensureRuntime(ctx);
            if (!r) return;
            if (acknowledgeUncertain) {
              r.journal.acknowledgeUncertainEntries();
              r.state.uncertainMutationsCount = 0;
            }
            r.state.safetyFault = undefined;
            r.state.status = 'active';
            r.state.owedProviderTurn = false; r.checkpointPrompted = false;
            persist(r);
            status(r, halted(r) ? 'halted: unconfirmed effects' : 'active');
          },
          onError: (message: string) => notify(ctx, message, 'warning'),
          done,
        },
        subagents: {
          config: subagents.config,
          scopeControl: {
            location: locationFor('subagents'),
            select: scope => {
              if (!current()) throw new Error('The supervisor panel session was replaced.');
              return selectSubagentConfigScope(ctx.cwd, scope);
            },
          },
          candidates: subagentCandidates,
          error: subagents.error,
          applyConfig: patch => {
            if (!current()) throw new Error('The supervisor panel session was replaced.');
            return updateSubagentConfig(ctx.cwd, patch);
          },
        },
        framed: true,
      }), {
        overlay: true,
        overlayOptions: { anchor: 'center' },
      });
    } catch (error) {
      notify(ctx, `Supervisor panel failed: ${String(error)}`, 'error');
    }
  }

  const dispatchHandover = (r: Runtime): void => {
    const ready = r.ready;
    if (!ready) return;
    r.dispatched = true;
    try { pi.sendUserMessage(`/supervisor-rotate ${ready.token}`, { expandPromptTemplates: true }); }
    catch (error) { r.dispatched = false; throw error; }
  };
  const hasPending = (r: Runtime) => r.journal.getEntries().some(e => e.status === 'pending' && e.isMutating);

  const updateModel = async (r: Runtime, ctx: any, id: string): Promise<boolean> => {
    if (!r.autoSwitchModel) return false;
    const candidate = r.quotas.getCandidates().find(c => c.id === id);
    if (!candidate || halted(r) || !r.quotas.isSelected(id)) return false;
    const modelSlug = id.slice(candidate.provider.length + 1);
    let model = ctx.modelRegistry?.find?.(candidate.provider, modelSlug);
    if (!model) {
      model = hostRegisteredModels(ctx).find(item => item.provider === candidate.provider && item.id === modelSlug);
    }
    if (!model && typeof ctx.modelRegistry?.refresh === 'function') {
      try {
        await ctx.modelRegistry.refresh({ providers: [candidate.provider] });
        model = ctx.modelRegistry.find?.(candidate.provider, modelSlug);
      } catch { /* Refresh error */ }
    }
    if (!model) { status(r, `model unavailable: ${id}`); return false; }
    const revision = r.modelRevision;
    r.applyingModel = id;
    let applied: boolean;
    try { applied = await pi.setModel(model); }
    finally { r.applyingModel = undefined; }
    if (!applied || runtime !== r || r.disposed || halted(r) || revision !== r.modelRevision) return false;
    r.state.activeModel = id as SupervisorState['activeModel'];
    try { pi.setThinkingLevel(r.modelEfforts[id] ?? 'high'); }
    catch { /* Ignore effort clamp rejection */ }
    persist(r);
    status(r, id);
    notify(ctx, `Supervisor switched to routing model ${id}.`);
    void sendNotification(`Model changed to ${id}`);
    return true;
  };

  const poll = async (r: Runtime) => {
    if (!isSupervisorEnabled(r.cwd)) { teardownRuntime(r.ctx); return; }
    if (r.polling || r.disposed || halted(r) || (!r.state.owedProviderTurn && !selected(r, modelId(r.ctx)))) return;
    r.polling = true;
    try {
      await refreshCandidates(r, r.ctx);
      if (r.disposed || runtime !== r || halted(r)) return;
      if (!selected(r, modelId(r.ctx))) return;
      if (r.state.owedProviderTurn && r.autoSwitchModel && r.state.status === 'idle') {
        const revision = r.modelRevision;
        const best = await r.quotas.selectBestCandidate(r.errors.getCooldowns(), { forceFresh: true, excluded: r.errors.getExcludedCandidates() });
        if (!best.candidate || revision !== r.modelRevision || !r.state.owedProviderTurn || r.disposed || runtime !== r || halted(r) || !r.ctx.isIdle?.() || r.ready || preparing || hasPending(r)) return;
        if (!(await updateModel(r, r.ctx, best.candidate.id))) return;
        if (r.disposed || runtime !== r || halted(r) || !r.state.owedProviderTurn || !r.ctx.isIdle?.()) return;
        r.state.owedProviderTurn = false; r.state.status = 'active'; persist(r);
        pi.sendMessage({ customType: 'supervisor-provider-recovery',
          content: providerRecoveryMessage,
          display: true, details: {} }, { triggerTurn: true });
        return;
      }
    } catch { if (!r.disposed) status(r, 'account/quota unavailable; current model unchanged'); }
    finally { r.polling = false; }
  };

  pi.registerCommand('supervisor', {
    description: 'Supervisor configuration: independent Project/Global sources and effective paths for Orchestrator and Subagents; Orchestrator state, model slots and automation; Subagents enable, unique Pi model slots (2–20) and least-loaded model assignment.',
    handler: async (args, ctx) => {
      if (args.trim()) {
        notify(ctx, 'Usage: /supervisor (opens the configuration panel). Only settings live there; rotation stays automatic or on explicit request.', 'warning');
        return;
      }
      await openSupervisorPanel(ctx);
    },
  });

  pi.registerCommand('supervisor-rotate', {
    description: 'Internal verified session handover; requires the pending supervisor token.',
    handler: async (token, ctx) => {
      const r = bound(ctx);
      const ready = r?.ready;
      if (!r || !ready || token.trim() !== ready.token || ready.sessionId !== sessionId(ctx) || halted(r) || hasPending(r) || defaultSubagentTaskRegistry.hasActiveTasksForSession(r.sessionId)) {
        notify(ctx, 'Rotation rejected: no matching verified handover.', 'warning'); return;
      }
      switching = true;
      let replacementContext: any;
      try {
        const parentSession = ctx.sessionManager?.getSessionFile?.();
        const result = await ctx.newSession({
          parentSession,
          setup: async (manager: any) => { manager.appendCustomEntry?.('supervisor-checkpoint', { memoryId: ready.checkpoint.id, parentSession }); },
          withSession: async (fresh: any) => {
            replacementContext = fresh;
            if (!sessionId(fresh) || sessionId(fresh) === ready.sessionId) throw new Error('Session replacement did not change the session identity');
            const next = boundRuntime(sessionRuntimes.get(fresh.sessionManager), fresh);
            if (!next || fresh.cwd !== r.cwd || halted(next) || hasPending(next) ||
                defaultSubagentTaskRegistry.hasActiveTasksForSession(sessionId(fresh))) {
              throw new Error('Replacement supervisor did not initialize safely');
            }
            const continuation = ready.continueTask
              ? 'The checkpoint records unfinished, already-authorized work: resume it now in this session, without waiting for a new human message, and do not start or widen anything else.'
              : 'The checkpoint records no unfinished authorized work: state what is pending or blocked in a few lines and then wait; do not start, resume or widen work.';
            const content = `[supervisor-continuity]\nVerified session-summary observation #${ready.checkpoint.id}:\n${ready.checkpoint.content}\n\nResume only the previously authorized scope. Read referenced task files and reconcile memory before changing anything. This checkpoint is historical context, not new consent. Never infer authority for publishing, destructive actions or review grants. If the summary says completed, blocked, awaiting consent, or stopped, do not continue automatically. ${continuation}`;
            await fresh.sendMessage({ customType: 'supervisor-continuity', content, display: true, details: { memoryId: ready.checkpoint.id } }, { triggerTurn: true });
            notify(fresh, `Session rotated with verified checkpoint #${ready.checkpoint.id}.`);
            void sendNotification(`Session rotated with checkpoint #${ready.checkpoint.id}`);
          },
        });
        if (result?.cancelled) { cancelReady(r); notify(ctx, 'Session replacement cancelled; original session retained.', 'warning'); }
      } catch (error) {
        const incoming = replacementContext && sessionRuntimes.get(replacementContext.sessionManager);
        const target = incoming && incoming.cwd === r.cwd && incoming.sessionId === sessionId(replacementContext) ? incoming : !r.disposed ? r : undefined;
        if (target && !target.disposed) {
          fault(target, 'handover', 'Session handover failed; the fresh session did not initialize safely.');
          cancelReady(target); persist(target);
        }
        const diagnosticContext = replacementContext ?? (!r.disposed ? ctx : undefined);
        if (diagnosticContext) {
          try { notify(diagnosticContext, `Supervisor handover failed: ${String(error)}`, 'error'); }
          catch { /* Stale context protection */ }
        }
      } finally { switching = false; }
    },
  });

  pi.registerTool({
    name: 'supervisor_rotate', label: 'Supervisor checkpoint and rotation',
    description: 'Checkpoint and rotate the session immediately. Saves the continuity summary to persistent memory, verifies the readback and that all subagents are settled, then opens the fresh session at once. The fresh session always starts exactly one turn; continue_task picks its instruction. This is the only action needed at the rotation boundary: call it once and make no further tool calls.',
    promptGuidelines: [
      'At the measured 90% context boundary (or when the user asks to rotate), call supervisor_rotate exactly once with a concise 150–250-word continuity summary. That single call saves to persistent memory and opens the fresh session immediately; do not try to finish, verify or edit work first, and make no other tool calls in that turn.',
      'Include active goal and exact user limits, completed/pending work and checks, task-file pointers (not file contents), environment state, and next authorized step. Clearly state completed, blocked, stopped or awaiting consent when applicable.',
      'Set continue_task true only when there is unfinished work already authorized by the user: the fresh session always starts one turn, and with true that turn resumes that work immediately without waiting for a new human message; with false it reports the pending or blocked state and then waits. It grants no new authority.',
    ],
    parameters: { type: 'object', additionalProperties: false, properties: {
      summary: { type: 'string', minLength: 1, maxLength: 12000 },
      memory_id: { type: 'integer', minimum: 1, description: 'An existing session_summary observation, as an alternative to summary.' },
      continue_task: { type: 'boolean', description: 'Continue only unfinished work already authorized. Default false.' },
    } } as never,
    reachesTools: () => ['memory_save', 'memory_get', 'supervisor_rotate', 'subagent_run'],
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const r = bound(ctx);
      if (!r) throw new Error('Supervisor inactive; requires an interactive parent session');
      if (halted(r)) throw new Error(haltedMessage(r));
      if (preparing || r.ready) throw new Error('Supervisor checkpoint already in progress or scheduled');
      preparing = true;
      try {
        await assertWorkSettled(ctx, defaultSubagentTaskRegistry);
        if (hasPending(r)) throw new Error('Rotation deferred: unsettled mutation effects');
        const checkpoint = await verifiedCheckpoint(ctx, params as { summary?: string; memory_id?: number });
        await assertWorkSettled(ctx, defaultSubagentTaskRegistry);
        if (runtime !== r || r.disposed || halted(r) || hasPending(r)) throw new Error('Session changed or has unsettled effects during checkpoint');
        r.ready = { token: randomUUID(), sessionId: r.sessionId, checkpoint, continueTask: (params as any).continue_task === true };
        r.state.lastCheckpointMemoryId = checkpoint.id; persist(r);
        dispatchHandover(r);
        return { content: [{ type: 'text', text: `Rotation scheduled with verified checkpoint #${checkpoint.id}; opening the fresh session now. Do not call any more tools.` }], details: { scheduled: true, memoryId: checkpoint.id, dispatched: true } };
      } finally { preparing = false; }
    },
  });

  pi.on('session_start', async (event, ctx) => {
    const alreadyRunning = Boolean(runtime && !runtime.disposed);
    const r = ensureRuntime(ctx);
    if (!r) { ctx.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, undefined); return; }
    if (alreadyRunning) return;
    if (['startup', 'new'].includes(event.reason) && !halted(r)) {
      const revision = r.modelRevision;
      try {
        await refreshCandidates(r, ctx);
        if (r.autoSwitchModel && r.quotas.getPriorityCandidateIds().length > 0 &&
            bound(ctx) === r && revision === r.modelRevision && !halted(r)) {
          const best = await r.quotas.selectBestCandidate(r.errors.getCooldowns(), { forceFresh: true, excluded: r.errors.getExcludedCandidates() });
          if (bound(ctx) !== r || revision !== r.modelRevision || halted(r)) return;
          if (!best.candidate) {
            status(r, 'startup routing unavailable; no eligible routing model; current model unchanged');
          } else if (best.candidate.id !== modelId(ctx)) {
            await updateModel(r, ctx, best.candidate.id);
          }
        }
      } catch { if (bound(ctx) === r) status(r, 'startup routing unavailable; current model unchanged'); }
    }
  });

  pi.on('before_agent_start', async (_event, ctx) => {
    const r = bound(ctx); if (!r) return;
    r.ctx = ctx; r.checkpointPrompted = false;
    if ((_event as any).messageType === 'user' && r.state.owedProviderTurn) { r.state.owedProviderTurn = false; persist(r); }
    if ((_event as any).messageType === 'user') { r.pendingAction = undefined; r.modelRevision++; }
  });

  pi.on('model_select', (event, ctx) => {
    const r = bound(ctx); if (!r) return;
    const id = `${event.model.provider}/${event.model.id}`;
    if (r.applyingModel === id) return;
    r.modelRevision++;
    r.pendingAction = undefined;
    r.state.owedProviderTurn = false;
    if (selected(r, id)) r.state.activeModel = id as SupervisorState['activeModel'];
    if (r.state.status === 'idle') r.state.status = 'active';
    persist(r);
  });

  pi.on('tool_call', (event, ctx) => {
    const r = bound(ctx); if (!r) return;
    const name = event.toolName;
    const mutating = name !== 'supervisor_rotate' && isMutatingTool(name, event.input);
    if (r.state.uncertainMutationsCount && mutating) return { block: true, reason: 'Uncertain prior effects: inspect them, then confirm by switching the supervisor off and on in the configuration panel (/supervisor).' };
    if (r.ready && name !== 'supervisor_rotate' && isMutatingTool(name, event.input)) {
      return { block: true, reason: 'Verified rotation is scheduled; no new mutating effects until handover.' };
    }
    if (!halted(r) && name !== 'supervisor_rotate' && exceeded(r, ctx)) {
      const usage = ctx.getContextUsage()!;
      const metrics = r.guard.evaluateUsage(usage, modelId(ctx) || r.state.activeModel);
      const blocked = r.guard.interceptToolCall(event, metrics.tokens, metrics.contextWindow);
      if (blocked?.block) return { block: true, reason: blocked.reason };
    }
    try {
      r.journal.recordToolCallPre({ toolCallId: event.toolCallId, parentToolCallId: event.parentToolCallId, sessionId: r.sessionId, turnIndex: 0, toolName: name, args: event.input, isMutating: mutating });
    } catch { return { block: true, reason: 'Supervisor WAL failed; tool execution blocked.' }; }
  });

  pi.on('tool_result', (event, ctx) => {
    const r = bound(ctx); if (!r) return;
    try {
      r.journal.recordToolCallResult(event.toolCallId, event.isError, { content: event.content, details: event.details });
    } catch {
      fault(r, 'wal', 'Tool journal write failed; effects may be unsaved.');
      r.state.uncertainMutationsCount = Math.max(1, r.state.uncertainMutationsCount);
      status(r, 'WAL failure; halted');
    }
  });

  pi.on('message_end', (_event, _ctx) => {
    // Kept for lifecycle hook completeness
  });

  pi.on('turn_end', async (event, ctx) => {
    const r = bound(ctx); if (!r || halted(r)) return;
    const active = modelId(ctx) as SupervisorState['activeModel'];
    if (!active) return;
    const isSelectedModel = selected(r, active);
    if (!isSelectedModel && (!r.autoSwitchModel || r.quotas.getPriorityCandidateIds().length === 0)) return;
    r.state.activeModel = active;
    if (event.message?.stopReason !== 'error') { r.state.owedProviderTurn = false; if (r.state.status === 'idle') r.state.status = 'active'; persist(r); }
    const action = r.errors.handleMessageEnd(event.message, active, { mode: ctx.mode, sessionId: r.sessionId });
    if (action.type === 'fatal_proxy_key') {
      fault(r, 'credentials', 'Provider credentials rejected; automatic and manual rotation stay halted.');
      persist(r); status(r, 'provider credentials rejected; halted');
      r.pendingAction = action;
      return;
    }
    if (action.type === 'ignored' || action.type === 'success') {
      r.pendingAction = undefined;
      return;
    }
    if (!isSelectedModel && action.type !== 'cooldown_failover') {
      r.pendingAction = undefined;
      return;
    }
    r.pendingAction = action;
  });

  pi.on('agent_before_settle', async (event, ctx) => {
    const r = bound(ctx); if (!r || halted(r) || event.outcome === 'aborted' || r.ready) return;
    if (r.autoRotate && exceeded(r, ctx) && !r.checkpointPrompted && event.context.canContinue) {
      r.checkpointPrompted = true;
      return { entries: [{ type: 'custom_message', customType: 'supervisor-checkpoint-request', content: checkpointRequest, display: true, details: {} }], continue: true };
    }
    const action = r.pendingAction; r.pendingAction = undefined;
    if (!action) return;
    const revision = r.modelRevision;
    const recover = () => ({ entries: [{ type: 'custom_message' as const, customType: 'supervisor-provider-recovery', content: providerRecoveryMessage, display: true, details: {} }], continue: true });
    if (action.type === 'transient_retry') {
      await new Promise(resolve => setTimeout(resolve, action.retryDelayMs ?? 1000));
      if (bound(ctx) === r && revision === r.modelRevision && !halted(r) && !ctx.signal?.aborted) return recover();
    } else if (action.type === 'immediate_failover' || action.type === 'cooldown_failover') {
      r.state.owedProviderTurn = true; persist(r);
      if (!r.autoSwitchModel) {
        r.state.status = 'idle'; persist(r); status(r, 'model autoswitch off; current model unchanged');
        return;
      }
      let best;
      try {
        await refreshCandidates(r, ctx);
        best = await r.quotas.selectBestCandidate(r.errors.getCooldowns(), { forceFresh: true, excluded: r.errors.getExcludedCandidates() });
      } catch {
        if (bound(ctx) === r && revision === r.modelRevision && !halted(r)) {
          r.state.status = 'idle'; persist(r); status(r, 'account or routing slots unavailable; waiting');
        }
        return;
      }
      if (bound(ctx) !== r || revision !== r.modelRevision || halted(r) || ctx.signal?.aborted) return;
      try {
        if (best.candidate && await updateModel(r, ctx, best.candidate.id)) {
          r.state.owedProviderTurn = false;
          r.pendingTurnTrigger = true;
          r.state.status = 'active';
          persist(r);
          return recover();
        }
      } catch { /* Recoverable debt */ }
      if (bound(ctx) !== r || revision !== r.modelRevision || halted(r)) return;
      r.state.status = 'idle'; persist(r); status(r, 'no selected fallback; idle');
    }
  });

  pi.on('agent_settled', (event, ctx) => {
    const r = bound(ctx); if (!r) return;
    if (event.aborted) {
      r.pendingAction = undefined; r.pendingTurnTrigger = false; r.state.owedProviderTurn = false;
      const pendingHandover = Boolean(r.ready);
      cancelReady(r);
      if (!halted(r)) r.state.status = 'active';
      persist(r);
      status(r, halted(r) ? 'halted' : pendingHandover ? 'handover cancelled; active' : 'response interrupted; active');
      return;
    }
    if (r.pendingTurnTrigger && !halted(r)) {
      r.pendingTurnTrigger = false;
      r.state.owedProviderTurn = false;
      r.state.status = 'active';
      persist(r);
      pi.sendMessage({
        customType: 'supervisor-provider-recovery',
        content: providerRecoveryMessage,
        display: true,
        details: {},
      }, { triggerTurn: true });
    }
    if (!r.ready || r.dispatched || halted(r) || hasPending(r) || defaultSubagentTaskRegistry.hasActiveTasksForSession(r.sessionId)) return;
    r.dispatched = true;
    const token = r.ready.token;
    setImmediate(() => {
      if (runtime === r && !r.disposed && isSupervisorEnabled(r.cwd) && r.ready?.token === token && !halted(r) && !hasPending(r)) {
        try { dispatchHandover(r); }
        catch (error) { r.dispatched = false; status(r, `handover dispatch failed: ${String(error)}`); }
      }
    });
  });

  pi.on('session_before_switch', (_event, ctx) => {
    const r = bound(ctx); if (!r || switching) return;
    if (preparing || hasPending(r) || r.state.uncertainMutationsCount) return { cancel: true };
    cancelReady(r);
  });

  pi.on('session_shutdown', (_event, ctx) => {
    if (runtime) {
      sessionRuntimes.delete(runtime.ctx.sessionManager);
      runtime.disposed = true; if (runtime.timer) clearInterval(runtime.timer); runtime.lock.release(); runtime = undefined;
    }
    ctx.ui?.setStatus?.('orchestrator-supervisor', undefined);
  });
}

const providerRecoveryMessage = 'Resume the response interrupted by a provider error, only within the already authorized task. Reconcile effects before executing tools; do not replay mutations or infer any new consent.';

function hostRegisteredModels(ctx: any): RegisteredModel[] {
  const registry = ctx?.modelRegistry;
  if (!registry) return [];
  const read = (method: 'getAvailable' | 'getAll'): any[] => {
    try {
      const value = registry[method]?.();
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  };
  const available = read('getAvailable');
  const models = available.length ? available : read('getAll');
  const seen = new Set<string>();
  const registered: RegisteredModel[] = [];
  for (const model of models) {
    if (!model || typeof model.provider !== 'string' || typeof model.id !== 'string' || !model.id) continue;
    if (model.type !== undefined && model.type !== 'chat') continue;
    const id = `${model.provider}/${model.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    registered.push({
      provider: model.provider,
      id: model.id,
      contextWindow: Number.isFinite(model.contextWindow) ? model.contextWindow : undefined,
    });
  }
  return registered;
}

const checkpointRequest = 'Context reached the supervisor boundary or the user requested rotation. Call supervisor_rotate exactly once with a concise 150–250-word continuity summary: exact user goal and limits, completed/pending work and checks, task-file pointers, environment state, and next authorized action. That single call saves the summary to persistent memory and opens the fresh session immediately: make no other tool calls, and do not try to finish or verify pending work first. Set continue_task true only for unfinished already-authorized work; false for completed, stopped, blocked or awaiting-consent work. Either way the fresh session starts one turn immediately: true resumes that work without waiting for me; false makes it report what is pending or blocked and then wait. Do not rewrite tools, stop active jobs, publish, or infer consent. If the tool reports a concrete blocker, explain it and end the turn.';

function inventoryFailure(error: unknown): string {
  const allowed = new Set(['Account inventory unavailable', 'Unsupported account inventory',
    'Account model inventory unavailable', 'Unsupported account model inventory']);
  if (error instanceof Error && allowed.has(error.message)) return error.message;
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) return 'Account discovery timed out or was interrupted';
  return 'Account discovery failed; check management endpoint access and registered models';
}

async function sendNotification(body: string): Promise<void> {
  const endpoint = process.env.PI_NTFY_URL;
  if (!endpoint) return;
  try { await fetch(endpoint, { method: 'POST', body, headers: { Title: 'Orchestrator supervisor' }, signal: AbortSignal.timeout(3000) }); } catch { /* Optional notifications never block work */ }
}
