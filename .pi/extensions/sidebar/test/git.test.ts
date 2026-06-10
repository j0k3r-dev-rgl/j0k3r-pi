import { describe, expect, it } from 'vitest';

import type { SectionState, GitStatusModel } from '../src/model.js';
import {
  createGitAdapter,
  mergeNumstatCounts,
  parseGitRepositoryLabel,
  parsePorcelainEntries,
} from '../src/adapters/git.js';

type CommandResult = { stdout: string; stderr?: string; exitCode?: number };
type Runner = (args: readonly string[], options: { cwd: string; timeoutMs: number }) => Promise<CommandResult>;

function commandKey(args: readonly string[]): string {
  return args.join(' ');
}

function createRunner(map: Record<string, CommandResult | Error>): Runner {
  return async (args, _options) => {
    const value = map[commandKey(args)];
    if (value instanceof Error) throw value;
    if (!value) throw new Error(`missing stub for ${commandKey(args)}`);
    return value;
  };
}

function expectReady(state: SectionState<GitStatusModel>) {
  expect(state.kind).toBe('ready');
  return (state as Extract<SectionState<GitStatusModel>, { kind: 'ready' }>).data;
}

describe('parseGitRepositoryLabel', () => {
  it('extracts repository labels from common remote url formats', () => {
    expect(parseGitRepositoryLabel('https://github.com/earendil-works/pi-coding-agent.git')).toBe('pi-coding-agent');
    expect(parseGitRepositoryLabel('git@github.com:earendil-works/pi-coding-agent.git')).toBe('pi-coding-agent');
    expect(parseGitRepositoryLabel('ssh://git@github.com/earendil-works/pi-coding-agent.git/')).toBe('pi-coding-agent');
  });
});

describe('parsePorcelainEntries', () => {
  it('maps edited, created, deleted, untracked, renamed, copied, and mixed statuses safely', () => {
    const status = [
      ' M src/edited.ts',
      'A  src/created.ts',
      ' D src/deleted.ts',
      '?? src/untracked.ts',
      'R  src/old-name.ts',
      'src/new-name.ts',
      'C  src/copied-from.ts',
      'src/copied-to.ts',
      'AM src/mixed.ts',
      '',
    ].join('\0');

    expect(parsePorcelainEntries(status)).toEqual([
      { path: 'src/edited.ts', basename: 'edited.ts', state: 'edited' },
      { path: 'src/created.ts', basename: 'created.ts', state: 'created' },
      { path: 'src/deleted.ts', basename: 'deleted.ts', state: 'deleted' },
      { path: 'src/untracked.ts', basename: 'untracked.ts', state: 'created' },
      { path: 'src/new-name.ts', basename: 'new-name.ts', state: 'edited' },
      { path: 'src/copied-to.ts', basename: 'copied-to.ts', state: 'created' },
      { path: 'src/mixed.ts', basename: 'mixed.ts', state: 'created' },
    ]);
  });
});

describe('mergeNumstatCounts', () => {
  it('merges working tree and staged numstat counts into basename rows', () => {
    const rows = parsePorcelainEntries([' M src/feature/alpha.ts', 'A  README.md', ' D docs/legacy.txt', ''].join('\0'));

    const merged = mergeNumstatCounts(
      rows,
      '5\t1\tsrc/feature/alpha.ts\n2\t0\tREADME.md\n0\t7\tdocs/legacy.txt\n',
      '3\t2\tsrc/feature/alpha.ts\n4\t0\tREADME.md\n',
    );

    expect(merged).toEqual([
      { path: 'src/feature/alpha.ts', basename: 'alpha.ts', state: 'edited', added: 8, deleted: 3 },
      { path: 'README.md', basename: 'README.md', state: 'created', added: 6, deleted: 0 },
      { path: 'docs/legacy.txt', basename: 'legacy.txt', state: 'deleted', added: 0, deleted: 7 },
    ]);
  });
});

