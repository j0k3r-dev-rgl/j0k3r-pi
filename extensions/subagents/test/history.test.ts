import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { SubagentHistoryStore } from '../src/history.js';
import type { SubagentTask } from '../src/types.js';

const require = createRequire(import.meta.url);

describe('subagent history persistence and display_name compatibility', () => {
  let tmp: string;
  let oldDbPath: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagents-history-test-'));
    oldDbPath = process.env.PI_SUBAGENTS_HISTORY_DB_PATH;
    process.env.PI_SUBAGENTS_HISTORY_DB_PATH = path.join(tmp, 'subagents-history.sqlite');
  });

  afterEach(() => {
    if (oldDbPath === undefined) delete process.env.PI_SUBAGENTS_HISTORY_DB_PATH;
    else process.env.PI_SUBAGENTS_HISTORY_DB_PATH = oldDbPath;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('persists and retrieves display_name across task queries and attempts', () => {
    const store = new SubagentHistoryStore();
    const task: SubagentTask = {
      id: 'subtask_persisted_friendly_name',
      display_name: 'Security Vulnerability Scan',
      agent: 'security',
      mode: 'task',
      status: 'completed',
      task: 'scan for vulnerabilities',
      created_at: new Date().toISOString(),
      attempt: 1,
      result: 'no vulnerabilities found',
    };

    store.upsertTask(tmp, task);

    const direct = store.getTask(tmp, task.id);
    expect(direct).toBeDefined();
    expect(direct?.display_name).toBe('Security Vulnerability Scan');

    const listed = store.listTasks(tmp);
    expect(listed).toHaveLength(1);
    expect(listed[0].display_name).toBe('Security Vulnerability Scan');

    const byStatus = store.listTasksByStatus(tmp, ['completed']);
    expect(byStatus).toHaveLength(1);
    expect(byStatus[0].display_name).toBe('Security Vulnerability Scan');

    const attempts = store.listTaskAttempts(tmp, task.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].display_name).toBe('Security Vulnerability Scan');
  });

  it('migrates older databases without display_name column and leaves legacy rows with undefined display_name', () => {
    const dbPath = process.env.PI_SUBAGENTS_HISTORY_DB_PATH!;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    // Create legacy table without display_name column
    const { DatabaseSync } = require('node:sqlite');
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      CREATE TABLE subagent_tasks (
        id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL,
        agent TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        task TEXT NOT NULL,
        context TEXT,
        created_at TEXT NOT NULL,
        attempt INTEGER,
        session_id TEXT,
        nested_session_path TEXT,
        started_at TEXT,
        ended_at TEXT,
        last_activity_at TEXT,
        last_activity TEXT,
        output_preview TEXT,
        prompt TEXT,
        continuation_prompt TEXT,
        system_prompt TEXT,
        transcript TEXT,
        usage_input INTEGER,
        usage_output INTEGER,
        usage_cache_read INTEGER,
        usage_cache_write INTEGER,
        usage_cost REAL,
        usage_context_tokens INTEGER,
        usage_turns INTEGER,
        model TEXT,
        effort TEXT,
        model_source TEXT,
        effort_source TEXT,
        fallback_used INTEGER,
        error TEXT,
        error_metadata_json TEXT,
        error_category TEXT,
        result TEXT,
        thread_snapshot_json TEXT,
        pi_retry_attempts INTEGER,
        pending_message_count INTEGER,
        undelivered_message_count INTEGER
      );
      CREATE TABLE subagent_task_attempts (
        task_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        cwd TEXT NOT NULL,
        agent TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        task TEXT NOT NULL,
        context TEXT,
        created_at TEXT NOT NULL,
        session_id TEXT,
        nested_session_path TEXT,
        started_at TEXT,
        ended_at TEXT,
        last_activity_at TEXT,
        last_activity TEXT,
        output_preview TEXT,
        prompt TEXT,
        continuation_prompt TEXT,
        system_prompt TEXT,
        transcript TEXT,
        usage_input INTEGER,
        usage_output INTEGER,
        usage_cache_read INTEGER,
        usage_cache_write INTEGER,
        usage_cost REAL,
        usage_context_tokens INTEGER,
        usage_turns INTEGER,
        model TEXT,
        effort TEXT,
        model_source TEXT,
        effort_source TEXT,
        fallback_used INTEGER,
        error TEXT,
        error_metadata_json TEXT,
        error_category TEXT,
        result TEXT,
        thread_snapshot_json TEXT,
        pi_retry_attempts INTEGER,
        pending_message_count INTEGER,
        undelivered_message_count INTEGER,
        PRIMARY KEY (task_id, attempt)
      );
      CREATE TABLE subagent_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        attempt INTEGER,
        cwd TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        activity TEXT NOT NULL,
        output_preview TEXT
      );
    `);
    legacyDb.prepare(`
      INSERT INTO subagent_tasks (id, cwd, agent, mode, status, task, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('subtask_legacy_row', tmp, 'analyst', 'task', 'completed', 'legacy task', '2026-01-01T00:00:00.000Z');
    legacyDb.prepare(`
      INSERT INTO subagent_task_attempts (task_id, attempt, cwd, agent, mode, status, task, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('subtask_legacy_row', 1, tmp, 'analyst', 'task', 'completed', 'legacy task', '2026-01-01T00:00:00.000Z');
    legacyDb.close();

    // Opening with SubagentHistoryStore should trigger ensureColumn migration
    const store = new SubagentHistoryStore();
    const legacyTask = store.getTask(tmp, 'subtask_legacy_row');
    expect(legacyTask).toBeDefined();
    expect(legacyTask?.display_name).toBeUndefined();

    // Now upsert a new task with display_name
    const newTask: SubagentTask = {
      id: 'subtask_post_migration',
      display_name: 'Post Migration Task',
      agent: 'tester',
      mode: 'task',
      status: 'completed',
      task: 'verify migration',
      created_at: new Date().toISOString(),
      attempt: 1,
    };
    store.upsertTask(tmp, newTask);

    const fetchedNew = store.getTask(tmp, newTask.id);
    expect(fetchedNew?.display_name).toBe('Post Migration Task');

    const all = store.listTasks(tmp);
    expect(all).toHaveLength(2);
    const legacyFromList = all.find((t) => t.id === 'subtask_legacy_row');
    const newFromList = all.find((t) => t.id === 'subtask_post_migration');
    expect(legacyFromList?.display_name).toBeUndefined();
    expect(newFromList?.display_name).toBe('Post Migration Task');
  });
});
