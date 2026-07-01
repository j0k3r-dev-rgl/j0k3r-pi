import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';

export type ScreenshotDisplayServer = 'wayland' | 'x11' | 'wayland+x11';
export type ScreenshotErrorCode = 'unsupported_platform' | 'no_graphical_session' | 'missing_dependency' | 'capture_failed' | 'validation_error';

export interface ScreenshotCommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type ScreenshotCommandRunner = (command: string, args: string[], options: { signal?: AbortSignal; env?: NodeJS.ProcessEnv }) => Promise<ScreenshotCommandResult>;
export type ScreenshotCommandFinder = (command: string) => Promise<string | null>;
export type OsReleaseReader = () => Promise<string | null>;

export interface ScreenshotInput {
  cwd: string;
  outputPath?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  now?: () => Date;
  findCommand?: ScreenshotCommandFinder;
  runCommand?: ScreenshotCommandRunner;
  readOsRelease?: OsReleaseReader;
}

export interface ScreenshotResult {
  outputPath: string;
  displayServer: ScreenshotDisplayServer;
  screenshotProgram: string;
  command: string;
  outputSizeBytes: number;
  warnings: string[];
}

interface ScreenshotCandidate {
  name: string;
  display: 'wayland' | 'x11' | 'both';
  args(outputPath: string): string[];
}

export class ScreenshotError extends Error {
  code: ScreenshotErrorCode;
  recoverable: boolean;
  installHint?: string;

  constructor(code: ScreenshotErrorCode, message: string, options?: { recoverable?: boolean; installHint?: string }) {
    super(message);
    this.name = 'ScreenshotError';
    this.code = code;
    this.recoverable = options?.recoverable ?? code !== 'validation_error';
    this.installHint = options?.installHint;
  }
}

const SUPPORTED_CANDIDATES: ScreenshotCandidate[] = [
  { name: 'grim', display: 'wayland', args: (outputPath) => [outputPath] },
  { name: 'gnome-screenshot', display: 'both', args: (outputPath) => ['-f', outputPath] },
  { name: 'spectacle', display: 'both', args: (outputPath) => ['-b', '-n', '-o', outputPath] },
  { name: 'maim', display: 'x11', args: (outputPath) => [outputPath] },
  { name: 'scrot', display: 'x11', args: (outputPath) => ['-o', outputPath] },
  { name: 'import', display: 'x11', args: (outputPath) => ['-window', 'root', outputPath] },
];

export async function captureScreenshot(input: ScreenshotInput): Promise<ScreenshotResult> {
  const platform = input.platform ?? process.platform;
  if (platform !== 'linux') {
    throw new ScreenshotError('unsupported_platform', `screenshot supports Linux only; current platform is ${platform}`, { recoverable: false });
  }

  const env = input.env ?? process.env;
  const displayServer = detectDisplayServer(env);
  if (!displayServer) {
    throw new ScreenshotError(
      'no_graphical_session',
      'screenshot requires a graphical Linux session, but neither DISPLAY nor WAYLAND_DISPLAY is set. Pi appears to be running in a pure shell, TTY, SSH, container, or headless session; start Pi inside an X11/Wayland desktop session or expose a graphical display before retrying.',
      { recoverable: true },
    );
  }

  const cwd = input.cwd || process.cwd();
  const outputPath = resolveOutputPath(cwd, input.outputPath, input.now ?? (() => new Date()));
  await mkdir(dirname(outputPath), { recursive: true });

  const findCommand = input.findCommand ?? findCommandOnPath;
  const runCommand = input.runCommand ?? runCommandWithSpawn;
  const candidates = getCandidatesForDisplay(displayServer);
  const installed: Array<{ candidate: ScreenshotCandidate; command: string }> = [];

  for (const candidate of candidates) {
    const command = await findCommand(candidate.name);
    if (command) installed.push({ candidate, command });
  }

  if (installed.length === 0) {
    const installHint = await buildInstallHint(input.readOsRelease ?? readOsReleaseFile, displayServer);
    throw new ScreenshotError(
      'missing_dependency',
      `no supported Linux screenshot program was found on PATH. ${installHint}`,
      { recoverable: true, installHint },
    );
  }

  const warnings: string[] = [];
  for (const entry of installed) {
    const args = entry.candidate.args(outputPath);
    await rm(outputPath, { force: true }).catch(() => undefined);
    const result = await runCommand(entry.command, args, { signal: input.signal, env });
    if (result.code !== 0) {
      warnings.push(`${entry.candidate.name} failed with exit code ${result.code}${formatCommandOutput(result)}`);
      continue;
    }

    const size = await getNonEmptyFileSize(outputPath);
    if (size === null) {
      warnings.push(`${entry.candidate.name} exited successfully but did not create a non-empty screenshot at ${outputPath}`);
      continue;
    }

    return {
      outputPath,
      displayServer,
      screenshotProgram: entry.candidate.name,
      command: entry.command,
      outputSizeBytes: size,
      warnings,
    };
  }

  const attempts = warnings.length ? warnings.join('; ') : 'no capture attempts were made';
  throw new ScreenshotError(
    'capture_failed',
    `all installed screenshot programs failed for ${displayServer}: ${attempts}. This can happen when the compositor blocks screenshot APIs, the session bus is unavailable, or Pi is attached to a display it cannot access. Try a screenshot utility matching the active desktop/session and retry.`,
    { recoverable: true },
  );
}

function detectDisplayServer(env: NodeJS.ProcessEnv): ScreenshotDisplayServer | null {
  const hasWayland = Boolean(env.WAYLAND_DISPLAY?.trim());
  const hasX11 = Boolean(env.DISPLAY?.trim());
  if (hasWayland && hasX11) return 'wayland+x11';
  if (hasWayland) return 'wayland';
  if (hasX11) return 'x11';
  return null;
}

