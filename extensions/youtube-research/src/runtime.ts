import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolError, YtDlpRuntime } from './types.js';

export const DEFAULT_YT_DLP_BINARY = 'yt-dlp';

export const YT_DLP_INSTALL_HINT =
  'Install yt-dlp (https://github.com/yt-dlp/yt-dlp) and ensure it is available on PATH. The youtube-research extension requires it before any tool call.';

export interface YtDlpCheckOptions {
  binary?: string;
  timeoutMs?: number;
  probe?: (binary: string, timeoutMs: number) => Promise<string>;
}

export interface YtDlpCheckResult {
  runtime?: YtDlpRuntime;
  error?: ToolError;
}

export function ytDlpMissingError(binary: string): ToolError {
  return {
    code: 'yt_dlp_missing',
    message: `The YouTube backend binary is missing or not executable: ${binary}`,
    recoverable: true,
    details: {
      binary,
      reason: 'missing_runtime_dependency',
    },
    install_hint: YT_DLP_INSTALL_HINT,
  };
}

export function isRecoverableDependencyError(error: unknown): boolean {
  return !!(
    typeof error === 'object' &&
    error !== null &&
    'code' in (error as { code?: unknown }) &&
    ['ENOENT', 'EACCES', 'EISDIR'].includes(String((error as { code?: unknown }).code))
  );
}

const execFileAsync = promisify(execFile);

async function defaultProbe(binary: string, timeoutMs: number): Promise<string> {
  const { stdout } = await execFileAsync(binary, ['--version'], {
    timeout: timeoutMs,
    windowsHide: true,
  });
  return String(stdout).trim();
}

export async function checkYtDlpRuntime(options: YtDlpCheckOptions = {}): Promise<YtDlpCheckResult> {
  const binary = options.binary ?? DEFAULT_YT_DLP_BINARY;
  const timeoutMs = options.timeoutMs ?? 5000;
  const probe = options.probe ?? defaultProbe;

  try {
    const version = await probe(binary, timeoutMs);
    return {
      runtime: {
        binary,
        version,
      },
    };
  } catch {
    return {
      error: ytDlpMissingError(binary),
    };
  }
}

export async function assertYtDlpAvailable(options: YtDlpCheckOptions = {}): Promise<YtDlpRuntime> {
  const result = await checkYtDlpRuntime(options);
  if (result.error) {
    throw result.error;
  }
  if (!result.runtime) {
    throw ytDlpMissingError(options.binary ?? DEFAULT_YT_DLP_BINARY);
  }
  return result.runtime;
}
