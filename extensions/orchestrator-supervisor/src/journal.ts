import {
  openSync,
  closeSync,
  renameSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  fsyncSync,
  constants,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { JournalEntry, JournalToolStatus, SupervisorState } from './types.ts';

const KNOWN_READ_ONLY_TOOLS = new Set([
  'read',
  'grep',
  'find',
  'ls',
  'memory_save',
  'memory_get',
  'memory_search',
  'memory_context',
  'memory_deleted_list',
  'supervisor_rotate',
  'codegraph_status',
  'codegraph_node',
  'codegraph_explore',
  'codegraph_impact',
  'typesafe_circuit_breaker',
  'typesafe_check_overengineering',
  'typesafe_evaluate',
]);

export function isMutatingTool(toolName: string, _args: any): boolean {
  if (KNOWN_READ_ONLY_TOOLS.has(toolName)) {
    return false;
  }
  // All other tools, including bash, write, edit, and unknown custom tools, fail-closed as mutating
  return true;
}

export function classifyOperationKind(
  toolName: string,
  args: any,
): 'git_commit' | 'git_push' | 'file_mutation' | 'bash' | 'other' {
  if (toolName === 'bash' || toolName === 'powershell') {
    const cmd = typeof args?.command === 'string' ? args.command : '';
    if (/\bgit\s+push\b/.test(cmd)) return 'git_push';
    if (/\bgit\s+commit\b/.test(cmd)) return 'git_commit';
    return 'bash';
  }
  if (toolName === 'write' || toolName === 'edit') {
    return 'file_mutation';
  }
  return 'other';
}

export function writeDurableJson(filePath: string, data: any): void {
  const dirPath = dirname(filePath);
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }

  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const content = Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8');

  // 1. Write and fsync temporary file
  const fd = openSync(
    tmpPath,
    constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC,
    0o600,
  );
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  // 2. Atomic rename to target path
  renameSync(tmpPath, filePath);

  // 3. Parent directory fsync to guarantee directory entry persistence
  try {
    const dirFd = openSync(dirPath, constants.O_RDONLY);
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    // Some filesystems or non-POSIX platforms may disallow directory fsync
  }
}

export class FlowJournal {
  readonly flowDir: string;
  readonly flowIdentity: string;
  readonly sessionId: string;
  readonly journalPath: string;
  readonly statePath: string;
  private entries: JournalEntry[] = [];

  constructor(flowDir: string, flowIdentity: string, sessionId: string) {
    this.flowDir = flowDir;
    this.flowIdentity = flowIdentity;
    this.sessionId = sessionId;
    this.journalPath = join(flowDir, 'tool-journal.json');
    this.statePath = join(flowDir, 'state.json');
    this.loadEntries();
  }

  private loadEntries(): void {
    if (existsSync(this.journalPath)) {
      try {
        const raw = readFileSync(this.journalPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.entries = parsed;
        }
      } catch {
        this.entries = [];
      }
    }
  }

  recordToolCallPre(params: {
    toolCallId: string;
    parentToolCallId?: string;
    sessionId: string;
    turnIndex: number;
    toolName: string;
    args: any;
    isMutating?: boolean;
  }): JournalEntry {
    const isMutating = params.isMutating ?? isMutatingTool(params.toolName, params.args);
    const argsString = JSON.stringify(params.args ?? {});
    const argsHash = createHash('sha256').update(argsString).digest('hex').slice(0, 16);
    const argsSummary = params.toolName === 'bash'
      ? (typeof params.args?.command === 'string' ? params.args.command.slice(0, 120) : 'bash command')
      : (typeof params.args?.path === 'string' ? params.args.path : `${params.toolName} args`);

    const entry: JournalEntry = {
      toolCallId: params.toolCallId,
      parentToolCallId: params.parentToolCallId,
      sessionId: params.sessionId,
      turnIndex: params.turnIndex,
      toolName: params.toolName,
      argsHash,
      argsSummary,
      isMutating,
      operationKind: classifyOperationKind(params.toolName, params.args),
      status: 'pending',
      startedAt: Date.now(),
    };

    this.entries.push(entry);
    try {
      writeDurableJson(this.journalPath, this.entries);
    } catch (err) {
      this.entries.pop();
      throw err;
    }
    return entry;
  }

  recordToolCallResult(toolCallId: string, isError: boolean, result: any): void {
    const entry = this.entries.find((e) => e.toolCallId === toolCallId);
    if (!entry) {
      return;
    }

    entry.status = 'settled';
    entry.finishedAt = Date.now();
    entry.isError = isError;
    if (isError && entry.isMutating) {
      entry.partialSideEffectSuspected = true;
    }
    try {
      const resString = JSON.stringify(result ?? {});
      entry.resultHash = createHash('sha256').update(resString).digest('hex').slice(0, 16);
    } catch {
      entry.resultHash = 'unserializable';
    }

    writeDurableJson(this.journalPath, this.entries);
  }

  acknowledgeUncertainEntries(): void {
    let modified = false;
    for (const entry of this.entries) {
      if (entry.status === 'uncertain') {
        entry.status = 'settled';
        entry.finishedAt = Date.now();
        modified = true;
      }
    }
    if (modified) {
      writeDurableJson(this.journalPath, this.entries);
    }
  }

  recoverOnStartup(): { uncertainEntries: JournalEntry[]; recovered: boolean } {
    let modified = false;
    const uncertainEntries: JournalEntry[] = [];

    for (const entry of this.entries) {
      if (entry.status === 'pending' && entry.isMutating) {
        entry.status = 'uncertain';
        uncertainEntries.push(entry);
        modified = true;
      }
    }

    if (modified) {
      writeDurableJson(this.journalPath, this.entries);
    }

    return { uncertainEntries, recovered: modified };
  }

  getEntries(): JournalEntry[] {
    return [...this.entries];
  }

  getUncertainEntries(): JournalEntry[] {
    return this.entries.filter((e) => e.status === 'uncertain');
  }

  saveState(state: SupervisorState): void {
    writeDurableJson(this.statePath, state);
  }

  loadState(): SupervisorState | null {
    if (!existsSync(this.statePath)) {
      return null;
    }
    try {
      const raw = readFileSync(this.statePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
