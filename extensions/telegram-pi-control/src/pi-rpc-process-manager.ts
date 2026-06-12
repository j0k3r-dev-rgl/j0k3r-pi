import type { ActiveBinding, PiRpcProcessManager as PiRpcProcessManagerContract, PiRpcSessionState } from './types.js';
import type { PiRpcClient as PiRpcClientContract } from './types.js';
import { PiRpcClient } from './pi-rpc-client.js';

export interface PiRpcProcessManagerOptions {
  createClient?: (binding: ActiveBinding) => Promise<PiRpcClientContract> | PiRpcClientContract;
  onLifecycle?: (event: {
    event: 'spawned' | 'stopped' | 'reused' | 'replaced';
    binding: ActiveBinding;
    reason?: string;
  }) => void;
}

interface ManagedBinding {
  binding: ActiveBinding;
  client: PiRpcClientContract;
}

export class InMemoryPiRpcProcessManager implements PiRpcProcessManagerContract {
  private readonly clients = new Map<string, ManagedBinding>();
  private readonly createClient: (binding: ActiveBinding) => Promise<PiRpcClientContract>;
  private readonly options: PiRpcProcessManagerOptions;

  constructor(options: PiRpcProcessManagerOptions = {}) {
    this.options = options;
    this.createClient = async (binding) => {
      if (options.createClient) {
        return options.createClient(binding);
      }

      const client = new PiRpcClient({
        workspaceRoot: binding.workspace.canonicalRoot,
      });
      return client;
    };
  }

  async acquire(binding: ActiveBinding): Promise<PiRpcClientContract> {
    let attempts = 0;

    while (attempts < 3) {
      attempts += 1;

      const existing = this.clients.get(binding.rpcKey);
      if (existing) {
        const matching = await this.validateOrNull(existing, binding);
        if (matching) {
          this.options.onLifecycle?.({
            event: 'reused',
            binding,
            reason: 'identity matched',
          });
          return existing.client;
        }

        await this.stop(binding);
      }

      const client = await this.createClient(binding);
      await client.start();
      await this.alignClientSession(client, binding);
      const validated = await this.validateOrNull({ binding, client }, binding);

      if (validated) {
        this.clients.set(binding.rpcKey, { binding, client });
        this.options.onLifecycle?.({
          event: 'spawned',
          binding,
          reason: 'new client created for binding',
        });
        return client;
      }

      await client.stop().catch(() => undefined);
      this.options.onLifecycle?.({
        event: 'replaced',
        binding,
        reason: 'identity validation failed',
      });
      this.clients.delete(binding.rpcKey);
    }

    throw new Error('pi rpc client identity does not match binding');
  }
  async restart(binding: ActiveBinding): Promise<PiRpcClientContract> {
    await this.stop(binding);
    return this.acquire(binding);
  }

  async stop(binding: ActiveBinding): Promise<void> {
    const managed = this.clients.get(binding.rpcKey);
    if (!managed) return;

    await managed.client.stop().catch(() => undefined);
    this.clients.delete(binding.rpcKey);
    this.options.onLifecycle?.({
      event: 'stopped',
      binding: managed.binding,
      reason: 'stop requested',
    });
  }

  async stopAll(): Promise<void> {
    const entries = Array.from(this.clients.values());
    this.clients.clear();

    await Promise.all(entries.map(async (managed) => {
      await managed.client.stop().catch(() => undefined);
      this.options.onLifecycle?.({
        event: 'stopped',
        binding: managed.binding,
        reason: 'stopAll',
      });
    }));
  }

  private async alignClientSession(client: PiRpcClientContract, expected: ActiveBinding): Promise<void> {
    if (!expected.sessionFile) return;
    const state = await client.getState().catch(() => undefined as unknown as PiRpcSessionState | undefined);
    if (state?.sessionFile === expected.sessionFile) return;
    await client.switchSession(expected.sessionFile).catch(() => undefined);
  }

  private async validateOrNull(current: ManagedBinding, expected: ActiveBinding): Promise<PiRpcClientContract | null> {
    const state = await current.client.getState().catch(() => undefined as unknown as PiRpcSessionState | undefined);
    if (!state) return null;

    if (!state.workspaceRoot || state.workspaceRoot !== expected.workspace.canonicalRoot) {
      return null;
    }

    if (expected.sessionFile) {
      return state.sessionFile === expected.sessionFile ? current.client : null;
    }

    if (!expected.sessionId) {
      return current.client;
    }

    if (!state.sessionId) {
      return null;
    }

    return state.sessionId === expected.sessionId ? current.client : null;
  }
}
