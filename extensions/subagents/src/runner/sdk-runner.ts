import fs from 'node:fs';
import path from 'node:path';
import { resolveEffectiveSubagentProfile } from '../profile-resolver.js';
import { SubagentStructuredError } from '../error-metadata.js';
import { resolveSubagentsHistoryHome } from '../history.js';
import type { EffectiveSubagentProfile, ModelRef, SubagentDefinition, SubagentErrorMetadata, SubagentRunner, SubagentsConfig, ThinkingEffort } from '../types.js';
import { getInteractionSessionRegistry } from './interaction-session-registry.js';
import { detectPiRuntimeSupport, loadPiSdkModule } from './pi-sdk-module.js';
import { buildPrompt } from './prompt.js';
import { promptWithInactivity, structuredMetadataFromError } from './event-processing.js';
import { expandToolPatterns } from '../tool-patterns.js';
import { composeLeanSystemPrompt } from './tool-guidelines.js';

function modelLabel(model: any): string | undefined {
  if (!model) return undefined;
  return `${model.provider ?? 'unknown'}/${model.id ?? model.name ?? 'unknown'}`;
}

function modelRefLabel(ref: ModelRef | undefined): string | undefined {
  return ref ? `${ref.provider}/${ref.id}` : undefined;
}

function resolveModel(ctx: any, ref?: ModelRef): any | undefined {
  if (!ref) return undefined;
  return ctx?.modelRuntime?.getModel?.(ref.provider, ref.id) ?? ctx?.modelRegistry?.find?.(ref.provider, ref.id);
}

function activeToolNames(ctx: any): string[] | undefined {
  for (const source of [ctx?.pi, ctx]) {
    try {
      const tools = source?.getActiveTools?.() ?? source?.getTools?.();
      if (!Array.isArray(tools)) continue;
      return tools
        .map((tool: unknown) => typeof tool === 'string' ? tool : (tool as { name?: unknown })?.name)
        .filter((name: unknown): name is string => typeof name === 'string' && name.length > 0);
    } catch {}
  }
  return undefined;
}

const SUBAGENT_ALLOWED_EXTENSION_EVENTS = new Set(['tool_call', 'tool_result', 'user_bash']);
const INLINE_MEMORY_ADAPTER_PATH = '<inline:memory-invocation-adapter-v1>';

class NonRetryableSubagentError extends Error {
  readonly nonRetryable = true;
}

function isNonRetryableSubagentError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { nonRetryable?: unknown }).nonRetryable);
}

function isolateSubagentExtensions(base: any): any {
  return {
    ...base,
    extensions: (base?.extensions ?? []).map((extension: any) => ({
      ...extension,
      handlers: new Map([...((extension.handlers as Map<string, unknown[]>) ?? new Map())]
        .filter(([event]) => {
          if (extension?.path === INLINE_MEMORY_ADAPTER_PATH && event === 'message_start') {
            return true;
          }
          return SUBAGENT_ALLOWED_EXTENSION_EVENTS.has(event);
        })),
      commands: new Map(),
      flags: new Map(),
      shortcuts: new Map(),
    })),
  };
}

function safeSdkProperty<T = any>(piSdk: any, prop: string): T | undefined {
  try {
    return piSdk?.[prop];
  } catch {
    return undefined;
  }
}

function resolveChildSettingsManager(piSdk: any, childCwd: string, ctx: any, agentDir?: string): any {
  const SettingsManager = safeSdkProperty(piSdk, 'SettingsManager');
  const ProjectTrustStore = safeSdkProperty(piSdk, 'ProjectTrustStore');
  if (!SettingsManager) return ctx?.settingsManager;

  const parentCwd = ctx?.cwd ?? process.cwd();
  const isSameCwd = path.resolve(childCwd) === path.resolve(parentCwd);

  let projectTrusted = false;
  if (isSameCwd) {
    projectTrusted = typeof ctx?.isProjectTrusted === 'function' ? ctx.isProjectTrusted() : false;
  } else {
    try {
      if (typeof ProjectTrustStore === 'function' && agentDir) {
        const store = new ProjectTrustStore(agentDir);
        const decision = store.get(childCwd);
        if (typeof decision === 'boolean') {
          projectTrusted = decision;
        } else {
          const defaultTrust = ctx?.settingsManager?.getSettings?.()?.defaultProjectTrust ?? 'ask';
          projectTrusted = defaultTrust === 'always';
        }
      }
    } catch {
      projectTrusted = false;
    }
  }

  try {
    if (typeof SettingsManager.create === 'function' && agentDir) {
      return SettingsManager.create(childCwd, agentDir, { projectTrusted });
    }
    if (typeof SettingsManager.inMemory === 'function') {
      return SettingsManager.inMemory({}, { projectTrusted });
    }
  } catch {}

  return ctx?.settingsManager;
}

