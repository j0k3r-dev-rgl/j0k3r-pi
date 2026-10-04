import fs from 'node:fs';
import path from 'node:path';
import { readSubagentsConfig } from './config.js';

export function isSubagentsDebugEnabled(cwd?: string): boolean {
  if (!cwd) return false;
  try {
    return readSubagentsConfig(cwd).debug === true;
  } catch {
    return false;
  }
}

const DEBUG_LOG_RELATIVE_PATH = '.pi/subagents-debug.log';

function ensureDebugLogGitignored(root: string): void {
  try {
    if (!fs.existsSync(path.join(root, '.git'))) return;
    const gitignorePath = path.join(root, '.gitignore');
    let current = '';
    try { current = fs.readFileSync(gitignorePath, 'utf8'); } catch {}
    const lines = current.split(/\r?\n/).map((line) => line.trim());
    if (lines.includes(DEBUG_LOG_RELATIVE_PATH)) return;
    const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(gitignorePath, `${prefix}${DEBUG_LOG_RELATIVE_PATH}\n`);
  } catch {}
}

export function writeSubagentsDebugLog(cwd: string | undefined, scope: string, data: unknown): void {
  const root = cwd ?? process.cwd();
  if (!isSubagentsDebugEnabled(root)) return;
  try {
    const file = path.join(root, DEBUG_LOG_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    ensureDebugLogGitignored(root);
    fs.appendFileSync(file, `${new Date().toISOString()} ${scope} ${JSON.stringify(data, (_key, value) => value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value).slice(0, 4000)}\n`);
  } catch {}
}
