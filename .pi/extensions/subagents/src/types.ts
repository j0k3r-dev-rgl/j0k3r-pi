export type SubagentMode = 'task' | 'background';
export type SubagentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type ModelRef = { provider: string; id: string };

export type SubagentDefinition = {
  name: string;
  description: string;
  filePath: string;
  instructions: string;
  model?: ModelRef;
  tools: string[];
};

export type SubagentsConfig = {
  default_model?: ModelRef;
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
  onActivity?: (activity: { message: string; output?: string; prompt?: string; transcript?: string; usage?: UsageStats }) => void;
}) => Promise<{ result: string; model?: string; fallback_used?: boolean; usage?: UsageStats }>;
