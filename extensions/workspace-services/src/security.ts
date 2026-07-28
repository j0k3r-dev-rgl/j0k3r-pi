import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { WorkspacePathSecurityContext } from './types.js';

const SECRET_FIELD_RE = /(secret|token|password|passwd|authorization|api[_-]?key|cookie|session)/i;
const PROC_SELF_FD_ROOT = '/proc/self/fd';
const O_PATH = 0o10000000;
export const MAX_ENV_FILE_BYTES = 256 * 1024;
export const MAX_ENV_ENTRIES = 512;
export const MAX_ENV_KEY_CHARS = 128;
export const MAX_ENV_VALUE_CHARS = 16 * 1024;

export interface PinnedDirectoryHandle {
  handle: FileHandle;
  procPath: string;
  realPath: string;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function safeRelativePath(root: string, candidate: string): string {
  const rel = relative(root, candidate);
  if (!rel || rel === '') return '.';
  return rel.split(sep).join('/');
}

function validatePathSegment(segment: string, label: string): void {
  if (!segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\')) {
    throw new Error(`${label} contains an invalid path segment.`);
  }
}

function relativeSegments(baseRealRoot: string, candidateRealPath: string): string[] {
  const rel = relative(baseRealRoot, candidateRealPath);
  if (rel === '') return [];
  return rel.split(sep).filter(Boolean);
}

function isContainedRealPath(baseRealRoot: string, candidateRealPath: string): boolean {
  const rel = relative(baseRealRoot, candidateRealPath);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith('/'));
}

function procFdPath(fd: number, ...segments: string[]): string {
  return join(PROC_SELF_FD_ROOT, String(fd), ...segments);
}

async function assertDirectoryIdentity(path: string, handle: FileHandle, label: string): Promise<void> {
  const [entryStat, handleStat] = await Promise.all([lstat(path), handle.stat()]);
  if (!entryStat.isDirectory() || !handleStat.isDirectory() || entryStat.dev !== handleStat.dev || entryStat.ino !== handleStat.ino) {
    throw new Error(`${label} changed while it was being pinned.`);
  }
}

