import { AuthenticatedTelegramCommandInput, CommandResult, PiSessionRef, TelegramCommandInput, WorkspaceRef, AuditEvent, TelegramCommandDeniedResult } from './types.js';
import type { BindingManager, PiTrustValidator, TelegramApprovalChoice, WorkspaceRegistry } from './types.js';
import type { TelegramPermissionApprovalStore } from './permission-approval-store.js';

export interface CommandRouterSessionIndex {
  listWorkspaceSessions(workspaceRoot: string): Promise<PiSessionRef[]>;
}

export interface CommandRouterDependencies {
  workspaceRegistry: WorkspaceRegistry;
  trustValidator: PiTrustValidator;
  bindings: BindingManager;
  sessionIndex: CommandRouterSessionIndex;
  openSession: (workspace: WorkspaceRef, requestedSession?: PiSessionRef) => Promise<PiSessionRef>;
  createSession: (workspace: WorkspaceRef, sessionName?: string) => Promise<PiSessionRef>;
  closeSession?: (binding: import('./types.js').ActiveBinding) => Promise<void>;
  permissionStore?: TelegramPermissionApprovalStore;
  answerPermission?: (binding: import('./types.js').ActiveBinding, requestId: string, choice: TelegramApprovalChoice) => Promise<import('./types.js').PermissionAnswerResult>;
  sendPrompt: (binding: import('./types.js').ActiveBinding, message: string) => Promise<void>;
  sendSteer: (binding: import('./types.js').ActiveBinding, message: string) => Promise<void>;
  sendFollowup: (binding: import('./types.js').ActiveBinding, message: string) => Promise<void>;
  sendAbort: (binding: import('./types.js').ActiveBinding) => Promise<void>;
  nowMs?: () => number;
  defaultArmDurationSeconds?: number;
  maxArmDurationSeconds?: number;
  maxPromptChars?: number;
  audit?: (entry: Omit<AuditEvent, 'version' | 'timestamp'>) => Promise<void> | void;
}

const DEFAULT_ARM_SECONDS = 300;
const DEFAULT_MAX_PROMPT_CHARS = 4096;

