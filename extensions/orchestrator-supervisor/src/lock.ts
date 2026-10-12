import {
  openSync,
  closeSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  fsyncSync,
  constants,
} from 'node:fs';
import { join } from 'node:path';
import type { LockPayload } from './types.ts';

export class FlowLock {
  readonly flowDir: string;
  readonly flowIdentity: string;
  readonly sessionId: string;
  readonly lockPath: string;
  private held = false;
  private currentSessionId: string;

  constructor(flowDir: string, flowIdentity: string, sessionId: string) {
    this.flowDir = flowDir;
    this.flowIdentity = flowIdentity;
    this.sessionId = sessionId;
    this.currentSessionId = sessionId;
    this.lockPath = join(flowDir, 'supervisor.lock');
  }

  ensureDirectory(): void {
    if (!existsSync(this.flowDir)) {
      mkdirSync(this.flowDir, { recursive: true, mode: 0o700 });
    }
  }

  isHeld(): boolean {
    return this.held;
  }

  static getBootId(): string {
    try {
      return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    } catch {
      return 'unknown-boot-id';
    }
  }

  static getStartTimeTicks(pid: number): number {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const parenIdx = stat.lastIndexOf(')');
      if (parenIdx < 0) return -1;
      const tokens = stat.slice(parenIdx + 2).split(/\s+/);
      // Field 22 is index 19 (since field 3 is index 0)
      const field22 = tokens[19];
      return field22 ? Number.parseInt(field22, 10) : -1;
    } catch {
      return -1;
    }
  }

  static isOwnerAlive(payload: LockPayload): boolean {
    const currentBootId = FlowLock.getBootId();
    if (payload.bootId && payload.bootId !== 'unknown-boot-id' && payload.bootId !== currentBootId) {
      // System rebooted since lock was created
      return false;
    }

    try {
      // Check process existence via signal 0
      process.kill(payload.pid, 0);
    } catch (err: any) {
      if (err.code === 'ESRCH') {
        return false;
      }
    }

    // Check start time ticks from /proc/<pid>/stat
    const actualTicks = FlowLock.getStartTimeTicks(payload.pid);
    if (actualTicks === -1) {
      return false;
    }
    if (payload.startTimeTicks > 0 && actualTicks !== payload.startTimeTicks) {
      // PID was recycled by OS for another process
      return false;
    }

    return true;
  }

  acquire(options?: { enforceDistinctSession?: boolean }): boolean {
    this.ensureDirectory();
    const pid = process.pid;
    const bootId = FlowLock.getBootId();
    const startTimeTicks = FlowLock.getStartTimeTicks(pid);
    const cmdline = process.title || 'pi';

    const payload: LockPayload = {
      pid,
      startTimeTicks,
      bootId,
      cmdline,
      sessionId: this.currentSessionId,
      flowIdentity: this.flowIdentity,
      createdAt: Date.now(),
    };

    try {
      const fd = openSync(
        this.lockPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      try {
        const data = Buffer.from(JSON.stringify(payload, null, 2) + '\n', 'utf8');
        writeFileSync(fd, data);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      this.held = true;
      return true;
    } catch (err: any) {
      if (err.code !== 'EEXIST') {
        throw err;
      }
    }

    // Lock file already exists. Inspect it.
    let existing: LockPayload | null = null;
    try {
      const raw = readFileSync(this.lockPath, 'utf8');
      existing = JSON.parse(raw);
    } catch {
      existing = null;
    }

    if (existing) {
      const isSameProcess =
        existing.pid === pid &&
        existing.bootId === bootId &&
        (startTimeTicks === -1 || existing.startTimeTicks === startTimeTicks);

      if (isSameProcess) {
        if (options?.enforceDistinctSession && existing.sessionId !== this.currentSessionId) {
          throw new Error(
            `locked_by_active_owner: Flow is already held by PID ${existing.pid} for active session ${existing.sessionId}`,
          );
        }
        // Retained ownership across newSession or within same process
        this.held = true;
        return true;
      }

      // Check if existing owner is alive
      const alive = FlowLock.isOwnerAlive(existing);
      if (alive) {
        throw new Error(
          `locked_by_active_owner: Flow is actively locked by PID ${existing.pid} (session: ${existing.sessionId})`,
        );
      }

      // Stale lock detected. Perform atomic owner identity recheck immediately prior to unlink.
      try {
        const recheckRaw = readFileSync(this.lockPath, 'utf8');
        const recheckParsed = JSON.parse(recheckRaw);
        if (
          recheckParsed.pid === existing.pid &&
          recheckParsed.startTimeTicks === existing.startTimeTicks &&
          recheckParsed.bootId === existing.bootId
        ) {
          unlinkSync(this.lockPath);
        } else {
          // File changed during check, abort unlink to prevent race
          throw new Error('locked_by_active_owner: Lock changed during stale reclamation');
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT' && !err.message.includes('locked_by_active_owner')) {
          throw err;
        }
      }
    } else {
      // File corrupt or empty, unlink stale
      try {
        unlinkSync(this.lockPath);
      } catch {}
    }

    // Retry acquisition once after reclaiming stale lock
    const fd = openSync(
      this.lockPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    try {
      const data = Buffer.from(JSON.stringify(payload, null, 2) + '\n', 'utf8');
      writeFileSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.held = true;
    return true;
  }

  handover(newSessionId: string): boolean {
    if (!this.held) {
      throw new Error('Cannot handover lock that is not held');
    }
    this.currentSessionId = newSessionId;
    const pid = process.pid;
    const bootId = FlowLock.getBootId();
    const startTimeTicks = FlowLock.getStartTimeTicks(pid);

    const payload: LockPayload = {
      pid,
      startTimeTicks,
      bootId,
      cmdline: process.title || 'pi',
      sessionId: newSessionId,
      flowIdentity: this.flowIdentity,
      createdAt: Date.now(),
    };

    writeFileSync(this.lockPath, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
    return true;
  }

  release(): void {
    if (!this.held) return;
    try {
      if (existsSync(this.lockPath)) {
        const raw = readFileSync(this.lockPath, 'utf8');
        const existing = JSON.parse(raw);
        if (existing.pid === process.pid) {
          unlinkSync(this.lockPath);
        }
      }
    } catch {}
    this.held = false;
  }
}
