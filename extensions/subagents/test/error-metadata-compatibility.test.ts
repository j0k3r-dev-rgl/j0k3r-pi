import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import extension, { ClaudeBackgroundWidget, ClaudeBackgroundWidgetState, completionMessage, createSubagentsPanelKeyMatcher, moveClaudeBackgroundWidgetSelection, renderClaudeBackgroundWidgetLines, resolveRegisteredToolDefinition, sendSubagentCompletionMessage } from '../index.js';
import { loadSubagents, parseFrontmatter, readSubagentsConfig, resetGlobalSubagentModelProfileField, saveGlobalSubagentModelProfile, subagentSourceWarnings } from '../src/config.js';
import { resolveEffectiveSubagentProfile } from '../src/profile-resolver.js';
import { buildPrompt, ThreadSnapshotBuilder } from '../src/runner.js';
import { SubagentStructuredError, deriveErrorString, normalizeErrorMetadata, parseErrorMetadata, safeErrorMetadataDetails, serializeErrorMetadata } from '../src/error-metadata.js';
import { applyDirtyProfileEdit, buildModelProfileRows, buildNoChangesModelProfilesMessage, buildNonTuiModelProfilesMessage, commitStagedModelProfiles, createSubagentModelProfilesModal, globalSubagentsConfigPath, groupAvailableModelsByProvider, runSubagentModelsCommand, stageModelProfileEdit } from '../src/model-profiles-ui.js';
import { resolveSubagentHistoryDbPath, resolveSubagentsHistoryHome, SubagentHistoryStore } from '../src/history.js';
import { isSubagentsDebugEnabled, writeSubagentsDebugLog } from '../src/debug.js';
import { createSubagentsRenderLogger, DEFAULT_RENDER_DEBUG_LOG_PATH } from '../src/render-debug.js';
import { SubagentManager } from '../src/manager.js';
import { registerSubagentTools } from '../src/tools.js';
import { SubagentsHistoryPanel } from '../src/ui.js';
import { boundThreadSnapshot, isValidThreadSnapshot, registerSubagentRuntimeToolDefinition, renderThreadBody, resetPiComponentCacheForTests } from '../src/thread-view.js';
import type { EffectiveSubagentProfile, SubagentErrorMetadata, SubagentModelProfiles, SubagentRunner, SubagentTask } from '../src/types.js';

const require = createRequire(import.meta.url);

let tmp: string;
let oldAgentDir: string | undefined;
let oldHistoryDbPath: string | undefined;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagents-test-'));
  oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  oldHistoryDbPath = process.env.PI_SUBAGENTS_HISTORY_DB_PATH;
  process.env.PI_CODING_AGENT_DIR = path.join(tmp, 'isolated-agent');
  process.env.PI_SUBAGENTS_HISTORY_DB_PATH = path.join(tmp, 'global-agent', 'subagents-history.sqlite');
  fs.mkdirSync(path.join(tmp, '.pi', 'subagents'), { recursive: true });
});
afterEach(() => {
  if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  if (oldHistoryDbPath === undefined) delete process.env.PI_SUBAGENTS_HISTORY_DB_PATH;
  else process.env.PI_SUBAGENTS_HISTORY_DB_PATH = oldHistoryDbPath;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeAgent(name: string, body = '# Agent\nhello') {
  fs.writeFileSync(path.join(tmp, '.pi', 'subagents', `${name}.md`), `---\nname: ${name}\ndescription: ${name} agent\ntools:\n  - read\n  - memory_search\n---\n${body}`);
}

function mockRunner(delay = 0): SubagentRunner {
  return async ({ definition, task }) => {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    return { result: `${definition.name} handled ${task}`, model: 'mock/model', fallback_used: false };
  };
}

function statusSnapshot(text: string) {
  return { version: 1 as const, source: 'events' as const, items: [{ type: 'status' as const, text }] };
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '').replace(/\u001b\][^\u001b]*(?:\u001b\\|\u0007)/g, '');
}

function renderText(snapshot: unknown, overrides: Partial<Parameters<typeof renderThreadBody>[1]> = {}): string {
  const context = {
    cwd: tmp,
    visibleWidth: (text: string) => stripAnsi(text).length,
    truncateToWidth: (text: string, width: number) => text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text,
    ...overrides,
  };
  return stripAnsi(renderThreadBody(snapshot, context).join('\n')).replace(/\s+/g, ' ').trim();
}

function withAgentDir<T>(agentDir: string, run: () => T): T {
  const old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    return run();
  } finally {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = old;
  }
}

function readJsonl(file: string): any[] {
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

describe('structured error metadata public compatibility', () => {
  it('exposes compatible public task types while keeping error string optional', () => {
    const task: SubagentTask = {
      id: 'task-error-metadata',
      agent: 'analyst',
      mode: 'task',
      status: 'failed',
      task: 'render error',
      created_at: new Date().toISOString(),
      error: 'timed out after 123ms',
      error_metadata: normalizeErrorMetadata({
        category: 'total_timeout',
        message: 'timed out after 123ms',
        retryable: false,
        partial_result_available: true,
        details: { timeout_ms: '123', prompt: 'SYSTEM: hidden prompt text' },
        last_activity: `Working in /tmp/fake-private.txt ${'x'.repeat(700)}`,
      }),
    };

    expect(task.error).toBe('timed out after 123ms');
    expect(task.error_metadata?.version).toBe(1);
    expect(task.error_metadata?.last_activity?.length ?? 0).toBeLessThanOrEqual(512);
    expect(task.error_metadata?.last_activity).not.toContain('/tmp/fake-private.txt');
    expect(deriveErrorString(task.error_metadata!)).toBe(task.error);
  });

  it('serializes, parses, and exposes safe bounded metadata details without leaking secrets', () => {
    const metadata: SubagentErrorMetadata = normalizeErrorMetadata({
      category: 'provider_api_error',
      message: 'Authorization: Bearer sk-fake-secret-token fake.user@example.com /tmp/fake-private.txt',
      partial_result_available: false,
      details: {
        provider_code: '500',
        auth_header: 'Authorization: Bearer sk-fake-secret-token',
        prompt: 'USER: fake prompt body',
        file_path: '/tmp/fake-private.txt',
      },
    });

    const json = serializeErrorMetadata(metadata);
    expect(json).toBeTruthy();
    expect(json).not.toContain('sk-fake-secret-token');
    expect(json).not.toContain('fake.user@example.com');
    expect(json).not.toContain('/tmp/fake-private.txt');

    const parsed = parseErrorMetadata(json);
    expect(parsed).toBeDefined();
    expect(parsed?.version).toBe(1);

    const details = safeErrorMetadataDetails(parsed!);
    expect(JSON.stringify(details)).not.toContain('sk-fake-secret-token');
    expect(JSON.stringify(details)).not.toContain('fake.user@example.com');
    expect(JSON.stringify(details)).not.toContain('/tmp/fake-private.txt');
  });
});