function nowMsProvider(options: CommandRouterDependencies): () => number {
  return options.nowMs ?? (() => Date.now());
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function parseDuration(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

type DeniedReason = TelegramCommandDeniedResult['reason'];

function makeDenied(text: string, reason: DeniedReason = 'invalid_update') {
  return {
    kind: 'denied',
    text,
    reason,
  } satisfies CommandResult;
}

function buildActor(identity: AuthenticatedTelegramCommandInput['identity']) {
  return {
    userId: identity.userId,
    chatId: identity.chatId,
    ...(identity.username ? { username: identity.username } : {}),
  };
}

function sanitizeWorkspace(workspace: WorkspaceRef | undefined): string | undefined {
  return workspace?.id;
}

function limitPrompt(value: string, maxPromptChars: number): { ok: true } | { ok: false; reason: string } {
  if (maxPromptChars <= 0) {
    return { ok: true };
  }

  if (value.length <= maxPromptChars) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: `Message exceeds policy.maxPromptChars (${maxPromptChars} chars).`,
  };
}

function previewText(value: string, maxChars = 0): string | undefined {
  if (!maxChars || maxChars <= 0) return undefined;
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars))}...`;
}

function approvalChoiceFor(scope?: 'once' | 'session' | 'project' | 'file' | 'folder'): TelegramApprovalChoice {
  switch (scope) {
    case 'session':
      return 'Allow for session';
    case 'project':
      return 'Allow for project';
    case 'file':
      return 'Allow this file for project';
    case 'folder':
      return 'Allow this folder for project';
    case 'once':
    default:
      return 'Allow once';
  }
}

function normalizeApprovalScope(value?: string): 'once' | 'session' | 'project' | 'file' | 'folder' | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'once' || normalized === 'session' || normalized === 'project' || normalized === 'file' || normalized === 'folder') {
    return normalized;
  }
  return undefined;
}

export function parseCommandInput(input: TelegramCommandInput): AuthenticatedTelegramCommandInput {
  if (input.kind === 'text') {
    const text = input.rawText ?? input.text;
    const trimmed = text.trim();
    if (!trimmed) {
      return { kind: 'prompt', identity: input.identity, message: '' };
    }

    if (!trimmed.startsWith('/')) {
      return { kind: 'prompt', identity: input.identity, message: trimmed };
    }

    const [command, ...args] = trimmed.slice(1).trim().split(/\s+/);
    const normalized = command.toLowerCase();

    switch (normalized) {
      case 'start':
        return { kind: 'start', identity: input.identity, };
      case 'status':
        return { kind: 'status', identity: input.identity, };
      case 'workspaces':
        return { kind: 'workspaces', identity: input.identity };
      case 'open': {
        return {
          kind: 'open',
          identity: input.identity,
          workspaceId: args[0] ?? '',
          sessionId: args[1],
        };
      }
      case 'sessions':
        return {
          kind: 'sessions',
          identity: input.identity,
          workspaceId: args[0],
        };
      case 'new': {
        const [workspaceId, ...nameParts] = args;
        return {
          kind: 'new',
          identity: input.identity,
          workspaceId,
          sessionName: nameParts.length > 0 ? nameParts.join(' ') : undefined,
        };
      }
      case 'arm':
        return {
          kind: 'arm',
          identity: input.identity,
          durationSeconds: parseDuration(args[0]),
        };
      case 'disarm':
        return { kind: 'disarm', identity: input.identity };
      case 'close':
        return { kind: 'close', identity: input.identity };
      case 'abort':
        return { kind: 'abort', identity: input.identity };
      case 'steer':
        return {
          kind: 'steer',
          identity: input.identity,
          message: args.join(' '),
        };
      case 'followup':
        return {
          kind: 'followup',
          identity: input.identity,
          message: args.join(' '),
        };
      case 'approve':
        return {
          kind: 'approve',
          identity: input.identity,
          requestId: args[0] ?? '',
          scope: normalizeApprovalScope(args[1]),
        };
      case 'deny':
        return {
          kind: 'deny',
          identity: input.identity,
          requestId: args[0] ?? '',
        };
      case 'permissions':
        return { kind: 'permissions', identity: input.identity };
      default:
        return { kind: 'prompt', identity: input.identity, message: trimmed };
    }
  }

  const args = [...input.args];
  switch (input.command) {
    case 'start':
      return { kind: 'start', identity: input.identity };
    case 'status':
      return { kind: 'status', identity: input.identity };
    case 'workspaces':
      return { kind: 'workspaces', identity: input.identity };
    case 'open': {
      const [workspaceId, sessionId] = args;
      return {
        kind: 'open',
        identity: input.identity,
        workspaceId: workspaceId ?? '',
        sessionId,
      };
    }
    case 'sessions':
      return { kind: 'sessions', identity: input.identity, workspaceId: args[0] };
    case 'new': {
      const [workspaceId, ...nameParts] = args;
      return {
        kind: 'new',
        identity: input.identity,
        workspaceId,
        sessionName: nameParts.join(' '),
      };
    }
    case 'arm':
      return { kind: 'arm', identity: input.identity, durationSeconds: parseDuration(args[0]) };
    case 'disarm':
      return { kind: 'disarm', identity: input.identity };
    case 'close':
      return { kind: 'close', identity: input.identity };
    case 'abort':
      return { kind: 'abort', identity: input.identity };
    case 'steer':
      return { kind: 'steer', identity: input.identity, message: args.join(' ') };
    case 'followup':
      return { kind: 'followup', identity: input.identity, message: args.join(' ') };
    case 'approve':
      return { kind: 'approve', identity: input.identity, requestId: args[0] ?? '', scope: normalizeApprovalScope(args[1]) };
    case 'deny':
      return { kind: 'deny', identity: input.identity, requestId: args[0] ?? '' };
    case 'permissions':
      return { kind: 'permissions', identity: input.identity };
    default:
      return {
        kind: 'prompt',
        identity: input.identity,
        message: input.rawText,
      };
  }}

function workspaceSelectionFromArgument(arg?: string) {
  return arg && arg.trim().length > 0 ? arg.trim() : undefined;
}

function formatBindingState(binding?: import('./types.js').ActiveBinding, nowMs?: number): string {
  if (!binding) {
    return 'No active workspace/session binding.';
  }

  const armedUntil = binding.armedUntil;
  const armed = typeof armedUntil === 'number' && armedUntil > (nowMs ?? Date.now());
  const armedState = armed ? `Armed until ${new Date(armedUntil).toISOString()}` : 'Not armed';
  const sessionRef = binding.sessionId ?? binding.sessionFile ?? 'no session';

  return [
    `Workspace: ${binding.workspace.id}`,
    `Session: ${sessionRef}`,
    armedState,
  ].join('\n');
}

export class CommandRouter {
  private readonly dependencies: CommandRouterDependencies;

  constructor(dependencies: CommandRouterDependencies) {
    this.dependencies = {
      defaultArmDurationSeconds: DEFAULT_ARM_SECONDS,
      maxPromptChars: DEFAULT_MAX_PROMPT_CHARS,
      ...dependencies,
    };
  }

  private async recordAudit(entry: Omit<AuditEvent, 'version' | 'timestamp'>): Promise<void> {
    if (!this.dependencies.audit) {
      return;
    }

    try {
      await this.dependencies.audit(entry);
    } catch {
      // Audit failures are non-blocking.
    }
  }

  async handle(input: TelegramCommandInput): Promise<CommandResult> {
    const parsed = parseCommandInput(input);
    return this.handleAuthorized(parsed);
  }

  async handleAuthorized(input: AuthenticatedTelegramCommandInput): Promise<CommandResult> {
    const { identity } = input;
    const nowMs = nowMsProvider(this.dependencies);

    switch (input.kind) {
      case 'start':
        return {
          kind: 'ok',
          text: 'telegram control ready. Use /workspaces to begin.',
        };

      case 'status': {
        const binding = this.dependencies.bindings.get(identity.chatId);
        return {
          kind: 'ok',
          text: formatBindingState(binding, nowMs()),
        };
      }

      case 'workspaces': {
        const workspaces = await this.dependencies.workspaceRegistry.listAuthorizedWorkspaces(identity);
        const allowed: string[] = [];

        for (const workspace of workspaces) {
          const trust = await this.dependencies.trustValidator.validate(workspace.canonicalRoot);
          if (!trust.trusted) continue;
          allowed.push(`${workspace.label} (${workspace.id}) — ${workspace.canonicalRoot}`);
        }

        await this.recordAudit({
          event: 'workspace_query',
          decision: 'observe',
          reason: 'available workspaces listed',
          action: 'workspaces',
          actor: buildActor(identity),
          command: '/workspaces',
          metadata: {
            total: workspaces.length,
            trusted: allowed.length,
          },
        });

        if (allowed.length === 0) {
          return {
            kind: 'ok',
            text: 'No workspaces available.',
          };
        }

        return {
          kind: 'ok',
          text: `Available workspaces:\n${allowed.join('\n')}`,
        };
      }

      case 'open': {
        if (!input.workspaceId) {
          await this.recordAudit({
            event: 'binding_change',
            decision: 'deny',
            reason: 'missing workspace argument',
            action: 'open',
            actor: buildActor(identity),
            command: '/open',
            metadata: {
              workspace: undefined,
            },
          });
          return makeDenied('You must provide a workspace id.');
        }

        const target = workspaceSelectionFromArgument(input.workspaceId);
        if (!target) {
          await this.recordAudit({
            event: 'binding_change',
            decision: 'deny',
            reason: 'invalid workspace argument',
            action: 'open',
            actor: buildActor(identity),
            command: '/open',
          });
          return makeDenied('You must provide a workspace id.');
        }

        const decision = await this.dependencies.workspaceRegistry.resolveWorkspace(target, identity);
        if (!decision.ok) {
          await this.recordAudit({
            event: 'binding_change',
            decision: 'deny',
            reason: decision.reason === 'ambiguous' ? 'ambiguous workspace selector' : 'workspace not allowlisted',
            action: 'open',
            actor: buildActor(identity),
            command: '/open',
            metadata: {
              selector: target,
            },
          });
          return {
            kind: 'error',
            text: decision.reason === 'ambiguous'
              ? 'Multiple workspaces match that selector.'
              : 'Requested workspace is not allowlisted.',
          };
        }

        const trust = await this.dependencies.trustValidator.validate(decision.workspace.canonicalRoot);
        if (!trust.trusted) {
          await this.recordAudit({
            event: 'binding_change',
            decision: 'deny',
            reason: 'workspace not trusted',
            action: 'open',
            actor: buildActor(identity),
            workspace: decision.workspace.id,
            command: '/open',
            metadata: {
              selector: target,
            },
          });
          return {
            kind: 'error',
            text: 'Workspace is not currently trusted.',
          };
        }

        const workspace = decision.workspace;
        let selectedSession: PiSessionRef | undefined;

        if (input.sessionId) {
          const sessions = await this.dependencies.sessionIndex.listWorkspaceSessions(workspace.canonicalRoot);
          const wanted = input.sessionId;
          selectedSession = sessions.find((candidate) =>
            candidate.sessionId === wanted
            || candidate.sessionFile === wanted
            || candidate.sessionName === wanted,
          );

          if (!selectedSession) {
            await this.recordAudit({
              event: 'binding_change',
              decision: 'deny',
              reason: 'session not found',
              action: 'open',
              actor: buildActor(identity),
              workspace: sanitizeWorkspace(workspace),
              command: '/open',
              metadata: {
                sessionRef: wanted,
              },
            });
            return {
              kind: 'error',
              text: 'Requested session not found for workspace.',
            };
          }
        }

        const openedSession = await this.dependencies.openSession(workspace, selectedSession);
        const binding = this.dependencies.bindings.bind(identity.chatId, workspace, openedSession);

        await this.recordAudit({
          event: 'binding_change',
          decision: 'allow',
          reason: 'binding updated',
          action: 'open',
          actor: buildActor(identity),
          workspace: sanitizeWorkspace(binding.workspace),
          sessionId: binding.sessionId,
          sessionFile: binding.sessionFile,
          command: '/open',
          metadata: {
            sessionName: openedSession.sessionName,
            requestedSession: selectedSession,
          },
        });

        return {
          kind: 'ok',
          text: `Workspace ${workspace.id} is now active.`,
        };
      }

      case 'sessions': {
        let workspace = (await this.getBoundWorkspace(identity.chatId))?.workspace;
        if (input.workspaceId) {
          const decision = await this.dependencies.workspaceRegistry.resolveWorkspace(input.workspaceId, identity);
          if (!decision.ok) {
            await this.recordAudit({
              event: 'session_query',
              decision: 'deny',
              reason: 'workspace not allowlisted',
              action: 'sessions',
              actor: buildActor(identity),
              command: '/sessions',
              workspace: input.workspaceId,
            });
            return {
              kind: 'error',
              text: 'Requested workspace is not allowlisted.',
            };
          }

          const trust = await this.dependencies.trustValidator.validate(decision.workspace.canonicalRoot);
          if (!trust.trusted) {
            await this.recordAudit({
              event: 'session_query',
              decision: 'deny',
              reason: 'workspace not trusted',
              action: 'sessions',
              actor: buildActor(identity),
              workspace: sanitizeWorkspace(decision.workspace),
              command: '/sessions',
            });
            return {
              kind: 'error',
              text: 'Workspace is not currently trusted.',
            };
          }
          workspace = decision.workspace;
        }

        if (!workspace) {
          await this.recordAudit({
            event: 'session_query',
            decision: 'deny',
            reason: 'no active binding',
            action: 'sessions',
            actor: buildActor(identity),
            command: '/sessions',
          });
          return makeDenied('Open a workspace first.');
        }

        const sessions = await this.dependencies.sessionIndex.listWorkspaceSessions(workspace.canonicalRoot);
        if (sessions.length === 0) {
          await this.recordAudit({
            event: 'session_query',
            decision: 'observe',
            reason: 'no sessions',
            action: 'sessions',
            actor: buildActor(identity),
            workspace: sanitizeWorkspace(workspace),
            command: '/sessions',
          });
          return {
            kind: 'ok',
            text: 'No sessions found for workspace.',
          };
        }

        await this.recordAudit({
          event: 'session_query',
          decision: 'observe',
          reason: 'sessions listed',
          action: 'sessions',
          actor: buildActor(identity),
          workspace: sanitizeWorkspace(workspace),
          command: '/sessions',
          metadata: {
            count: sessions.length,
          },
        });

        const lines = sessions.map((session) =>
          session.sessionName ? `${session.sessionId} (${session.sessionName})` : `${session.sessionId}`,
        );
        return {
          kind: 'ok',
          text: `Available sessions:\n${lines.join('\n')}`,
        };
      }

      case 'new': {
        let workspace: WorkspaceRef | undefined;

        const directWorkspace = workspaceSelectionFromArgument(input.workspaceId);
        if (directWorkspace) {
          const decision = await this.dependencies.workspaceRegistry.resolveWorkspace(directWorkspace, identity);
          if (!decision.ok) {
            await this.recordAudit({
              event: 'binding_change',
              decision: 'deny',
              reason: 'workspace not allowlisted',
              action: 'new',
              actor: buildActor(identity),
              command: '/new',
              metadata: {
                selector: directWorkspace,
              },
            });
            return {
              kind: 'error',
              text: 'Requested workspace is not allowlisted.',
            };
          }

          workspace = decision.workspace;
        } else {
          workspace = (await this.getBoundWorkspace(identity.chatId))?.workspace;
        }

        if (!workspace) {
          await this.recordAudit({
            event: 'binding_change',
            decision: 'deny',
            reason: 'no active workspace to create session',
            action: 'new',
            actor: buildActor(identity),
            command: '/new',
          });
          return makeDenied('Open or specify a workspace before creating a new session.');
        }

        const trust = await this.dependencies.trustValidator.validate(workspace.canonicalRoot);
        if (!trust.trusted) {
          await this.recordAudit({
            event: 'binding_change',
            decision: 'deny',
            reason: 'workspace not trusted',
            action: 'new',
            actor: buildActor(identity),
            workspace: sanitizeWorkspace(workspace),
            command: '/new',
          });
          return {
            kind: 'error',
            text: 'Workspace is not currently trusted.',
          };
        }

        const created = await this.dependencies.createSession(workspace, input.sessionName);
        const binding = this.dependencies.bindings.bind(identity.chatId, workspace, created);

        await this.recordAudit({
          event: 'binding_change',
          decision: 'allow',
          reason: 'new binding created',
          action: 'new',
          actor: buildActor(identity),
          workspace: sanitizeWorkspace(binding.workspace),
          sessionId: binding.sessionId,
          sessionFile: binding.sessionFile,
          command: '/new',
          metadata: {
            sessionName: created.sessionName,
          },
        });

        return {
          kind: 'ok',
          text: `Created new session for ${workspace.id}.`,
        };
      }

      case 'arm': {
        const binding = this.dependencies.bindings.get(identity.chatId);
        if (!binding) {
          await this.recordAudit({
            event: 'arm_state',
            decision: 'deny',
            reason: 'no active binding',
            action: 'arm',
            actor: buildActor(identity),
            command: '/arm',
          });
          return makeDenied('No active binding. Open a workspace first.');
        }

        const defaultDuration = this.dependencies.defaultArmDurationSeconds ?? DEFAULT_ARM_SECONDS;
        const maxDuration = this.dependencies.maxArmDurationSeconds ?? defaultDuration;
        const requestedDuration = input.durationSeconds ?? defaultDuration;
        const safeDuration = clamp(requestedDuration, 1, maxDuration);

        const armed = this.dependencies.bindings.arm(identity.chatId, nowMs(), safeDuration * 1000);
        await this.recordAudit({
          event: 'arm_state',
          decision: 'allow',
          reason: 'binding armed',
          action: 'arm',
          actor: buildActor(identity),
          workspace: sanitizeWorkspace(binding.workspace),
          sessionId: binding.sessionId,
          sessionFile: binding.sessionFile,
          command: '/arm',
          metadata: {
            durationSeconds: safeDuration,
            armedUntil: armed.armedUntil,
          },
        });

        return {
          kind: 'ok',
          text: `Armed for ${safeDuration} seconds (until ${new Date(armed.armedUntil ?? 0).toISOString()}).`,
        };
      }

      case 'disarm': {
        const binding = this.dependencies.bindings.get(identity.chatId);
        if (!binding) {
          await this.recordAudit({
            event: 'arm_state',
            decision: 'deny',
            reason: 'no active binding',
            action: 'disarm',
            actor: buildActor(identity),
            command: '/disarm',
          });
          return makeDenied('No active binding to disarm.');
        }

        this.dependencies.bindings.disarm(identity.chatId);
        await this.recordAudit({
          event: 'arm_state',
          decision: 'allow',
          reason: 'binding disarmed',
          action: 'disarm',
          actor: buildActor(identity),
          workspace: sanitizeWorkspace(binding.workspace),
          sessionId: binding.sessionId,
          sessionFile: binding.sessionFile,
          command: '/disarm',
        });
        return {
          kind: 'ok',
          text: 'Binding disarmed.',
        };
      }

      case 'close': {
        const binding = this.dependencies.bindings.get(identity.chatId);
        if (!binding) {
          await this.recordAudit({
            event: 'binding_change',
            decision: 'deny',
            reason: 'no active binding',
            action: 'close',
            actor: buildActor(identity),
            command: '/close',
          });
          return makeDenied('No active binding to close.');
        }

        await this.dependencies.closeSession?.(binding);
        this.dependencies.bindings.unbind(identity.chatId);
        await this.recordAudit({
          event: 'binding_change',
          decision: 'allow',
          reason: 'binding closed',
          action: 'close',
          actor: buildActor(identity),
          workspace: sanitizeWorkspace(binding.workspace),
          sessionId: binding.sessionId,
          sessionFile: binding.sessionFile,
          command: '/close',
        });
        return {
          kind: 'ok',
          text: 'Session closed.',
        };
      }

      case 'permissions': {
        const binding = this.dependencies.bindings.get(identity.chatId);
        if (!binding) {
          return makeDenied('No active binding. Open a workspace first.');
        }
        const pending = this.dependencies.permissionStore?.list(identity.chatId, binding) ?? [];
        if (pending.length === 0) {
          return { kind: 'ok', text: 'No pending permission requests.' };
        }
        const lines = pending.map((request) => `${request.requestId}: ${request.title} — ${request.reasonCode} — expires ${request.expiresAt}`);
        return { kind: 'ok', text: `Pending permissions:\n${lines.join('\n')}` };
      }

      case 'approve': {
        const binding = this.dependencies.bindings.get(identity.chatId);
        if (!binding) return makeDenied('No active binding. Open a workspace first.');
        if (!input.requestId) return makeDenied('Usage: /approve <request-id> [once|session|project|file|folder].');

        const pending = this.dependencies.permissionStore?.get(identity.chatId, binding, input.requestId);
        if (!pending) {
          await this.recordAudit({
            event: 'permission_approval',
            decision: 'deny',
            reason: 'pending permission request not found',
            action: 'approve',
            actor: buildActor(identity),
            workspace: sanitizeWorkspace(binding.workspace),
            sessionId: binding.sessionId,
            sessionFile: binding.sessionFile,
            command: '/approve',
            metadata: { requestId: input.requestId },
          });
          return { kind: 'error', text: 'No matching pending permission request.' };
        }

        const choice = approvalChoiceFor(input.scope);
        if (!pending.choices.includes(choice)) {
          return { kind: 'error', text: `Approval choice is not available for this request. Available: ${pending.choices.join(', ')}` };
        }
        const result = await this.dependencies.answerPermission?.(binding, input.requestId, choice)
          ?? { ok: false as const, reason: 'unavailable' as const, requestId: input.requestId };
        if (!result.ok) {
          return { kind: 'error', text: `Unable to approve permission request (${result.reason}).` };
        }
        this.dependencies.permissionStore?.resolve(identity.chatId, binding, input.requestId, 'approved', choice);
        await this.recordAudit({
          event: 'permission_approval',
          decision: 'allow',
          reason: 'permission approved from telegram',
          action: 'approve',
          actor: buildActor(identity),
          workspace: sanitizeWorkspace(binding.workspace),
          sessionId: binding.sessionId,
          sessionFile: binding.sessionFile,
          command: '/approve',
          metadata: { requestId: input.requestId, choice },
        });
        return { kind: 'ok', text: `Permission ${input.requestId} approved (${choice}).` };
      }

      case 'deny': {
        const binding = this.dependencies.bindings.get(identity.chatId);
        if (!binding) return makeDenied('No active binding. Open a workspace first.');
        if (!input.requestId) return makeDenied('Usage: /deny <request-id>.');

        const pending = this.dependencies.permissionStore?.get(identity.chatId, binding, input.requestId);
        if (!pending) {
          await this.recordAudit({
            event: 'permission_approval',
            decision: 'deny',
            reason: 'pending permission request not found',
            action: 'deny',
            actor: buildActor(identity),
            workspace: sanitizeWorkspace(binding.workspace),
            sessionId: binding.sessionId,
            sessionFile: binding.sessionFile,
            command: '/deny',
            metadata: { requestId: input.requestId },
          });
          return { kind: 'error', text: 'No matching pending permission request.' };
        }

        const result = await this.dependencies.answerPermission?.(binding, input.requestId, 'Deny')
          ?? { ok: false as const, reason: 'unavailable' as const, requestId: input.requestId };
        if (!result.ok) {
          return { kind: 'error', text: `Unable to deny permission request (${result.reason}).` };
        }
        this.dependencies.permissionStore?.resolve(identity.chatId, binding, input.requestId, 'denied', 'Deny');
        await this.recordAudit({
          event: 'permission_approval',
          decision: 'deny',
          reason: 'permission denied from telegram',
          action: 'deny',
          actor: buildActor(identity),
          workspace: sanitizeWorkspace(binding.workspace),
          sessionId: binding.sessionId,
          sessionFile: binding.sessionFile,
          command: '/deny',
          metadata: { requestId: input.requestId },
        });
        return { kind: 'ok', text: `Permission ${input.requestId} denied.` };
      }

      case 'abort': {
        const bindingResult = this.dependencies.bindings.requireArmed(identity.chatId, nowMs());
        if (!bindingResult.ok) {
          await this.recordAudit({
            event: 'control_action',
            decision: 'deny',
            reason: bindingResult.reason === 'no_binding'
              ? 'no active binding'
              : bindingResult.reason === 'unarmed' || bindingResult.reason === 'expired'
                ? 'binding not armed'
                : 'binding unavailable',
            action: 'abort',
            actor: buildActor(identity),
            command: '/abort',
          });
          return makeDenied(bindingResult.reason === 'no_binding'
            ? 'No active binding found.'
            : 'Binding is not armed; use /arm first.');
        }

        await this.dependencies.sendAbort(bindingResult.binding);
        await this.recordAudit({
          event: 'control_action',
          decision: 'allow',
          reason: 'abort requested',
          action: 'abort',
          actor: buildActor(identity),
          workspace: sanitizeWorkspace(bindingResult.binding.workspace),
          sessionId: bindingResult.binding.sessionId,
          sessionFile: bindingResult.binding.sessionFile,
          command: '/abort',
        });
        return {
          kind: 'ok',
          text: 'Abort requested.',
        };
      }

      case 'steer': {
        if (!input.message) {
          return {
            kind: 'error',
            text: 'Steer command requires a message.',
          };
        }

        const maxPromptChars = this.dependencies.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
        const limit = limitPrompt(input.message, maxPromptChars);
        if (!limit.ok) {
          await this.recordAudit({
            event: 'control_action',
            decision: 'deny',
            reason: 'message exceeds maxPromptChars',
            action: 'steer',
            actor: buildActor(identity),
            command: '/steer',
            outputPreview: previewText(input.message),
          });
          return {
            kind: 'denied',
            text: limit.reason,
            reason: 'invalid_update',
          };
        }

        const steerBindingResult = this.dependencies.bindings.requireArmed(identity.chatId, nowMs());
        if (!steerBindingResult.ok) {
          await this.recordAudit({
            event: 'control_action',
            decision: 'deny',
            reason: steerBindingResult.reason === 'no_binding'
              ? 'no active binding'
              : 'binding not armed',
            action: 'steer',
            actor: buildActor(identity),
            command: '/steer',
          });
          return makeDenied('Binding is not armed; use /arm first.');
        }

        await this.dependencies.sendSteer(steerBindingResult.binding, input.message);
        await this.recordAudit({
          event: 'control_action',
          decision: 'allow',
          reason: 'steer sent',
          action: 'steer',
          actor: buildActor(identity),
          workspace: sanitizeWorkspace(steerBindingResult.binding.workspace),
          sessionId: steerBindingResult.binding.sessionId,
          sessionFile: steerBindingResult.binding.sessionFile,
          command: '/steer',
          outputPreview: previewText(input.message),
        });

        return {
          kind: 'ok',
          text: '',
          silent: true,
        };
      }

      case 'followup': {
        if (!input.message) {
          return {
            kind: 'error',
            text: 'Followup command requires a message.',
          };
        }

        const maxPromptChars = this.dependencies.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
        const limit = limitPrompt(input.message, maxPromptChars);
        if (!limit.ok) {
          await this.recordAudit({
            event: 'control_action',
            decision: 'deny',
            reason: 'message exceeds maxPromptChars',
            action: 'followup',
            actor: buildActor(identity),
            command: '/followup',
            outputPreview: previewText(input.message),
          });
          return {
            kind: 'denied',
            text: limit.reason,
            reason: 'invalid_update',
          };
        }

        const followupBindingResult = this.dependencies.bindings.requireArmed(identity.chatId, nowMs());
        if (!followupBindingResult.ok) {
          await this.recordAudit({
            event: 'control_action',
            decision: 'deny',
            reason: followupBindingResult.reason === 'no_binding'
              ? 'no active binding'
              : 'binding not armed',
            action: 'followup',
            actor: buildActor(identity),
            command: '/followup',
          });
          return makeDenied('Binding is not armed; use /arm first.');
        }

        await this.dependencies.sendFollowup(followupBindingResult.binding, input.message);
        await this.recordAudit({
          event: 'control_action',
          decision: 'allow',
          reason: 'followup sent',
          action: 'followup',
          actor: buildActor(identity),
          workspace: sanitizeWorkspace(followupBindingResult.binding.workspace),
          sessionId: followupBindingResult.binding.sessionId,
          sessionFile: followupBindingResult.binding.sessionFile,
          command: '/followup',
          outputPreview: previewText(input.message),
        });

        return {
          kind: 'ok',
          text: '',
          silent: true,
        };
      }

      case 'prompt': {
        if (!input.message) {
          return {
            kind: 'error',
            text: 'Prompt is empty.',
          };
        }

        const maxPromptChars = this.dependencies.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
        const limit = limitPrompt(input.message, maxPromptChars);
        if (!limit.ok) {
          await this.recordAudit({
            event: 'control_action',
            decision: 'deny',
            reason: 'message exceeds maxPromptChars',
            action: 'prompt',
            actor: buildActor(identity),
            command: '/prompt',
            outputPreview: previewText(input.message),
          });
          return {
            kind: 'denied',
            text: limit.reason,
            reason: 'invalid_update',
          };
        }

        const promptBindingResult = this.dependencies.bindings.requireArmed(identity.chatId, nowMs());
        if (!promptBindingResult.ok) {
          await this.recordAudit({
            event: 'control_action',
            decision: 'deny',
            reason: promptBindingResult.reason === 'no_binding'
              ? 'no active binding'
              : 'binding not armed',
            action: 'prompt',
            actor: buildActor(identity),
            command: '/prompt',
          });
          return makeDenied('Binding is not armed; use /arm first.');
        }

        await this.dependencies.sendPrompt(promptBindingResult.binding, input.message);
        await this.recordAudit({
          event: 'control_action',
          decision: 'allow',
          reason: 'prompt sent',
          action: 'prompt',
          actor: buildActor(identity),
          workspace: sanitizeWorkspace(promptBindingResult.binding.workspace),
          sessionId: promptBindingResult.binding.sessionId,
          sessionFile: promptBindingResult.binding.sessionFile,
          command: '/prompt',
          outputPreview: previewText(input.message),
        });

        return {
          kind: 'ok',
          text: '',
          silent: true,
        };
      }
    }
  }

  private getBoundWorkspace(chatId: number) {
    return this.dependencies.bindings.get(chatId);
  }
}