function createMemoryRunnerIntegration(identity: {
  version: 1;
  invocationId: string;
  childSessionId: string;
  invokingParentSessionId: string;
  taskId?: string;
  attempt?: number;
}) {
  let capturedLease: any = undefined;
  let activationPromise: Promise<void> | undefined = undefined;
  let bindCallback: ((childContext: any) => void) | undefined = undefined;

  const memoryInvocationAdapter = {
    name: 'memory-invocation-adapter-v1',
    factory: (pi: any) => {
      bindCallback = (childContext: any) => {
        if (pi?.events?.emit) {
          pi.events.emit('memory:invocation:bind:v1', {
            version: 1,
            identity,
            childContext,
            accept(lease: any) {
              capturedLease = lease;
            },
          });
        }
      };

      if (typeof pi?.on === 'function') {
        pi.on('message_start', async (event: any) => {
          if (event?.message?.role === 'user') {
            if (!activationPromise && capturedLease) {
              activationPromise = capturedLease.activate();
            }
            if (activationPromise) {
              await activationPromise;
            }
          }
        });
      }
    },
  };

  return {
    memoryInvocationAdapter,
    bindChildContext(childContext: any) {
      if (bindCallback) {
        bindCallback(childContext);
      }
    },
    async waitForActivation(): Promise<void> {
      if (activationPromise) {
        try {
          await activationPromise;
        } catch {}
      }
    },
    async terminateLease(outcome: 'completed' | 'cancelled' | 'failed'): Promise<void> {
      if (capturedLease) {
        await capturedLease.terminate(outcome);
      }
    },
    hasLease(): boolean {
      return Boolean(capturedLease);
    },
  };
}

type SubagentInteractionSessionMetadata = {
  origin: 'subagent';
  requester: { subagentName: string; description?: string; taskId?: string };
  parent?: { piSessionId?: string };
};

function registerInteractionSubagentSession(session: any, definition: SubagentDefinition, taskId?: string, parentPiSessionId?: string): () => void {
  const sessionId = session?.sessionManager?.getSessionId?.() ?? session?.sessionId;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return () => undefined;
  const registry = getInteractionSessionRegistry() as Map<string, SubagentInteractionSessionMetadata>;
  const previous = registry.get(sessionId);
  registry.set(sessionId, {
    origin: 'subagent',
    requester: { subagentName: definition.name, description: definition.description, taskId },
    parent: parentPiSessionId ? { piSessionId: parentPiSessionId } : undefined,
  });
  return () => {
    if (previous) registry.set(sessionId, previous);
    else registry.delete(sessionId);
  };
}

function resolveNestedSessionsHome(): string {
  const home = path.join(resolveSubagentsHistoryHome(), 'sessions');
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(home, 0o700); } catch {}
  return home;
}

function sessionPathFromManager(sessionManager: any, fallback?: string): string | undefined {
  const direct = sessionManager?.getSessionFile?.() ?? sessionManager?.path ?? sessionManager?.sessionPath ?? fallback;
  return typeof direct === 'string' && direct.length > 0 ? direct : undefined;
}

function secureSessionPath(sessionPath: string | undefined): void {
  if (!sessionPath) return;
  try {
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(sessionPath), 0o700);
  } catch {}
  try { fs.chmodSync(sessionPath, 0o600); } catch {}
}

