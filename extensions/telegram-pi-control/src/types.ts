export type TelegramChatType = 'private' | 'group' | 'supergroup' | 'channel' | string;

export interface TelegramIdentity {
  userId: number;
  chatId: number;
  chatType: TelegramChatType;
  username?: string;
}

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  is_bot?: boolean;
}

export interface TelegramChat {
  id: number;
  type: TelegramChatType;
  title?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  text?: string;
  from?: TelegramUser;
  chat: TelegramChat;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
}

export interface TelegramMessageRef {
  chatId: number;
  messageId: number;
}

export interface TelegramSendOptions {
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disableNotification?: boolean;
}

export interface TelegramEditOptions {
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
}

export interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number | string;
  };
}

export interface TelegramAdapter {
  start(handler: (update: TelegramUpdate) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  sendMessage(chatId: number, text: string, options?: TelegramSendOptions): Promise<TelegramMessageRef>;
  editMessage(ref: TelegramMessageRef, text: string, options?: TelegramEditOptions): Promise<void>;
}

export interface TelegramCommand {
  command:
    | 'start'
    | 'status'
    | 'workspaces'
    | 'open'
    | 'sessions'
    | 'new'
    | 'arm'
    | 'disarm'
    | 'close'
    | 'abort'
    | 'steer'
    | 'followup'
    | 'prompt';
  args: string[];
  identity: TelegramIdentity;
  rawText: string;
}

export interface TelegramCommandFrame {
  kind: 'command';
  command: TelegramCommand['command'];
  args: string[];
  identity: TelegramIdentity;
  rawText: string;
}

export interface TelegramTextFrame {
  kind: 'text';
  text: string;
  identity: TelegramIdentity;
  rawText: string;
}

export type TelegramCommandInput = TelegramCommandFrame | TelegramTextFrame;

export interface TelegramCommandOkResult {
  kind: 'ok';
  text: string;
  silent?: boolean;
}

export interface TelegramCommandDeniedResult {
  kind: 'denied';
  text: string;
  reason: 'missing_allowlist' | 'user_denied' | 'chat_denied' | 'invalid_update';
}

export interface TelegramCommandErrorResult {
  kind: 'error';
  text: string;
  retryable?: boolean;
}

export type TelegramCommandResult = TelegramCommandOkResult | TelegramCommandDeniedResult | TelegramCommandErrorResult;

export type AuthDecision =
  | { ok: true; identity: TelegramIdentity }
  | { ok: false; reason: 'missing_allowlist' | 'user_denied' | 'chat_denied' | 'invalid_update' };

export interface AuthorizationPolicy {
  authorize(update: TelegramUpdate): AuthDecision;
  denialMessage(decision: AuthDecision): string;
}

export interface WorkspaceConfigEntry {
  id: string;
  label?: string;
  root: string;
}

export interface WorkspaceRef {
  id: string;
  label: string;
  canonicalRoot: string;
}

export type WorkspaceDecision =
  | { ok: true; workspace: WorkspaceRef }
  | { ok: false; reason: 'not_allowlisted' | 'not_trusted' | 'ambiguous' | 'missing' };

export interface WorkspaceRegistry {
  listAuthorizedWorkspaces(identity: TelegramIdentity): Promise<WorkspaceView[]>;
  resolveWorkspace(selector: string, identity: TelegramIdentity): Promise<WorkspaceDecision>;
}

export interface WorkspaceView extends WorkspaceRef {
  matchedConfigRoot: string;
}

export interface PiSessionRef {
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
}

export interface ActiveBinding {
  chatId: number;
  workspace: WorkspaceRef;
  sessionFile?: string;
  sessionId?: string;
  rpcKey: string;
  armedUntil?: number;
}

export interface BindingManager {
  get(chatId: number): ActiveBinding | undefined;
  bind(chatId: number, workspace: WorkspaceRef, session: PiSessionRef): ActiveBinding;
  arm(chatId: number, now: number, durationMs: number): ActiveBinding;
  disarm(chatId: number): void;
  unbind(chatId: number): ActiveBinding | undefined;
  requireArmed(chatId: number, now: number):
    | { ok: true; binding: ActiveBinding }
    | { ok: false; reason: 'no_binding' | 'unarmed' | 'expired' };
  clearForEmergencyDisable(): void;
}

export interface TelegramRuntimeConfig {
  configPath: string | undefined;
  configSource: 'env' | 'file' | 'fallback';
  botToken: string | undefined;
  botTokenSource?: 'env';
  config: TelegramControlConfig;
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export interface TelegramControlConfig {
  telegram: {
    allowedUserIds: number[];
    allowedChatIds?: number[];
    polling?: {
      timeoutSeconds?: number;
      limit?: number;
    };
  };
  workspaces: WorkspaceConfigEntry[];
  workspacesFromTrust?: boolean;
  policy?: {
    armDurationSeconds?: number;
    maxArmDurationSeconds?: number;
    maxPromptChars?: number;
  };
  pi?: {
    command?: string;
    sessionDir?: string;
    extraArgs?: string[];
  };
  audit?: {
    enabled?: boolean;
    path?: string;
    includePromptPreviewChars?: number;
    redactPaths?: boolean;
    maxBytes?: number;
    maxFiles?: number;
  };
  relay?: {
    maxTelegramMessageChars?: number;
    flushIntervalMs?: number;
    toolOutputMode?: 'off' | 'summary' | 'redacted';
  };
}

export interface PiTrustValidationResult {
  trusted: boolean;
  matchedPath?: string;
  decision?: boolean;
  reason?: 'missing_store' | 'nearest_false' | 'nearest_true' | 'invalid_store';
}

export interface PiTrustValidator {
  validate(canonicalRoot: string): Promise<PiTrustValidationResult>;
}

export interface AuditEvent {
  version: 1;
  timestamp: string;
  event: string;
  decision: 'allow' | 'deny' | 'observe';
  reason: string;
  actor?: {
    userId?: number;
    chatId?: number;
    username?: string;
  };
  workspace?: string;
  workspaceLabel?: string;
  sessionId?: string;
  sessionFile?: string;
  command?: string;
  action?: string;
  outputPreview?: string;
  auditPath?: string;
  cancelled?: boolean;
  metadata?: Record<string, unknown>;
}
export interface PiRpcSessionState {
  workspaceRoot?: string;
  workspace?: WorkspaceRef;
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  running?: boolean;
  cancelled?: boolean;
}

export interface PiRpcOutputEvent {
  type: 'output';
  text: string;
  sequence?: number;
}

export interface PiRpcStateEvent {
  type: 'state';
  state: PiRpcSessionState;
}

export interface PiRpcStatusEvent {
  type: 'status';
  status: 'running' | 'idle' | 'completed' | 'failed' | 'cancelled';
  text?: string;
}

export interface PiRpcErrorEvent {
  type: 'error';
  message: string;
  code?: string;
}

export interface PiRpcRawEvent {
  type: string;
  [key: string]: unknown;
}

export type PiRpcEvent = PiRpcOutputEvent | PiRpcStateEvent | PiRpcStatusEvent | PiRpcErrorEvent | PiRpcRawEvent;

export interface PiRpcClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): Promise<PiRpcSessionState>;
  newSession(parentSession?: string): Promise<{ cancelled: boolean }>;
  switchSession(sessionPath: string): Promise<{ cancelled: boolean }>;
  prompt(message: string): Promise<void>;
  steer(message: string): Promise<void>;
  followUp(message: string): Promise<void>;
  abort(): Promise<void>;
  onEvent(listener: (event: PiRpcEvent) => void): () => void;
}

