import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  renderApiToolCall,
  renderApiToolResult,
  extractApiToolAction,
  LIME,
  RED,
} from '../src/render.js';

describe('renderApiToolResult', () => {
  it('uses API Tools-owned Pi runtime packages through the local adapter seam', async () => {
    const [renderSource, runtimeSource, packageSource] = await Promise.all([
      readFile(new URL('../src/render.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/pi-runtime.ts', import.meta.url), 'utf8'),
      readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ]);
    const manifest = JSON.parse(packageSource) as {
      peerDependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(renderSource).toContain("from './pi-runtime.js'");
    expect(renderSource).toContain("keyHint('app.tools.expand'");
    expect(renderSource).toContain('renderApiToolCall');

    expect(runtimeSource).toContain("from '@earendil-works/pi-coding-agent'");
    expect(runtimeSource).toContain("from '@earendil-works/pi-tui'");

    expect(manifest.peerDependencies).toMatchObject({
      '@earendil-works/pi-coding-agent': '*',
      '@earendil-works/pi-tui': '*',
    });
  });

  it('surfaces safe metadata plus current chunk content inside hollow cards', () => {
    const result: any = {
      content: [{ type: 'text' as const, text: 'GET /users · listUsers · auth: declared' }],
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
    const collapsedStr = collapsedLines.join('\n');
    expect(collapsedStr).toContain('│');
    expect(collapsedStr).toContain('╰');
    expect(collapsedStr).toContain('more available');
    expect(collapsedStr).toContain('expand');

    const expanded = renderApiToolResult('api_swagger', result, { expanded: true });
    const expandedWide = expanded.render(80).join('\n');
    expect(expandedWide).toContain('│');
    expect(expandedWide).toContain('╰');
    expect(expandedWide).toContain('discover');
    expect(expandedWide).toContain('authorization: declared');
    expect(expandedWide).toContain('cursor-opa');
  });

  it('renders failure and partial results without duplicated hidden payloads', () => {
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
    const failureRender = failure.render(80).join('\n');
    expect(failureRender).toContain('│');
    expect(failureRender).toContain('╰');
    expect(failureRender).toContain('graphql_error');
    expect(failureRender).toContain('Inspect the GraphQL query.');

    const partial = renderApiToolResult('api_graphql', { content: [], details: { status: 'success' } as any }, { isPartial: true });
    const partialRender = partial.render(80).join('\n');
    expect(partialRender).toContain('│');
    expect(partialRender).toContain('╰');
    expect(partialRender).toContain('running…');
    expect(partialRender).not.toContain('expand');
  });

  it('renders pending card during call phase and extracts action badge', () => {
    const context: any = { state: {} };
    const callComponent = renderApiToolCall('api_rest_request', { method: 'POST', path: '/api/v1/items' }, {}, context);
    const lines = callComponent.render(80);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('╭');
    expect(lines[0]).toContain('api_rest_request [POST /api/v1/items]');
    expect(lines[0]).toContain('╮');
    expect(lines[1]).toContain('│');
    expect(lines[1]).toContain('Pending: POST /api/v1/items');
    expect(lines[2]).toContain('╰');
  });

  it('coordinates two-phase slot assembly and border colors', () => {
    const context: any = { state: {} };
    const callComponent = renderApiToolCall('api_swagger', { action: 'discover', tag: 'pets' }, {}, context);
    expect(callComponent.render(80)).toHaveLength(3);

    // Successful result
    const resultComponent = renderApiToolResult(
      'api_swagger',
      {
        content: [{ type: 'text', text: 'Pets API' }],
        details: { status: 'success', action: 'discover' } as any,
      },
      { expanded: false },
      {},
      context,
    );
    expect(context.state.hasResult).toBe(true);
    expect(context.state.borderColor).toBe(LIME);

    // Call now returns single top border in LIME
    const afterCall = callComponent.render(80);
    expect(afterCall).toHaveLength(1);
    expect(afterCall[0]).toContain('╭');
    expect(afterCall[0]).toContain(LIME);

    // Result ends with bottom border in LIME
    const resultLines = resultComponent.render(80);
    expect(resultLines[resultLines.length - 1]).toContain(LIME);
  });

  it('sets RED border on failed result', () => {
    const context: any = { state: {} };
    renderApiToolResult(
      'api_graphql',
      {
        content: [{ type: 'text', text: 'syntax error' }],
        details: { status: 'failure' } as any,
        isError: true,
      },
      {},
      {},
      context,
    );
    expect(context.state.hasResult).toBe(true);
    expect(context.state.borderColor).toBe(RED);
  });

  it('extracts API action badge correctly for all tool types', () => {
    expect(extractApiToolAction('api_status', {})).toBeUndefined();
    expect(extractApiToolAction('api_auth_status', { provider: 'github' })).toBe('github');
    expect(extractApiToolAction('api_login', { provider: 'okta' })).toBe('okta');
    expect(extractApiToolAction('api_rest_request', { method: 'GET', path: '/users' })).toBe('GET /users');
    expect(extractApiToolAction('api_swagger', { action: 'detail', operation: 'getUser' })).toBe('detail getUser');
    expect(extractApiToolAction('api_graphql', { action: 'execute', operationName: 'GetViewer' })).toBe('execute GetViewer');
  });

  it('falls back to single fit line when width < 24', () => {
    const callComponent = renderApiToolCall('api_login', { provider: 'google' }, {}, {});
    const lines = callComponent.render(20);
    expect(lines).toHaveLength(1);
  });
});