async function secureSessionPathWhenReady(sessionPath: string | undefined, attempts = 10, delayMs = 10): Promise<void> {
  if (!sessionPath) return;
  secureSessionPath(sessionPath);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (fs.existsSync(sessionPath)) {
        fs.chmodSync(sessionPath, 0o600);
        return;
      }
    } catch {}
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

function versionFromPiSdk(piSdk: any): unknown {
  try {
    return piSdk?.VERSION;
  } catch {
    return undefined;
  }
}

async function createSession(
  model: any,
  cwd: string,
  tools: string[],
  effort: ThinkingEffort | undefined,
  config: SubagentsConfig,
  ctx: any,
  systemPrompt: string,
  nestedSessionPath?: string,
  identityOptions?: {
    invocationId: string;
    parentSessionId: string;
    taskId?: string;
    attempt?: number;
  },
) {
  const piSdk = await loadPiSdkModule();
  const { createAgentSession, SessionManager } = piSdk;
  const sessionDir = resolveNestedSessionsHome();
  const sessionManager = nestedSessionPath
    ? await SessionManager.open(nestedSessionPath, sessionDir, cwd)
    : typeof SessionManager.create === 'function'
      ? await SessionManager.create(cwd, sessionDir, { cwd })
      : SessionManager.inMemory(cwd);
  const resolvedSessionPath = sessionPathFromManager(sessionManager, nestedSessionPath);
  await secureSessionPathWhenReady(resolvedSessionPath);

  const childSessionId = typeof sessionManager?.getSessionId === 'function'
    ? sessionManager.getSessionId()
    : 'unknown-child';

  const memoryIntegration = identityOptions
    ? createMemoryRunnerIntegration({
        version: 1,
        invocationId: identityOptions.invocationId,
        childSessionId,
        invokingParentSessionId: identityOptions.parentSessionId,
        taskId: identityOptions.taskId,
        attempt: identityOptions.attempt,
      })
    : undefined;

  const getAgentDir = safeSdkProperty(piSdk, 'getAgentDir');
  const agentDir = typeof getAgentDir === 'function' ? getAgentDir() : undefined;
  const childSettingsManager = resolveChildSettingsManager(piSdk, cwd, ctx, agentDir);

  const options: Record<string, unknown> = {
    cwd,
    model,
    thinkingLevel: effort,
    tools,
    sessionManager,
  };
  if (ctx?.modelRuntime) options.modelRuntime = ctx.modelRuntime;
  if (childSettingsManager) options.settingsManager = childSettingsManager;
  else if (ctx?.settingsManager) options.settingsManager = ctx.settingsManager;

  const DefaultResourceLoader = safeSdkProperty(piSdk, 'DefaultResourceLoader');
  const createEventBus = safeSdkProperty(piSdk, 'createEventBus');
  const childEventBus = typeof createEventBus === 'function' ? createEventBus() : undefined;
  const extensionFactories = memoryIntegration ? [memoryIntegration.memoryInvocationAdapter] : [];

  if (config.session_resources === 'lean') {
    if (typeof DefaultResourceLoader !== 'function') throw new Error('Subagent lean session resources require DefaultResourceLoader from Pi SDK.');
    const loaderOptions: Record<string, unknown> = {
      cwd,
      agentDir,
      settingsManager: options.settingsManager,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPromptOverride: () => systemPrompt,
      extensionsOverride: isolateSubagentExtensions,
    };
    if (childEventBus) loaderOptions.eventBus = childEventBus;
    if (extensionFactories.length > 0) loaderOptions.extensionFactories = extensionFactories;

    const resourceLoader = new DefaultResourceLoader(loaderOptions);
    await resourceLoader.reload();
    options.agentDir = agentDir;
    options.resourceLoader = resourceLoader;
  } else if (typeof DefaultResourceLoader === 'function' && memoryIntegration && childEventBus) {
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager: options.settingsManager,
      eventBus: childEventBus,
      extensionFactories,
    });
    await resourceLoader.reload();
    options.agentDir = agentDir;
    options.resourceLoader = resourceLoader;
  }

  const created = await createAgentSession(options);
  if (memoryIntegration && created?.extensionsResult?.runtime?.createContext) {
    try {
      const childContext = created.extensionsResult.runtime.createContext();
      memoryIntegration.bindChildContext(childContext);
    } catch {}
  }

  return {
    ...created,
    nested_session_path: resolvedSessionPath,
    pi_version: versionFromPiSdk(piSdk),
    memoryIntegration,
  };
}

