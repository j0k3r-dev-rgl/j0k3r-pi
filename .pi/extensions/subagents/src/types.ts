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

export type SubagentTask = {
  id: string;
  agent: string;
  mode: SubagentMode;
  status: SubagentStatus;
  task: string;
  context?: string;
  created_at: string;
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
  onActivity?: (activity: { message: string; output?: string; prompt?: string; transcript?: string; usage?: UsageStats; effort?: ThinkingEffort }) => void;
}) => Promise<{ result: string; model?: string; effort?: ThinkingEffort; fallback_used?: boolean; usage?: UsageStats }>;
