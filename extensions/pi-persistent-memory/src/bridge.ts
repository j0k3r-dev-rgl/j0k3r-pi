export const SUPERVISOR_CHECKPOINT_CHANNEL = 'memory:supervisor:checkpoint:v1';

export interface MemoryCheckpointSaveRequest {
  action: 'save';
  cwd: string;
  sessionId: string;
  title: string;
  content: string;
  type?: string;
  topicKey?: string;
  id?: number;
  scope?: 'project' | 'global';
  respond: (res: MemoryCheckpointSaveResult) => void;
}

export interface MemoryCheckpointSaveResult {
  ok: boolean;
  id?: number;
  committed?: boolean;
  indexed?: boolean;
  indexing_status?: string;
  topic_key?: string | null;
  content_version?: number;
  readbackVerified?: boolean;
  error?: string;
}

export interface MemoryCheckpointGetRequest {
  action: 'get';
  cwd: string;
  sessionId?: string;
  id: number;
  global?: boolean;
  cursor?: string;
  readAll?: boolean;
  respond: (res: MemoryCheckpointGetResult) => void;
}

export interface MemoryCheckpointGetResult {
  ok: boolean;
  id?: number;
  title?: string;
  content?: string;
  type?: string;
  topic_key?: string | null;
  content_version?: number;
  has_more?: boolean;
  next_cursor?: string | null;
  error?: string;
}

export type MemoryCheckpointRequest = MemoryCheckpointSaveRequest | MemoryCheckpointGetRequest;

export async function saveMemoryCheckpoint(
  events: any,
  options: Omit<MemoryCheckpointSaveRequest, 'action' | 'respond'>,
  timeoutMs = 10000,
): Promise<MemoryCheckpointSaveResult> {
  return new Promise<MemoryCheckpointSaveResult>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: 'save_checkpoint_timeout' });
      }
    }, timeoutMs);

    const respond = (res: MemoryCheckpointSaveResult) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(res);
      }
    };

    try {
      events.emit(SUPERVISOR_CHECKPOINT_CHANNEL, {
        action: 'save',
        ...options,
        respond,
      });
    } catch (err: any) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, error: err.message });
      }
    }
  });
}

export async function getMemoryCheckpoint(
  events: any,
  options: Omit<MemoryCheckpointGetRequest, 'action' | 'respond'>,
  timeoutMs = 10000,
): Promise<MemoryCheckpointGetResult> {
  return new Promise<MemoryCheckpointGetResult>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: 'get_checkpoint_timeout' });
      }
    }, timeoutMs);

    const respond = (res: MemoryCheckpointGetResult) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(res);
      }
    };

    try {
      events.emit(SUPERVISOR_CHECKPOINT_CHANNEL, {
        action: 'get',
        ...options,
        respond,
      });
    } catch (err: any) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, error: err.message });
      }
    }
  });
}
