import type {
  PiRpcClient as PiClientContract,
  PiRpcEvent,
  PiRpcSessionState,
  TelegramApprovalChoice,
  TelegramPermissionPrompt,
  PermissionAnswerResult,
  PiRpcPermissionResolvedEvent,
} from './types.js';

export interface PiSdkSessionLike {
  sessionFile?: string;
  sessionId: string;
  isStreaming?: boolean;
  prompt(message: string): Promise<void>;
  steer(message: string): Promise<void>;
  followUp(message: string): Promise<void>;
  abort(): Promise<void>;
  dispose?: () => void;
  bindExtensions?: (options?: Record<string, unknown>) => Promise<void>;
  subscribe(listener: (event: unknown) => void): () => void;
}

interface PermissionApprovalEntry {
  request: TelegramPermissionPrompt;
  resolve: (choice: TelegramApprovalChoice) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export interface PiSdkRuntimeLike {
  cwd?: string;
  services?: { cwd?: string };
  session: PiSdkSessionLike;
  newSession(): Promise<{ cancelled?: boolean } | void>;
  switchSession(sessionPath: string, options?: { cwdOverride?: string }): Promise<{ cancelled?: boolean } | void>;
  dispose(): Promise<void> | void;
}

export interface PiSdkClientOptions {
  workspaceRoot: string;
  sessionFile?: string;
  sessionDir?: string;
  agentDir?: string;
  permissionApprovalTimeoutMs?: number;
  runtimeFactory?: (options: { workspaceRoot: string; sessionFile?: string; sessionDir?: string; agentDir?: string }) => Promise<PiSdkRuntimeLike>;
}

interface AssistantEventLike {
  type?: string;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
    reason?: string;
  };
}

export class PiSdkClient implements PiClientContract {
  private readonly workspaceRoot: string;
  private readonly sessionFile?: string;
  private readonly sessionDir?: string;
  private readonly agentDir?: string;
  private readonly runtimeFactory: (options: { workspaceRoot: string; sessionFile?: string; sessionDir?: string; agentDir?: string }) => Promise<PiSdkRuntimeLike>;
  private readonly listeners = new Set<(event: PiRpcEvent) => void>();
  private readonly pendingApprovals = new Map<string, PermissionApprovalEntry>();
  private readonly approvalTimeoutMs: number;

  private runtime?: PiSdkRuntimeLike;
  private unsubscribe?: () => void;

  constructor(options: PiSdkClientOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.sessionFile = options.sessionFile;
    this.sessionDir = options.sessionDir;
    this.agentDir = options.agentDir;
    this.runtimeFactory = options.runtimeFactory ?? createDefaultSdkRuntime;
    this.approvalTimeoutMs = options.permissionApprovalTimeoutMs ?? 5 * 60 * 1000;
  }

  async start(): Promise<void> {
    if (this.runtime) return;
    this.runtime = await this.runtimeFactory({
      workspaceRoot: this.workspaceRoot,
      sessionFile: this.sessionFile,
      sessionDir: this.sessionDir,
      agentDir: this.agentDir,
    });
    await this.bindCurrentSession();
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.abortAllPending('aborted');
    await this.runtime?.dispose();
    this.runtime = undefined;
  }

  async getState(): Promise<PiRpcSessionState> {
    const session = this.requireSession();
    return {
      workspaceRoot: this.runtime?.cwd ?? this.runtime?.services?.cwd ?? this.workspaceRoot,
      sessionFile: session.sessionFile,
      sessionId: session.sessionId,
      running: session.isStreaming,
    };
  }

  async newSession(): Promise<{ cancelled: boolean }> {
    const runtime = this.requireRuntime();
    const result = await runtime.newSession();
    await this.bindCurrentSession();
    return { cancelled: Boolean(result && 'cancelled' in result && result.cancelled) };
  }