function createSessionAbortBridge(session: any, signal: AbortSignal) {
  let abortPromise: Promise<void> | undefined;
  const abortSession = async (): Promise<void> => {
    if (!abortPromise) {
      abortPromise = Promise.resolve(session?.abort?.()).then(() => undefined, () => undefined);
    }
    await abortPromise;
  };
  const onAbort = () => { void abortSession(); };
  signal.addEventListener('abort', onAbort, { once: true });
  return {
    abortSession,
    dispose() {
      signal.removeEventListener('abort', onAbort);
    },
  };
}

function selectedModel(input: { ctx: any; definition: SubagentDefinition; profile: EffectiveSubagentProfile }): any | undefined {
  const ref = input.profile.model.value;
  if (!ref) return input.ctx?.model;
  if (input.profile.model.source === 'orchestrator') return input.ctx?.model ?? resolveModel(input.ctx, ref);
  const resolved = resolveModel(input.ctx, ref);
  if (!resolved) throw new Error(`Subagent ${input.definition.name} could not resolve selected model ${modelRefLabel(ref)} (${input.profile.model.source}).`);
  return resolved;
}

function providerFromModel(model: any): string | undefined {
  return typeof model?.provider === 'string' ? model.provider : undefined;
}

function createLiveSteeringBridge(session: any, piVersion: unknown) {
  const runtime = detectPiRuntimeSupport(piVersion);
  const canSteer = typeof session?.steer === 'function';
  return {
    detected_pi_version: runtime.detected_pi_version,
    supported: runtime.supported && canSteer,
    steer(message: string): void {
      if (!canSteer) throw new Error('Live steering is unavailable for this nested session.');
      void Promise.resolve(session.steer(message)).catch(() => undefined);
    },
  };
}

