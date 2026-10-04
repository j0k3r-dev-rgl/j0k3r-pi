import { describe, expect, it, vi } from 'vitest';
import extension, {
  ClaudeBackgroundWidget,
  ClaudeBackgroundWidgetState,
  completionMessage,
  createSubagentsPanelKeyMatcher,
  moveClaudeBackgroundWidgetSelection,
  renderClaudeBackgroundWidgetLines,
  renderSubagentCompletionMessage,
  resolveRegisteredToolDefinition,
  sendSubagentCompletionMessage,
} from '../index.js';
import * as configModule from '../src/config.js';
import * as errorMetadataModule from '../src/error-metadata.js';
import * as modelProfilesUiModule from '../src/model-profiles-ui.js';
import * as runnerModule from '../src/runner.js';
import * as threadViewModule from '../src/thread-view.js';
import * as toolsModule from '../src/tools.js';
import * as typesModule from '../src/types.js';
import * as uiModule from '../src/ui.js';

async function withIsolatedSubagentsConfig(
  callback: (workspaceDir: string) => void | Promise<void>,
  options: { globalConfig?: Record<string, unknown>; projectConfig?: Record<string, unknown> } = {},
): Promise<void> {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagents-compat-'));
  const agentDir = path.join(root, 'agent');
  const workspaceDir = path.join(root, 'workspace');
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousCwd = process.cwd();

  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });

  if (options.globalConfig) {
    fs.writeFileSync(path.join(agentDir, 'subagents.json'), JSON.stringify(options.globalConfig));
  }

  if (options.projectConfig) {
    fs.mkdirSync(path.join(workspaceDir, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, '.pi', 'subagents.json'), JSON.stringify(options.projectConfig));
  }

  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.chdir(workspaceDir);

  try {
    await callback(workspaceDir);
  } finally {
    process.chdir(previousCwd);
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('compatibility smoke', () => {
  it('preserves the root default export and named root exports', () => {
    expect(typeof extension).toBe('function');
    expect(typeof createSubagentsPanelKeyMatcher).toBe('function');
    expect(typeof resolveRegisteredToolDefinition).toBe('function');
    expect(typeof moveClaudeBackgroundWidgetSelection).toBe('function');
    expect(typeof renderClaudeBackgroundWidgetLines).toBe('function');
    expect(typeof ClaudeBackgroundWidgetState).toBe('function');
    expect(typeof ClaudeBackgroundWidget).toBe('function');
    expect(typeof completionMessage).toBe('function');
    expect(typeof sendSubagentCompletionMessage).toBe('function');
    expect(typeof renderSubagentCompletionMessage).toBe('function');
  });

  it('preserves extension registration order and contract names with continuation disabled by default', async () => {
    await withIsolatedSubagentsConfig(() => {
      const calls: string[] = [];
      const shortcuts: string[] = [];
      const commands: string[] = [];
      const tools: string[] = [];
      const events: string[] = [];
      const pi = {
        registerMessageRenderer: vi.fn((name: string) => { calls.push(`renderer:${name}`); }),
        registerTool: vi.fn((tool: { name: string }) => { calls.push(`tool:${tool.name}`); tools.push(tool.name); }),
        on: vi.fn((name: string) => { calls.push(`event:${name}`); events.push(name); }),
        registerShortcut: vi.fn((name: string) => { calls.push(`shortcut:${name}`); shortcuts.push(name); }),
        registerCommand: vi.fn((name: string) => { calls.push(`command:${name}`); commands.push(name); }),
      };

      extension(pi);

      expect(calls[0]).toBe('renderer:subagent-completion');
      expect(tools).toEqual([
        'subagent_list_agents',
        'subagent_run',
        'subagent_status',
        'subagent_result',
        'subagent_list_tasks',
        'subagent_cancel',
        'subagent_send_message',
      ]);
      expect(events).toEqual(['session_start', 'session_shutdown']);
      expect(shortcuts).toEqual(expect.arrayContaining(['ctrl+,', 'ctrl+h']));
      expect(commands).toEqual(['subagents', 'subagent-models']);
    });
  });

  it('restores subagent_continue registration when continuation is explicitly enabled before extension initialization', async () => {
    await withIsolatedSubagentsConfig(() => {
      const tools: string[] = [];
      extension({
        registerMessageRenderer: () => undefined,
        registerTool: vi.fn((tool: { name: string }) => { tools.push(tool.name); }),
        on: () => undefined,
        registerShortcut: () => undefined,
        registerCommand: () => undefined,
      });
      expect(tools).toContain('subagent_continue');
    }, { projectConfig: { enable_continue: true } });
  });
});
