import type { PermissionRequiredPayload } from '../../permission-guard/src/types.js';

export type SubagentMode = 'task' | 'background';
export type SubagentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type ModelRef = { provider: string; id: string };
export type ThinkingEffort = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export type SubagentModelProfile = {
  model?: ModelRef;
  effort?: ThinkingEffort;
};

export type SubagentModelProfiles = Record<string, SubagentModelProfile>;

export type ProfileValueSource = 'profile' | 'definition' | 'default' | 'orchestrator' | 'unresolved';

export type ResolvedProfileField<T> = {
  value?: T;
  source: ProfileValueSource;
  label: string;
};

export type EffectiveSubagentProfile = {
  agent: string;
  model: ResolvedProfileField<ModelRef>;
  effort: ResolvedProfileField<ThinkingEffort>;
};

export type SubagentDefinition = {
  name: string;
  description: string;
  filePath: string;
  instructions: string;
  model?: ModelRef;
  effort?: ThinkingEffort;
  tools: string[];
};

export type SubagentsConfig = {
  default_model?: ModelRef;
  default_effort?: ThinkingEffort;
  model_profiles: SubagentModelProfiles;
  timeout_ms: number;
  stall_timeout_ms: number;
  max_concurrency: number;
  default_tools: string[];
};

export type SubagentRunInput = {
  agent?: string;
  agents?: string[];
  task: string;
  context?: string;
  mode?: SubagentMode;
};

export type UsageStats = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
};

export type SubagentThreadSnapshot = {
  version: 1;
  created_at?: string;
  updated_at?: string;
  source: 'events' | 'session_messages' | 'mixed';
  items: SubagentThreadItem[];
};

export type SubagentThreadItem =
  | SubagentAssistantItem
  | SubagentUserItem
  | SubagentToolItem
  | SubagentToolResultItem
  | SubagentBashItem
  | SubagentCustomItem
  | SubagentStatusItem
  | SubagentErrorItem;

export type SubagentAssistantItem = {
  type: 'assistant';
  id?: string;
  message: {
    role: 'assistant';
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'thinking'; text?: string; thinking?: string }
      | { type: 'toolCall'; id: string; name: string; arguments: unknown }
    >;
    stopReason?: string;
    errorMessage?: string;
    usage?: unknown;
  };
};

export type SubagentUserItem = {
  type: 'user';
  id?: string;
  text: string;
  label?: 'delegated_task' | 'context' | 'prompt' | 'user';
};

export type SubagentToolResultPayload = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  details?: unknown;
  isError: boolean;
  preview?: string;
};

export type SubagentToolItem = {
  type: 'tool';
  id?: string;
  tool_call_id?: string;
  name: string;
  arguments?: unknown;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'partial';
  result?: SubagentToolResultPayload;
  started_at?: string;
  ended_at?: string;
};

export type SubagentToolResultItem = {
  type: 'tool_result';
  id?: string;
  tool_call_id?: string;
  name?: string;
  result: SubagentToolResultPayload;
};

export type SubagentBashItem = {
  type: 'bash';
  id?: string;
  tool_call_id?: string;
  command: string;
  output?: string;
  exitCode?: number;
  cancelled?: boolean;
  truncated?: boolean;
  fullOutputPath?: string;
  status?: 'running' | 'completed' | 'failed' | 'cancelled';
};

export type SubagentCustomItem = {
  type: 'custom';
  id?: string;
  customType: string;
  content?: unknown;
  display?: boolean;
  fallbackText?: string;
};

export type SubagentStatusItem = {
  type: 'status';
  text: string;
  severity?: 'info' | 'success' | 'warning';
};

export type SubagentErrorItem = {
  type: 'error';
  text: string;
};

export type SubagentThreadRenderContext = {
  theme?: any;
  tui?: any;
  cwd: string;
  visibleWidth: (text: string) => number;
  truncateToWidth: (text: string, width: number) => string;
  renderWidth?: number;
  getToolDefinition?: (name: string) => unknown;
  getMessageRenderer?: (customType: string) => unknown;
  showImages?: boolean;
  imageWidthCells?: number;
  toolOutputExpanded?: boolean;
};

export type SubagentTask = {
  id: string;
  agent: string;
  mode: SubagentMode;
  status: SubagentStatus;
  task: string;
  context?: string;
  created_at: string;
  session_id?: string;
  started_at?: string;
  ended_at?: string;
  last_activity_at?: string;
  last_activity?: string;
  output_preview?: string;
  prompt?: string;
  transcript?: string;
  usage?: UsageStats;
  model?: string;
  effort?: ThinkingEffort;
  model_source?: ProfileValueSource;
  effort_source?: ProfileValueSource;
  fallback_used?: boolean;
  error?: string;
  result?: string;
  thread_snapshot?: SubagentThreadSnapshot;
  permission_request?: PermissionRequiredPayload;
};

export type SubagentRunner = (input: {
  definition: SubagentDefinition;
  task: string;
  context?: string;
  cwd: string;
  ctx: any;
  config: SubagentsConfig;
  signal: AbortSignal;
  effectiveProfile?: EffectiveSubagentProfile;
  onActivity?: (activity: { message: string; output?: string; prompt?: string; transcript?: string; usage?: UsageStats; effort?: ThinkingEffort; thread_snapshot?: SubagentThreadSnapshot; permission_request?: PermissionRequiredPayload }) => void;
}) => Promise<{ result: string; model?: string; effort?: ThinkingEffort; fallback_used?: boolean; usage?: UsageStats; thread_snapshot?: SubagentThreadSnapshot; permission_request?: PermissionRequiredPayload }>;
