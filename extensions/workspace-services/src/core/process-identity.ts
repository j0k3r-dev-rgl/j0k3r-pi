import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, readdir, realpath, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { safeRelativePath } from '../security.js';
import type { ManagedProcessIdentityV1, WorkspaceServicesConfig } from '../types.js';

async function readBootId(): Promise<string> {
  return (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
}

async function readProcStat(pid: number): Promise<{ pgrp: number; sid: number; startTimeTicks: string }> {
  const text = await readFile(`/proc/${pid}/stat`, 'utf8');
  const idx = text.lastIndexOf(') ');
  if (idx < 0) throw new Error(`Unable to parse /proc/${pid}/stat`);
  const fields = text.slice(idx + 2).trim().split(/\s+/);
  return {
    pgrp: Number(fields[2]),
    sid: Number(fields[3]),
    startTimeTicks: String(fields[19]),
  };
}

async function readCmdlineHash(pid: number): Promise<string> {
  const buffer = await readFile(`/proc/${pid}/cmdline`);
  return createHash('sha256').update(buffer).digest('hex');
}

async function readCwdIdentity(pid: number, config: WorkspaceServicesConfig): Promise<{ cwdRelative: string; cwdDevice: string; cwdInode: string }> {
  const linkPath = await readlink(`/proc/${pid}/cwd`);
  const real = await realpath(`/proc/${pid}/cwd`);
  const rel = relative(config.workspaceRealRoot, real);
  if (rel.startsWith('..')) throw new Error(`Process cwd escapes workspace: ${linkPath}`);
  const fileStat = await stat(real);
  return {
    cwdRelative: safeRelativePath(config.workspaceRealRoot, real),
    cwdDevice: String(fileStat.dev),
    cwdInode: String(fileStat.ino),
  };
}

export async function captureManagedIdentity(
  config: WorkspaceServicesConfig,
  pid: number,
  serviceCommand: string,
): Promise<ManagedProcessIdentityV1> {
  const [bootId, procStat, cmdlineSha256, cwdIdentity] = await Promise.all([
    readBootId(),
    readProcStat(pid),
    readCmdlineHash(pid),
    readCwdIdentity(pid, config),
  ]);
  return {
    pid,
    processGroupId: procStat.pgrp,
    sessionId: procStat.sid,
    bootId,
    startTimeTicks: procStat.startTimeTicks,
    cmdlineSha256,
    cwdRelative: cwdIdentity.cwdRelative,
    cwdDevice: cwdIdentity.cwdDevice,
    cwdInode: cwdIdentity.cwdInode,
    serviceCommandSha256: createHash('sha256').update(serviceCommand).digest('hex'),
  };
}

export async function validateManagedIdentity(
  config: WorkspaceServicesConfig,
  identity: ManagedProcessIdentityV1,
  serviceCommand: string,
): Promise<{ ok: true; identity: ManagedProcessIdentityV1 } | { ok: false; reason: string }> {
  if (!Number.isInteger(identity.pid) || identity.pid <= 0) return { ok: false, reason: 'invalid pid' };
  try {
    const current = await captureManagedIdentity(config, identity.pid, serviceCommand);
    const mismatches: string[] = [];
    if (current.bootId !== identity.bootId) mismatches.push('boot id');
    if (current.startTimeTicks !== identity.startTimeTicks) mismatches.push('start time');
    if (current.processGroupId !== identity.processGroupId) mismatches.push('process group');
    if (current.sessionId !== identity.sessionId) mismatches.push('session');
    if (current.cmdlineSha256 !== identity.cmdlineSha256) mismatches.push('command line');
    if (current.cwdRelative !== identity.cwdRelative || current.cwdDevice !== identity.cwdDevice || current.cwdInode !== identity.cwdInode) mismatches.push('cwd');
    if (current.serviceCommandSha256 !== createHash('sha256').update(serviceCommand).digest('hex')) mismatches.push('service command');
    if (mismatches.length) return { ok: false, reason: `identity mismatch (${mismatches.join(', ')})` };
    return { ok: true, identity: current };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'process missing' };
  }
}

async function listProcPids(): Promise<number[]> {
  const entries = await readdir('/proc');
  return entries.map((entry) => Number(entry)).filter((value) => Number.isInteger(value) && value > 0);
}

async function matchingGroupMembers(identity: ManagedProcessIdentityV1): Promise<number[]> {
  const pids = await listProcPids();
  const matches: number[] = [];
  for (const pid of pids) {
    try {
      const procStat = await readProcStat(pid);
      if (procStat.pgrp !== identity.processGroupId || procStat.sid !== identity.sessionId) continue;
      if (pid !== identity.pid && BigInt(procStat.startTimeTicks) < BigInt(identity.startTimeTicks)) continue;
      matches.push(pid);
    } catch {
      // ignore racing procfs entries
    }
  }
  return matches;
}

export async function confirmGroupAbsent(identity: ManagedProcessIdentityV1, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let seenEmpty = 0;
  while (Date.now() <= deadline) {
    if (signal?.aborted) throw new Error('Operation aborted');
    const members = await matchingGroupMembers(identity);
    if (members.length === 0) {
      seenEmpty += 1;
      if (seenEmpty >= 2) return true;
    } else {
      seenEmpty = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

export async function processStillRunning(pid: number): Promise<boolean> {
  try {
    await lstat(`/proc/${pid}`);
    return true;
  } catch {
    return false;
  }
}
