import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('history runtime compatibility', () => {
  it('opens the history store under Bun using the runtime-supported sqlite module', () => {
    const bunCheck = spawnSync('bun', ['--version'], { encoding: 'utf8' });
    if (bunCheck.status !== 0) return;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-subagents-bun-history-'));
    const dbPath = path.join(tmp, 'subagents-history.sqlite');
    const script = [
      `import { SubagentHistoryStore } from ${JSON.stringify(new URL('../src/history.ts', import.meta.url).pathname)};`,
      'const store = new SubagentHistoryStore();',
      `store.listTasks(${JSON.stringify(tmp)});`,
      "console.log('ok');",
    ].join('\n');

    const output = execFileSync('bun', ['-e', script], {
      cwd: process.cwd(),
      env: { ...process.env, PI_SUBAGENTS_HISTORY_DB_PATH: dbPath },
      encoding: 'utf8',
    });

    expect(output).toContain('ok');
  });
});
