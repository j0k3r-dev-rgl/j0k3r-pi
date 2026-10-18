import type { ConfigurationScope, ConfigurationScopeControl } from './configuration-scope.ts';

/** Shared presentation only; persistence and runtime ownership stay in the host. */
export function createConfigurationScopeEditor<T>(control: ConfigurationScopeControl<T> | undefined, adopt: (config: T, error?: string) => void, onError: (message: string) => void) {
  let location = control?.location;
  return {
    get available(): boolean { return Boolean(control); },
    lines(selected: boolean): string[] {
      if (!location) return [];
      const label = location.scope === 'legacy' ? 'Existing (unchanged)' : location.scope === 'project' ? 'Project' : location.scope === 'global' ? 'Global' : 'Unavailable';
      return [`${selected ? '→ ' : '  '}Configuration source: ${label} · ← Project / Global →`, `   Path: ${location.path}`];
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
        onError(`Could not change configuration source: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
