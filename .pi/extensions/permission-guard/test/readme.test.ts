import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('permission guard disclosure documentation', () => {
  it('documents scope, limitations, approval routing, configuration, secrets, and audit behavior', async () => {
    const text = (await readFile(new URL('../README.md', import.meta.url), 'utf8')).toLowerCase();

    expect(text).toContain('in-process guard');
    expect(text).toContain('not a hard sandbox');
    expect(text).toContain('container');
    expect(text).toContain('gondolin');
    expect(text).toContain('sandbox-runtime');
    expect(text).toContain('bash policy is heuristic');
    expect(text).toContain('custom and third-party tools are out of mvp scope');
    expect(text).toContain('secrets are denied by default');
    expect(text).toContain('json configurable');
    expect(text).toContain('allow once');
    expect(text).toContain('allow for session');
    expect(text).toContain('allow for project');
    expect(text).toContain('regex:<pattern>');
    expect(text).toContain('deny');
    expect(text).toContain('subagent approvals route to the main thread');
    expect(text).toContain('audit is local and redacted');
  });
});
