import fs from 'node:fs/promises';
import { basename, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { GitFileRow, GitFileState, GitStatusModel, SectionState, SidebarAdapterContext } from '../model.js';
import { DEFAULT_COMMAND_TIMEOUT_MS } from '../config.js';

const execFileAsync = promisify(execFile);

type CommandResult = {
  stdout: string;
  stderr?: string;
  exitCode?: number;
};

type CommandRunner = (args: readonly string[], options: { cwd: string; timeoutMs: number }) => Promise<CommandResult>;

type FileReader = (filePath: string) => Promise<string | Buffer>;
type StatReader = (filePath: string) => Promise<{ mtimeMs: number }>;

type GitAdapter = {
  load(context: SidebarAdapterContext): Promise<SectionState<GitStatusModel>>;
};

const ALLOWED_COMMANDS = new Set([
  'rev-parse --is-inside-work-tree',
  'rev-parse --show-toplevel',
  'remote get-url origin',
  'branch --show-current',
  'rev-parse --short HEAD',
  'status --porcelain=v1 -z --untracked-files=all',
  'diff --numstat',
  'diff --cached --numstat',
]);

function defaultFileReader(filePath: string): Promise<string | Buffer> {
  return fs.readFile(filePath);
}

async function defaultStatReader(filePath: string): Promise<{ mtimeMs: number }> {
  const stat = await fs.stat(filePath);
  return { mtimeMs: stat.mtimeMs };
}

function defaultRunner(args: readonly string[], options: { cwd: string; timeoutMs: number }): Promise<CommandResult> {
  return execFileAsync('git', [...args], {
    cwd: options.cwd,
    timeout: options.timeoutMs,
    maxBuffer: 1024 * 1024,
    encoding: 'utf8',
  }).then(({ stdout, stderr }) => ({ stdout, stderr }));
}

function normalizeOutput(text: string): string {
  return text.trim();
}

function commandKey(args: readonly string[]): string {
  return args.join(' ');
}

async function safeRun(run: CommandRunner, cwd: string, timeoutMs: number, args: readonly string[]): Promise<CommandResult> {
  const key = commandKey(args);
  if (!ALLOWED_COMMANDS.has(key)) throw new Error(`unsupported git command: ${key}`);
  return run(args, { cwd, timeoutMs });
}

function toGitState(code: string): GitFileState {
  if (code === '??') return 'created';
  if (code.includes('A') || code.includes('C')) return 'created';
  if (code.includes('D') && !code.includes('A')) return 'deleted';
  return 'edited';
}

export function parseGitRepositoryLabel(remoteUrl: string): string | undefined {
  const trimmed = remoteUrl.trim().replace(/\/$/, '');
  if (!trimmed) return undefined;

  const sshIndex = trimmed.lastIndexOf(':');
  const slashIndex = trimmed.lastIndexOf('/');
  const splitIndex = Math.max(sshIndex, slashIndex);
  const tail = splitIndex >= 0 ? trimmed.slice(splitIndex + 1) : trimmed;
  const label = tail.replace(/\.git$/i, '').trim();
  return label || undefined;
}

export function parsePorcelainEntries(output: string): GitFileRow[] {
  if (!output) return [];

  const entries = output.split('\0');
  const rows: GitFileRow[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;

    const statusCode = entry.slice(0, 2);
    const pathText = entry.slice(3);
    let path = pathText;

    if (statusCode.includes('R') || statusCode.includes('C')) {
      const renamedPath = entries[index + 1];
      if (renamedPath) {
        path = renamedPath;
        index += 1;
      }
    }

    rows.push({
      path,
      basename: basename(path),
      state: toGitState(statusCode),
    });
  }

  return rows;
}

function parseNumstat(output: string): Map<string, { added: number; deleted: number }> {
  const counts = new Map<string, { added: number; deleted: number }>();

  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const [addedText, deletedText, ...pathParts] = line.split('\t');
    const path = pathParts.join('\t').trim();
    if (!path) continue;
    const added = Number.parseInt(addedText ?? '', 10);
    const deleted = Number.parseInt(deletedText ?? '', 10);
    const previous = counts.get(path) ?? { added: 0, deleted: 0 };
    counts.set(path, {
      added: previous.added + (Number.isFinite(added) ? added : 0),
      deleted: previous.deleted + (Number.isFinite(deleted) ? deleted : 0),
    });
  }

  return counts;
}

