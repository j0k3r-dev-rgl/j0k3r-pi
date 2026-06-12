import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type {
  ActiveBinding,
  BindingManager,
  CommandResult,
  OutputRelay,
  PiRpcProcessManager,
  PiSessionRef,
  TelegramCommandInput,
  TelegramBotCommand,
  TelegramControlConfig,
  TelegramIdentity,
  WorkspaceRegistry,
} from './types.js';
import type {
  AuthDecision,
  PiTrustValidator,
  AuthorizationPolicy,
  TelegramUpdate,
} from './types.js';
import { loadTelegramControlConfig } from './config.js';
import { TelegramAuthorizer } from './authorization.js';
import { CommandRouter, type CommandRouterSessionIndex } from './commands.js';
import { ExactWorkspaceRegistry } from './workspace-registry.js';
import { FilePiTrustValidator } from './pi-trust.js';
import { FileSessionIndex } from './session-index.js';
import { InMemoryBindingManager } from './bindings.js';
import { InMemoryPiRpcProcessManager } from './pi-rpc-process-manager.js';
import { PiSdkClient } from './pi-sdk-client.js';
import type { PiRpcClient as PiRpcClientContract, AuditEvent } from './types.js';
import { TelegramLongPollingAdapter } from './telegram-adapter.js';
import { TelegramOutputRelay } from './output-relay.js';
import { InMemoryTelegramPermissionApprovalStore } from './permission-approval-store.js';
import { FileAuditLogger } from './audit.js';
import type { PiRpcSessionState } from './types.js';

const DEFAULT_UPDATE_OFFSET_FILE = 'telegram-update-offset.json';

interface GatewayOffsetFile {
  lastUpdateOffset?: number;
  offset?: number;
  updatedAt?: string;
}

interface GatewayDependencies {
  bindings?: BindingManager;
  workspaceRegistry?: WorkspaceRegistry;
  trustValidator?: PiTrustValidator;
  sessionIndex?: CommandRouterSessionIndex;
  processManager?: PiRpcProcessManager;
  outputRelay?: OutputRelay;
  auditLogger?: {
    record(event: AuditEvent): Promise<void>;
  };
  createAdapter?: AdapterFactory;
  authorizer?: AuthorizationPolicy;
  commandRouter?: CommandRouter;
}

export interface GatewayRuntime {
  stop(): Promise<void>;
  emergencyStop(): Promise<void>;
  waitUntilStopped(): Promise<void>;
}

