import { describe, expect, it, vi } from 'vitest';
import workspaceServicesExtension, { WORKSPACE_SERVICE_TOOL_NAMES } from '../index.js';

function createPi() {
  const tools: any[] = [];
  return {
    tools,
    registerTool(tool: any) {
      tools.push(tool);
    },
  };
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