  async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
    const runtime = this.requireRuntime();
    const result = await runtime.switchSession(sessionPath, { cwdOverride: this.workspaceRoot });
    await this.bindCurrentSession();
    return { cancelled: Boolean(result && 'cancelled' in result && result.cancelled) };
  }

  async prompt(message: string): Promise<void> {
    await this.requireSession().prompt(message);
  }

  async steer(message: string): Promise<void> {
    await this.requireSession().steer(message);
  }

  async followUp(message: string): Promise<void> {
    await this.requireSession().followUp(message);
  }

  async abort(): Promise<void> {
    await this.requireSession().abort();
  }

  async answerPermission(requestId: string, choice: TelegramApprovalChoice): Promise<PermissionAnswerResult> {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) {
      return { ok: false, reason: 'not_found' };
    }

    if (!pending.request.choices.includes(choice)) {
      return { ok: false, reason: 'unsupported_choice' };
    }

    clearTimeout(pending.timeoutHandle);
    this.pendingApprovals.delete(requestId);
    pending.resolve(choice);

    return {
      ok: true,
      requestId,
      choice,
    };
  }

  onEvent(listener: (event: PiRpcEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private requestPermissionApproval(payload: unknown): Promise<TelegramApprovalChoice | undefined> {
    const request = this.toPermissionPrompt(payload);
    if (!request) {
      return Promise.resolve('Deny');
    }


    return new Promise<TelegramApprovalChoice>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        const pending = this.pendingApprovals.get(request.requestId);
        if (!pending) {
          return;
        }
        this.pendingApprovals.delete(request.requestId);
        pending.resolve('Deny');
        this.emit({
          type: 'permission_resolved',
          requestId: request.requestId,
          status: 'expired',
        });
      }, this.approvalTimeoutMs);

      const boundSession = this.requireSession();
      if (!request.sessionId && boundSession.sessionId) {
        request.sessionId = boundSession.sessionId;
      }
      if (!request.sessionFile && boundSession.sessionFile) {
        request.sessionFile = boundSession.sessionFile;
      }

      this.pendingApprovals.set(request.requestId, {
        request,
        resolve: (choice: TelegramApprovalChoice) => {
          resolve(choice);
          this.emit({
            type: 'permission_resolved',
            requestId: request.requestId,
            status: choice === 'Deny' ? 'denied' : 'approved',
            choice,
          });
        },
        reject,
        timeoutHandle,
      });

      this.emit({
        type: 'permission_required',
        request,
      });
    });
  }

  private abortAllPending(status: PiRpcPermissionResolvedEvent['status'] = 'aborted'): void {
    for (const [requestId, pending] of this.pendingApprovals.entries()) {
      clearTimeout(pending.timeoutHandle);
      this.pendingApprovals.delete(requestId);
      this.emit({
        type: 'permission_resolved',
        requestId,
        status,
        choice: status === 'approved' ? pending.request.choices[0] : 'Deny',
      });
      pending.resolve('Deny');
    }
  }

  private toPermissionPrompt(raw: unknown): TelegramPermissionPrompt | undefined {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }

    const candidate = raw as {
      requestId?: unknown;
      reason?: unknown;
      reasonCode?: unknown;
      riskLevel?: unknown;
      tool?: unknown;
      action?: unknown;
      prompt?: unknown;
      projectScope?: unknown;
      sessionScope?: unknown;
    };
    if (typeof candidate.requestId !== 'string' || candidate.requestId.length === 0) {
      return undefined;
    }

    const prompt = (candidate.prompt as {
      title?: unknown;
      message?: unknown;
      safeTarget?: unknown;
      safeCommandSummary?: unknown;
      choices?: unknown;
      workspaceRoot?: unknown;
    }) ?? {};

    if (typeof prompt.title !== 'string' || typeof prompt.message !== 'string') {
      return undefined;
    }

    const choices: TelegramApprovalChoice[] = [];
    const knownChoices = new Set<TelegramApprovalChoice>([
      'Allow once',
      'Allow for session',
      'Allow for project',
      'Allow this file for project',
      'Allow this folder for project',
      'Deny',
    ]);
    if (Array.isArray(prompt.choices)) {
      for (const candidateChoice of prompt.choices) {
        if (typeof candidateChoice === 'string' && knownChoices.has(candidateChoice as TelegramApprovalChoice)) {
          choices.push(candidateChoice as TelegramApprovalChoice);
        }
      }
    }

    const request: TelegramPermissionPrompt = {
      id: candidate.requestId,
      requestId: candidate.requestId,
      workspaceRoot: typeof prompt.workspaceRoot === 'string'
        ? prompt.workspaceRoot
        : this.runtime?.cwd
          ?? this.runtime?.services?.cwd
          ?? this.workspaceRoot,
      reason: typeof candidate.reason === 'string' ? candidate.reason : 'permission required',
      reasonCode: typeof candidate.reasonCode === 'string' ? candidate.reasonCode : 'permission_required',
      riskLevel: candidate.riskLevel === 'critical'
        ? 'critical'
        : candidate.riskLevel === 'medium'
          ? 'medium'
          : candidate.riskLevel === 'low'
            ? 'low'
            : 'high',
      tool: typeof candidate.tool === 'string' ? candidate.tool : 'unknown',
      action: typeof candidate.action === 'string' ? candidate.action : 'unknown',
      title: prompt.title,
      message: prompt.message,
      safeTarget: typeof prompt.safeTarget === 'string' ? prompt.safeTarget : undefined,
      safeCommandSummary: typeof prompt.safeCommandSummary === 'string' ? prompt.safeCommandSummary : undefined,
      choices: choices.length > 0 ? choices : ['Deny'],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + this.approvalTimeoutMs).toISOString(),
    };

    request.sessionId = this.extractSessionId(candidate.sessionScope)
      || this.extractSessionId(candidate.projectScope)
      || request.sessionId;

    return request;
  }

  private extractSessionId(raw: unknown): string | undefined {
    if (!raw || typeof raw !== 'object') return undefined;

    const candidate = raw as {
      sessionScope?: unknown;
      sessionId?: unknown;
      cacheKey?: unknown;
      action?: unknown;
      commandPattern?: unknown;
    };

    if (typeof candidate.sessionId === 'string' && candidate.sessionId.length > 0) {
      return candidate.sessionId;
    }

    return undefined;
  }

  private requireRuntime(): PiSdkRuntimeLike {
    if (!this.runtime) throw new Error('SDK runtime is not running');
    return this.runtime;
  }

  private requireSession(): PiSdkSessionLike {
    return this.requireRuntime().session;
  }

  private async bindCurrentSession(): Promise<void> {
    const session = this.requireSession();
    this.unsubscribe?.();
    this.abortAllPending('aborted');
    await session.bindExtensions?.({
      mode: 'rpc',
      uiContext: {
        requestPermissionApproval: (payload: unknown): Promise<TelegramApprovalChoice | undefined> => this.requestPermissionApproval(payload),
      },
    });
    this.unsubscribe = session.subscribe((event) => this.handleSdkEvent(event));
  }

  private handleSdkEvent(raw: unknown): void {
    const event = raw as AssistantEventLike;
    if (event.type === 'message_update') {
      const assistant = event.assistantMessageEvent;
      if (assistant?.type === 'text_delta' && typeof assistant.delta === 'string') {
        this.emit({ type: 'output', text: assistant.delta });
        return;
      }
      if (assistant?.type === 'error') {
        this.emit({
          type: 'status',
          status: assistant.reason === 'aborted' ? 'cancelled' : 'failed',
          text: assistant.reason ?? 'error',
        });
        return;
      }
    }

    if (event.type === 'agent_end') {
      this.emit({ type: 'status', status: 'completed', text: 'completed' });
    }
  }

  private emit(event: PiRpcEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

async function createDefaultSdkRuntime(options: { workspaceRoot: string; sessionFile?: string; sessionDir?: string; agentDir?: string }): Promise<PiSdkRuntimeLike> {
  const sdk = await import('@earendil-works/pi-coding-agent');
  const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }: any) => {
    const services = await sdk.createAgentSessionServices({ cwd, agentDir: options.agentDir });
    return {
      ...(await sdk.createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  const sessionManager = options.sessionFile
    ? sdk.SessionManager.open(options.sessionFile, options.sessionDir, options.workspaceRoot)
    : sdk.SessionManager.create(options.workspaceRoot, options.sessionDir);

  return sdk.createAgentSessionRuntime(createRuntime, {
    cwd: options.workspaceRoot,
    agentDir: options.agentDir ?? sdk.getAgentDir(),
    sessionManager,
  }) as Promise<PiSdkRuntimeLike>;
}
