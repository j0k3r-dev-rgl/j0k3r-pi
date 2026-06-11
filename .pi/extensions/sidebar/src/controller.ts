import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_GIT_REFRESH_INTERVAL_MS,
  DEFAULT_RENDER_TICK_INTERVAL_MS,
  DEFAULT_SUBAGENTS_REFRESH_INTERVAL_MS,
} from './config.js';
import type {
  ChatHeaderModel,
  GitStatusModel,
  RefreshPolicy,
  SectionState,
  SidebarAdapterContext,
  SidebarModel,
  SidebarTodoModel,
  SubagentActivityModel,
} from './model.js';
import { renderSidebar, type SidebarTheme } from './render.js';
import { createChatAdapter, type ChatAdapter } from './adapters/chat.js';
import { createGitAdapter } from './adapters/git.js';
import { createSubagentsAdapter } from './adapters/subagents.js';
import { createTodoAdapter } from './adapters/todo.js';

type SectionAdapter<T> = {
  load(context: SidebarAdapterContext): Promise<SectionState<T>>;
};

type SidebarControllerOptions = {
  context: SidebarAdapterContext;
  chatAdapter?: ChatAdapter;
  gitAdapter?: SectionAdapter<GitStatusModel>;
  subagentsAdapter?: SectionAdapter<SubagentActivityModel>;
  todoAdapter?: SectionAdapter<SidebarTodoModel>;
  policy?: Partial<RefreshPolicy>;
  requestRender?: () => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
};

export class SidebarController {
  private readonly context: SidebarAdapterContext;
  private readonly chatAdapter: ChatAdapter;
  private readonly gitAdapter: SectionAdapter<GitStatusModel>;
  private readonly subagentsAdapter: SectionAdapter<SubagentActivityModel>;
  private readonly todoAdapter: SectionAdapter<SidebarTodoModel>;
  private readonly requestRenderFn: () => void;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private readonly policy: RefreshPolicy;

  private model: SidebarModel;
  private running = false;
  private hidden = false;
  private closed = false;
  private renderTimer?: ReturnType<typeof setInterval>;
  private gitTimer?: ReturnType<typeof setInterval>;
  private subagentsTimer?: ReturnType<typeof setInterval>;
  private gitInFlight = false;
  private subagentsInFlight = false;
  private todoInFlight = false;

  constructor(options: SidebarControllerOptions) {
    this.context = options.context;
    this.chatAdapter = options.chatAdapter ?? createChatAdapter();
    this.gitAdapter = options.gitAdapter ?? createGitAdapter({ timeoutMs: options.policy?.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS });
    this.subagentsAdapter = options.subagentsAdapter ?? createSubagentsAdapter();
    this.todoAdapter = options.todoAdapter ?? createTodoAdapter();
    this.requestRenderFn = options.requestRender ?? (() => undefined);
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
    this.policy = {
      gitIntervalMs: options.policy?.gitIntervalMs ?? DEFAULT_GIT_REFRESH_INTERVAL_MS,
      subagentsIntervalMs: options.policy?.subagentsIntervalMs ?? DEFAULT_SUBAGENTS_REFRESH_INTERVAL_MS,
      renderTickMs: options.policy?.renderTickMs ?? DEFAULT_RENDER_TICK_INTERVAL_MS,
      commandTimeoutMs: options.policy?.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    };
    this.model = {
      chat: { title: 'Current Chat', source: 'fallback' },
      git: { kind: 'loading' },
      subagents: { kind: 'loading' },
      refreshedAt: this.nowIso(),
    };
  }

  start(): void {
    if (this.running || this.hidden || this.closed) return;
    this.running = true;
    void this.refreshChat();
    void this.refreshGit();
    void this.refreshSubagents();
    void this.refreshTodo();

    this.renderTimer = this.setIntervalFn(() => {
      void this.refreshChat();
      void this.refreshTodo();
    }, this.policy.renderTickMs);
    this.gitTimer = this.setIntervalFn(() => {
      void this.refreshGit();
    }, this.policy.gitIntervalMs);
    this.subagentsTimer = this.setIntervalFn(() => {
      void this.refreshSubagents();
    }, this.policy.subagentsIntervalMs);
  }

