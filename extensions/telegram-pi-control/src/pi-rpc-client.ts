import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';

import type {
  PiRpcClient as PiRpcClientContract,
  PiRpcEvent,
  PiRpcSessionState,
} from './types.js';

export interface PiRpcProcess {
  stdin: {
    write: ChildProcessWithoutNullStreams['stdin']['write'];
    on?: (event: string, listener: () => void) => unknown;
  };
  stdout: Pick<ChildProcessWithoutNullStreams['stdout'], 'on'>;
  stderr: Pick<ChildProcessWithoutNullStreams['stderr'], 'on'>;
  kill: (...args: unknown[]) => void;
  on: EventEmitter['on'];
}

export interface PiRpcClientOptions {
  workspaceRoot: string;
  command?: string;
  extraArgs?: string[];
  sessionDir?: string;
  processFactory?: (command: string, args: string[], options: { cwd: string }) => PiRpcProcess;
}

interface PendingRequest {
  resolve: (result: ResponseResult) => void;
  reject: (error: Error) => void;
}

interface PiRpcRequestFrame {
  id: number;
  type: string;
  [key: string]: unknown;
}

interface PiRpcResponseFrame {
  id?: number;
  success?: boolean;
  data?: Record<string, unknown>;
  result?: {
    state?: PiRpcSessionState;
    cancelled?: boolean;
    error?: string;
    [key: string]: unknown;
  };
  workspace_root?: string;
  session_file?: string;
  session_id?: string;
  session_name?: string;
  running?: boolean;
  cancelled?: boolean;
  status?: 'running' | 'idle' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  text?: string;
  sequence?: number;
  code?: string;
  type?: string;
  [key: string]: unknown;
}

type ResponseResult = {
  cancelled?: boolean;
  state?: PiRpcSessionState;
  error?: string;
  [key: string]: unknown;
};

function parseLine(raw: string): object | undefined {
  const line = raw.trim();
  if (!line) return undefined;

  try {
    const parsed = JSON.parse(line);
    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }
    return parsed as object;
  } catch {
    return undefined;
  }
}

export class PiRpcClient implements PiRpcClientContract {
  private readonly command: string;
  private readonly args: string[];
  private readonly workspaceRoot: string;
  private readonly processFactory?: PiRpcClientOptions['processFactory'];
  private readonly listeners = new Set<(event: PiRpcEvent) => void>();
  private readonly pending = new Map<number, PendingRequest>();

  private process?: PiRpcProcess;
  private started = false;
  private closed = false;
  private nextRequestId = 1;
  private stdoutBuffer = '';

  constructor(options: PiRpcClientOptions) {
    this.command = options.command ?? 'pi';
    this.workspaceRoot = options.workspaceRoot;
    this.processFactory = options.processFactory;
    this.args = ['--mode', 'rpc', ...(options.extraArgs ?? [])];
    if (options.sessionDir) {
      this.args.push('--session-dir', options.sessionDir);
    }
  }

  async start(): Promise<void> {
    if (this.started && this.process) {
      return;
    }

    this.closed = false;
    const factory = this.processFactory
      ?? ((command, args) => {
        return spawn(command, args, {
          cwd: this.workspaceRoot,
          stdio: ['pipe', 'pipe', 'pipe'],
        }) as unknown as PiRpcProcess;
      });

    this.process = factory(this.command, this.args, { cwd: this.workspaceRoot });
    this.started = true;

    this.process.stdout.on('data', (chunk) => this.handleStdoutChunk(String(chunk)));
    this.process.stderr.on('data', () => {
      // stderr is intentionally ignored in this layer; adapter handles status separately.
    });

    this.process.on('exit', (code, signal) => {
      this.started = false;
      this.closePending(code, signal);
    });

    this.process.on('error', (error: unknown) => {
      this.started = false;
      this.closePending(undefined, undefined, error instanceof Error ? error : new Error(String(error)));
    });
  }

  async stop(): Promise<void> {
    if (!this.process) return;

    this.process.kill('SIGTERM');
    this.closePending(undefined, undefined, new Error('RPC process stopped'));
    this.started = false;
    this.process = undefined;
  }

  async getState(): Promise<PiRpcSessionState> {
    const response = await this.sendRequest('get_state');
    const state = response.state;

    return {
      workspaceRoot: typeof state?.workspaceRoot === 'string' ? state.workspaceRoot : this.workspaceRoot,
      sessionFile: typeof state?.sessionFile === 'string'
        ? state.sessionFile
        : typeof response.sessionFile === 'string'
          ? response.sessionFile
          : typeof response.session_file === 'string'
            ? response.session_file
            : undefined,
      sessionId: typeof state?.sessionId === 'string'
        ? state.sessionId
        : typeof response.sessionId === 'string'
          ? response.sessionId
          : typeof response.session_id === 'string'
            ? response.session_id
            : undefined,
      sessionName: typeof state?.sessionName === 'string'
        ? state.sessionName
        : typeof response.sessionName === 'string'
          ? response.sessionName
          : typeof response.session_name === 'string'
            ? response.session_name
            : undefined,
      running: typeof state?.running === 'boolean'
        ? state.running
        : typeof response.running === 'boolean'
          ? response.running
          : typeof response.isStreaming === 'boolean'
            ? response.isStreaming
            : undefined,
      cancelled: state?.cancelled === true || response.cancelled === true,
    };
  }

