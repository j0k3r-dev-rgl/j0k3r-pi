import type { ActiveBinding, BindingManager, PiSessionRef, WorkspaceRef } from './types.js';

function makeRpcKey(workspace: WorkspaceRef, session: PiSessionRef): string {
  const workspaceRoot = workspace.canonicalRoot;
  const sessionId = session.sessionId ?? session.sessionFile ?? session.sessionName ?? '<no-session>';
  return `${workspaceRoot}|${sessionId}`;
}

export class InMemoryBindingManager implements BindingManager {
  private readonly bindings = new Map<number, ActiveBinding>();

  get(chatId: number): ActiveBinding | undefined {
    return this.bindings.get(chatId);
  }

  bind(chatId: number, workspace: WorkspaceRef, session: PiSessionRef): ActiveBinding {
    const rpcKey = makeRpcKey(workspace, session);
    const binding: ActiveBinding = {
      chatId,
      workspace,
      ...(session.sessionFile ? { sessionFile: session.sessionFile } : {}),
      ...(session.sessionId ? { sessionId: session.sessionId } : {}),
      ...(session.sessionName ? { sessionName: session.sessionName } : {}),
      rpcKey,
      armedUntil: undefined,
    };

    this.bindings.set(chatId, binding);
    return binding;
  }

  arm(chatId: number, now: number, durationMs: number): ActiveBinding {
    const existing = this.bindings.get(chatId);
    if (!existing) {
      throw new Error(`No active binding for chat ${chatId}`);
    }

    const binding: ActiveBinding = {
      ...existing,
      armedUntil: now + durationMs,
    };

    this.bindings.set(chatId, binding);
    return binding;
  }

  disarm(chatId: number): void {
    const existing = this.bindings.get(chatId);
    if (!existing) return;

    this.bindings.set(chatId, {
      ...existing,
      armedUntil: undefined,
    });
  }

  unbind(chatId: number): ActiveBinding | undefined {
    const existing = this.bindings.get(chatId);
    this.bindings.delete(chatId);
    return existing;
  }

  requireArmed(chatId: number, now: number): { ok: true; binding: ActiveBinding } | { ok: false; reason: 'no_binding' | 'unarmed' | 'expired' } {
    const binding = this.bindings.get(chatId);
    if (!binding) {
      return { ok: false, reason: 'no_binding' };
    }

    if (typeof binding.armedUntil !== 'number') {
      return { ok: false, reason: 'unarmed' };
    }

    if (binding.armedUntil <= now) {
      this.bindings.set(chatId, {
        ...binding,
        armedUntil: undefined,
      });
      return { ok: false, reason: 'expired' };
    }

    return { ok: true, binding };
  }

  clearForEmergencyDisable(): void {
    for (const [chatId, binding] of this.bindings.entries()) {
      if (binding.armedUntil === undefined) continue;
      this.bindings.set(chatId, {
        ...binding,
        armedUntil: undefined,
      });
    }
  }
}
