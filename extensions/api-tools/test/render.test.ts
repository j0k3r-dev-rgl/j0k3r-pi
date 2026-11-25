import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import apiToolsExtension, { registerToolRenderers } from '../index.js';
import {
  API_TOOL_NAMES,
  buildApiToolRenderers,
  extractApiToolAction,
  LIME,
  RED,
  renderApiToolCall,
  renderApiToolResult,
  stripAnsi,
  visibleWidth,
} from '../src/render.js';

function assertUnboxedAndNoHints(lines: string[]): void {
  const joined = lines.join('\n');
  expect(joined).not.toMatch(/[╭╮╰╯│]/);
  expect(joined).not.toMatch(/\x1b\[(?:4[0-7]|48;|10[0-7]|7m)/);
  expect(stripAnsi(joined)).not.toMatch(/\b(to expand|to collapse|ctrl\+o|app\.tools\.expand)\b/i);
}

describe('api-tools compact rendering', () => {
  it('registers presentation synchronously without loading config, creating clients or exposing execution tools', async () => {
    const resolvers: any[] = [];
    const loadConfig = vi.fn(async () => { throw new Error('No config access allowed for rendering'); });
    const createClient = vi.fn();
    const registerTool = vi.fn();
    await apiToolsExtension({ registerTool, registerToolRenderer: (resolver: any) => resolvers.push(resolver) }, { cwd: '/nonexistent-render-only-project', loadConfig, createClient });
    expect(loadConfig).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(registerTool).not.toHaveBeenCalled();
    expect(resolvers).toHaveLength(1);
    const renderer = resolvers[0]('api_rest_request', () => undefined);
    expect(renderer.compactToolRenderingVersion).toBe(1);
    expect(renderer.renderShell).toBe('self');
    expect(renderer.renderResult({ content: [{ type: 'text', text: 'safe replay result' }], details: { status: 'success', action: 'request' } }, { expanded: true }).render(80).join('\n')).toContain('safe replay result');
    const next = vi.fn(() => ({ renderShell: 'native', renderResult: () => undefined }));
    expect(resolvers[0]('unrelated_tool', next)).toBe(next.mock.results[0].value);
  });

  it('provides compliant replay renderers for all API tools without requiring their execution definitions', () => {
    let resolver: any;
    registerToolRenderers({ registerToolRenderer: (value: any) => { resolver = value; } });
    for (const name of API_TOOL_NAMES) {
      const renderer = resolver(name, () => undefined);
      expect(renderer.compactToolRenderingVersion).toBe(1);
      expect(renderer.renderShell).toBe('self');
      expect(typeof renderer.renderCall).toBe('function');
      expect(typeof renderer.renderResult).toBe('function');
    }
  });

  it('uses API Tools-owned Pi runtime packages through the local adapter seam', async () => {
    const [renderSource, runtimeSource, packageSource] = await Promise.all([
      readFile(new URL('../src/render.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/pi-runtime.ts', import.meta.url), 'utf8'),
      readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ]);
    const manifest = JSON.parse(packageSource) as {
      peerDependencies?: Record<string, string>;
    };

    expect(renderSource).toContain("from './pi-runtime.js'");
    expect(renderSource).toContain('compactToolRenderingVersion: 1');
    expect(renderSource).toContain('renderApiToolCall');

    expect(runtimeSource).toContain("from '@earendil-works/pi-tui'");
    expect(manifest.peerDependencies).toMatchObject({
      '@earendil-works/pi-coding-agent': '*',
      '@earendil-works/pi-tui': '*',
    });
  });

  it('surfaces safe metadata plus current chunk content without cards or hints', () => {
    const result: any = {
      content: [
        { type: 'text' as const, text: 'GET /users · listUsers · auth: declared' },
        { type: 'text' as const, text: 'Literal data: ╭box╮ to expand' },
      ],
      details: {
        contract_version: 2,
        status: 'success',
        action: 'discover',
        identity: '1 operation',
        render: { authorization_state: 'declared' },
        continuation: { has_more: true, next_cursor: 'cursor-opaque-token', returned_count: 1, total: 5, follow_up: { tool: 'api_swagger', action: 'discover', cursor_parameter: 'cursor' }, returned_bytes: 40, returned_lines: 1 },
      },
    };

    const collapsed = renderApiToolResult('api_swagger', result, { expanded: false });
    const collapsedLines = collapsed.render(80);
    expect(collapsedLines).toHaveLength(1);
    const collapsedStr = stripAnsi(collapsedLines[0]);
    expect(collapsedStr).toContain('api_swagger');
    expect(collapsedStr).toContain('───');
    expect(collapsedStr).toContain('discover');
    expect(collapsedStr).toContain('more available');
    assertUnboxedAndNoHints(collapsedLines);

    const expanded = renderApiToolResult('api_swagger', result, { expanded: true });
    const expandedWide = stripAnsi(expanded.render(80).join('\n'));
    expect(expandedWide).toContain('discover');
    expect(expandedWide).toContain('authorization: declared');
    expect(expandedWide).toContain('cursor-opa');
    expect(expandedWide).toContain('GET /users · listUsers · auth: declared');
    expect(expandedWide).toContain('Literal data: ╭box╮ to expand');
  });

  it('renders failure, partial, and empty results cleanly in one inline row when collapsed', () => {
    const failure = renderApiToolResult('api_graphql', {
      content: [{ type: 'text', text: 'field denied' }],
      details: {
        contract_version: 2,
        status: 'failure',
        action: 'execute',
        failure: { category: 'graphql_error', code: 'api_graphql.execute.graphql_error', message: 'field denied', retryable: false, next_step: 'Inspect the GraphQL query.' },
        continuation: { has_more: false, returned_count: 1, follow_up: { tool: 'api_graphql', action: 'execute', cursor_parameter: 'cursor' }, returned_bytes: 12, returned_lines: 1 },
      },
      isError: true,
    }, { expanded: true });
    const failureRender = stripAnsi(failure.render(80).join('\n'));
    expect(failureRender).toContain('graphql_error');
    expect(failureRender).toContain('Inspect the GraphQL query.');
    expect(failureRender).toContain('field denied');

    const partialLines = renderApiToolResult('api_graphql', { content: [], details: { status: 'success' } as any }, { isPartial: true }).render(80);
    expect(partialLines).toHaveLength(1);
    expect(stripAnsi(partialLines[0])).toContain('running…');
    assertUnboxedAndNoHints(partialLines);

    const emptyLines = renderApiToolResult('api_status', { content: [], details: undefined as any }, { expanded: false }).render(80);
    expect(emptyLines).toHaveLength(1);
    expect(stripAnsi(emptyLines[0])).toContain('api_status');
    assertUnboxedAndNoHints(emptyLines);
  });

  it('renders pending inline row during call phase and coordinates into one combined row on result', () => {
    const context: any = { state: {}, args: { method: 'POST', path: '/api/v1/items' } };
    const callComponent = renderApiToolCall('api_rest_request', { method: 'POST', path: '/api/v1/items' }, {}, context);
    const pendingLines = callComponent.render(80);

    expect(pendingLines).toHaveLength(1);
    expect(stripAnsi(pendingLines[0])).toContain('api_rest_request [POST /api/v1/items]');
    expect(stripAnsi(pendingLines[0])).toContain('───');
    expect(stripAnsi(pendingLines[0])).toContain('Pending: POST /api/v1/items');
    assertUnboxedAndNoHints(pendingLines);

    const resultComponent = renderApiToolResult(
      'api_rest_request',
      {
        content: [{ type: 'text', text: 'Created item' }],
        details: { status: 'success', action: 'request' } as any,
      },
      { expanded: false },
      {},
      context,
    );
    expect(context.state.hasResult).toBe(true);
    expect(context.state.borderColor).toBe(LIME);
    expect(callComponent.render(80)).toEqual([]);

    const resultLines = resultComponent.render(80);
    expect(resultLines).toHaveLength(1);
    expect(resultLines[0]).toContain(LIME);
    expect(stripAnsi(resultLines[0])).toContain('api_rest_request [POST /api/v1/items]');
    assertUnboxedAndNoHints(resultLines);
  });

  it('sets RED color on failed result', () => {
    const context: any = { state: {} };
    const resultLines = renderApiToolResult(
      'api_graphql',
      {
        content: [{ type: 'text', text: 'syntax error' }],
        details: { status: 'failure' } as any,
        isError: true,
      },
      {},
      {},
      context,
    ).render(80);
    expect(context.state.hasResult).toBe(true);
    expect(context.state.borderColor).toBe(RED);
    expect(resultLines[0]).toContain(RED);
  });

  it('extracts API action badge correctly for all tool types', () => {
    expect(extractApiToolAction('api_status', {})).toBeUndefined();
    expect(extractApiToolAction('api_auth_status', { provider: 'github' })).toBe('github');
    expect(extractApiToolAction('api_login', { alias: 'PLATFORM_ADMIN' })).toBe('PLATFORM_ADMIN');
    expect(extractApiToolAction('api_login', { provider: 'okta' })).toBe('okta');
    expect(extractApiToolAction('api_rest_request', { method: 'GET', path: '/users' })).toBe('GET /users');
    expect(extractApiToolAction('api_swagger', { action: 'detail', operation: 'getUser' })).toBe('detail getUser');
    expect(extractApiToolAction('api_graphql', { action: 'execute', operationName: 'GetViewer' })).toBe('execute GetViewer');
  });

  it('enforces width 0 empty output and positive width bounds with wide chars and OSC 8', () => {
    const renderer = buildApiToolRenderers('api_rest_request');
    const callComp = renderer.renderCall({ method: 'GET', path: '/漢字/🚀/café\u0301' }, {}, {});
    const resComp = renderer.renderResult(
      {
        content: [{ type: 'text', text: '漢字🚀 café\u0301 \x1b]8;;https://example.com\x07link\x1b]8;;\x07\nline2' }],
        details: { status: 'success', action: 'request', identity: 'GET /漢字' } as any,
      },
      { expanded: true, isPartial: false },
      {},
      { args: { method: 'GET', path: '/漢字/🚀/café\u0301' }, state: {} },
    );
    expect(callComp.render(0)).toEqual([]);
    expect(resComp.render(0)).toEqual([]);
    for (const width of [1, 2, 10, 23, 24, 40, 80, 120]) {
      for (const line of callComp.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      for (const line of resComp.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  it('wraps overflowing collapsed headers without ellipsis clipping and preserves 1-col margin', () => {
    const longPath = '/api/v2/organizations/acme/deployments/production/healthcheck/END_MARKER';
    const callLines = renderApiToolCall('api_rest_request', { method: 'GET', path: longPath }, {}, { state: {} }).render(40);
    expect(callLines.length).toBeGreaterThan(1);
    expect(stripAnsi(callLines.join('\n'))).not.toContain('…');
    expect(stripAnsi(callLines.join(' '))).toContain('END_MARKER');
    for (const line of callLines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(40);
      expect(stripAnsi(line).startsWith(' ')).toBe(true);
    }

    const resLines = renderApiToolResult(
      'api_rest_request',
      {
        content: [{ type: 'text', text: 'ok' }],
        details: { status: 'success', action: 'request', identity: '200 OK · long-response-identity-END_RES' } as any,
      },
      { expanded: false },
      {},
      { args: { method: 'GET', path: longPath }, state: {} },
    ).render(40);
    expect(resLines.length).toBeGreaterThan(1);
    expect(stripAnsi(resLines.join('\n'))).not.toContain('…');
    expect(stripAnsi(resLines.join(' '))).toContain('END_RES');
    for (const line of resLines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(40);
      expect(stripAnsi(line).startsWith(' ')).toBe(true);
    }
  });

  it('applies muted foreground to plain-text expanded bodies while preserving existing ANSI colors', () => {
    const customTheme = {
      fg: (token: string, text: string) => (token === 'muted' ? `\x1b[38;2;10;20;30m${text}\x1b[39m` : text),
    };
    const result: any = {
      content: [{ type: 'text', text: 'Plain JSON response line\n\x1b[33mAmber warning line\x1b[0m' }],
      details: {
        contract_version: 2,
        status: 'success',
        action: 'request',
        render: { authorization_state: 'declared' },
      },
    };

    const withTheme = renderApiToolResult('api_rest_request', result, { expanded: true }, customTheme, { state: {} }).render(80);
    const joined = withTheme.join('\n');
    expect(joined).toContain('\x1b[38;2;10;20;30mauthorization: declared\x1b[39m');
    expect(joined).toContain('\x1b[38;2;10;20;30mPlain JSON response line\x1b[39m');
    expect(joined).toContain('\x1b[33mAmber warning line\x1b[0m');
    expect(joined).not.toContain('\x1b[38;2;10;20;30m\x1b[33m');

    const fallback = renderApiToolResult('api_rest_request', result, { expanded: true }, undefined, { state: {} }).render(80);
    expect(fallback.join('\n')).toContain('\x1b[38;2;122;167;184mPlain JSON response line\x1b[39m');
    expect(fallback.join('\n')).toContain('\x1b[33mAmber warning line\x1b[0m');
  });

  it('handles width 1 as blank column and width 2 wide graphemes via conditional margin omission', () => {
    const comp = renderApiToolResult(
      'api_status',
      { content: [{ type: 'text', text: 'A漢B' }], details: { status: 'success' } as any },
      { expanded: true },
      {},
      { state: {} },
    );
    expect(comp.render(0)).toEqual([]);
    expect(comp.render(1)).toEqual([' ']);

    const w2 = comp.render(2);
    const plainW2 = w2.map(stripAnsi);
    expect(plainW2).toContain(' A');
    expect(plainW2).toContain('漢');
    expect(plainW2).toContain(' B');
    for (const line of w2) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(2);
    }
  });

  it('never throws on malformed args, result, or context', () => {
    expect(() => renderApiToolCall('api_status', null, undefined, undefined).render(80)).not.toThrow();
    expect(() => renderApiToolResult('api_status', null as any, undefined, undefined, undefined).render(80)).not.toThrow();
  });
});