  async newSession(parentSession?: string): Promise<{ cancelled: boolean }> {
    const response = await this.sendRequest('new_session', {
      ...(parentSession ? { parentSession } : {}),
    });

    return {
      cancelled: response.cancelled === true || response.error === 'cancelled',
    };
  }

  async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
    const response = await this.sendRequest('switch_session', { sessionPath });
    return {
      cancelled: response.cancelled === true || response.error === 'cancelled',
    };
  }

  async prompt(message: string): Promise<void> {
    await this.sendRequest('prompt', { message });
  }

  async steer(message: string): Promise<void> {
    await this.sendRequest('steer', { message });
  }

  async followUp(message: string): Promise<void> {
    await this.sendRequest('follow_up', { message });
  }

  async abort(): Promise<void> {
    await this.sendRequest('abort');
  }

  onEvent(listener: (event: PiRpcEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async sendRequest(command: string, payload: Record<string, unknown> = {}): Promise<ResponseResult> {
    if (!this.process || !this.started || this.closed) {
      throw new Error('RPC process is not running');
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    const frame: PiRpcRequestFrame = {
      id,
      type: command,
      ...payload,
    };

    const response = this.waitForResponse(id);
    await this.writeFrame(frame);
    const result = await response;

    if (result.error) {
      throw new Error(result.error);
    }

    return result;
  }

  private waitForResponse(id: number): Promise<ResponseResult> {
    return new Promise<ResponseResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (result) => resolve(result),
        reject,
      });
    });
  }

  private async writeFrame(frame: PiRpcRequestFrame): Promise<void> {
    const text = `${JSON.stringify(frame)}\n`;

    if (!this.process) {
      throw new Error('RPC process is not running');
    }

    const accepted = this.process.stdin.write(text);
    if (!accepted) {
      await new Promise<void>((resolve) => {
        const stdin = this.process?.stdin as unknown as { once?: (event: 'drain', listener: () => void) => void };
        if (stdin?.once) {
          stdin.once('drain', () => {
            resolve();
          });
          return;
        }
        resolve();
      });
    }
  }

  private handleStdoutChunk(chunk: string): void {
    this.stdoutBuffer += chunk;

    while (true) {
      const newline = this.stdoutBuffer.indexOf('\n');
      if (newline === -1) break;

      const rawLine = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);

      const parsed = parseLine(rawLine);
      if (!parsed) continue;

      const response = parsed as PiRpcResponseFrame;
      if (typeof response.id === 'number' && this.pending.has(response.id)) {
        const pending = this.pending.get(response.id);
        this.pending.delete(response.id);

        if (pending) {
          const responseData = response.data ?? response.result ?? {};
          const payload: ResponseResult = {
            ...responseData,
            ...(response.error !== undefined ? { error: response.error } : {}),
            ...(response.success === false ? { error: response.error ?? 'RPC command failed' } : {}),
            ...(response.cancelled === true ? { cancelled: true } : {}),
          };

          pending.resolve(payload);
          continue;
        }
      }

      const event = this.normalizeOutputEvent(response);
      if (event) {
        this.notifyListeners(event);
      }
    }
  }

  private normalizeOutputEvent(payload: PiRpcResponseFrame): PiRpcEvent {
    if (payload.type === 'message_update') {
      const event = (payload as { assistantMessageEvent?: { type?: string; delta?: string; reason?: string } }).assistantMessageEvent;
      if (event?.type === 'text_delta') {
        return {
          type: 'output',
          text: typeof event.delta === 'string' ? event.delta : '',
        };
      }

      if (event?.type === 'error') {
        return {
          type: 'status',
          status: event.reason === 'aborted' ? 'cancelled' : 'failed',
          text: event.reason ?? 'error',
        };
      }
    }

    if (payload.type === 'agent_end') {
      return {
        type: 'status',
        status: 'completed',
        text: 'completed',
      };
    }

    if (payload.type === 'output') {
      const text = typeof payload.text === 'string' ? payload.text : '';
      const sequence = typeof payload.sequence === 'number' ? payload.sequence : undefined;
      return {
        type: 'output',
        text,
        ...(sequence !== undefined ? { sequence } : {}),
      };
    }

    if (payload.type === 'status' && typeof payload.text === 'string') {
      return {
        type: 'status',
        status: payload.status === 'completed' || payload.status === 'failed' || payload.status === 'cancelled' || payload.status === 'running' || payload.status === 'idle'
          ? payload.status
          : 'running',
        text: payload.text,
      };
    }

    if (payload.type === 'state' || typeof payload.state === 'object') {
      const state = (payload.state && typeof payload.state === 'object') ? payload.state as PiRpcSessionState : undefined;
      return {
        type: 'state',
        state: state ?? {
          workspaceRoot: this.workspaceRoot,
        },
      };
    }

    if (payload.error && typeof payload.error === 'string') {
      return {
        type: 'error',
        message: payload.error,
        code: typeof payload.code === 'string' ? payload.code : undefined,
      };
    }

    return {
      type: 'status',
      status: 'running',
      text: payload.text === undefined ? JSON.stringify(payload) : String(payload.text),
    };
  }

  private notifyListeners(event: PiRpcEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private closePending(code?: number | null, signal?: NodeJS.Signals | string | null, cause?: Error): void {
    this.closed = true;
    const error = cause ?? new Error(`RPC process exited${signal ? ` with ${String(signal)}` : code ? ` (${code})` : ' unexpectedly'}`);

    for (const pending of this.pending.values()) {
      pending.reject(error);
    }

    this.pending.clear();
  }
}
