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
    expect(renderSource).not.toContain('@earendil-works/pi-coding-agent');
    expect(renderSource).not.toContain('@earendil-works/pi-tui');
    expect(renderSource).toContain("keyHint('app.tools.expand'");
    expect(renderSource).toContain('new Text(');

    expect(runtimeSource).toContain("from '@earendil-works/pi-coding-agent'");
    expect(runtimeSource).toContain("from '@earendil-works/pi-tui'");
    expect(runtimeSource).not.toContain('createRequire');
    expect(runtimeSource).not.toContain('require.resolve');
    expect(runtimeSource).not.toContain('resolvePackage');
    expect(runtimeSource).not.toContain('searchPaths');
    expect(runtimeSource).not.toContain('accessSync');
    expect(runtimeSource).not.toContain('pathToFileURL');
    expect(runtimeSource).not.toContain('../../context7/');
    expect(runtimeSource).not.toContain('../../npm/');

    expect(manifest.peerDependencies).toMatchObject({
      '@earendil-works/pi-coding-agent': '*',
      '@earendil-works/pi-tui': '*',
    });
    expect(manifest.devDependencies).toHaveProperty('@earendil-works/pi-coding-agent');
    expect(manifest.devDependencies).toHaveProperty('@earendil-works/pi-tui');
  });

  it('surfaces safe metadata plus current chunk content', () => {
    const result = {
      content: [{ type: 'text' as const, text: 'hello world from renderer' }],
      details: {
        status: 'success',
        request: { action: 'discover', method: 'GET', path: '/users' },
        response: { status: 200, status_text: 'OK' },
        continuation: { has_more: true, next_cursor: 'cursor-opaque-token', returned_lines: 2, total_lines: 5 },
      },
    };

    const collapsed = renderApiToolResult('api_swagger', result, { expanded: false });
    expect(collapsed).toBeInstanceOf(Text);
    expect(collapsed.render(80).join('\n')).toContain('more available');
    expect(collapsed.render(80).join('\n')).toContain('to expand');

    const expanded = renderApiToolResult('api_swagger', result, { expanded: true });
    expect(expanded).toBeInstanceOf(Text);
    const expandedWide = expanded.render(80).join('\n');
    expect(expandedWide).toContain('to collapse');
    expect(expandedWide).toContain('discover');
    expect(expandedWide).toContain('GET /users');
    expect(expandedWide).toContain('cursor-opa');
    const rendered = expanded.render(10);
    expect(rendered.some((line: string) => line.length <= 10)).toBe(true);
  });

  it('renders partial results without expansion controls', () => {
    const partial = renderApiToolResult('api_graphql', { content: [], details: { status: 'success' } }, { isPartial: true });
    expect(partial).toBeInstanceOf(Text);
    expect(partial.render(80).join('\n')).toContain('running…');
    expect(partial.render(80).join('\n')).not.toContain('to expand');
  });
});
