import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
  SUPERVISOR_EXTENSION_NAME,
  SUPERVISOR_RELOAD_GUARD_CHANNEL,
  isExtensionEnabled,
} from './src/config.ts';
import { SupervisorRuntime } from './src/supervisor.ts';

export default function orchestratorSupervisorExtension(pi: ExtensionAPI, explicitCwd?: string): void {
  const cwd = explicitCwd || process.cwd();

  // Early-exit gate: If disabled in .pi/extensions.json, register zero hooks, tools, commands, locks or timers
  if (!isExtensionEnabled(SUPERVISOR_EXTENSION_NAME, cwd)) {
    return;
  }

  let runtime: SupervisorRuntime | null = null;

  // Internal deferred session rotation command (zero LLM invocation)
  pi.registerCommand('supervisor-rotate', {
    description: 'Internal deferred session rotation for supervisor',
    handler: async (_args, cmdCtx: ExtensionCommandContext) => {
      if (typeof cmdCtx.newSession === 'function') {
        const parentSession = cmdCtx.sessionManager?.getSessionFile?.();
        await cmdCtx.newSession({
          parentSession: parentSession ?? undefined,
          withSession: async (replacementCtx: any) => {
            if (runtime) {
              await runtime.onSessionReplaced(replacementCtx);
            }
          },
        });
      }
    },
  });

  // Optional runtime safety controls (status, pause, cancel, resume, rotate)
  pi.registerCommand('supervisor', {
    description: 'Supervisor runtime safety and recovery controls',
    handler: async (args: string, cmdCtx: ExtensionCommandContext) => {
      const sub = args?.trim().toLowerCase();
      if (!runtime) {
        cmdCtx.ui?.notify('Supervisor is not initialized in this session', 'warning');
        return;
      }

      if (sub === 'status' || !sub) {
        const state = runtime.getState();
        cmdCtx.ui?.notify(
          `Supervisor Status: ${state.status} · Model: ${state.activeModel} · Gen: ${state.activeGeneration} · Paused: ${state.userPaused}`,
          'info',
        );
        return;
      }

      if (sub === 'pause') {
        runtime.setUserPaused(true);
        cmdCtx.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, 'supervisor · paused');
        cmdCtx.ui?.notify('Supervisor paused by user. Automatic operations halted.', 'warning');
        return;
      }

      if (sub === 'cancel') {
        runtime.setUserCancelled(true);
        cmdCtx.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, 'supervisor · cancelled');
        cmdCtx.ui?.notify('Supervisor cancelled by user. Automatic operations halted.', 'warning');
        return;
      }

      if (sub === 'resume') {
        runtime.acknowledgeUncertainMutations();
        runtime.setUserPaused(false);
        runtime.setUserCancelled(false);
        cmdCtx.ui?.setStatus?.(
          SUPERVISOR_EXTENSION_NAME,
          `supervisor · ${runtime.getState().activeModel.split('/')[1] || 'main'} · normal`,
        );
        cmdCtx.ui?.notify('Supervisor resumed by user.', 'info');
        return;
      }

      if (sub === 'rotate') {
        runtime.requestRotation('user_requested_rotate');
        cmdCtx.ui?.notify('Supervisor rotation requested. Will rotate at clean settlement.', 'info');
        if (!cmdCtx.isIdle || cmdCtx.isIdle()) {
          await runtime.onAgentSettled(pi, cmdCtx);
        }
        return;
      }

      cmdCtx.ui?.notify('Available subcommands: status, pause, cancel, resume, rotate', 'info');
    },
  });

  // Model-facing tool to request clean session rotation with a saved memory ID
  if (typeof pi?.registerTool === 'function') {
    pi.registerTool({
      name: 'supervisor_rotate',
      label: 'supervisor_rotate',
      description: 'Solicita la rotación del orquestador hacia una nueva sesión limpia. Debe llamarse tras guardar un resumen conciso de continuación en memoria persistente con memory_save (tipo session_summary). La nueva sesión continuará automáticamente desde el ID de memoria indicado.',
      promptGuidelines: [
        'Cuando el contexto alcance o se aproxime al límite de seguridad (90%), guarda inmediatamente un resumen de continuación ESTRUCTURADO Y CONCISO (150-250 palabras) usando memory_save (type: "session_summary", title: "Resumen de continuación").',
        'ESTRUCTURA OBLIGATORIA DEL RESUMEN (4-5 viñetas concisas): 1) Objetivo activo y límites del usuario (ej. dónde detenerse), 2) Dónde se quedó exactamente (qué se completó y qué falta), 3) Punteros exactos a los archivos con la verdad que la nueva sesión debe leer con la herramienta read (ej. plan.md, apply.md) — ¡NUNCA copies ni vuelques el contenido de esos archivos en la memoria!, 4) Estado de servicios o entorno en vivo si aplica (puertos, bases de datos, flags), 5) Próxima acción inmediata a ejecutar.',
        'REGLA DE ORO: NUNCA vuelques transcripciones, historiales de tareas pasadas ni bloques de código en la memoria. Usa punteros a archivos.',
        'Tras guardar la memoria con éxito, invoca supervisor_rotate pasando el memory_id devuelto y el next_step para transferir el control a una sesión nueva limpia sin perder el hilo.',
      ],
      parameters: {
        type: 'object',
        properties: {
          memory_id: {
            type: 'integer',
            description: 'El ID numérico positivo de la memoria tipo session_summary guardada con memory_save',
          },
          next_step: {
            type: 'string',
            description: 'Resumen claro del siguiente paso que debe ejecutarse al arrancar la nueva sesión',
          },
        },
        required: ['memory_id'],
      },
      execute: async (_toolCallId: string, args: any) => {
        const memoryId = Number(args?.memory_id);
        const nextStep = typeof args?.next_step === 'string' ? args.next_step.trim() : '';

        if (!Number.isSafeInteger(memoryId) || memoryId <= 0) {
          return {
            content: [{ type: 'text', text: 'Error: memory_id debe ser un entero positivo devuelto por memory_save.' }],
            isError: true,
          };
        }

        if (runtime) {
          runtime.requestRotationFromTool(memoryId, nextStep);
        }

        return {
          content: [{
            type: 'text',
            text: `Sesión rotada hacia una sesión limpia. Se reanudará la tarea automáticamente desde la memoria ID ${memoryId}. La nueva sesión se iniciará de inmediato.`,
          }],
        };
      },
    });
  }

  // Reload guard listener on pi.events
  if (pi?.events?.on) {
    pi.events.on(SUPERVISOR_RELOAD_GUARD_CHANNEL, (query: any) => {
      if (runtime) {
        runtime.handleReloadGuardQuery(query);
      }
    });
  }

  // Pre-message session_start auto-initialization
  pi.on('session_start', async (event: any, ctx: ExtensionContext) => {
    // Project trust boundary: reject untrusted projects
    if (ctx.isProjectTrusted && !ctx.isProjectTrusted()) {
      return;
    }

    if (!isExtensionEnabled(SUPERVISOR_EXTENSION_NAME, ctx.cwd)) {
      ctx.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, undefined);
      return;
    }

    const sessionId = ctx.sessionManager?.getSessionId?.() ?? (ctx as any).sessionId ?? 'default-session';
    if (!runtime) {
      runtime = new SupervisorRuntime(ctx.cwd, sessionId, { events: pi.events });
      try {
        runtime.init({ reason: event?.reason });
      } catch (err: any) {
        runtime = null;
        ctx.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, `supervisor · error: ${err.message}`);
        return;
      }
    } else {
      runtime.setSessionId(sessionId);
    }

    const currentModelId = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
    if (currentModelId && currentModelId.startsWith('cliproxyapi/') && event?.reason !== 'new') {
      runtime.setActiveModel(currentModelId);
    }

    if (event?.reason === 'new') {
      await runtime.onNewSessionStart(pi, ctx);
    }

    const state = runtime.getState();
    if (state.uncertainMutationsCount > 0) {
      ctx.ui?.notify?.(
        `Supervisor recovery: ${state.uncertainMutationsCount} interrupted mutating tool call(s) have uncertain side effects. Inspect and run /supervisor resume to confirm before executing mutating tools.`,
        'warning',
      );
      ctx.ui?.setStatus?.(
        SUPERVISOR_EXTENSION_NAME,
        `supervisor · paused (uncertain effects: ${state.uncertainMutationsCount})`,
      );
    } else if (state.userCancelled) {
      ctx.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, 'supervisor · cancelled');
    } else if (state.userPaused) {
      ctx.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, 'supervisor · paused');
    } else {
      ctx.ui?.setStatus?.(
        SUPERVISOR_EXTENSION_NAME,
        `supervisor · ${state.activeModel.split('/')[1] || 'main'} · normal`,
      );
    }

    runtime.startPeriodicPolling((text) => {
      ctx.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, text);
    });
  });

  // Pre-agent start guard for context reserve ceiling and batch reset
  pi.on('before_agent_start', async (_event: any, ctx: ExtensionContext) => {
    if (!runtime || (ctx.isProjectTrusted && !ctx.isProjectTrusted())) return;
    if (ctx.mode !== 'tui') return;
    const sessionId = ctx.sessionManager?.getSessionId?.() ?? (ctx as any).sessionId;
    if (sessionId && sessionId !== runtime.getSessionId()) return;

    if (!isExtensionEnabled(SUPERVISOR_EXTENSION_NAME, ctx.cwd)) {
      runtime.checkQuiescence();
      ctx.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, undefined);
      return;
    }

    // A new prompt is starting: unpause so new operations can proceed and be monitored
    if (runtime.getState().userPaused) {
      runtime.setUserPaused(false);
    }

    const currentModelId = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
    if (currentModelId) {
      runtime.setActiveModel(currentModelId);
    }

    runtime.contextGuard.resetBatchBudget();

    const usage = ctx.getContextUsage ? ctx.getContextUsage() : undefined;
    if (usage) {
      const fallbackDetails = runtime.contextGuard.extractFallbackDetails(ctx);
      const evaluated = runtime.contextGuard.evaluateUsage(
        usage,
        runtime.getState().activeModel,
        fallbackDetails,
      );
      if (evaluated.isReserveExceeded) {
        ctx.ui?.setStatus?.(
          SUPERVISOR_EXTENSION_NAME,
          `supervisor · ${runtime.getState().activeModel.split('/')[1] || 'main'} · contexto ≥ 90%`,
        );
      }
    }
  });

  // Observe background subagent completion delivery messages
  pi.on('message_end', async (event: any, ctx: ExtensionContext) => {
    if (!runtime || (ctx.isProjectTrusted && !ctx.isProjectTrusted())) return;
    if (ctx.mode !== 'tui') return;
    const sessionId = ctx.sessionManager?.getSessionId?.() ?? (ctx as any).sessionId;
    if (sessionId && sessionId !== runtime.getSessionId()) return;

    const msg = event?.message;
    if (msg?.customType === 'subagent-completion') {
      const taskId = msg?.details?.task?.id;
      runtime.subagentMonitor.recordCompletionDelivery(runtime.getSessionId(), taskId);
    }
  });

  // Pre-execution WAL and context reserve ceiling interceptor
  pi.on('tool_call', async (event: any, ctx: ExtensionContext) => {
    if (!runtime || (ctx.isProjectTrusted && !ctx.isProjectTrusted())) return;
    if (ctx.mode !== 'tui') return;
    const currentSessionId = ctx.sessionManager?.getSessionId?.() ?? (ctx as any).sessionId;
    if (currentSessionId && currentSessionId !== runtime.getSessionId()) return;

    if (!isExtensionEnabled(SUPERVISOR_EXTENSION_NAME, ctx.cwd)) {
      runtime.checkQuiescence();
      ctx.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, undefined);
      return;
    }

    const toolCallId = event.toolCallId ?? event.id ?? `call_${Date.now()}`;
    const parentToolCallId = event.parentToolCallId ?? event.parentId;
    const toolName = event.toolName ?? event.name ?? 'unknown';
    const toolInput = event.input ?? event.arguments;

    // 0. Check uncertain mutations confirmation gate before executing tools
    if (runtime.getState().uncertainMutationsCount > 0) {
      let confirmed = false;
      if (ctx.hasUI && typeof ctx.ui?.confirm === 'function') {
        confirmed = await ctx.ui.confirm(
          'Uncertain prior mutation detected',
          'A previous mutating tool call was interrupted and may have partial side effects. Confirm to clear uncertainty and proceed?',
        );
      }
      if (confirmed) {
        runtime.acknowledgeUncertainMutations();
      } else {
        return {
          block: true,
          reason:
            'Blocked due to unconfirmed uncertain mutations from prior crash/interruption. Run /supervisor resume after verifying side effects.',
        };
      }
    }

    // 1. Record pre-execution WAL synchronously; block tool execution if WAL write fails
    try {
      runtime.recordToolCallPre({
        toolCallId,
        parentToolCallId,
        sessionId: currentSessionId ?? runtime.getSessionId(),
        turnIndex: (event.turnIndex as number) ?? 0,
        toolName,
        args: toolInput,
      });
    } catch {
      return {
        block: true,
        reason: 'Supervisor WAL write failed; blocking tool execution for safety.',
      };
    }

    // 2. Check 90% context reserve ceiling (with post-compaction fallback details and cumulative batch budget)
    const usage = ctx.getContextUsage
      ? ctx.getContextUsage() ?? { tokens: null, contextWindow: 272000, percent: null }
      : { tokens: null, contextWindow: 272000, percent: null };
    const fallbackDetails = runtime.contextGuard.extractFallbackDetails(ctx);
    const evaluated = runtime.contextGuard.evaluateUsage(
      usage,
      runtime.getState().activeModel,
      fallbackDetails,
    );

    const intercept = runtime.contextGuard.interceptToolCall(
      { ...event, toolName, input: toolInput },
      evaluated.tokens,
      evaluated.contextWindow,
    );
    if (intercept && intercept.block) {
      // Settle the pre-logged WAL entry as blocked so it does not remain pending
      try {
        runtime.recordToolCallResult(toolCallId, true, { blockedBySupervisor: true });
      } catch {}
      return {
        block: true,
        reason: intercept.reason,
        terminate: true,
      };
    }
  });

  // Tool execution settlement in WAL
  pi.on('tool_result', async (event: any, ctx: ExtensionContext) => {
    if (!runtime || (ctx.isProjectTrusted && !ctx.isProjectTrusted())) return;
    if (ctx.mode !== 'tui') return;
    const currentSessionId = ctx.sessionManager?.getSessionId?.() ?? (ctx as any).sessionId;
    if (currentSessionId && currentSessionId !== runtime.getSessionId()) return;

    const toolCallId = event.toolCallId ?? event.id;
    const resultPayload = event.content ?? event.details ?? event.result;
    if (toolCallId) {
      try {
        runtime.recordToolCallResult(toolCallId, Boolean(event.isError), resultPayload);
      } catch {
        runtime.setUserPaused(true);
        ctx.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, 'supervisor · HALTED (WAL error)');
      }
    }

    if (!isExtensionEnabled(SUPERVISOR_EXTENSION_NAME, ctx.cwd)) {
      runtime.checkQuiescence();
      ctx.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, undefined);
    }
  });

  // Child subagent isolation guard on user_bash
  pi.on('user_bash', async (_event: any, ctx: ExtensionContext) => {
    if (!runtime || (ctx.isProjectTrusted && !ctx.isProjectTrusted())) return;
    if (ctx.mode !== 'tui') return;
    const currentSessionId = ctx.sessionManager?.getSessionId?.() ?? (ctx as any).sessionId;
    if (currentSessionId && currentSessionId !== runtime.getSessionId()) return;
    return undefined;
  });

  // Turn error classification, counter reset on success, and 90% context check
  pi.on('turn_end', async (event: any, ctx: ExtensionContext) => {
    if (!runtime || (ctx.isProjectTrusted && !ctx.isProjectTrusted())) return;
    if (ctx.mode !== 'tui') return;
    const currentSessionId = ctx.sessionManager?.getSessionId?.() ?? (ctx as any).sessionId;
    if (currentSessionId && currentSessionId !== runtime.getSessionId()) return;

    runtime.contextGuard.resetBatchBudget();

    if (!isExtensionEnabled(SUPERVISOR_EXTENSION_NAME, ctx.cwd)) {
      runtime.checkQuiescence();
      ctx.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, undefined);
      return;
    }

    if (event?.message) {
      if (event.message.role === 'assistant') {
        const text = Array.isArray(event.message.content)
          ? event.message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
          : (typeof event.message.content === 'string' ? event.message.content : '');
        if (text && text.trim().length > 0) {
          runtime.setLastAssistantSummary(text.trim());
        }
      }

      const action = await runtime.classifyTurnMessage(
        event.message,
        { mode: ctx.mode, sessionId: currentSessionId ?? runtime.getSessionId() },
        pi,
      );

      if (action.type === 'immediate_failover' || action.type === 'cooldown_failover') {
        runtime.requestFailover(action.reason || 'provider_failover', { autoContinue: true });
        if (action.shouldAbortRetry && typeof (ctx as any).abort === 'function') {
          runtime.markInternalAbort(action.reason || 'provider_failover');
          (ctx as any).abort();
        }
      } else if (action.type === 'fatal_proxy_key') {
        ctx.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, 'supervisor · FATAL PROXY KEY');
        ctx.ui?.notify?.(action.reason || 'Fatal proxy key configuration error', 'error');
        runtime.setUserPaused(true);
      }
    }

    // Check if context usage reached >= 90% at turn end
    const usage = ctx.getContextUsage ? ctx.getContextUsage() : undefined;
    if (usage) {
      const fallbackDetails = runtime.contextGuard.extractFallbackDetails(ctx);
      const evaluated = runtime.contextGuard.evaluateUsage(
        usage,
        runtime.getState().activeModel,
        fallbackDetails,
      );
      if (evaluated.isReserveExceeded) {
        ctx.ui?.setStatus?.(
          SUPERVISOR_EXTENSION_NAME,
          `supervisor · ${runtime.getState().activeModel.split('/')[1] || 'main'} · contexto ≥ 90%`,
        );
      }
    }
  });

  // Safe deferred rotation and Escape abort attribution at settlement
  pi.on('agent_settled', async (event: any, ctx: ExtensionContext) => {
    if (!runtime || (ctx.isProjectTrusted && !ctx.isProjectTrusted())) return;
    if (ctx.mode !== 'tui') return;
    const currentSessionId = ctx.sessionManager?.getSessionId?.() ?? (ctx as any).sessionId;
    if (currentSessionId && currentSessionId !== runtime.getSessionId()) return;

    runtime.contextGuard.resetBatchBudget();

    if (!isExtensionEnabled(SUPERVISOR_EXTENSION_NAME, ctx.cwd)) {
      runtime.checkQuiescence();
      ctx.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, undefined);
      return;
    }

    if (event?.aborted === true) {
      const abortCheck = runtime.handleSettledAbort(true);
      if (abortCheck.isUserAbort) {
        ctx.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, 'supervisor · paused');
        return;
      }
    } else {
      runtime.handleSettledAbort(false);
    }

    await runtime.onAgentSettled(pi, ctx);
  });

  // Subagent and unsettled effect reload guard
  pi.on('session_before_switch', async (_event: any, ctx: ExtensionContext) => {
    if (!runtime) return;
    const currentSessionId = ctx.sessionManager?.getSessionId?.() ?? (ctx as any).sessionId;
    if (currentSessionId && currentSessionId !== runtime.getSessionId()) return;
    return runtime.handleBeforeSwitch();
  });

  // Clean shutdown (retaining lock across reload or active rotation handover)
  pi.on('session_shutdown', async (event: any, ctx: ExtensionContext) => {
    ctx.ui?.setStatus?.(SUPERVISOR_EXTENSION_NAME, undefined);
    if (runtime) {
      runtime.dispose(event?.reason);
      runtime = null;
    }
  });
}