describe('createGitAdapter', () => {
  it('requests all untracked files so new directories are expanded into internal files and counts new file lines', async () => {
    const adapter = createGitAdapter({
      fileReader: async (filePath) => {
        if (filePath === '/workspace/pi/.pi/extensions/sidebar/index.ts') return 'one\ntwo\nthree\n';
        if (filePath === '/workspace/pi/.pi/extensions/sidebar/src/render.ts') return 'one\ntwo';
        throw new Error(`unexpected read ${filePath}`);
      },
      run: createRunner({
        'rev-parse --is-inside-work-tree': { stdout: 'true\n' },
        'rev-parse --show-toplevel': { stdout: '/workspace/pi\n' },
        'remote get-url origin': { stdout: 'git@github.com:earendil-works/j0k3r-pi.git\n' },
        'branch --show-current': { stdout: 'main\n' },
        'status --porcelain=v1 -z --untracked-files=all': {
          stdout: ['?? .pi/extensions/sidebar/index.ts', '?? .pi/extensions/sidebar/src/render.ts', ''].join('\0'),
        },
        'diff --numstat': { stdout: '' },
        'diff --cached --numstat': { stdout: '' },
      }),
    });

    const state = await adapter.load({ cwd: '/workspace/pi', ctx: {}, pi: {}, now: () => new Date('2026-06-10T00:00:00.000Z') });
    const data = expectReady(state);

    expect(data.files.map((file) => file.path)).toEqual([
      '.pi/extensions/sidebar/index.ts',
      '.pi/extensions/sidebar/src/render.ts',
    ]);
    expect(data.files).toEqual([
      { path: '.pi/extensions/sidebar/index.ts', basename: 'index.ts', state: 'created', added: 3, deleted: 0 },
      { path: '.pi/extensions/sidebar/src/render.ts', basename: 'render.ts', state: 'created', added: 2, deleted: 0 },
    ]);
  });

  it('orders changed files by newest filesystem activity first', async () => {
    const adapter = createGitAdapter({
      statReader: async (filePath) => {
        const mtimes: Record<string, number> = {
          '/workspace/pi/src/older.ts': 1000,
          '/workspace/pi/src/newer.ts': 3000,
          '/workspace/pi/src': 2000,
        };
        const mtimeMs = mtimes[filePath];
        if (mtimeMs === undefined) throw new Error(`missing ${filePath}`);
        return { mtimeMs };
      },
      run: createRunner({
        'rev-parse --is-inside-work-tree': { stdout: 'true\n' },
        'rev-parse --show-toplevel': { stdout: '/workspace/pi\n' },
        'remote get-url origin': { stdout: 'git@github.com:earendil-works/j0k3r-pi.git\n' },
        'branch --show-current': { stdout: 'main\n' },
        'status --porcelain=v1 -z --untracked-files=all': {
          stdout: [' M src/older.ts', ' D src/deleted.ts', '?? src/newer.ts', ''].join('\0'),
        },
        'diff --numstat': { stdout: '1\t0\tsrc/older.ts\n0\t4\tsrc/deleted.ts\n' },
        'diff --cached --numstat': { stdout: '' },
      }),
    });

    const state = await adapter.load({ cwd: '/workspace/pi', ctx: {}, pi: {}, now: () => new Date('2026-06-10T00:00:00.000Z') });
    const data = expectReady(state);

    expect(data.files.map((file) => file.path)).toEqual([
      'src/newer.ts',
      'src/deleted.ts',
      'src/older.ts',
    ]);
  });

  it('returns branch and remote repository labels when available', async () => {
    const adapter = createGitAdapter({
      run: createRunner({
        'rev-parse --is-inside-work-tree': { stdout: 'true\n' },
        'rev-parse --show-toplevel': { stdout: '/workspace/pi\n' },
        'remote get-url origin': { stdout: 'git@github.com:earendil-works/pi-sidebar-extension.git\n' },
        'branch --show-current': { stdout: 'main\n' },
        'status --porcelain=v1 -z --untracked-files=all': { stdout: '' },
        'diff --numstat': { stdout: '' },
        'diff --cached --numstat': { stdout: '' },
      }),
      timeoutMs: 250,
    });

    const state = await adapter.load({ cwd: '/workspace/pi', ctx: {}, pi: {}, now: () => new Date('2026-06-10T00:00:00.000Z') });
    const data = expectReady(state);

    expect(data.repositoryLabel).toBe('pi-sidebar-extension');
    expect(data.branchLabel).toBe('main');
    expect(data.files).toEqual([]);
  });

  it('falls back for detached head and missing remote url', async () => {
    const adapter = createGitAdapter({
      run: createRunner({
        'rev-parse --is-inside-work-tree': { stdout: 'true\n' },
        'rev-parse --show-toplevel': { stdout: '/workspace/sidebar\n' },
        'remote get-url origin': new Error('no remote'),
        'branch --show-current': { stdout: '\n' },
        'rev-parse --short HEAD': { stdout: 'abc1234\n' },
        'status --porcelain=v1 -z --untracked-files=all': { stdout: '' },
        'diff --numstat': { stdout: '' },
        'diff --cached --numstat': { stdout: '' },
      }),
    });

    const state = await adapter.load({ cwd: '/workspace/sidebar', ctx: {}, pi: {}, now: () => new Date('2026-06-10T00:00:00.000Z') });
    const data = expectReady(state);

    expect(data.repositoryLabel).toBe('sidebar');
    expect(data.branchLabel).toBe('detached@abc1234');
  });

  it('returns a no-repository state outside a git work tree', async () => {
    const adapter = createGitAdapter({
      run: createRunner({
        'rev-parse --is-inside-work-tree': { stdout: 'false\n' },
      }),
    });

    const state = await adapter.load({ cwd: '/tmp/plain', ctx: {}, pi: {}, now: () => new Date('2026-06-10T00:00:00.000Z') });

    expect(state).toEqual({ kind: 'empty', message: 'not a git repository' });
  });

  it('returns unavailable on runner timeout or git failure without throwing', async () => {
    const adapter = createGitAdapter({
      run: createRunner({
        'rev-parse --is-inside-work-tree': Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
      }),
      timeoutMs: 10,
    });

    const state = await adapter.load({ cwd: '/workspace/pi', ctx: {}, pi: {}, now: () => new Date('2026-06-10T00:00:00.000Z') });

    expect(state).toEqual({ kind: 'unavailable', message: 'git status unavailable' });
  });
});