export function mergeNumstatCounts(rows: GitFileRow[], workingTreeOutput: string, stagedOutput = ''): GitFileRow[] {
  const combined = parseNumstat(workingTreeOutput);
  for (const [path, counts] of parseNumstat(stagedOutput)) {
    const previous = combined.get(path) ?? { added: 0, deleted: 0 };
    combined.set(path, {
      added: previous.added + counts.added,
      deleted: previous.deleted + counts.deleted,
    });
  }

  return rows.map((row) => {
    const counts = combined.get(row.path);
    return counts ? { ...row, added: counts.added, deleted: counts.deleted } : row;
  });
}

function countTextLines(content: string | Buffer): number {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : content;
  if (!text) return 0;
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines.length;
}

async function addCreatedFileLineCounts(rows: GitFileRow[], root: string, readFile: FileReader): Promise<GitFileRow[]> {
  return Promise.all(rows.map(async (row) => {
    if (row.state !== 'created' || row.added !== undefined || row.deleted !== undefined) return row;
    try {
      return { ...row, added: countTextLines(await readFile(join(root, row.path))), deleted: 0 };
    } catch {
      return row;
    }
  }));
}

async function changedAtMs(row: GitFileRow, root: string, statReader: StatReader): Promise<number> {
  const filePath = join(root, row.path);
  try {
    return (await statReader(filePath)).mtimeMs;
  } catch {
    try {
      return (await statReader(join(filePath, '..'))).mtimeMs;
    } catch {
      return 0;
    }
  }
}

async function sortByRecentActivity(rows: GitFileRow[], root: string, statReader: StatReader): Promise<GitFileRow[]> {
  const decorated = await Promise.all(rows.map(async (row, index) => ({
    row,
    index,
    changedAt: await changedAtMs(row, root, statReader),
  })));
  return decorated
    .sort((a, b) => (b.changedAt - a.changedAt) || (a.index - b.index))
    .map((entry) => entry.row);
}

async function readBranchLabel(run: CommandRunner, cwd: string, timeoutMs: number): Promise<string> {
  const branch = normalizeOutput((await safeRun(run, cwd, timeoutMs, ['branch', '--show-current'])).stdout);
  if (branch) return branch;

  const shortHead = normalizeOutput((await safeRun(run, cwd, timeoutMs, ['rev-parse', '--short', 'HEAD'])).stdout);
  return shortHead ? `detached@${shortHead}` : 'detached';
}

export function createGitAdapter(options?: { run?: CommandRunner; timeoutMs?: number; fileReader?: FileReader; statReader?: StatReader }): GitAdapter {
  const run = options?.run ?? defaultRunner;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const fileReader = options?.fileReader ?? defaultFileReader;
  const statReader = options?.statReader ?? defaultStatReader;

  return {
    async load(context: SidebarAdapterContext): Promise<SectionState<GitStatusModel>> {
      try {
        const insideWorkTree = normalizeOutput(
          (await safeRun(run, context.cwd, timeoutMs, ['rev-parse', '--is-inside-work-tree'])).stdout,
        );
        if (insideWorkTree !== 'true') return { kind: 'empty', message: 'not a git repository' };

        const root = normalizeOutput((await safeRun(run, context.cwd, timeoutMs, ['rev-parse', '--show-toplevel'])).stdout);
        const repositoryLabel = await safeRun(run, context.cwd, timeoutMs, ['remote', 'get-url', 'origin'])
          .then((result) => parseGitRepositoryLabel(result.stdout) ?? basename(root || context.cwd))
          .catch(() => basename(root || context.cwd));
        const branchLabel = await readBranchLabel(run, context.cwd, timeoutMs);
        const statusRows = parsePorcelainEntries(
          (await safeRun(run, context.cwd, timeoutMs, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout,
        );
        const workingTreeCounts = await safeRun(run, context.cwd, timeoutMs, ['diff', '--numstat']).then((result) => result.stdout);
        const stagedCounts = await safeRun(run, context.cwd, timeoutMs, ['diff', '--cached', '--numstat']).then((result) => result.stdout);

        return {
          kind: 'ready',
          refreshedAt: context.now().toISOString(),
          data: {
            root,
            repositoryLabel,
            branchLabel,
            files: await sortByRecentActivity(
              await addCreatedFileLineCounts(mergeNumstatCounts(statusRows, workingTreeCounts, stagedCounts), root, fileReader),
              root,
              statReader,
            ),
          },
        };
      } catch {
        return { kind: 'unavailable', message: 'git status unavailable' };
      }
    },
  };
}
