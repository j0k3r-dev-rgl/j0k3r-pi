import type { ConfigurationScope, ConfigurationScopeControl } from './configuration-scope.ts';

/** Shared presentation only; persistence and runtime ownership stay in the host. */
export function createConfigurationScopeEditor<T>(control: ConfigurationScopeControl<T> | undefined, adopt: (config: T, error?: string) => void, onError: (message: string) => void) {
  let location = control?.location;
  return {
    get available(): boolean { return Boolean(control); },
    lines(selected: boolean): string[] {
      if (!location) return [];
      const label = location.scope === 'legacy'
        ? 'Legado (sin cambios)'
        : location.scope === 'project'
          ? 'Proyecto'
          : location.scope === 'global'
            ? 'Global'
            : 'No disponible';
      return [`${selected ? '→ ' : '  '}Origen de config: ${label} · ← Proyecto / Global →`, `   Ruta: ${location.path}`];
    },
    select(scope?: ConfigurationScope): void {
      if (!control || !location) return;
      const next = scope ?? (location.scope === 'project' ? 'global' : 'project');
      if (next === location.scope) return;
      try {
        const result = control.select(next);
        location = result.location;
        adopt(result.config, result.error);
      } catch (error) {
        onError(`No se pudo cambiar el origen de configuración: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
