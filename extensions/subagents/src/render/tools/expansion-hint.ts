import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

export type KeybindingResolver = (keybinding: string) => string | undefined;

let customKeybindingResolver: KeybindingResolver | undefined;
let cachedNativeKeyText: ((id: string) => string) | undefined;
let triedNativeLoad = false;

function runningPiEntrypoint(): string | undefined {
  if (!process.argv[1]) return undefined;
  const resolved = path.resolve(process.argv[1]);
  try { return fs.realpathSync(resolved); } catch { return resolved; }
}

function findRunningPiPackageRoot(): string | undefined {
  let current = runningPiEntrypoint();
  if (!current) return undefined;
  if (!fs.existsSync(current)) return undefined;
  current = fs.statSync(current).isDirectory() ? current : path.dirname(current);
  while (true) {
    const packageJson = path.join(current, 'package.json');
    if (fs.existsSync(packageJson)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(packageJson, 'utf8')) as { name?: string };
        if (parsed.name === '@earendil-works/pi-coding-agent') return current;
      } catch {}
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function getNativePiKeyTextFn(): ((id: string) => string) | undefined {
  if (triedNativeLoad) return cachedNativeKeyText;
  triedNativeLoad = true;
  try {
    const packageRoot = findRunningPiPackageRoot();
    if (packageRoot) {
      const piRequire = createRequire(path.join(packageRoot, 'package.json'));
      const agent = piRequire('./dist/index.js');
      if (typeof agent?.keyText === 'function') {
        cachedNativeKeyText = agent.keyText;
        return cachedNativeKeyText;
      }
    }
  } catch {}
  return undefined;
}

export function setExpandKeybindingProviderForTests(resolver: KeybindingResolver | undefined): void {
  customKeybindingResolver = resolver;
}

export function resetExpandKeybindingProviderForTests(): void {
  customKeybindingResolver = undefined;
}

export function resolveExpandKeyText(context?: any): string {
  if (customKeybindingResolver) {
    const custom = customKeybindingResolver('app.tools.expand');
    if (custom) return custom;
  }

  const contextKb = context?.keybindings ?? context?.ui?.keybindings;
  if (typeof contextKb?.getKeys === 'function') {
    const keys = contextKb.getKeys('app.tools.expand');
    if (Array.isArray(keys) && keys.length > 0 && typeof keys[0] === 'string' && keys[0].trim()) {
      return keys[0].trim();
    }
    if (typeof keys === 'string' && keys.trim()) {
      return keys.trim();
    }
  }

  const nativeFn = getNativePiKeyTextFn();
  if (nativeFn) {
    try {
      const text = nativeFn('app.tools.expand');
      if (typeof text === 'string' && text.trim()) {
        return text.trim();
      }
    } catch {}
  }

  return 'ctrl+o';
}

export function resolveExpandHint(action = 'to expand', context?: any): string {
  return `${resolveExpandKeyText(context)} ${action}`;
}
