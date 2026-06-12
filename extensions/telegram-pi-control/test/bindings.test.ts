import { describe, expect, it, vi } from 'vitest';
import { afterEach } from 'vitest';

import { InMemoryBindingManager } from '../src/bindings.js';
import { ActiveBinding, PiSessionRef, WorkspaceRef } from '../src/types.js';

const identityA = 100;
const identityB = 200;

const workspaceA: WorkspaceRef = {
  id: 'workspace-a',
  label: 'Workspace A',
  canonicalRoot: '/tmp/workspace-a',
};

const workspaceB: WorkspaceRef = {
  id: 'workspace-b',
  label: 'Workspace B',
  canonicalRoot: '/tmp/workspace-b',
};

const sessionA: PiSessionRef = { sessionId: 'session-a', sessionName: 'A' };
const sessionB: PiSessionRef = { sessionId: 'session-b', sessionName: 'B' };

describe('InMemoryBindingManager', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps per-chat bindings isolated', () => {
    const manager = new InMemoryBindingManager();
    manager.bind(identityA, workspaceA, sessionA);
    manager.bind(identityB, workspaceB, sessionB);

    const bindingA = manager.get(identityA);
    const bindingB = manager.get(identityB);

    expect(bindingA?.rpcKey).toBe(`${workspaceA.canonicalRoot}|${sessionA.sessionId}`);
    expect(bindingB?.rpcKey).toBe(`${workspaceB.canonicalRoot}|${sessionB.sessionId}`);

    manager.arm(identityA, 1000, 1000);
    expect(manager.get(identityB)?.armedUntil).toBeUndefined();
    expect(manager.requireArmed(identityB, 1000)).toEqual({ ok: false, reason: 'unarmed' });
  });

  it('clears armed state when the chat binds to a new workspace/session', () => {
    const manager = new InMemoryBindingManager();

    manager.bind(identityA, workspaceA, sessionA);
    manager.arm(identityA, 10_000, 30_000);
    expect(manager.requireArmed(identityA, 10_001)).toEqual({ ok: true, binding: expect.anything() });

    manager.bind(identityA, workspaceB, sessionB);
    expect(manager.get(identityA)?.armedUntil).toBeUndefined();
    expect(manager.requireArmed(identityA, 10_001)).toEqual({ ok: false, reason: 'unarmed' });
  });

  it('supports arming expiry', () => {
    vi.useFakeTimers();
    const manager = new InMemoryBindingManager();

    manager.bind(identityA, workspaceA, sessionA);
    const now = () => Date.now();

    manager.arm(identityA, now(), 5_000);
    expect(manager.requireArmed(identityA, now())).toMatchObject({ ok: true });

    vi.advanceTimersByTime(6_000);
    expect(manager.requireArmed(identityA, Date.now())).toEqual({ ok: false, reason: 'expired' });
  });

  it('disarms immediately', () => {
    const manager = new InMemoryBindingManager();

    manager.bind(identityA, workspaceA, sessionA);
    manager.arm(identityA, 1_000, 10_000);
    manager.disarm(identityA);

    expect(manager.requireArmed(identityA, 2_000)).toEqual({ ok: false, reason: 'unarmed' });
  });

  it('clears all armed bindings on emergency disable', () => {
    const manager = new InMemoryBindingManager();

    manager.bind(identityA, workspaceA, sessionA);
    manager.bind(identityB, workspaceB, sessionB);
    manager.arm(identityA, 1_000, 10_000);
    manager.arm(identityB, 2_000, 10_000);

    manager.clearForEmergencyDisable();

    expect(manager.requireArmed(identityA, 3_000)).toEqual({ ok: false, reason: 'unarmed' });
    expect(manager.requireArmed(identityB, 3_000)).toEqual({ ok: false, reason: 'unarmed' });
  });
});