  stop(): void {
    if (this.renderTimer) this.clearIntervalFn(this.renderTimer);
    if (this.gitTimer) this.clearIntervalFn(this.gitTimer);
    if (this.subagentsTimer) this.clearIntervalFn(this.subagentsTimer);
    this.renderTimer = undefined;
    this.gitTimer = undefined;
    this.subagentsTimer = undefined;
    this.running = false;
  }

  close(): void {
    this.closed = true;
    this.stop();
  }

  setHidden(hidden: boolean): void {
    if (this.closed || this.hidden === hidden) return;
    this.hidden = hidden;
    if (hidden) {
      this.stop();
      return;
    }
    this.start();
  }

  getModel(): SidebarModel {
    return this.model;
  }

  render(width: number, theme?: SidebarTheme): string[] {
    return renderSidebar(this.model, width, theme);
  }

  invalidate(): void {
    this.model = { ...this.model };
  }

  private async refreshChat(): Promise<void> {
    try {
      const chat = await this.chatAdapter.load(this.context);
      this.model = {
        ...this.model,
        chat,
        refreshedAt: this.nowIso(),
      };
    } catch {
      this.model = {
        ...this.model,
        chat: this.model.chat.title.trim() ? this.model.chat : { title: 'Current Chat', source: 'fallback' },
        refreshedAt: this.nowIso(),
      };
    } finally {
      this.requestRender();
    }
  }

  private async refreshGit(): Promise<void> {
    if (this.hidden || this.closed || this.gitInFlight) return;
    this.gitInFlight = true;
    try {
      const next = await this.gitAdapter.load(this.context);
      this.model = {
        ...this.model,
        git: preservePreviousOnFailure(this.model.git, next, this.nowIso()),
        refreshedAt: this.nowIso(),
      };
    } catch {
      this.model = {
        ...this.model,
        git: toFailureState(this.model.git, 'git status unavailable', this.nowIso()),
        refreshedAt: this.nowIso(),
      };
    } finally {
      this.gitInFlight = false;
      this.requestRender();
    }
  }

  private async refreshSubagents(): Promise<void> {
    if (this.hidden || this.closed || this.subagentsInFlight) return;
    this.subagentsInFlight = true;
    try {
      const next = await this.subagentsAdapter.load(this.context);
      this.model = {
        ...this.model,
        subagents: preservePreviousOnFailure(this.model.subagents, next, this.nowIso()),
        refreshedAt: this.nowIso(),
      };
    } catch {
      this.model = {
        ...this.model,
        subagents: toFailureState(this.model.subagents, 'subagents unavailable', this.nowIso()),
        refreshedAt: this.nowIso(),
      };
    } finally {
      this.subagentsInFlight = false;
      this.requestRender();
    }
  }

  private async refreshTodo(): Promise<void> {
    if (this.hidden || this.closed || this.todoInFlight) return;
    this.todoInFlight = true;
    try {
      const next = await this.todoAdapter.load(this.context);
      this.model = {
        ...this.model,
        todo: next.kind === 'ready' ? next : undefined,
        refreshedAt: this.nowIso(),
      };
    } catch {
      this.model = {
        ...this.model,
        todo: undefined,
        refreshedAt: this.nowIso(),
      };
    } finally {
      this.todoInFlight = false;
      this.requestRender();
    }
  }

  private requestRender(): void {
    this.requestRenderFn();
  }

  private nowIso(): string {
    return this.context.now().toISOString();
  }
}

function preservePreviousOnFailure<T>(
  previous: SectionState<T>,
  next: SectionState<T>,
  refreshedAt: string,
): SectionState<T> {
  if (next.kind === 'unavailable' || next.kind === 'error') {
    return toFailureState(previous, next.message, refreshedAt);
  }
  return next;
}

function toFailureState<T>(previous: SectionState<T>, message: string, refreshedAt: string): SectionState<T> {
  const previousData = extractPrevious(previous);
  if (!previousData) return { kind: 'unavailable', message, refreshedAt };
  return { kind: 'error', message, refreshedAt, previous: previousData };
}

function extractPrevious<T>(state: SectionState<T>): T | undefined {
  switch (state.kind) {
    case 'ready':
      return state.data;
    case 'loading':
    case 'error':
      return state.previous;
    default:
      return undefined;
  }
}
