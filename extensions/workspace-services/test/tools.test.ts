import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import workspaceServicesExtension, { WORKSPACE_SERVICE_TOOL_NAMES } from '../index.js';

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

async function configuredWorkspace(): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-workspace-services-tools-'));
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

  it('registers the expected separate tools with renderers', () => {
    const pi = createPi();
    workspaceServicesExtension(pi as any);
    expect(pi.tools.map((tool) => tool.name)).toEqual([...WORKSPACE_SERVICE_TOOL_NAMES]);
    for (const tool of pi.tools) {
      expect(tool.renderResult).toBeTypeOf('function');
      expect(tool.renderCall).toBeTypeOf('function');
    }
  });

  it('fails closed before project reads in an untrusted project for all six tools', async () => {
    const pi = createPi();
    workspaceServicesExtension(pi as any);
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

  it('renders compact and expanded result states', () => {
    const pi = createPi();
    workspaceServicesExtension(pi as any);
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
});
