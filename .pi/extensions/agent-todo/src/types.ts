export const AGENT_TODO_VERSION = 1;

export const AGENT_TODO_ACTIONS = [
  'create',
  'show',
  'complete_step',
  'complete_all',
  'complete_range',
  'reopen_step',
  'clear',
] as const;

export const AGENT_TODO_ERROR_CODES = [
  'unsupported_action',
  'invalid_input',
  'active_todo_exists',
  'no_active_todo',
  'step_not_found',
] as const;

export const AGENT_TODO_PROVIDER_NAME = 'agent-todo.activeTodo';
export const AGENT_TODO_GLOBAL_PROVIDER_KEY = '__PI_AGENT_TODO_PROVIDER__';

export type AgentTodoAction = (typeof AGENT_TODO_ACTIONS)[number];
export type AgentTodoErrorCode = (typeof AGENT_TODO_ERROR_CODES)[number];
export type AgentTodoStatus = 'active' | 'completed' | 'cleared';
export type AgentTodoStepStatus = 'open' | 'completed';

export type AgentTodoStep = {
  id: string;
  text: string;
  status: AgentTodoStepStatus;
};

export type AgentTodo = {
  id: string;
  title: string;
  body?: string;
  status: AgentTodoStatus;
  steps: AgentTodoStep[];
  created_at: string;
  updated_at: string;
  completed_at?: string;
  cleared_at?: string;
};

export type AgentTodoProjection = {
  active_todo: AgentTodo | null;
  current_todo: AgentTodo | null;
};

export type AgentTodoToolInput = {
  action: string;
  title?: string;
  body?: string;
  steps?: string[];
  step_id?: string;
  start_step_id?: string;
  end_step_id?: string;
  range?: string;
};

export type AgentTodoError = {
  code: AgentTodoErrorCode;
  message: string;
  active_todo_id?: string;
};

export type AgentTodoDetailsV1 = {
  version: typeof AGENT_TODO_VERSION;
  action: AgentTodoAction;
  ok: boolean;
  error?: AgentTodoError;
  state: AgentTodoProjection;
};

export type AgentTodoDetailsEnvelope = {
  agent_todo: AgentTodoDetailsV1;
};

export type AgentTodoToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: AgentTodoDetailsEnvelope;
  isError?: boolean;
};

export type AgentTodoReducerResult = AgentTodoToolResult & {
  nextState: AgentTodoProjection;
  mutated: boolean;
};

export type AgentTodoReducerDeps = {
  now: () => string;
  idGenerator: (kind: 'todo' | 'step', index: number) => string;
};

export type AgentTodoProviderValueV1 = {
  version: 1;
  source: 'agent-todo';
  active_todo: {
    id: string;
    title: string;
    body?: string;
    steps: AgentTodoStep[];
    updated_at: string;
  };
};

export type AgentTodoProvider = {
  name: typeof AGENT_TODO_PROVIDER_NAME;
  getActiveTodo: () => AgentTodoProviderValueV1 | null | Promise<AgentTodoProviderValueV1 | null>;
};