async function pinRelativeDirectory(base: PinnedDirectoryHandle, relativePath: string, label: string, create = false): Promise<PinnedDirectoryHandle> {
  const segments = relativePath.split(sep).filter(Boolean);
  let current = base;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    validatePathSegment(segment, label);
    const segmentPath = procFdPath(current.handle.fd, segment);
    if (create) await mkdir(segmentPath, { recursive: false, mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const nextHandle = await open(segmentPath, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
    try {
      await assertDirectoryIdentity(segmentPath, nextHandle, label);
    } catch (error) {
      await nextHandle.close();
      throw error;
    }
    if (current !== base) await current.handle.close();
    current = {
      handle: nextHandle,
      procPath: procFdPath(nextHandle.fd),
      realPath: join(current.realPath, segment),
    };
  }
  return current;
}

export async function createWorkspaceSecurityContext(cwd: string): Promise<WorkspacePathSecurityContext> {
  const workspaceRoot = resolve(cwd);
  const workspaceRealRoot = await realpath(workspaceRoot);
  const handle = await open(workspaceRealRoot, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  await handle.close();
  return { workspaceRoot, workspaceRealRoot };
}

export async function pinWorkspaceRoot(workspaceRealRoot: string): Promise<PinnedDirectoryHandle> {
  const handle = await open(workspaceRealRoot, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  await assertDirectoryIdentity(workspaceRealRoot, handle, 'Workspace root');
  return { handle, procPath: procFdPath(handle.fd), realPath: workspaceRealRoot };
}

export async function pinContainedDirectory(baseRealRoot: string, candidatePath: string, label: string): Promise<PinnedDirectoryHandle> {
  const candidateRealPath = await realpath(candidatePath);
  if (!isContainedRealPath(baseRealRoot, candidateRealPath)) throw new Error(`${label} escapes the real workspace boundary.`);
  const root = await pinWorkspaceRoot(baseRealRoot);
  let pinned: PinnedDirectoryHandle | undefined;
  try {
    pinned = await pinRelativeDirectory(root, relativeSegments(baseRealRoot, candidateRealPath).join(sep), label, false);
    return pinned;
  } finally {
    if (pinned !== root) await root.handle.close();
  }
}

export async function pinRelativeWorkspaceDirectory(baseRealRoot: string, relativePath: string, label: string, create = false): Promise<PinnedDirectoryHandle> {
  const root = await pinWorkspaceRoot(baseRealRoot);
  let pinned: PinnedDirectoryHandle | undefined;
  try {
    pinned = await pinRelativeDirectory(root, relativePath, label, create);
    return pinned;
  } finally {
    if (pinned !== root) await root.handle.close();
  }
}

export async function closePinnedDirectory(directory: PinnedDirectoryHandle | undefined): Promise<void> {
  if (directory) await directory.handle.close();
}

export async function assertContainedRealPath(baseRealRoot: string, candidatePath: string, label: string): Promise<string> {
  const resolved = await pathExists(candidatePath)
    ? await realpath(candidatePath)
    : join(await realpath(dirname(candidatePath)), candidatePath.slice(candidatePath.lastIndexOf(sep) + 1));
  if (isContainedRealPath(baseRealRoot, resolved)) return resolved;
  throw new Error(`${label} escapes the real workspace boundary.`);
}

export async function assertExistingContainedRealPath(baseRealRoot: string, candidatePath: string, label: string): Promise<string> {
  const resolved = await realpath(candidatePath);
  if (isContainedRealPath(baseRealRoot, resolved)) return resolved;
  throw new Error(`${label} escapes the real workspace boundary.`);
}

export async function ensurePrivateDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  await handle.close();
}

export async function writePrivateFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const handle = await open(path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function assertMatchingRegularIdentity(
  entryStat: Awaited<ReturnType<typeof lstat>>,
  handleStat: Awaited<ReturnType<FileHandle['stat']>>,
  label: string,
): void {
  if (!entryStat.isFile() || !handleStat.isFile()) {
    throw new Error(`${label} must remain a regular file.`);
  }
  if (entryStat.nlink !== 1 || handleStat.nlink !== 1) {
    throw new Error(`${label} must remain the transaction-owned leaf.`);
  }
  if (entryStat.dev !== handleStat.dev || entryStat.ino !== handleStat.ino) {
    throw new Error(`${label} changed while it was being opened.`);
  }
}

async function openPinnedRegularFile(directory: PinnedDirectoryHandle, leaf: string, flags: number, mode: number, label: string): Promise<FileHandle> {
  validatePathSegment(leaf, label);
  const path = join(directory.procPath, leaf);
  const beforeOpenStat = await lstat(path);
  if (!beforeOpenStat.isFile()) {
    throw new Error(`${label} must remain a regular file.`);
  }

  const metadataHandle = await open(path, O_PATH | fsConstants.O_NOFOLLOW);
  try {
    const metadataStat = await metadataHandle.stat();
    assertMatchingRegularIdentity(beforeOpenStat, metadataStat, label);

    const beforeDataOpenStat = await lstat(path);
    assertMatchingRegularIdentity(beforeDataOpenStat, metadataStat, label);

    const dataHandle = await open(procFdPath(metadataHandle.fd), flags, mode);
    try {
      const dataStat = await dataHandle.stat();
      assertMatchingRegularIdentity(beforeDataOpenStat, dataStat, label);

      const beforeFirstReadStat = await lstat(path);
      assertMatchingRegularIdentity(beforeFirstReadStat, dataStat, label);
      return dataHandle;
    } catch (error) {
      await dataHandle.close();
      throw error;
    }
  } finally {
    await metadataHandle.close();
  }
}

export async function pinnedLeafExists(directory: PinnedDirectoryHandle, leaf: string): Promise<boolean> {
  validatePathSegment(leaf, 'Pinned leaf');
  try {
    await lstat(join(directory.procPath, leaf));
    return true;
  } catch {
    return false;
  }
}

export async function readPinnedTextFile(directory: PinnedDirectoryHandle, leaf: string, maxBytes: number, label: string): Promise<string> {
  const handle = await openPinnedRegularFile(directory, leaf, fsConstants.O_RDONLY, 0o600, label);
  try {
    const fileStat = await handle.stat();
    if (fileStat.size > maxBytes) throw new Error(`${label} exceeds the supported size limit.`);
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

export async function writePinnedTextFile(directory: PinnedDirectoryHandle, leaf: string, content: string, mode = 0o600): Promise<void> {
  validatePathSegment(leaf, 'Pinned leaf');
  const path = join(directory.procPath, leaf);
  const handle = await open(path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW, mode);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function assertPinnedLeafIdentity(directory: PinnedDirectoryHandle, leaf: string, handle: FileHandle, label: string): Promise<void> {
  validatePathSegment(leaf, label);
  const [entryStat, handleStat] = await Promise.all([lstat(join(directory.procPath, leaf)), handle.stat()]);
  assertMatchingRegularIdentity(entryStat, handleStat, label);
}

async function cleanupOwnedPinnedLeaf(directory: PinnedDirectoryHandle, leaf: string, handle: FileHandle, label: string): Promise<void> {
  try {
    await assertPinnedLeafIdentity(directory, leaf, handle, label);
    await rm(join(directory.procPath, leaf), { force: false });
  } catch {
    // Leave mismatched or already-missing temp leaves in place for safe recovery.
  }
}

export async function writePinnedTextFileAtomically(directory: PinnedDirectoryHandle, leaf: string, content: string, mode = 0o600): Promise<void> {
  validatePathSegment(leaf, 'Pinned leaf');
  const tempLeaf = `${leaf}.${process.pid}.${Date.now()}.tmp`;
  const tempPath = join(directory.procPath, tempLeaf);
  const targetPath = join(directory.procPath, leaf);
  const handle = await open(tempPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, mode);
  let renamed = false;
  try {
    await assertPinnedLeafIdentity(directory, tempLeaf, handle, 'Pinned temp leaf');
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await assertPinnedLeafIdentity(directory, tempLeaf, handle, 'Pinned temp leaf');
    await rename(tempPath, targetPath);
    renamed = true;
    await directory.handle.sync();
  } finally {
    try {
      if (!renamed) await cleanupOwnedPinnedLeaf(directory, tempLeaf, handle, 'Pinned temp leaf');
    } finally {
      await handle.close();
    }
  }
}

export async function renamePinnedLeaf(sourceDirectory: PinnedDirectoryHandle, sourceLeaf: string, targetDirectory: PinnedDirectoryHandle, targetLeaf: string): Promise<void> {
  validatePathSegment(sourceLeaf, 'Pinned leaf');
  validatePathSegment(targetLeaf, 'Pinned leaf');
  await rename(join(sourceDirectory.procPath, sourceLeaf), join(targetDirectory.procPath, targetLeaf));
  await sourceDirectory.handle.sync();
  if (sourceDirectory.procPath !== targetDirectory.procPath) await targetDirectory.handle.sync();
}

export async function removePinnedLeafIfEmpty(directory: PinnedDirectoryHandle, leaf: string): Promise<void> {
  validatePathSegment(leaf, 'Pinned leaf');
  const path = join(directory.procPath, leaf);
  if (!(await pinnedLeafExists(directory, leaf))) return;
  const fileStat = await stat(path);
  if (fileStat.size === 0) await rm(path, { force: true });
}

export async function readPinnedDirectory(directory: PinnedDirectoryHandle): Promise<string[]> {
  return readdir(directory.procPath);
}

export async function readBoundedTextFile(path: string, maxBytes: number, label: string): Promise<string> {
  const fileStat = await stat(path);
  if (fileStat.size > maxBytes) {
    throw new Error(`${label} exceeds the supported size limit.`);
  }
  return readFile(path, 'utf8');
}

export function redactText(text: string, secrets: string[]): string {
  let redacted = text;
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
    if (!secret) continue;
    redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted;
}

export function redactStructured<T>(value: T, secrets: string[]): T {
  if (typeof value === 'string') return redactText(value, secrets) as T;
  if (Array.isArray(value)) return value.map((item) => redactStructured(item, secrets)) as T;
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELD_RE.test(key)) output[key] = '[REDACTED]';
    else output[key] = redactStructured(inner, secrets);
  }
  return output as T;
}

export async function assertRegularFile(path: string, label: string): Promise<void> {
  const fileStat = await lstat(path);
  if (!fileStat.isFile()) throw new Error(`${label} must be a regular file.`);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureReadable(path: string): Promise<void> {
  const handle = await open(path, fsConstants.O_RDONLY);
  await handle.close();
}
