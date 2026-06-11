import fs from 'node:fs';
import path from 'node:path';

export function isSubagentsDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.PI_SUBAGENTS_DEBUG;
  if (!value) return false;
  return !['0', 'false', 'off', 'no'].includes(value.trim().toLowerCase());
}

export function writeSubagentsDebugLog(cwd: string | undefined, scope: string, data: unknown): void {
  if (!isSubagentsDebugEnabled()) return;
  try {
    const root = cwd ?? process.cwd();
    const file = path.join(root, '.pi', 'subagents-debug.log');
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(file, `${new Date().toISOString()} ${scope} ${JSON.stringify(data, (_key, value) => value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value).slice(0, 4000)}\n`);
  } catch {}
}
