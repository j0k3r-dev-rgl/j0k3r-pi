import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import workspaceServicesExtension, { isExtensionEnabled, registerWorkspaceServicesTools, WORKSPACE_SERVICE_TOOL_NAMES } from '../index.js';
import { composeExecutor } from '../src/core/docker-compose.js';
import { vi } from 'vitest';

function createPi() {
  const tools: any[] = [];
  const handlers: Record<string, any[]> = {};
  return {
    tools,
    handlers,
    registerTool(tool: any) {
      tools.push(tool);
    },
    on(event: string, handler: any) {
      handlers[event] ??= [];
      handlers[event].push(handler);
    },
  };
}

async function enableExtension(cwd: string, enabled = true): Promise<void> {
  await mkdir(join(cwd, '.pi'), { recursive: true });
  await writeFile(join(cwd, '.pi', 'extensions.json'), JSON.stringify({ 'workspace-services': enabled }), 'utf8');
}

async function workspaceWithExtensionEnabled(): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-workspace-services-tools-env-'));
  await enableExtension(cwd, true);
  return cwd;
}

async function configuredWorkspace(): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-workspace-services-tools-'));
  await enableExtension(cwd, true);
  await mkdir(join(cwd, '.pi'), { recursive: true });
  await mkdir(join(cwd, 'svc'), { recursive: true });
  await writeFile(join(cwd, '.pi', 'workspace-services.json'), JSON.stringify({
    services: {
      svc: { type: 'node', path: 'svc', command: 'npm run dev', env_file: false },
    },
  }), 'utf8');
  return cwd;
}

