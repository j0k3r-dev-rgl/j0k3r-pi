import type { SubagentInteractionRequest } from './interaction-channel.js';

export type SubagentMode = 'task' | 'background';
export type SubagentStatus = 'queued' | 'running' | 'stopping' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export type ModelRef = { provider: string; id: string };
export type ThinkingEffort = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type SubagentModelProfile = {
  model?: ModelRef;
  effort?: ThinkingEffort;
};

export type SubagentModelProfiles = Record<string, SubagentModelProfile>;
export type SubagentDefinitionScope = 'global' | 'project';

export type ProfileValueSource = 'profile' | 'definition' | 'default' | 'orchestrator' | 'allocated' | 'unresolved';

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
  subagent_mode?: SubagentMode;
  tools: string[];
  scope?: SubagentDefinitionScope;
};

export type SubagentSessionResources = 'full' | 'lean';

export type SubagentTaskAllocationClaim = (
  signal: AbortSignal,
) => Promise<{ model: { provider: string; id: string }; effort?: ThinkingEffort } | undefined>;

export interface SubagentTaskAllocationEvent {
  taskId: string;
  attempt?: number;
  parentSessionId?: string;
  agent: string;
  cwd: string;
  signal: AbortSignal;
  /** Synchronous registration of an async model allocator */
  claimModel: (allocator: SubagentTaskAllocationClaim) => void;
}

export interface SubagentTaskTerminalEvent {
  taskId: string;
  attempt?: number;
  parentSessionId?: string;
  status: 'completed' | 'failed' | 'cancelled' | 'interrupted';
  error?: string;
  /** Synchronous registration of an async cleanup callback to be awaited before runner settlement completes */
  registerCleanup: (cleanup: () => Promise<void>) => void;
}

export type SubagentsRenderDebugConfig = {
  enabled: true;
  path: string;
};

export type SubagentsConfig = {
  default_model?: ModelRef;
  default_effort?: ThinkingEffort;
  default_mode?: SubagentMode;
  model_profiles: SubagentModelProfiles;
  global_model_profiles?: SubagentModelProfiles;
  project_model_profiles?: SubagentModelProfiles;
  timeout_ms: number;
  stall_timeout_ms: number;
  max_concurrency: number;
  default_tools: string[];
  session_resources?: SubagentSessionResources;
  background_handoff_shortcut?: string;
  history_panel_shortcut?: string;
  detail_cancel_shortcut?: string;
  enable_continue?: boolean;
  debug?: boolean;
  render_debug?: SubagentsRenderDebugConfig;
};

export type SubagentRunInput = {
  name?: string;
  display_name?: string;
  agent?: string;
  agents?: string[];
  task: string;
  context?: string;
  mode?: SubagentMode;
};

export type SubagentContinueInput = {
  task_id: string;
  prompt: string;
  mode?: SubagentMode;
  model?: string;
  effort?: ThinkingEffort;
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

export type SubagentErrorCategory =
  | 'total_timeout'
  | 'stall_timeout'
  | 'cancelled'
  | 'interrupted'
  | 'empty_response_no_tools'
  | 'empty_response_after_tools'
  | 'context_overflow'
  | 'provider_api_error'
  | 'provider_auth_error'
  | 'provider_rate_limit'
  | 'provider_network_error'
  | 'tool_failure'
  | 'fallback_failed'
  | 'unknown_fallback'
  | 'malformed_thrown_value'
  | 'serialization_failure'
  | 'unknown';

export type SubagentErrorPhase =
  | 'runner_invoke'
  | 'runner_session'
  | 'assistant_final'
  | 'tool_execution'
  | 'manager'
  | 'user'
  | 'serializer';

export type SubagentErrorAttemptRole = 'primary' | 'fallback';

export type SubagentErrorMetadata = {
  version: 1;
  category: SubagentErrorCategory;
  message: string;
  retryable: boolean;
  phase?: SubagentErrorPhase;
  code?: string;
  role?: SubagentErrorAttemptRole;
  source?: {
    provider?: string;
    model?: string;
    tool?: string;
    operation?: string;
  };
  cause?: SubagentErrorMetadata;
  attempts?: SubagentErrorMetadata[];
  usage_at_failure?: UsageStats;
  last_activity?: string;
  partial_result_available: boolean;
  task_id?: string;
  parent_session_id?: string;
  details?: Record<string, string>;
};

export type SubagentThreadSnapshot = {
  version: 1;
  created_at?: string;
  updated_at?: string;
  source: 'events' | 'session_messages' | 'mixed';
  items: SubagentThreadItem[];
};

export type SubagentThreadItem =
  | SubagentAttemptItem
  | SubagentAssistantItem
  | SubagentUserItem
  | SubagentToolItem
  | SubagentToolResultItem
  | SubagentBashItem
  | SubagentCustomItem
  | SubagentStatusItem
  | SubagentErrorItem;

export type SubagentAttemptItem = {
  type: 'attempt';
  id?: string;
  attempt: number;
};

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
  label?: 'delegated_task' | 'continuation' | 'context' | 'prompt' | 'user' | 'queued';
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
  taskId?: string;
  getToolDefinition?: (name: string) => unknown;
  getMessageRenderer?: (customType: string) => unknown;
  showImages?: boolean;
  imageWidthCells?: number;
  toolOutputExpanded?: boolean;
  hideThinkingBlock?: boolean;
};

