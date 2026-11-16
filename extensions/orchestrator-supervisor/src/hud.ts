import { loadSupervisorConfig, type SupervisorConfig } from './supervisor-config.ts';
import { loadSubagentConfig } from './subagent-config.ts';
import { resolveConfigurationLocation } from './configuration-scope.ts';
import type { SupervisorPanelState } from './supervisor-panel.ts';

export function supervisorHudLines(cwd: string, state: SupervisorPanelState): string[] {
  const supervisor = loadSupervisorConfig(cwd);
  const subagents = loadSubagentConfig(cwd);
  const c = supervisor.config;
  const yes = (value: boolean) => value ? 'sí' : 'no';
  const pool = (ids: string[], count: number, efforts: SupervisorConfig['modelEfforts']) =>
    Array.from({ length: count }, (_, i) => `  ${i + 1}. ${ids[i] || 'sin asignar'}${ids[i] ? ` · ${efforts?.[ids[i]] ?? 'high'}` : ''}`);
  return [
    'ORQUESTADOR · solo lectura',
    `Ámbito: ${resolveConfigurationLocation(cwd, 'supervisor').scope}`,
    `Habilitado: ${yes(state.enabled)} · runtime: ${yes(state.running)}`,
    `Estado: ${state.status ?? 'inactivo'}`,
    `Modelo activo: ${state.activeModel ?? '—'}`,
    `Rotación automática: ${yes(c.autoRotate)}`,
    `Cambio automático de modelo: ${yes(c.autoSwitchModel)}`,
    `Modelos: ${c.modelCount}`,
    ...pool(c.priorityCandidateIds, c.modelCount, c.modelEfforts),
    `Umbral rotación: ${c.rotationThresholdPercent}%`,
    `Umbral cuota Codex: ${c.codexQuotaThresholdPercent}%`,
    `Reintentos: ${c.maxTransientFailures}`,
    `Cooldown: ${c.cooldownMinutes} min`,
    `Poll: ${c.pollIntervalSeconds} s`,
    `Checkpoint preparado: ${state.checkpoint ?? '—'}`,
    `Último checkpoint: ${state.lastCheckpoint ?? '—'}`,
    `Efectos inciertos: ${state.uncertain}`,
    `Inventario: ${state.inventory ?? '—'}`,
    ...(state.inventoryError ? ['Inventario no disponible'] : []),
    ...(supervisor.error ? ['Configuración del supervisor inválida'] : []),
    '', 'SUBAGENTES',
    `Ámbito: ${resolveConfigurationLocation(cwd, 'subagents').scope}`,
    `Asignación automática: ${yes(subagents.config.enabled)}`,
    'Default',
    ...pool(subagents.config.priorityCandidateIds, subagents.config.modelCount, subagents.config.modelEfforts),
    ...Object.entries(subagents.config.subagentPools ?? {}).flatMap(([name, config]) => [
      `${name}: ${config.mode}`,
      ...(config.mode === 'custom' ? pool(config.priorityCandidateIds, config.modelCount, config.modelEfforts) : []),
    ]),
    ...(subagents.error ? ['Configuración de subagentes inválida'] : []),
    '', 'Editar desde /supervisor en Pi',
  ];
}

export function registerSupervisorHud(pi: any, state: (ctx: any) => SupervisorPanelState) {
  let context: any;
  pi.on('session_start', (_event: any, ctx: any) => { context = ctx; });
  const unsubscribe = pi.events?.on('pihud:sup:read:v1', (request: any) => {
    if (!context || context.mode !== 'tui' || !context.isProjectTrusted?.() || !request ||
        request.cwd !== context.cwd || request.sessionId !== context.sessionManager.getSessionId() || typeof request.respond !== 'function') return;
    try { request.respond({ lines: supervisorHudLines(context.cwd, state(context)) }); }
    catch { request.respond({ lines: [], error: 'Supervisor no disponible' }); }
  });
  pi.on('session_shutdown', () => { context = undefined; unsubscribe?.(); });
}