describe('workspace services extension tools', () => {
  const untrustedContext = {
    cwd: '/tmp/untrusted-workspace',
    isProjectTrusted: () => false,
  };

  it('verifies opt-in gating: 0 tools when false or missing, 6 tools when true', async () => {
    const missingDir = mkdtempSync(join(tmpdir(), 'pi-ws-gating-missing-'));
    const disabledDir = mkdtempSync(join(tmpdir(), 'pi-ws-gating-disabled-'));
    await enableExtension(disabledDir, false);
    const enabledDir = mkdtempSync(join(tmpdir(), 'pi-ws-gating-enabled-'));
    await enableExtension(enabledDir, true);

    expect(isExtensionEnabled('workspace-services', missingDir)).toBe(false);
    expect(isExtensionEnabled('workspace-services', disabledDir)).toBe(false);
    expect(isExtensionEnabled('workspace-services', enabledDir)).toBe(true);

    const piMissing = createPi();
    workspaceServicesExtension(piMissing as any, { cwd: missingDir });
    expect(piMissing.tools).toHaveLength(0);

    const piDisabled = createPi();
    workspaceServicesExtension(piDisabled as any, { cwd: disabledDir });
    expect(piDisabled.tools).toHaveLength(0);

    const piEnabled = createPi();
    workspaceServicesExtension(piEnabled as any, { cwd: enabledDir });
    expect(piEnabled.tools.map((t) => t.name)).toEqual([...WORKSPACE_SERVICE_TOOL_NAMES]);
  });

  it('directly exercises registerWorkspaceServicesTools regardless of extensions.json', () => {
    const pi = createPi();
    registerWorkspaceServicesTools(pi as any);
    expect(pi.tools.map((tool) => tool.name)).toEqual([...WORKSPACE_SERVICE_TOOL_NAMES]);
  });

  it('registers the expected separate tools with renderers', async () => {
    const cwd = await workspaceWithExtensionEnabled();
    const pi = createPi();
    workspaceServicesExtension(pi as any, { cwd });
    expect(pi.tools.map((tool) => tool.name)).toEqual([...WORKSPACE_SERVICE_TOOL_NAMES]);
    for (const tool of pi.tools) {
      expect(tool.compactToolRenderingVersion).toBe(1);
      expect(tool.renderShell).toBe('self');
      expect(tool.renderResult).toBeTypeOf('function');
      expect(tool.renderCall).toBeTypeOf('function');
    }
  });

  it('fails closed before project reads in an untrusted project for all six tools with native isError and remediation', async () => {
    const cwd = await workspaceWithExtensionEnabled();
    const pi = createPi();
    workspaceServicesExtension(pi as any, { cwd });
    expect(pi.tools.length).toBe(6);
    for (const tool of pi.tools) {
      const params = tool.name === 'workspace_service_start' || tool.name === 'workspace_service_stop' || tool.name === 'workspace_service_restart' || tool.name === 'workspace_service_logs'
        ? { service: 'svc' }
        : {};
      const result = await tool.execute('1', params, undefined, undefined, untrustedContext);
      expect(result.isError).toBe(true);
      expect(result.details.status).toBe('trust_required');
      expect(result.details.ok).toBe(false);
      expect(result.content[0].text).toContain('Trust the project');
    }
  });

  it('returns concise configured service details in status content with status=ok and declared_type label', async () => {
    const cwd = await configuredWorkspace();
    const pi = createPi();
    workspaceServicesExtension(pi as any, { cwd });
    const tool = pi.tools.find((entry) => entry.name === 'workspace_services_status');
    const result = await tool.execute('1', {}, undefined, undefined, { cwd, isProjectTrusted: () => true });
    expect(result.isError).toBeFalsy();
    expect(result.details.ok).toBe(true);
    expect(result.details.status).toBe('ok');
    expect(result.details.summary).not.toContain('workspace_services_status');
    expect(result.content[0].text).toContain('workspace_services_status:');
    expect(result.content[0].text).toContain('sources:');
    expect(result.content[0].text).toContain('- svc: stopped declared_type=node path=svc command=npm run dev');
  });

  it('returns every service name and declared metadata in list content with status=ok', async () => {
    const cwd = await configuredWorkspace();
    const pi = createPi();
    workspaceServicesExtension(pi as any, { cwd });
    const tool = pi.tools.find((entry) => entry.name === 'workspace_services_list');
    const result = await tool.execute('1', {}, undefined, undefined, { cwd, isProjectTrusted: () => true });
    expect(result.isError).toBeFalsy();
    expect(result.details.ok).toBe(true);
    expect(result.details.status).toBe('ok');
    expect(result.details.summary).not.toContain('workspace_services_list');
    expect(result.content[0].text).toContain('workspace_services_list:');
    expect(result.content[0].text).toContain('svc');
    expect(result.content[0].text).toContain('declared_type=node');
    expect(result.content[0].text).toContain('command=npm run dev');
  });

  it('reports partial status when Compose discovery or ps fails while keeping confirmed local services intact', async () => {
    const cwd = await configuredWorkspace();
    await writeFile(join(cwd, 'compose.yaml'), 'services:\n  api:\n    image: node:20\n', 'utf8');
    const runSpy = vi.spyOn(composeExecutor, 'run').mockImplementation(async (_cwd, args) => {
      if (args[0] === 'config') return { stdout: '', stderr: 'daemon down', exitCode: 1 };
      return { stdout: '', stderr: 'daemon down', exitCode: 1 };
    });
    try {
      const pi = createPi();
      workspaceServicesExtension(pi as any, { cwd });
      const listTool = pi.tools.find((entry) => entry.name === 'workspace_services_list');
      const listResult = await listTool.execute('1', {}, undefined, undefined, { cwd, isProjectTrusted: () => true });
      expect(listResult.isError).toBeFalsy();
      expect(listResult.details.ok).toBe(true);
      expect(listResult.details.status).toBe('partial');
      expect(listResult.content[0].text).toContain('svc');
      expect(listResult.content[0].text).toContain('warning');
      expect(listResult.content[0].text).toContain('nextAction');

      const statusTool = pi.tools.find((entry) => entry.name === 'workspace_services_status');
      const statusResult = await statusTool.execute('1', {}, undefined, undefined, { cwd, isProjectTrusted: () => true });
      expect(statusResult.isError).toBeFalsy();
      expect(statusResult.details.ok).toBe(true);
      expect(statusResult.details.status).toBe('partial');
      expect(statusResult.content[0].text).toContain('- svc: stopped');
      expect(statusResult.content[0].text).toContain('warning');
    } finally {
      runSpy.mockRestore();
    }
  });

  it('exposes bounded log text, range, and continuation directly in logs content and sets isError on failures', async () => {
    const cwd = await configuredWorkspace();
    const logDir = join(cwd, '.pi', 'workspace-services', 'logs');
    await mkdir(logDir, { recursive: true });
    await writeFile(join(logDir, 'svc.log'), Array.from({ length: 15 }, (_, i) => `row-${i + 1}`).join('\n') + '\n', 'utf8');

    const pi = createPi();
    workspaceServicesExtension(pi as any, { cwd });
    const logsTool = pi.tools.find((entry) => entry.name === 'workspace_service_logs');
    const okRes = await logsTool.execute('1', { service: 'svc', lines: 5, offset: 0 }, undefined, undefined, { cwd, isProjectTrusted: () => true });
    expect(okRes.isError).toBeFalsy();
    expect(okRes.details.status).toBe('ok');
    expect(okRes.content[0].text).toContain('row-11');
    expect(okRes.content[0].text).toContain('row-15');
    expect(okRes.content[0].text).toContain('offset=5');

    const stopTool = pi.tools.find((entry) => entry.name === 'workspace_service_stop');
    const controller = new AbortController();
    controller.abort();
    await writeFile(join(cwd, 'compose.yaml'), 'services:\n  db:\n    image: postgres\n', 'utf8');
    const runSpy = vi.spyOn(composeExecutor, 'run').mockResolvedValue({ stdout: 'db\n', stderr: '', exitCode: 0 });
    try {
      const cancelledRes = await stopTool.execute('2', { service: 'db' }, controller.signal, undefined, { cwd, isProjectTrusted: () => true });
      expect(cancelledRes.isError).toBe(true);
      expect(cancelledRes.details.ok).toBe(false);
      expect(cancelledRes.details.status).toBe('cancelled');
      expect(cancelledRes.content[0].text).toContain('cancelled');
    } finally {
      runSpy.mockRestore();
    }
  });

  it('serializes registered tool content through installed pi-ai convertMessages without details and maps native isError', async () => {
    const piAiApiDir = join(
      dirname(process.execPath),
      '..',
      'lib',
      'node_modules',
      '@earendil-works',
      'pi-coding-agent',
      'node_modules',
      '@earendil-works',
      'pi-ai',
      'dist',
      'api',
    );
    const { convertMessages } = await import(join(piAiApiDir, 'openai-completions.js'));
    const cwd = await configuredWorkspace();
    const logDir = join(cwd, '.pi', 'workspace-services', 'logs');
    await mkdir(logDir, { recursive: true });
    await writeFile(join(logDir, 'svc.log'), 'hello-model-line\n', 'utf8');

    const pi = createPi();
    workspaceServicesExtension(pi as any, { cwd });
    const statusTool = pi.tools.find((entry) => entry.name === 'workspace_services_status');
    const logsTool = pi.tools.find((entry) => entry.name === 'workspace_service_logs');
    const startTool = pi.tools.find((entry) => entry.name === 'workspace_service_start');

    const statusRes = await statusTool.execute('1', {}, undefined, undefined, { cwd, isProjectTrusted: () => true });
    const logsRes = await logsTool.execute('2', { service: 'svc', lines: 10 }, undefined, undefined, { cwd, isProjectTrusted: () => true });
    const failRes = await startTool.execute('3', { service: 'svc' }, undefined, undefined, untrustedContext);

    expect(statusRes.isError).toBeFalsy();
    expect(logsRes.isError).toBeFalsy();
    expect(failRes.isError).toBe(true);

    const model: any = {
      id: 'gpt-4o-mini',
      name: 'gpt-4o-mini',
      api: 'openai-completions',
      provider: 'openai',
      baseUrl: 'https://example.invalid/v1',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };
    const compat: any = {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      maxTokensField: 'max_tokens',
      requiresToolResultName: false,
      requiresAssistantAfterToolResult: false,
      requiresThinkingAsText: false,
      requiresMistralToolIds: false,
      thinkingFormat: 'openai',
      requiresReasoningContentOnAssistantMessages: false,
      requiresNonNullAssistantContent: false,
    };
    const sentinel = 'DETAILS_ONLY_SENTINEL_NEVER_SERIALIZE';
    const context: any = {
      systemPrompt: 'sys',
      messages: [
        { role: 'user', content: 'check services', timestamp: 1 },
        {
          role: 'assistant',
          content: [
            { type: 'toolCall', id: 'call_1', name: 'workspace_services_status', arguments: {} },
            { type: 'toolCall', id: 'call_2', name: 'workspace_service_logs', arguments: { service: 'svc' } },
            { type: 'toolCall', id: 'call_3', name: 'workspace_service_start', arguments: { service: 'svc' } },
          ],
          api: 'openai-completions',
          provider: 'openai',
          model: 'gpt-4o-mini',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'toolUse',
          timestamp: 2,
        },
        {
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'workspace_services_status',
          content: statusRes.content,
          details: { ...statusRes.details, sentinel },
          isError: Boolean(statusRes.isError),
          timestamp: 3,
        },
        {
          role: 'toolResult',
          toolCallId: 'call_2',
          toolName: 'workspace_service_logs',
          content: logsRes.content,
          details: { ...logsRes.details, sentinel },
          isError: Boolean(logsRes.isError),
          timestamp: 4,
        },
        {
          role: 'toolResult',
          toolCallId: 'call_3',
          toolName: 'workspace_service_start',
          content: failRes.content,
          details: { ...failRes.details, sentinel },
          isError: Boolean(failRes.isError),
          timestamp: 5,
        },
      ],
    };

    const converted = convertMessages(model, context, compat);
    const toolMsgs = converted.filter((m: any) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(3);
    expect(toolMsgs[0].content).toContain('svc');
    expect(toolMsgs[0].content).toContain('stopped');
    expect(toolMsgs[0].content).not.toContain(sentinel);
    expect(toolMsgs[1].content).toContain('hello-model-line');
    expect(toolMsgs[1].content).not.toContain(sentinel);
    expect(toolMsgs[2].content).toContain('Trust the project');
    expect(toolMsgs[2].content).not.toContain(sentinel);

    // Check installed Anthropic provider is_error mapping on tool_result blocks
    const hostAnthropicPath = join(piAiApiDir, 'anthropic-messages.js');
    const anthropicSource = await import('node:fs/promises').then((fs) => fs.readFile(hostAnthropicPath, 'utf8'));
    expect(anthropicSource).toContain('is_error: msg.isError');
  });

  it('documents Compose recent-only bounds and unknown-secret limitation in schemas, tool descriptions, and README', async () => {
    const cwd = await workspaceWithExtensionEnabled();
    const pi = createPi();
    workspaceServicesExtension(pi as any, { cwd });
    const logsTool = pi.tools.find((entry) => entry.name === 'workspace_service_logs');
    expect(logsTool.parameters.properties.offset.description).toMatch(/unsupported for Compose/i);
    expect(logsTool.parameters.properties.until.description).toMatch(/unsupported for Compose/i);
    expect(logsTool.description).toMatch(/Compose.*recent window/i);
    expect(logsTool.description).toMatch(/unknown free-text secrets/i);

    const listTool = pi.tools.find((entry) => entry.name === 'workspace_services_list');
    expect(listTool.description).toMatch(/declared configuration\/routing label/i);

    for (const name of ['workspace_service_start', 'workspace_service_stop', 'workspace_service_restart']) {
      const lifecycleTool = pi.tools.find((entry) => entry.name === name);
      expect(lifecycleTool.description).toMatch(/env_file=true/i);
      expect(lifecycleTool.description).toMatch(/union/i);
    }

    const readme = await import('node:fs/promises').then((fs) => fs.readFile(join(cwd, '..', '..', 'README.md'), 'utf8').catch(async () => {
      return fs.readFile('/home/j0k3r/.pi/agent/extensions/workspace-services/README.md', 'utf8');
    }));
    expect(readme).toMatch(/unknown secret values.*not.*guaranteed redacted/i);
    expect(readme).toMatch(/declared configuration\/routing label/i);
    expect(readme).toMatch(/before fetching Compose logs.*or writing mirror files/i);
    expect(readme).toMatch(/named Compose target loads and redacts only that service's own/i);
    expect(readme).toMatch(/Stack targets \(`all` \/ `compose`\) load and redact the union/i);
    expect(readme).toMatch(/offset.*until/i);
  });

  it('reports missing status config without forcing the agent to read the json', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-workspace-services-tools-empty-'));
    await enableExtension(cwd, true);
    const pi = createPi();
    workspaceServicesExtension(pi as any, { cwd });
    const tool = pi.tools.find((entry) => entry.name === 'workspace_services_status');
    const result = await tool.execute('1', {}, undefined, undefined, { cwd, isProjectTrusted: () => true });
    expect(result.content[0].text).toContain('no config found at');
    expect(result.details.data.exists).toBe(false);
  });

  it('reconciles service status on trusted session start', async () => {
    const cwd = await configuredWorkspace();
    const pi = createPi();
    workspaceServicesExtension(pi as any, { cwd });
    await expect(pi.handlers.session_start[0]({}, { cwd, isProjectTrusted: () => true })).resolves.toBeUndefined();
  });

  it('renders compact and expanded result states', async () => {
    const cwd = await workspaceWithExtensionEnabled();
    const pi = createPi();
    workspaceServicesExtension(pi as any, { cwd });
    const tool = pi.tools.find((entry) => entry.name === 'workspace_service_logs');
    const result = {
      details: {
        ok: true,
        status: 'running',
        summary: 'Retrieved bounded logs for svc.',
        data: { service: 'svc', text: 'alpha\nbeta\nTOKEN=[REDACTED]' },
        truncation: { returned: 2, total: 5, hasMore: true, continuation: 'Call again' },
      },
      content: [{ type: 'text', text: 'ignored' }],
    };
    const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };
    const compact = tool.renderResult(result, { expanded: false, isPartial: false }, theme, {}).render(80).join('\n');
    const expanded = tool.renderResult(result, { expanded: true, isPartial: false }, theme, {}).render(80).join('\n');
    expect(compact).not.toContain('expand');
    expect(compact).toContain('more available');
    expect(expanded).toContain('continue: Call again');
    expect(expanded).toContain('[REDACTED]');
  });

  it('declares optional timeout_ms parameter on workspace_service_start', async () => {
    const cwd = await workspaceWithExtensionEnabled();
    const pi = createPi();
    workspaceServicesExtension(pi as any, { cwd });
    const tool = pi.tools.find((entry) => entry.name === 'workspace_service_start');
    expect(tool).toBeDefined();
    expect(tool.parameters.properties).toHaveProperty('timeout_ms');
  });

  it('supports compose service start with target "all"', async () => {
    const cwd = await workspaceWithExtensionEnabled();
    await writeFile(join(cwd, 'compose.yaml'), 'services:\n  db:\n    image: postgres\n', 'utf8');
    const runSpy = vi.spyOn(composeExecutor, 'run').mockImplementation(async (_cwd, args) => {
      if (args[0] === 'up') return { stdout: 'Started\n', stderr: '', exitCode: 0 };
      return { stdout: 'db\n', stderr: '', exitCode: 0 };
    });

    const pi = createPi();
    workspaceServicesExtension(pi as any, { cwd });
    const tool = pi.tools.find((entry) => entry.name === 'workspace_service_start');
    const result = await tool.execute('1', { service: 'all' }, undefined, undefined, { cwd, isProjectTrusted: () => true });
    expect(result.details.ok).toBe(true);
    expect(result.details.status).toBe('started');
    expect(result.details.summary).toContain('Docker Compose stack started');
    runSpy.mockRestore();
  });
});