export const sdkSubagentRunner: SubagentRunner = async ({ definition, task, taskId, parentPiSessionId, context, cwd, ctx, config, signal, effectiveProfile, nested_session_path, continuation, registerLiveBridge, clearLiveBridge, onQueuedMessageStart, onActivity }) => {
  const profile = effectiveProfile ?? resolveEffectiveSubagentProfile({ agentName: definition.name, definition, config, ctx });
  const preferred = selectedModel({ ctx, definition, profile });
  const effort = profile.effort.value;
  const configuredTools = definition.tools?.length ? definition.tools : config.default_tools;
  const tools = expandToolPatterns(configuredTools, activeToolNames(ctx));
  const systemPrompt = config.session_resources === 'lean'
    ? composeLeanSystemPrompt(definition.instructions, tools, ctx)
    : definition.instructions;
  const prompt = continuation?.prompt ?? buildPrompt(definition, task, context, tools);
  onActivity?.({
    message: continuation ? 'continuation prompt prepared' : 'orchestrator prompt prepared',
    prompt,
    system_prompt: systemPrompt,
    transcript: `# system prompt\n\n${systemPrompt}\n\n# ${continuation ? 'continuation prompt' : 'delegated prompt'}\n\n${prompt}\n`,
    effort,
  });

  async function attempt(model: any) {
    onActivity?.({ message: `starting ${definition.name} with model ${modelLabel(model) ?? 'unknown'}${effort ? ` effort ${effort}` : ''}`, prompt, system_prompt: systemPrompt, effort });

    const invocationId = crypto.randomUUID();
    const parentSessionId = parentPiSessionId ?? ctx?.sessionManager?.getSessionId?.() ?? 'standalone';
    const taskIdForMemory = taskId ?? (continuation ? 'continuation' : undefined);
    const attemptNumber = continuation?.attempt ?? 1;

    const {
      session,
      nested_session_path: resolvedNestedSessionPath,
      pi_version: piVersion,
      memoryIntegration,
    } = await createSession(
      model,
      cwd,
      tools,
      effort,
      config,
      ctx,
      systemPrompt,
      nested_session_path,
      {
        invocationId,
        parentSessionId,
        taskId: taskIdForMemory,
        attempt: attemptNumber,
      },
    );
    registerLiveBridge?.(createLiveSteeringBridge(session, piVersion));
    onActivity?.({ message: 'nested session ready', nested_session_path: resolvedNestedSessionPath });
    const unregisterInteractionSession = registerInteractionSubagentSession(session, definition, taskId, parentSessionId);
    const abortBridge = createSessionAbortBridge(session, signal);
    let outcome: 'completed' | 'cancelled' | 'failed' = 'completed';
    try {
      if (signal.aborted) {
        outcome = 'cancelled';
        await abortBridge.abortSession();
        throw new Error('Subagent was aborted');
      }
      const effectiveSystemPrompt = typeof session.systemPrompt === 'string' ? session.systemPrompt : systemPrompt;
      const { result, usage, thread_snapshot, interaction_request } = await promptWithInactivity(
        session,
        prompt,
        config.stall_timeout_ms,
        signal,
        onActivity,
        context,
        cwd,
        effectiveSystemPrompt,
        taskId,
        continuation ? 'continuation' : 'delegated_task',
        continuation?.prompt ?? task,
        continuation?.attempt ?? 1,
        onQueuedMessageStart,
        continuation?.previous_snapshot,
      );
      if (signal.aborted) {
        outcome = 'cancelled';
        await abortBridge.abortSession();
        throw new Error('Subagent was aborted');
      }
      await secureSessionPathWhenReady(resolvedNestedSessionPath);
      return { result, usage, thread_snapshot, interaction_request, system_prompt: effectiveSystemPrompt, nested_session_path: resolvedNestedSessionPath };
    } catch (error) {
      outcome = signal.aborted ? 'cancelled' : 'failed';
      if (signal.aborted) await abortBridge.abortSession();
      await secureSessionPathWhenReady(resolvedNestedSessionPath);
      throw error instanceof SubagentStructuredError
        ? error
        : new SubagentStructuredError(structuredMetadataFromError(error, {
            phase: 'runner_invoke',
            provider: providerFromModel(model),
            model: modelLabel(model),
            operation: 'session.prompt',
          }));
    } finally {
      clearLiveBridge?.();
      abortBridge.dispose();
      unregisterInteractionSession();

      if (memoryIntegration) {
        await memoryIntegration.waitForActivation();
        try {
          await memoryIntegration.terminateLease(outcome);
        } catch (cleanupError) {
          throw cleanupError instanceof SubagentStructuredError
            ? cleanupError
            : new SubagentStructuredError(structuredMetadataFromError(cleanupError, {
                phase: 'runner_invoke',
                provider: providerFromModel(model),
                model: modelLabel(model),
                operation: 'memory.lease.terminate',
              }));
        }
      }
    }
  }

  try {
    const { result, usage, thread_snapshot, interaction_request, system_prompt, nested_session_path: resolvedNestedSessionPath } = await attempt(preferred);
    return {
      result,
      usage,
      thread_snapshot,
      interaction_request,
      system_prompt,
      nested_session_path: resolvedNestedSessionPath,
      model: modelLabel(preferred) ?? modelRefLabel(profile.model.value),
      effort,
      fallback_used: false,
    };
  } catch (error) {
    if (signal.aborted) throw new Error('Subagent was aborted');
    const preferredLabel = modelLabel(preferred) ?? modelRefLabel(profile.model.value) ?? 'unknown';
    const primaryFailure = structuredMetadataFromError(error, {
      phase: isNonRetryableSubagentError(error) ? 'runner_session' : 'runner_invoke',
      provider: providerFromModel(preferred),
      model: preferredLabel,
      operation: 'session.prompt',
    });
    throw new SubagentStructuredError(primaryFailure);
  }
};
