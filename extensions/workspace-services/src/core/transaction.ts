import { createHash, randomUUID } from 'node:crypto';
import net from 'node:net';
import { writePrivateFile } from '../security.js';

export interface LifecycleTransaction {
  ownerId: string;
  leaseName: string;
}

export interface TransactionOptions {
  signal?: AbortSignal;
  deadlineMs: number;
  ownerPath?: string;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error('Operation aborted'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function toLeaseName(canonicalStatePath: string): string {
  const digest = createHash('sha256').update(canonicalStatePath).digest('hex');
  return `\0pi-workspace-services-${digest}`;
}

async function writeOwnerRecord(ownerPath: string | undefined, record: Record<string, unknown>): Promise<void> {
  if (!ownerPath) return;
  await writePrivateFile(ownerPath, `${JSON.stringify(record, null, 2)}\n`);
}

export async function withLifecycleTransaction<T>(
  canonicalStatePath: string,
  options: TransactionOptions,
  operation: (transaction: LifecycleTransaction) => Promise<T>,
): Promise<T> {
  const leaseName = toLeaseName(canonicalStatePath);
  const ownerId = randomUUID();
  const startedAt = Date.now();

  while (true) {
    if (options.signal?.aborted) throw new Error('Operation aborted');
    if (Date.now() - startedAt > options.deadlineMs) throw new Error('Lifecycle transaction is busy. Retry when the active operation finishes.');

    const server = net.createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen({ path: leaseName, exclusive: true }, () => resolve());
      });
      await writeOwnerRecord(options.ownerPath, {
        ownerId,
        leaseName: leaseName.replace(/^\0/, '@'),
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      });
      try {
        return await operation({ ownerId, leaseName });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    } catch (error: any) {
      server.close();
      if (error?.code !== 'EADDRINUSE') throw error;
      await writeOwnerRecord(options.ownerPath, {
        ownerId,
        leaseName: leaseName.replace(/^\0/, '@'),
        pid: process.pid,
        waitingAt: new Date().toISOString(),
        status: 'busy',
      });
      await delay(50, options.signal);
    }
  }
}
