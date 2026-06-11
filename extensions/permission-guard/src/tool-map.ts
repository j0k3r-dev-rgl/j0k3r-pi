import { classifyPathTarget, resolveWorkspaceRoot } from './path-policy.js';
import type { Action, PermissionPolicyConfig, PermissionRequest, PermissionSource, RequestOrigin } from './types.js';

export type BuiltinPermissionTool = 'read' | 'write' | 'edit' | 'grep' | 'find' | 'ls' | 'bash' | 'user_bash';

export interface MapBuiltinToolInputOptions {
  tool: BuiltinPermissionTool;
  input: unknown;
  cwd: string;
  config: PermissionPolicyConfig;
  mode: string;
  hasUI: boolean;
  policyIdentity: string;
  timestamp?: string;
  origin?: RequestOrigin;
  requester?: PermissionRequest['requester'];
}

type InputObject = Record<string, unknown>;

function isInputObject(input: unknown): input is InputObject {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function stringField(input: InputObject, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = input[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function pathTargetForTool(tool: BuiltinPermissionTool, input: unknown): string | undefined {
  if (!isInputObject(input)) return undefined;

  switch (tool) {
    case 'read':
    case 'write':
    case 'edit':
      return stringField(input, ['path', 'file_path', 'filePath']);
    case 'grep':
      return stringField(input, ['path', 'root', 'directory', 'dir', 'cwd']) ?? '.';
    case 'find':
    case 'ls':
      return stringField(input, ['path', 'root', 'directory', 'dir']) ?? '.';
    default:
      return undefined;
  }
}

function commandForTool(tool: BuiltinPermissionTool, input: unknown): string | undefined {
  if (tool !== 'bash' && tool !== 'user_bash') return undefined;
  if (typeof input === 'string') return input;
  if (isInputObject(input)) return stringField(input, ['command', 'cmd', 'raw']);
  return undefined;
}

function sourceForTool(tool: BuiltinPermissionTool): PermissionSource {
  return tool === 'user_bash' ? 'user_bash' : 'tool_call';
}

function stableId(tool: BuiltinPermissionTool, timestamp: string): string {
  const safeTimestamp = timestamp.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) || 'request';
  return `permission-${tool}-${safeTimestamp}`;
}

function safeCommandSummary(command: string, maxLength: number): string {
  if (command.length <= maxLength) return command;
  return `${command.slice(0, Math.max(0, maxLength - 1))}…`;
}

function summaryForPath(tool: BuiltinPermissionTool, action: Action, rawPath: string): string {
  if (tool === 'write') return `write ${action} ${rawPath}`;
  if (tool === 'edit') return `edit ${rawPath}`;
  return `${tool} ${action} ${rawPath}`;
}

export async function mapBuiltinToolInput(options: MapBuiltinToolInputOptions): Promise<PermissionRequest> {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const command = commandForTool(options.tool, options.input);

  if (command !== undefined) {
    const summary = safeCommandSummary(command, options.config.bash.maxCommandPreviewChars);
    return {
      id: stableId(options.tool, timestamp),
      source: sourceForTool(options.tool),
      origin: options.origin ?? 'main',
      requester: options.requester,
      tool: options.tool,
      action: 'bash',
      rawInputSummary: `${options.tool} ${summary}`,
      command: {
        raw: command,
        summary,
      },
      executionContext: {
        cwd: options.cwd,
        workspaceRoot: resolveWorkspaceRoot({ cwd: options.cwd, config: options.config }),
        policyIdentity: options.policyIdentity,
      },
      mode: options.mode,
      hasUI: options.hasUI,
      policyIdentity: options.policyIdentity,
      timestamp,
    };
  }

  const rawPath = pathTargetForTool(options.tool, options.input);
  if (!rawPath) {
    throw new Error(`cannot map ${options.tool} input: missing path or command`);
  }

  const preliminaryAction: Action =
    options.tool === 'read'
      ? 'read'
      : options.tool === 'edit'
        ? 'edit'
        : options.tool === 'grep'
          ? 'search'
          : options.tool === 'find' || options.tool === 'ls'
            ? 'list'
            : 'write';

  const target = await classifyPathTarget(rawPath, {
    cwd: options.cwd,
    config: options.config,
    forCreate: options.tool === 'write',
  });
  const action: Action = options.tool === 'write' ? (target.exists ? 'write' : 'create') : preliminaryAction;

  return {
    id: stableId(options.tool, timestamp),
    source: sourceForTool(options.tool),
    origin: options.origin ?? 'main',
    requester: options.requester,
    tool: options.tool,
    action,
    rawInputSummary: summaryForPath(options.tool, action, rawPath),
    target,
    mode: options.mode,
    hasUI: options.hasUI,
    policyIdentity: options.policyIdentity,
    timestamp,
  };
}