interface TelegramPoller {
  start(handler: (update: TelegramUpdate) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  sendMessage(chatId: number, text: string): Promise<{ chatId: number; messageId: number }>;
  editMessage(ref: { chatId: number; messageId: number }, text: string): Promise<void>;
  setMyCommands?(commands: TelegramBotCommand[]): Promise<void>;
  offset?: number;
}

export const TELEGRAM_CONTROL_BOT_COMMANDS: TelegramBotCommand[] = [
  { command: 'start', description: 'Show Telegram Pi control help' },
  { command: 'status', description: 'Show active workspace/session status' },
  { command: 'workspaces', description: 'List trusted workspaces' },
  { command: 'open', description: 'Open workspace/session: /open <workspace> [session]' },
  { command: 'sessions', description: 'List sessions: /sessions [workspace]' },
  { command: 'new', description: 'Create session: /new <workspace> [name]' },
  { command: 'arm', description: 'Arm prompt forwarding: /arm [seconds]' },
  { command: 'disarm', description: 'Disable prompt forwarding' },
  { command: 'close', description: 'Close active session binding' },
  { command: 'abort', description: 'Abort active Pi run' },
  { command: 'steer', description: 'Send steer message: /steer <text>' },
  { command: 'followup', description: 'Send follow-up: /followup <text>' },
  { command: 'permissions', description: 'List pending permission requests' },
  { command: 'approve', description: 'Approve permission: /approve <id> [scope]' },
  { command: 'deny', description: 'Deny permission: /deny <id>' },
];

type AdapterFactory = (token: string, polling: TelegramControlConfig['telegram']['polling'], options: { initialOffset: number; maxPolls?: number; pollIntervalMs?: number }) => TelegramPoller;

function resolveStatePath(env: NodeJS.ProcessEnv, homeDir: string): string {
  const stateRoot = env.XDG_STATE_HOME?.trim()
    ? env.XDG_STATE_HOME
    : join(homeDir, '.local', 'state');

  return join(stateRoot, 'pi', 'telegram-pi-control', DEFAULT_UPDATE_OFFSET_FILE);
}

async function readOffsetState(path: string): Promise<number | undefined> {
  const raw = await readFile(path, 'utf8').catch(() => undefined);
  if (!raw) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (typeof parsed === 'number' && Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }

  const candidate = (parsed as GatewayOffsetFile).lastUpdateOffset ?? (parsed as GatewayOffsetFile).offset;
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0
    ? candidate
    : undefined;
}

async function writeOffsetState(path: string, offset: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ lastUpdateOffset: offset, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
}

function extractIdentity(update: TelegramUpdate): TelegramIdentity | undefined {
  const message = update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
  if (!message || !message.from || !message.chat) return undefined;

  const userId = Number(message.from.id);
  const chatId = Number(message.chat.id);
  if (!Number.isInteger(userId) || !Number.isInteger(chatId)) return undefined;

  return {
    userId,
    chatId,
    chatType: message.chat.type,
    username: message.from.username,
  };
}

function buildCommandInput(update: TelegramUpdate, identity: TelegramIdentity): TelegramCommandInput | undefined {
  const message = update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
  if (!message || typeof message.text !== 'string') {
    return undefined;
  }

  return {
    kind: 'text',
    text: message.text,
    identity,
    rawText: message.text,
  };
}

function previewPayload(value: string | undefined, maxChars = 0): string | undefined {
  if (!value || !maxChars || maxChars <= 0) return undefined;
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars))}...`;
}

function recordAuditEvent(event: Omit<AuditEvent, 'version' | 'timestamp'>): AuditEvent {
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    ...event,
  };
}

export interface RunGatewayOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  nowMs?: () => number;
  pollMax?: number;
  pollIntervalMs?: number;
  stateOffsetPath?: string;
  installSignalHandlers?: boolean;
  loadConfig?: typeof loadTelegramControlConfig;
  createAdapter?: AdapterFactory;
  bindings?: BindingManager;
  workspaceRegistry?: WorkspaceRegistry;
  trustValidator?: PiTrustValidator;
  sessionIndex?: CommandRouterSessionIndex;
  processManager?: PiRpcProcessManager;
  outputRelay?: OutputRelay;
  auditLogger?: GatewayDependencies['auditLogger'];
  adapter?: TelegramPoller;
  authorizer?: AuthorizationPolicy;
  commandRouter?: CommandRouter;
}

export async function runTelegramControlGateway(options: RunGatewayOptions = {}): Promise<GatewayRuntime> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? homedir();
  const stateOffsetPath = options.stateOffsetPath ?? resolveStatePath(env, homeDir);

  const runtimeConfig = await (options.loadConfig ?? loadTelegramControlConfig)({
    cwd,
    env,
    homeDir,
  });

  if (!runtimeConfig.botToken) {
    throw new Error('Gateway startup rejected: missing PI_TELEGRAM_CONTROL_BOT_TOKEN.');
  }

  if (!runtimeConfig.valid) {
    throw new Error(`Gateway startup rejected: ${runtimeConfig.errors.join(', ')}`);
  }

  const authorizer: AuthorizationPolicy = options.authorizer ?? new TelegramAuthorizer(runtimeConfig.config);
  const bindings: BindingManager = options.bindings ?? new InMemoryBindingManager();
  const workspaceRegistry: WorkspaceRegistry = options.workspaceRegistry
    ?? new ExactWorkspaceRegistry(runtimeConfig.config, { cwd });
  const defaultAgentDir = join(homeDir, '.pi', 'agent');
  const trustValidator: PiTrustValidator = options.trustValidator
    ?? new FilePiTrustValidator({
      piCodingAgentDir: defaultAgentDir,
      exactRootOnly: true,
      fallbackTrustFilePaths: [
        join(cwd, 'trust.json'),
      ],
    });
  const sessionIndex: CommandRouterSessionIndex = options.sessionIndex
    ?? new FileSessionIndex({ sessionDir: runtimeConfig.config.pi?.sessionDir });
  const fileAuditLogger = options.auditLogger
    ?? new FileAuditLogger({
      enabled: runtimeConfig.config.audit?.enabled === true,
      path: runtimeConfig.config.audit?.path,
      maxBytes: runtimeConfig.config.audit?.maxBytes,
      maxFiles: runtimeConfig.config.audit?.maxFiles,
      redactPaths: runtimeConfig.config.audit?.redactPaths,
      homeDir,
      env,
    });
  const auditLogger = options.auditLogger ?? fileAuditLogger;
  const processManager: PiRpcProcessManager = options.processManager
    ?? new InMemoryPiRpcProcessManager({
      createClient(binding) {
        return new PiSdkClient({
          workspaceRoot: binding.workspace.canonicalRoot,
          agentDir: defaultAgentDir,
          sessionDir: runtimeConfig.config.pi?.sessionDir,
          sessionFile: binding.sessionFile,
        });
      },
      onLifecycle: (event) => {
        void auditLogger.record(recordAuditEvent({
          event: 'lifecycle',
          decision: event.event === 'stopped' ? 'observe' : 'allow',
          reason: event.reason ?? event.event,
          action: 'sdk_runtime',
          actor: {
            chatId: event.binding.chatId,
          },
          workspace: event.binding.workspace.id,
          sessionId: event.binding.sessionId,
          sessionFile: event.binding.sessionFile,
        }));
      },
    });

  const permissionStore = new InMemoryTelegramPermissionApprovalStore();

  const initialOffset = (await readOffsetState(stateOffsetPath)) ?? 0;
  const adapter: TelegramPoller = options.adapter
    ?? options.createAdapter?.(runtimeConfig.botToken, runtimeConfig.config.telegram.polling, {
      initialOffset,
      maxPolls: options.pollMax,
      pollIntervalMs: options.pollIntervalMs,
    })
    ?? new TelegramLongPollingAdapter({
      token: runtimeConfig.botToken,
      polling: runtimeConfig.config.telegram.polling,
      initialOffset,
      maxPolls: options.pollMax,
      pollIntervalMs: options.pollIntervalMs,
    });

  const outputRelay: OutputRelay = options.outputRelay
    ?? new TelegramOutputRelay({
      telegram: adapter,
      maxTelegramMessageChars: runtimeConfig.config.relay?.maxTelegramMessageChars,
      flushIntervalMs: runtimeConfig.config.relay?.flushIntervalMs,
      permissionStore,
    });

  const relayDisposers = new Map<number, () => void>();
  const relayBindingKeys = new Map<number, string>();

  const ensureRelay = (binding: ActiveBinding, client: PiRpcClientContract) => {
    const currentKey = binding.rpcKey;
    const previous = relayBindingKeys.get(binding.chatId);

    if (previous === currentKey) {
      return;
    }

    const existing = relayDisposers.get(binding.chatId);
    if (existing) {
      existing();
      relayDisposers.delete(binding.chatId);
    }

    relayBindingKeys.set(binding.chatId, currentKey);
    relayDisposers.set(binding.chatId, outputRelay.attach(binding.chatId, binding, client));
  };

  const stopRelayAll = async () => {
    for (const dispose of relayDisposers.values()) {
      dispose();
    }
    relayDisposers.clear();
    relayBindingKeys.clear();
    await Promise.resolve();
  };

  const clientForBinding = async (binding: ActiveBinding): Promise<PiRpcClientContract> => {
    const client = await processManager.acquire(binding);
    ensureRelay(binding, client);
    return client;
  };

  const openSession = async (workspace: { id: string; label: string; canonicalRoot: string }, requested?: PiSessionRef): Promise<PiSessionRef> => {
    const draft: ActiveBinding = {
      chatId: -1,
      workspace,
      rpcKey: `${workspace.canonicalRoot}|${requested?.sessionFile ?? requested?.sessionId ?? requested?.sessionName ?? '<no-session>'}`,
      ...(requested?.sessionFile ? { sessionFile: requested.sessionFile } : {}),
      ...(requested?.sessionId ? { sessionId: requested.sessionId } : {}),
      ...(requested?.sessionName ? { sessionName: requested.sessionName } : {}),
    };

    const client = await clientForBinding(draft);
    if (requested?.sessionFile) {
      await client.switchSession(requested.sessionFile);
    } else if (requested?.sessionId) {
      await client.switchSession(requested.sessionId);
    }

    const state = await client.getState().catch(() => undefined as PiRpcSessionState | undefined);
    return {
      sessionFile: state?.sessionFile ?? requested?.sessionFile,
      sessionId: state?.sessionId ?? requested?.sessionId,
      sessionName: state?.sessionName ?? requested?.sessionName,
    };
  };

  const createSession = async (workspace: { id: string; label: string; canonicalRoot: string }, sessionName?: string): Promise<PiSessionRef> => {
    const draft: ActiveBinding = {
      chatId: -1,
      workspace,
      rpcKey: `${workspace.canonicalRoot}|new-${sessionName ?? '<default>'}`,
      ...(sessionName ? { sessionName } : {}),
    };

    const client = await clientForBinding(draft);
    await client.newSession(sessionName);
    const state = await client.getState().catch(() => undefined as PiRpcSessionState | undefined);
    return {
      sessionFile: state?.sessionFile,
      sessionId: state?.sessionId ?? 'new',
      sessionName: state?.sessionName ?? sessionName,
    };
  };

  const sendPrompt = async (binding: ActiveBinding, message: string): Promise<void> => {
    const client = await clientForBinding(binding);
    await client.prompt(message);
  };

  const sendSteer = async (binding: ActiveBinding, message: string): Promise<void> => {
    const client = await clientForBinding(binding);
    await client.steer(message);
  };

  const sendFollowup = async (binding: ActiveBinding, message: string): Promise<void> => {
    const client = await clientForBinding(binding);
    await client.followUp(message);
  };

  const sendAbort = async (binding: ActiveBinding): Promise<void> => {
    const client = await clientForBinding(binding);
    await client.abort();
  };

  const closeSession = async (binding: ActiveBinding): Promise<void> => {
    const dispose = relayDisposers.get(binding.chatId);
    if (dispose) {
      dispose();
      relayDisposers.delete(binding.chatId);
    }
    relayBindingKeys.delete(binding.chatId);
    permissionStore.clearForBinding(binding.chatId, binding);
    await processManager.stop(binding);
  };

  const answerPermission = async (binding: ActiveBinding, requestId: string, choice: import('./types.js').TelegramApprovalChoice) => {
    const client = await clientForBinding(binding);
    if (!client.answerPermission) {
      return { ok: false as const, reason: 'unavailable' as const, requestId };
    }
    return client.answerPermission(requestId, choice);
  };

  const commandRouter = options.commandRouter
    ?? new CommandRouter({
      workspaceRegistry,
      trustValidator,
      bindings,
      sessionIndex,
      openSession,
      createSession,
      closeSession,
      permissionStore,
      answerPermission,
      sendPrompt,
      sendSteer,
      sendFollowup,
      sendAbort,
      nowMs: options.nowMs,
      defaultArmDurationSeconds: runtimeConfig.config.policy?.armDurationSeconds,
      maxArmDurationSeconds: runtimeConfig.config.policy?.maxArmDurationSeconds,
      maxPromptChars: runtimeConfig.config.policy?.maxPromptChars,
      audit: async (entry) => {
        const maxChars = runtimeConfig.config.audit?.includePromptPreviewChars ?? 0;
        await auditLogger.record(recordAuditEvent({
          ...entry,
          outputPreview: entry.outputPreview
            ? previewPayload(entry.outputPreview, maxChars)
            : undefined,
        }));
      },
    });

  const persistOffset = async (candidateOffset?: number) => {
    const nextOffset = typeof adapter.offset === 'number'
      ? adapter.offset
      : undefined;

    const value = candidateOffset !== undefined
      ? Math.max(candidateOffset, nextOffset ?? candidateOffset)
      : nextOffset;

    if (typeof value === 'number') {
      await writeOffsetState(stateOffsetPath, value);
    }
  };

  const handleUpdate = async (update: TelegramUpdate): Promise<void> => {
    const decision: AuthDecision = authorizer.authorize(update);

    try {
      if (!decision.ok) {
        const identity = extractIdentity(update);
        if (identity) {
          await adapter.sendMessage(identity.chatId, authorizer.denialMessage(decision));
          await auditLogger.record(recordAuditEvent({
            event: 'authorization',
            decision: 'deny',
            reason: decision.reason,
            action: 'authorize',
            actor: {
              userId: identity.userId,
              chatId: identity.chatId,
              ...(identity.username ? { username: identity.username } : {}),
            },
          }));
        }
        return;
      }

      const identity = decision.identity;
      const commandInput = buildCommandInput(update, identity);
      if (!commandInput) {
        await adapter.sendMessage(identity.chatId, 'No text message to process.');
        return;
      }

      const result = await commandRouter.handle(commandInput) as CommandResult;
      if (result.text && !(result.kind === 'ok' && result.silent)) {
        await adapter.sendMessage(identity.chatId, result.text);
      }

      const binding = bindings.get(identity.chatId);
      await auditLogger.record(recordAuditEvent({
        event: 'command',
        decision: result.kind === 'denied' ? 'deny' : 'allow',
        reason: result.kind,
        action: commandInput.kind,
        actor: {
          userId: identity.userId,
          chatId: identity.chatId,
          ...(identity.username ? { username: identity.username } : {}),
        },
        ...(binding
          ? {
              workspace: binding.workspace.id,
              sessionId: binding.sessionId,
              sessionFile: binding.sessionFile,
            }
          : {}),
      }));

      if (result.kind === 'ok' && commandInput.kind === 'command') {
        await outputRelay.flush(identity.chatId).catch(() => undefined);
      }
    } catch {
      if (decision.ok) {
        await adapter.sendMessage(decision.identity.chatId, 'Unable to process command.');
      }
    } finally {
      await persistOffset(update.update_id + 1);
    }
  };

  if (adapter.setMyCommands) {
    await adapter.setMyCommands(TELEGRAM_CONTROL_BOT_COMMANDS);
  }

  let stopRequested = false;
  let startError: unknown;
  const pollingLoop = adapter.start(handleUpdate).catch((error) => {
    startError = error;
    if (!stopRequested) {
      return Promise.reject(error);
    }
    return Promise.resolve();
  });

  const emergencyStop = async () => {
    if (stopRequested) {
      return;
    }

    stopRequested = true;
    bindings.clearForEmergencyDisable();
    permissionStore.clearExpired();
    await stopRelayAll();
    await processManager.stopAll().catch(() => undefined);
    await auditLogger.record(recordAuditEvent({
      event: 'command',
      decision: 'observe',
      reason: 'emergency disable',
      action: 'emergency_disable',
      actor: {
        userId: 0,
        chatId: 0,
      },
    }));
    await persistOffset();
  };

  const stop = async () => {
    await emergencyStop();
    await adapter.stop();
    try {
      await pollingLoop;
    } finally {
      if (startError && !stopRequested) {
        throw startError instanceof Error ? startError : new Error('Gateway polling failed.');
      }
    }
  };

  if (options.installSignalHandlers !== false) {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
    for (const signal of signals) {
      process.once(signal, () => {
        void stop().catch(() => undefined);
      });
    }
  }

  return {
    stop,
    emergencyStop,
    waitUntilStopped: async () => {
      await pollingLoop;
      if (startError && !stopRequested) {
        throw startError instanceof Error ? startError : new Error('Gateway polling failed.');
      }
    },
  };
}

export { DEFAULT_UPDATE_OFFSET_FILE, CommandRouter, TelegramLongPollingAdapter, TelegramAuthorizer, InMemoryBindingManager };
