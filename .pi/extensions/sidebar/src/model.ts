export type SectionState<T> =
  | { kind: 'loading'; previous?: T }
  | { kind: 'ready'; data: T; refreshedAt: string; stale?: boolean }
  | { kind: 'empty'; message: string; refreshedAt?: string }
  | { kind: 'unavailable'; message: string; refreshedAt?: string }
  | { kind: 'error'; message: string; refreshedAt?: string; previous?: T };

export type ChatHeaderModel = {
  title: string;
  source: 'runtime' | 'session' | 'fallback';
};

export type SubagentActivity = {
  id: string;
  agent: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';
  summary: string;
  lastActivityAt: string;
  elapsedSeconds?: number;
};

export type SubagentActivityModel = {
  windowMinutes: 20;
  activities: SubagentActivity[];
  source: 'provider' | 'history' | 'events' | 'none';
};

export type GitFileState = 'created' | 'deleted' | 'edited';

export type GitFileRow = {
  path: string;
  basename: string;
  state: GitFileState;
  added?: number;
  deleted?: number;
};

export type GitStatusModel = {
  root: string;
  repositoryLabel: string;
  branchLabel: string;
  files: GitFileRow[];
};

export type SidebarTodoModel = {
  id: string;
  title: string;
  body?: string;
  completedSteps: number;
  totalSteps: number;
  progressLabel: string;
  steps: Array<{
    id: string;
    text: string;
    status: 'open' | 'completed';
  }>;
  updatedAt: string;
};

export type SidebarModel = {
  chat: ChatHeaderModel;
  subagents: SectionState<SubagentActivityModel>;
  todo?: SectionState<SidebarTodoModel>;
  git: SectionState<GitStatusModel>;
  refreshedAt: string;
};

export type SidebarAdapterContext = {
  cwd: string;
  sessionId?: string;
  ctx: any;
  pi: any;
  now: () => Date;
};

export type RefreshPolicy = {
  gitIntervalMs: number;
  subagentsIntervalMs: number;
  renderTickMs: number;
  commandTimeoutMs: number;
};
