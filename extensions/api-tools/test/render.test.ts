import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { Text } from '../src/pi-runtime.js';
import { renderApiToolResult } from '../src/render.js';

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
    expect(renderSource).toContain('new Text(');

    expect(runtimeSource).toContain("from '@earendil-works/pi-coding-agent'");
    expect(runtimeSource).toContain("from '@earendil-works/pi-tui'");

    expect(manifest.peerDependencies).toMatchObject({
      '@earendil-works/pi-coding-agent': '*',
      '@earendil-works/pi-tui': '*',
    });
  });

  it('surfaces safe metadata plus current chunk content', () => {
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
    expect(collapsed).toBeInstanceOf(Text);
    expect(collapsed.render(80).join('\n')).toContain('more available');
    expect(collapsed.render(80).join('\n')).toContain('to expand');

    const expanded = renderApiToolResult('api_swagger', result, { expanded: true });
    expect(expanded).toBeInstanceOf(Text);
    const expandedWide = expanded.render(80).join('\n');
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
    expect(failure.render(80).join('\n')).toContain('graphql_error');
    expect(failure.render(80).join('\n')).toContain('Inspect the GraphQL query.');

    const partial = renderApiToolResult('api_graphql', { content: [], details: { status: 'success' } as any }, { isPartial: true });
    expect(partial).toBeInstanceOf(Text);
    expect(partial.render(80).join('\n')).toContain('running…');
    expect(partial.render(80).join('\n')).not.toContain('to expand');
  });
});