export interface PiRpcProcessManager {
  acquire(binding: ActiveBinding): Promise<PiRpcClient>;
  restart(binding: ActiveBinding): Promise<PiRpcClient>;
  stop(binding: ActiveBinding): Promise<void>;
  stopAll(): Promise<void>;
}

export type PiOutputStatus = 'completed' | 'failed' | 'cancelled' | 'timeout';

export interface OutputRelay {
  attach(chatId: number, binding: ActiveBinding, client: PiRpcClient): () => void;
  flush(chatId: number): Promise<void>;
  complete(chatId: number, status: PiOutputStatus): Promise<void>;
}

export type AuthenticatedTelegramCommandInput =
  | { kind: 'start'; identity: TelegramIdentity }
  | { kind: 'status'; identity: TelegramIdentity }
  | { kind: 'workspaces'; identity: TelegramIdentity }
  | { kind: 'open'; identity: TelegramIdentity; workspaceId: string; sessionId?: string }
  | { kind: 'sessions'; identity: TelegramIdentity; workspaceId?: string }
  | { kind: 'new'; identity: TelegramIdentity; workspaceId?: string; sessionName?: string }
  | { kind: 'arm'; identity: TelegramIdentity; durationSeconds?: number }
  | { kind: 'disarm'; identity: TelegramIdentity }
  | { kind: 'close'; identity: TelegramIdentity }
  | { kind: 'abort'; identity: TelegramIdentity }
  | { kind: 'steer'; identity: TelegramIdentity; message: string }
  | { kind: 'followup'; identity: TelegramIdentity; message: string }
  | { kind: 'prompt'; identity: TelegramIdentity; message: string };

export type CommandResult = TelegramCommandResult;