export type SubagentLiveActivity = {
  kind: 'thinking' | 'streaming_response' | 'tool_running' | 'tool_completed' | 'tool_failed';
  label: string;
  tool_names?: string[];
};

export type SubagentLiveActivityProjection = {
  trail: SubagentLiveActivity[];
  current?: SubagentLiveActivity;
};

export type SubagentRunMember = {
  task_id: string;
  agent: string;
  effective_mode: SubagentMode;
  state: SubagentStatus;
};

export type SubagentRunResult = {
  mode: SubagentMode | 'mixed';
  task_ids: string[];
  waited_task_ids: string[];
  background_task_ids: string[];
  results?: SubagentTask[];
  members?: SubagentRunMember[];
};

export type LiveSteeringBridge = {
  detected_pi_version: string | 'unknown';
  supported: boolean;
  steer(message: string): void;
};

export type SendMessageResult =
  | {
      status: 'queued';
      task_id: string;
      pending_message_count: number;
      message: 'Message accepted into the steering queue; this does not prove model consumption.';
    }
  | {
      status: 'rejected';
      task_id?: string;
      reason:
        | 'unsupported_runtime'
        | 'caller_identity_unavailable'
        | 'not_owner'
        | 'unknown_task'
        | 'not_running'
        | 'not_background'
        | 'missing_live_session'
        | 'empty_message'
        | 'message_too_large'
        | 'queue_count_limit'
        | 'queue_bytes_limit'
        | 'enqueue_failed';
      required_pi_version?: '>=0.82.1';
      detected_pi_version?: string | 'unknown';
      message: string;
    };

export type SubagentTask = {
  id: string;
  display_name?: string;
  agent: string;
  mode: SubagentMode;
  effective_mode?: SubagentMode;
  status: SubagentStatus;
  task: string;
  context?: string;
  created_at: string;
  attempt?: number;
  session_id?: string;
  nested_session_path?: string;
  started_at?: string;
  ended_at?: string;
  last_activity_at?: string;
  last_activity?: string;
  output_preview?: string;
  pending_message_count?: number;
  undelivered_message_count?: number;
  live_activity?: SubagentLiveActivityProjection;
  prompt?: string;
  continuation_prompt?: string;
  system_prompt?: string;
  transcript?: string;
  usage?: UsageStats;
  model?: string;
  effort?: ThinkingEffort;
  model_source?: ProfileValueSource;
  effort_source?: ProfileValueSource;
  fallback_used?: boolean;
  error?: string;
  error_metadata?: SubagentErrorMetadata;
  result?: string;
  thread_snapshot?: SubagentThreadSnapshot;
  interaction_request?: SubagentInteractionRequest;
  stop_reason?: string;
  pi_retry_attempts?: number;
};

export type SubagentRunner = (input: {
  definition: SubagentDefinition;
  task: string;
  taskId?: string;
  parentPiSessionId?: string;
  context?: string;
  cwd: string;
  ctx: any;
  config: SubagentsConfig;
  signal: AbortSignal;
  effectiveProfile?: EffectiveSubagentProfile;
  nested_session_path?: string;
  continuation?: { prompt: string; attempt: number; previous_snapshot?: SubagentThreadSnapshot };
  registerLiveBridge?: (bridge: LiveSteeringBridge) => void;
  clearLiveBridge?: () => void;
  onQueuedMessageStart?: () => void;
  onActivity?: (activity: { message: string; output?: string; prompt?: string; system_prompt?: string; transcript?: string; usage?: UsageStats; effort?: ThinkingEffort; thread_snapshot?: SubagentThreadSnapshot; interaction_request?: SubagentInteractionRequest; nested_session_path?: string; pi_retry_attempts?: number; live_activity?: SubagentLiveActivityProjection }) => void;
}) => Promise<{ result: string; model?: string; effort?: ThinkingEffort; fallback_used?: boolean; usage?: UsageStats; error_metadata?: SubagentErrorMetadata; thread_snapshot?: SubagentThreadSnapshot; interaction_request?: SubagentInteractionRequest; system_prompt?: string; nested_session_path?: string }>;
