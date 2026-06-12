import type {
  PiRpcClient as PiClientContract,
  PiRpcEvent,
  PiRpcSessionState,
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

  private runtime?: PiSdkRuntimeLike;
  private unsubscribe?: () => void;

  constructor(options: PiSdkClientOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.sessionFile = options.sessionFile;
    this.sessionDir = options.sessionDir;
    this.agentDir = options.agentDir;
    this.runtimeFactory = options.runtimeFactory ?? createDefaultSdkRuntime;
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

  onEvent(listener: (event: PiRpcEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
    await session.bindExtensions?.({});
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
