import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { SUBAGENT_ACTIVITY_WINDOW_MINUTES } from '../config.js';
import type { SectionState, SidebarAdapterContext, SubagentActivity, SubagentActivityModel } from '../model.js';

const require = createRequire(import.meta.url);

type RawTask = {
  id?: unknown;
  agent?: unknown;
  status?: unknown;
  task?: unknown;
  result?: unknown;
  error?: unknown;
  output_preview?: unknown;
  last_activity?: unknown;
  session_id?: unknown;
  sessionId?: unknown;
  cwd?: unknown;
  created_at?: unknown;
  started_at?: unknown;
  ended_at?: unknown;
  last_activity_at?: unknown;
  lastActivityAt?: unknown;
};

type SubagentProvider = {
  listSessionTasks?: (cwd: string, sessionId: string) => unknown | Promise<unknown>;
  listTasks?: (cwd: string) => unknown | Promise<unknown>;
};

type HistoryReader = (cwd: string, sessionId?: string) => unknown | Promise<unknown>;

type SubagentsAdapterOptions = {
  provider?: SubagentProvider;
  historyReader?: HistoryReader;
  historyPathExists?: (cwd: string) => boolean;
};

export type SubagentsAdapter = {
  load(context: SidebarAdapterContext): Promise<SectionState<SubagentActivityModel>>;
};

export function createSubagentsAdapter(options: SubagentsAdapterOptions = {}): SubagentsAdapter {
  return {
    async load(context) {
      const provider = options.provider ?? detectProvider(context);
      if (provider) {
        const providerState = await loadFromProvider(provider, context);
        if (providerState) return providerState;
      }

      const historyState = await loadFromHistory(context, options);
      if (historyState) return historyState;

      return unavailable();
    },
  };
}

async function loadFromProvider(
  provider: SubagentProvider,
  context: SidebarAdapterContext,
): Promise<SectionState<SubagentActivityModel> | undefined> {
  try {
    let raw: unknown;
    if (context.sessionId && typeof provider.listSessionTasks === 'function') {
      raw = await provider.listSessionTasks(context.cwd, context.sessionId);
    } else if (typeof provider.listTasks === 'function') {
      raw = await provider.listTasks(context.cwd);
    } else if (typeof provider.listSessionTasks === 'function') {
      raw = await provider.listSessionTasks(context.cwd, context.sessionId ?? '');
    } else {
      return undefined;
    }

    const tasks = normalizeTaskArray(raw, context);
    if (!tasks) return unavailable();
    return buildState(tasks, 'provider', context);
  } catch {
    return unavailable();
  }
}

async function loadFromHistory(
  context: SidebarAdapterContext,
  options: SubagentsAdapterOptions,
): Promise<SectionState<SubagentActivityModel> | undefined> {
  const historyExists = options.historyPathExists ?? defaultHistoryPathExists;
  if (!historyExists(context.cwd)) return undefined;

  try {
    const raw = options.historyReader
      ? await options.historyReader(context.cwd, context.sessionId)
      : await readHistoryTasks(context.cwd, context.sessionId);
    const tasks = normalizeTaskArray(raw, context);
    if (!tasks) return unavailable();
    return buildState(tasks, 'history', context);
  } catch {
    return unavailable();
  }
}

function detectProvider(context: SidebarAdapterContext): SubagentProvider | undefined {
  const candidates = [
    context.ctx?.subagents,
    context.ctx?.subagentManager,
    context.pi?.subagents,
    context.pi?.subagentManager,
    (globalThis as Record<string, unknown>).__PI_SIDEBAR_SUBAGENTS_PROVIDER__,
  ];

  for (const candidate of candidates) {
    if (
      candidate
      && typeof candidate === 'object'
      && (typeof (candidate as SubagentProvider).listTasks === 'function'
        || typeof (candidate as SubagentProvider).listSessionTasks === 'function')
    ) {
      return candidate as SubagentProvider;
    }
  }

  return undefined;
}

function normalizeTaskArray(raw: unknown, context: SidebarAdapterContext): RawTask[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const tasks = raw.filter(isRecord);
  if (tasks.length !== raw.length) return undefined;

  if (context.sessionId) {
    const sessionTasks = tasks.filter((task) => {
      const sessionId = stringValue(task.session_id) ?? stringValue(task.sessionId);
      return sessionId === undefined || sessionId === context.sessionId;
    });
    return sessionTasks;
  }

  return tasks.filter((task) => {
    const cwd = stringValue(task.cwd);
    return cwd === undefined || cwd === context.cwd;
  });
}

function buildState(
  tasks: RawTask[],
  source: SubagentActivityModel['source'],
  context: SidebarAdapterContext,
): SectionState<SubagentActivityModel> {
  const threshold = context.now().getTime() - SUBAGENT_ACTIVITY_WINDOW_MINUTES * 60 * 1000;
  const activities = tasks
    .map((task) => toActivity(task, context.now()))
    .filter((activity): activity is SubagentActivity => Boolean(activity))
    .filter((activity) => Date.parse(activity.lastActivityAt) >= threshold)
    .sort(compareActivities);

  if (!activities.length) {
    return { kind: 'empty', message: 'no recent activity' };
  }

  return {
    kind: 'ready',
    refreshedAt: context.now().toISOString(),
    data: {
      windowMinutes: SUBAGENT_ACTIVITY_WINDOW_MINUTES,
      source,
      activities,
    },
  };
}