function getCandidatesForDisplay(displayServer: ScreenshotDisplayServer): ScreenshotCandidate[] {
  const accepts = (candidate: ScreenshotCandidate) => {
    if (candidate.display === 'both') return true;
    if (displayServer === 'wayland+x11') return true;
    return candidate.display === displayServer;
  };
  return SUPPORTED_CANDIDATES.filter(accepts);
}

function resolveOutputPath(cwd: string, outputPath: string | undefined, now: () => Date): string {
  const rawPath = outputPath?.trim().replace(/^@/, '');
  const resolved = rawPath
    ? (isAbsolute(rawPath) ? resolve(rawPath) : resolve(cwd, rawPath))
    : join(tmpdir(), `pi-screenshot-${formatTimestamp(now())}.png`);

  const extension = extname(resolved).toLowerCase();
  if (extension !== '.png') {
    throw new ScreenshotError('validation_error', 'screenshot outputPath must end with .png because the Linux screenshot tool writes PNG files', { recoverable: false });
  }
  return resolved;
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/gu, '-');
}

function formatCommandOutput(result: ScreenshotCommandResult): string {
  const output = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join(' | ');
  return output ? `: ${truncateLine(output, 320)}` : '';
}

function truncateLine(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

async function getNonEmptyFileSize(outputPath: string): Promise<number | null> {
  try {
    const fileStat = await stat(outputPath);
    if (!fileStat.isFile() || fileStat.size <= 0) return null;
    return fileStat.size;
  } catch {
    return null;
  }
}

async function findCommandOnPath(command: string): Promise<string | null> {
  const pathEntries = (process.env.PATH ?? '').split(':').filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = join(entry, command);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep searching
    }
  }
  return null;
}

async function runCommandWithSpawn(command: string, args: string[], options: { signal?: AbortSignal; env?: NodeJS.ProcessEnv }): Promise<ScreenshotCommandResult> {
  return await new Promise<ScreenshotCommandResult>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], signal: options.signal, env: { ...process.env, ...(options.env ?? {}) } });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolvePromise({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code: code ?? 1,
      });
    });
  });
}

async function readOsReleaseFile(): Promise<string | null> {
  return await readFile('/etc/os-release', 'utf8').catch(() => null);
}

async function buildInstallHint(readOsRelease: OsReleaseReader, displayServer: ScreenshotDisplayServer): Promise<string> {
  const osRelease = await readOsRelease();
  const distro = parseOsRelease(osRelease);
  const distroCommand = getDistroInstallCommand(distro);
  const sessionPackages = displayServer === 'wayland'
    ? 'Wayland: grim (wlroots), gnome-screenshot (GNOME), or spectacle (KDE).'
    : displayServer === 'x11'
      ? 'X11: maim, scrot, gnome-screenshot, spectacle, or ImageMagick import.'
      : 'Wayland/X11: grim, gnome-screenshot, spectacle, maim, scrot, or ImageMagick import.';
  const commandText = distroCommand ? ` Suggested command for this distro family: ${distroCommand}.` : '';
  return `Install one supported screenshot utility for the active desktop/session. ${sessionPackages}${commandText} For another distribution, use its package manager to install one of: grim, gnome-screenshot, spectacle, maim, scrot, imagemagick.`;
}

function parseOsRelease(content: string | null): { id?: string; idLike: string[] } {
  if (!content) return { idLike: [] };
  const values = new Map<string, string>();
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/u);
    if (!match) continue;
    values.set(match[1].toLowerCase(), unquoteOsReleaseValue(match[2]));
  }
  const id = values.get('id');
  const idLike = values.get('id_like')?.split(/\s+/u).filter(Boolean) ?? [];
  return { id, idLike };
}

function unquoteOsReleaseValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function getDistroInstallCommand(distro: { id?: string; idLike: string[] }): string | undefined {
  const ids = new Set([distro.id, ...distro.idLike].filter(Boolean).map((value) => value!.toLowerCase()));
  if (hasAny(ids, ['arch', 'manjaro', 'endeavouros'])) return 'sudo pacman -S grim gnome-screenshot spectacle maim scrot imagemagick';
  if (hasAny(ids, ['debian', 'ubuntu', 'linuxmint', 'pop'])) return 'sudo apt update && sudo apt install grim gnome-screenshot spectacle maim scrot imagemagick';
  if (hasAny(ids, ['fedora', 'rhel', 'centos'])) return 'sudo dnf install grim gnome-screenshot spectacle maim scrot ImageMagick';
  if (hasAny(ids, ['opensuse', 'suse'])) return 'sudo zypper install grim gnome-screenshot spectacle maim scrot ImageMagick';
  if (hasAny(ids, ['alpine'])) return 'sudo apk add grim scrot imagemagick';
  if (hasAny(ids, ['nixos', 'nix'])) return 'nix profile install nixpkgs#grim nixpkgs#gnome-screenshot nixpkgs#spectacle nixpkgs#maim nixpkgs#scrot nixpkgs#imagemagick';
  return undefined;
}

function hasAny(values: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => values.has(candidate));
}

export function summarizeScreenshotResult(result: ScreenshotResult, options?: { inlineAttached?: boolean }): string {
  const lines = [
    `screenshot: ${result.outputPath}`,
    `display: ${result.displayServer}`,
    `program: ${result.screenshotProgram} (${basename(result.command)})`,
    `image size: ${result.outputSizeBytes.toLocaleString('en-US')} bytes`,
    options?.inlineAttached ? 'inline image: attached in this tool result' : 'inline image: not attached; use outputPath only if you need the saved file',
    result.warnings.length ? `warnings: ${result.warnings.join('; ')}` : undefined,
  ].filter(Boolean);
  return lines.join('\n');
}
