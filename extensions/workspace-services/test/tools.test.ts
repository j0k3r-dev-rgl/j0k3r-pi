import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
      expect(tool.renderResult).toBeTypeOf('function');
      expect(tool.renderCall).toBeTypeOf('function');
    }
  });

  it('fails closed before project reads in an untrusted project for all six tools', async () => {
    const cwd = await workspaceWithExtensionEnabled();
    const pi = createPi();
    workspaceServicesExtension(pi as any, { cwd });
    expect(pi.tools.length).toBe(6);
    for (const tool of pi.tools) {
      const params = tool.name === 'workspace_service_start' || tool.name === 'workspace_service_stop' || tool.name === 'workspace_service_restart' || tool.name === 'workspace_service_logs'
        ? { service: 'svc' }
        : {};
      const result = await tool.execute('1', params, undefined, undefined, untrustedContext);
      expect(result.details.status).toBe('trust_required');
      expect(result.details.ok).toBe(false);
    }
  });

  it('returns concise configured service details in status content', async () => {
    const cwd = await configuredWorkspace();
    const pi = createPi();
    workspaceServicesExtension(pi as any, { cwd });
    const tool = pi.tools.find((entry) => entry.name === 'workspace_services_status');
    const result = await tool.execute('1', {}, undefined, undefined, { cwd, isProjectTrusted: () => true });
    expect(result.content[0].text).toContain('workspace_services_status: 1 configured service(s)');
    expect(result.content[0].text).toContain('config:');
    expect(result.content[0].text).toContain('- svc: stopped type=node path=svc command=npm run dev');
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
    expect(compact).toContain('expand');
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
