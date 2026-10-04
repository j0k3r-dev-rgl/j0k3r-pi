const moduleName = '@earendil-works/pi-coding-agent';
const MIN_PI_VERSION = [0, 82, 1] as const;

let piSdkModulePromise: Promise<any> | undefined;

export function loadPiSdkModule(): Promise<any> {
  piSdkModulePromise ??= import(moduleName) as Promise<any>;
  return piSdkModulePromise;
}

function parseVersion(text: string | undefined): number[] | undefined {
  if (!text) return undefined;
  const match = text.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : undefined;
}

function versionGte(version: number[], minimum: readonly number[]): boolean {
  for (let index = 0; index < minimum.length; index += 1) {
    const current = version[index] ?? 0;
    const required = minimum[index] ?? 0;
    if (current > required) return true;
    if (current < required) return false;
  }
  return true;
}

export function detectPiRuntimeSupport(version: unknown): { detected_pi_version: string | 'unknown'; supported: boolean; required_pi_version: '>=0.82.1' } {
  const detected = typeof version === 'string' && version.trim() ? version.trim() : 'unknown';
  const parsed = parseVersion(detected);
  return {
    detected_pi_version: detected,
    supported: Boolean(parsed && versionGte(parsed, MIN_PI_VERSION)),
    required_pi_version: '>=0.82.1',
  };
}