function toActivity(task: RawTask, now: Date): SubagentActivity | undefined {
  const id = stringValue(task.id);
  const agent = stringValue(task.agent);
  if (!id || !agent) return undefined;

  const status = normalizeStatus(task.status);
  const lastActivityAt = firstIso(task.last_activity_at, task.lastActivityAt, task.ended_at, task.started_at, task.created_at);
  if (!lastActivityAt) return undefined;

  return {
    id,
    agent,
    status,
    summary: summarizeTask(task, status),
    lastActivityAt,
    elapsedSeconds: elapsedSeconds(task, status, now),
  };
}

function summarizeTask(task: RawTask, status: SubagentActivity['status']): string {
  const summary = firstText(task.task, task.result, task.output_preview, task.last_activity, task.error);
  if (summary) return summary;

  switch (status) {
    case 'queued':
      return 'Queued task';
    case 'running':
      return 'Running task';
    case 'completed':
      return 'Completed task';
    case 'failed':
      return 'Failed task';
    case 'cancelled':
      return 'Cancelled task';
    default:
      return 'Task update';
  }
}

function elapsedSeconds(task: RawTask, status: SubagentActivity['status'], now: Date): number | undefined {
  const startedAt = firstIso(task.started_at, task.created_at);
  if (!startedAt) return undefined;
  const startMs = Date.parse(startedAt);
  if (!Number.isFinite(startMs)) return undefined;

  if (status === 'queued' || status === 'running') {
    return Math.max(0, Math.round((now.getTime() - startMs) / 1000));
  }

  const endedAt = firstIso(task.ended_at, task.last_activity_at, task.lastActivityAt);
  if (!endedAt) return undefined;
  const endMs = Date.parse(endedAt);
  if (!Number.isFinite(endMs)) return undefined;
  return Math.max(0, Math.round((endMs - startMs) / 1000));
}

function compareActivities(a: SubagentActivity, b: SubagentActivity): number {
  const rankDiff = activityRank(a.status) - activityRank(b.status);
  if (rankDiff !== 0) return rankDiff;
  return Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);
}

function activityRank(status: SubagentActivity['status']): number {
  return status === 'queued' || status === 'running' ? 0 : 1;
}

function normalizeStatus(value: unknown): SubagentActivity['status'] {
  switch (String(value ?? '').trim()) {
    case 'queued':
    case 'running':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return String(value).trim() as SubagentActivity['status'];
    default:
      return 'unknown';
  }
}

function unavailable(): SectionState<SubagentActivityModel> {
  return { kind: 'unavailable', message: 'subagents unavailable' };
}

function resolveSubagentsHistoryHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PI_SUBAGENTS_HISTORY_HOME) return path.resolve(env.PI_SUBAGENTS_HISTORY_HOME);
  const xdg = env.XDG_DATA_HOME;
  return xdg ? path.join(xdg, 'pi', 'subagents') : path.join(os.homedir(), '.local', 'share', 'pi', 'subagents');
}

function resolveSubagentHistoryDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PI_SUBAGENTS_HISTORY_DB_PATH) return path.resolve(env.PI_SUBAGENTS_HISTORY_DB_PATH);
  return path.join(resolveSubagentsHistoryHome(env), 'subagents-history.sqlite');
}

function defaultHistoryPathExists(_cwd: string): boolean {
  return fs.existsSync(resolveSubagentHistoryDbPath());
}

async function readHistoryTasks(cwd: string, sessionId?: string): Promise<unknown> {
  const databaseModule = require('node:sqlite') as {
    DatabaseSync?: new (filename: string, options?: Record<string, unknown>) => {
      prepare(sql: string): { all(...args: unknown[]): unknown[] };
      close?: () => void;
    };
  };
  const DatabaseSync = databaseModule.DatabaseSync;
  if (typeof DatabaseSync !== 'function') throw new Error('node:sqlite unavailable');

  const file = resolveSubagentHistoryDbPath();
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const sql = sessionId
      ? `SELECT id, agent, status, task, output_preview, error, session_id, created_at, started_at, ended_at, last_activity_at, cwd FROM subagent_tasks WHERE cwd = ? AND session_id = ? ORDER BY last_activity_at DESC LIMIT 50`
      : `SELECT id, agent, status, task, output_preview, error, session_id, created_at, started_at, ended_at, last_activity_at, cwd FROM subagent_tasks WHERE cwd = ? ORDER BY last_activity_at DESC LIMIT 50`;
    return sessionId ? db.prepare(sql).all(cwd, sessionId) : db.prepare(sql).all(cwd);
  } finally {
    db.close?.();
  }
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = stringValue(value)?.trim();
    if (text) return text;
  }
  return undefined;
}

function firstIso(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = stringValue(value)?.trim();
    if (text && Number.isFinite(Date.parse(text))) return text;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
