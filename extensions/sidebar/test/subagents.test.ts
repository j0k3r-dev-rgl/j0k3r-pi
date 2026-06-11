import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import type { SectionState, SubagentActivityModel } from '../src/model.js';
import { createSubagentsAdapter } from '../src/adapters/subagents.js';

const require = createRequire(import.meta.url);

type RawTask = {
  id: string;
  agent: string;
  status: string;
  task?: string;
  result?: string;
  error?: string;
  output_preview?: string;
  session_id?: string;
  created_at?: string;
  started_at?: string;
  ended_at?: string;
  last_activity_at?: string;
  cwd?: string;
};

function expectReady(state: SectionState<SubagentActivityModel>) {
  expect(state.kind).toBe('ready');
  return (state as Extract<SectionState<SubagentActivityModel>, { kind: 'ready' }>).data;
}

describe('createSubagentsAdapter', () => {
  it('returns graceful unavailable states for missing source, failing source, incompatible data, and missing history db', async () => {
    const now = () => new Date('2026-06-10T00:10:00.000Z');

    const missing = await createSubagentsAdapter({
      historyPathExists: () => false,
    }).load({ cwd: '/workspace/pi', ctx: {}, pi: {}, now });
    expect(missing).toEqual({ kind: 'unavailable', message: 'subagents unavailable' });

    const failing = await createSubagentsAdapter({
      provider: {
        listTasks: async () => {
          throw new Error('boom');
        },
      },
    }).load({ cwd: '/workspace/pi', ctx: {}, pi: {}, now });
    expect(failing).toEqual({ kind: 'unavailable', message: 'subagents unavailable' });

    const incompatible = await createSubagentsAdapter({
      provider: {
        listTasks: async () => ({ nope: true }),
      },
    }).load({ cwd: '/workspace/pi', ctx: {}, pi: {}, now });
    expect(incompatible).toEqual({ kind: 'unavailable', message: 'subagents unavailable' });

    const missingHistory = await createSubagentsAdapter({
      historyPathExists: () => true,
      historyReader: async () => {
        throw new Error('sqlite unavailable');
      },
    }).load({ cwd: '/workspace/pi', ctx: {}, pi: {}, now });
    expect(missingHistory).toEqual({ kind: 'unavailable', message: 'subagents unavailable' });
  });

  it('sorts running and queued tasks first, orders each group by recency, filters to the last 20 minutes, computes elapsed time, and fills missing summaries', async () => {
    const state = await createSubagentsAdapter({
      provider: {
        listTasks: async () => [
          task({
            id: 'completed-recent',
            agent: 'reviewer',
            status: 'completed',
            task: 'checked results',
            started_at: '2026-06-10T00:04:00.000Z',
            ended_at: '2026-06-10T00:07:00.000Z',
            last_activity_at: '2026-06-10T00:07:00.000Z',
          }),
          task({
            id: 'running-missing-summary',
            agent: 'writer',
            status: 'running',
            created_at: '2026-06-10T00:00:00.000Z',
            started_at: '2026-06-10T00:06:00.000Z',
            last_activity_at: '2026-06-10T00:06:00.000Z',
          }),
          task({
            id: 'queued-newest',
            agent: 'planner',
            status: 'queued',
            created_at: '2026-06-10T00:08:30.000Z',
            last_activity_at: '2026-06-10T00:08:30.000Z',
          }),
          task({
            id: 'failed-older',
            agent: 'critic',
            status: 'failed',
            error: 'tool failed',
            last_activity_at: '2026-06-10T00:05:00.000Z',
          }),
          task({
            id: 'completed-within-20-minutes',
            agent: 'archiver',
            status: 'completed',
            task: 'recent older work',
            last_activity_at: '2026-06-09T23:50:00.000Z',
          }),
          task({
            id: 'too-old',
            agent: 'archiver',
            status: 'completed',
            task: 'old work',
            last_activity_at: '2026-06-09T23:48:59.000Z',
          }),
        ] satisfies RawTask[],
      },
    }).load({
      cwd: '/workspace/pi',
      ctx: {},
      pi: {},
      now: () => new Date('2026-06-10T00:09:00.000Z'),
    });

    const data = expectReady(state);
    expect(data.source).toBe('provider');
    expect(data.windowMinutes).toBe(20);
    expect(data.activities.map((activity) => activity.id)).toEqual([
      'queued-newest',
      'running-missing-summary',
      'completed-recent',
      'failed-older',
      'completed-within-20-minutes',
    ]);
    expect(data.activities[0]?.elapsedSeconds).toBe(30);
    expect(data.activities[1]?.elapsedSeconds).toBe(180);
    expect(data.activities[1]?.summary).toBe('Running task');
    expect(data.activities[2]?.elapsedSeconds).toBe(180);
    expect(data.activities[3]?.summary).toBe('tool failed');
  });

  it('loads recent subagent tasks from the global history db path when no provider is available', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-sidebar-subagents-history-'));
    const oldDbPath = process.env.PI_SUBAGENTS_HISTORY_DB_PATH;
    const dbPath = path.join(tmp, 'subagents-history.sqlite');
    process.env.PI_SUBAGENTS_HISTORY_DB_PATH = dbPath;
    try {
      const { DatabaseSync } = require('node:sqlite') as any;
      const db = new DatabaseSync(dbPath);
      try {
        db.exec(`
          CREATE TABLE subagent_tasks (
            id TEXT PRIMARY KEY,
            cwd TEXT NOT NULL,
            agent TEXT NOT NULL,
            status TEXT NOT NULL,
            task TEXT,
            output_preview TEXT,
            error TEXT,
            session_id TEXT,
            created_at TEXT,
            started_at TEXT,
            ended_at TEXT,
            last_activity_at TEXT
          )
        `);
        db.prepare(`INSERT INTO subagent_tasks (id, cwd, agent, status, task, session_id, created_at, started_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          'history-global-task',
          '/workspace/pi',
          'discovery',
          'running',
          'global history work',
          'session-123',
          '2026-06-10T00:08:00.000Z',
          '2026-06-10T00:08:10.000Z',
          '2026-06-10T00:09:00.000Z',
        );
      } finally {
        db.close();
      }

      const state = await createSubagentsAdapter().load({
        cwd: '/workspace/pi',
        sessionId: 'session-123',
        ctx: {},
        pi: {},
        now: () => new Date('2026-06-10T00:10:00.000Z'),
      });

      const data = expectReady(state);
      expect(data.source).toBe('history');
      expect(data.activities.map((activity) => activity.id)).toEqual(['history-global-task']);
    } finally {
      if (oldDbPath === undefined) delete process.env.PI_SUBAGENTS_HISTORY_DB_PATH;
      else process.env.PI_SUBAGENTS_HISTORY_DB_PATH = oldDbPath;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('prefers session-filtered reads when session id is available and falls back to cwd-scoped reads when it is not', async () => {
    const listSessionTasks = vi.fn(async () => [
      task({
        id: 'session-task',
        agent: 'writer',
        status: 'running',
        task: 'session work',
        session_id: 'session-123',
        started_at: '2026-06-10T00:08:00.000Z',
        last_activity_at: '2026-06-10T00:08:30.000Z',
      }),
    ] satisfies RawTask[]);
    const listTasks = vi.fn(async () => [
      task({
        id: 'cwd-task',
        agent: 'planner',
        status: 'queued',
        task: 'cwd work',
        created_at: '2026-06-10T00:09:00.000Z',
        last_activity_at: '2026-06-10T00:09:00.000Z',
      }),
    ] satisfies RawTask[]);
    const adapter = createSubagentsAdapter({
      provider: { listSessionTasks, listTasks },
    });

    const sessionState = await adapter.load({
      cwd: '/workspace/pi',
      sessionId: 'session-123',
      ctx: {},
      pi: {},
      now: () => new Date('2026-06-10T00:10:00.000Z'),
    });
    const cwdState = await adapter.load({
      cwd: '/workspace/pi',
      ctx: {},
      pi: {},
      now: () => new Date('2026-06-10T00:10:00.000Z'),
    });

    expect(listSessionTasks).toHaveBeenCalledWith('/workspace/pi', 'session-123');
    expect(listTasks).toHaveBeenCalledWith('/workspace/pi');
    expect(expectReady(sessionState).activities.map((activity) => activity.id)).toEqual(['session-task']);
    expect(expectReady(cwdState).activities.map((activity) => activity.id)).toEqual(['cwd-task']);
  });
});

function task(overrides: RawTask): RawTask {
  return Object.assign(
    {
      created_at: '2026-06-10T00:00:00.000Z',
      last_activity_at: '2026-06-10T00:00:00.000Z',
      id: 'task-1',
      agent: 'agent',
      status: 'completed',
    } satisfies RawTask,
    overrides,
  );
}
