import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryLifecycle } from '../../src/lifecycle.ts';
import {
  SUPERVISOR_CHECKPOINT_CHANNEL,
  saveMemoryCheckpoint,
  getMemoryCheckpoint,
} from '../../src/bridge.ts';

test('MINI-005: bridge exports SUPERVISOR_CHECKPOINT_CHANNEL and helper functions', () => {
  assert.equal(SUPERVISOR_CHECKPOINT_CHANNEL, 'memory:supervisor:checkpoint:v1');
  assert.equal(typeof saveMemoryCheckpoint, 'function');
  assert.equal(typeof getMemoryCheckpoint, 'function');
});

test('MINI-005: memory checkpoint save and get over pi.events bridge with readback verification', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pi-memory-bridge-test-'));
  const dbPath = join(tmpDir, 'test-memory.sqlite');

  try {
    const lifecycle = new MemoryLifecycle(dbPath);

    // Mock EventBus
    const handlers = new Map<string, Array<(payload: any) => void>>();
    const mockEvents = {
      on(channel: string, handler: (payload: any) => void) {
        if (!handlers.has(channel)) handlers.set(channel, []);
        handlers.get(channel)!.push(handler);
        return () => {
          const arr = handlers.get(channel) ?? [];
          const idx = arr.indexOf(handler);
          if (idx >= 0) arr.splice(idx, 1);
        };
      },
      emit(channel: string, payload: any) {
        const arr = handlers.get(channel);
        if (arr) {
          for (const fn of [...arr]) {
            fn(payload);
          }
        }
      },
    };

    const mockPi = {
      on: () => () => {},
      events: mockEvents,
    };

    lifecycle.registerPublicEvents(mockPi);

    // Test save checkpoint
    const testTitle = 'Supervisor Checkpoint Run 101';
    const testContent = 'Checkpoint state: step=apply, tests=passed, branch=main';
    const saveRes = await saveMemoryCheckpoint(mockEvents, {
      cwd: tmpDir,
      sessionId: 'session-bridge-test-1',
      title: testTitle,
      content: testContent,
      type: 'session_summary',
    });

    assert.equal(saveRes.ok, true);
    assert.ok(typeof saveRes.id === 'number' && saveRes.id > 0);
    assert.equal(saveRes.committed, true);
    assert.equal(saveRes.readbackVerified, true);
    assert.equal(saveRes.topic_key, 'session/session-bridge-test-1/summary');

    // Test get checkpoint
    const getRes = await getMemoryCheckpoint(mockEvents, {
      cwd: tmpDir,
      sessionId: 'session-bridge-test-1',
      id: saveRes.id!,
    });

    assert.equal(getRes.ok, true);
    assert.equal(getRes.id, saveRes.id);
    assert.equal(getRes.title, testTitle);
    assert.equal(getRes.content, testContent);
    assert.equal(getRes.topic_key, 'session/session-bridge-test-1/summary');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
