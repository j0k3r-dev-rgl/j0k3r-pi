import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';

export type ScreenshotAction = 'capture' | 'list-windows';
export type ScreenshotCaptureTarget = 'screen' | 'active-window' | 'window';
export type ScreenshotWindowMatchMode = 'exact' | 'contains' | 'regex';
export type ScreenshotDisplayServer = 'wayland' | 'x11' | 'wayland+x11';
export type ScreenshotErrorCode = 'unsupported_platform' | 'unsupported_display_server' | 'no_graphical_session' | 'missing_dependency' | 'capture_failed' | 'validation_error';
export type ScreenshotWindowBackend = 'hyprland';

export interface ScreenshotCommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type ScreenshotCommandRunner = (command: string, args: string[], options: { signal?: AbortSignal; env?: NodeJS.ProcessEnv }) => Promise<ScreenshotCommandResult>;
export type ScreenshotCommandFinder = (command: string) => Promise<string | null>;
export type OsReleaseReader = () => Promise<string | null>;

export interface ScreenshotBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotWindow {
  id: string;
  title: string;
  app?: string;
  focused: boolean;
  bounds?: ScreenshotBounds;
  workspace?: string;
  output?: string;
  pid?: number;
  backend: ScreenshotWindowBackend;
}

export interface ScreenshotInput {
  cwd: string;
  action?: ScreenshotAction;
  target?: ScreenshotCaptureTarget;
  windowId?: string;
  windowTitle?: string;
  match?: ScreenshotWindowMatchMode;
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
  action: 'capture';
  target: ScreenshotCaptureTarget;
  outputPath: string;
  displayServer: ScreenshotDisplayServer;
  screenshotProgram: string;
  command: string;
  outputSizeBytes: number;
  warnings: string[];
  window?: ScreenshotWindow;
  windowBackend?: ScreenshotWindowBackend;
}

export interface ScreenshotWindowListResult {
  action: 'list-windows';
  displayServer: ScreenshotDisplayServer;
  backend: ScreenshotWindowBackend;
  command: string;
  windows: ScreenshotWindow[];
  warnings: string[];
}

export type ScreenshotToolResult = ScreenshotResult | ScreenshotWindowListResult;

interface ScreenshotCandidate {
  name: string;
  display: 'wayland' | 'x11' | 'both';
  args(outputPath: string): string[];
}

interface WaylandWindowBackendCandidate {
  backend: ScreenshotWindowBackend;
  commandName: string;
  args: string[];
  parse(stdout: string): ScreenshotWindow[];
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

const HYPRLAND_WINDOW_BACKEND: WaylandWindowBackendCandidate = {
  backend: 'hyprland',
  commandName: 'hyprctl',
  args: ['clients', '-j'],
  parse: parseHyprlandWindows,
};


export async function executeScreenshotAction(input: ScreenshotInput): Promise<ScreenshotToolResult> {
  const action = normalizeAction(input.action);
  if (action === 'list-windows') return await listScreenshotWindows(input);
  return await captureScreenshot(input);
}

export async function captureScreenshot(input: ScreenshotInput): Promise<ScreenshotResult> {
  const platform = input.platform ?? process.platform;
  if (platform !== 'linux') {
    throw new ScreenshotError('unsupported_platform', `screenshot supports Linux only; current platform is ${platform}`, { recoverable: false });
  }

  const env = input.env ?? process.env;
  const displayServer = detectDisplayServer(env);
  if (!displayServer) {
    throw noGraphicalSessionError();
  }

  const cwd = input.cwd || process.cwd();
  const outputPath = resolveOutputPath(cwd, input.outputPath, input.now ?? (() => new Date()));
  await mkdir(dirname(outputPath), { recursive: true });

  const target = normalizeTarget(input.target);
  const findCommand = input.findCommand ?? findCommandOnPath;
  const runCommand = input.runCommand ?? runCommandWithSpawn;

  if (target !== 'screen') {
    return await captureWaylandWindow(input, target, displayServer, outputPath, findCommand, runCommand, env);
  }

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
      action: 'capture',
      target,
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

export async function listScreenshotWindows(input: ScreenshotInput): Promise<ScreenshotWindowListResult> {
  const platform = input.platform ?? process.platform;
  if (platform !== 'linux') {
    throw new ScreenshotError('unsupported_platform', `screenshot list-windows supports Linux only; current platform is ${platform}`, { recoverable: false });
  }

  const env = input.env ?? process.env;
  const displayServer = detectDisplayServer(env);
  if (!displayServer) throw noGraphicalSessionError();
  ensureWaylandWindowSupport(displayServer, 'list windows');
  ensureHyprlandWindowSession(env);

  const findCommand = input.findCommand ?? findCommandOnPath;
  const runCommand = input.runCommand ?? runCommandWithSpawn;
  const warnings: string[] = [];
  const installed: Array<{ backend: WaylandWindowBackendCandidate; command: string }> = [];

  for (const backend of getWaylandWindowBackendsForEnv(env, input.target)) {
    const command = await findCommand(backend.commandName);
    if (command) installed.push({ backend, command });
  }

  if (installed.length === 0) {
    const installHint = buildWaylandWindowInstallHint();
    throw new ScreenshotError(
      'missing_dependency',
      `no supported Wayland window query program was found on PATH. ${installHint}`,
      { recoverable: true, installHint },
    );
  }

  for (const entry of installed) {
    const result = await runCommand(entry.command, entry.backend.args, { signal: input.signal, env });
    if (result.code !== 0) {
      warnings.push(`${entry.backend.commandName} failed with exit code ${result.code}${formatCommandOutput(result)}`);
      continue;
    }

    try {
      return {
        action: 'list-windows',
        displayServer,
        backend: entry.backend.backend,
        command: entry.command,
        windows: entry.backend.parse(result.stdout),
        warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${entry.backend.commandName} returned unrecognized window JSON: ${truncateLine(message, 240)}`);
    }
  }

  const attempts = warnings.length ? warnings.join('; ') : 'no window query attempts were made';
  throw new ScreenshotError(
    'capture_failed',
    `all installed Hyprland window query programs failed: ${attempts}. Targeted window listing/capture is currently Hyprland-only and needs hyprctl.`,
    { recoverable: true },
  );
}

async function captureWaylandWindow(
  input: ScreenshotInput,
  target: Exclude<ScreenshotCaptureTarget, 'screen'>,
  displayServer: ScreenshotDisplayServer,
  outputPath: string,
  findCommand: ScreenshotCommandFinder,
  runCommand: ScreenshotCommandRunner,
  env: NodeJS.ProcessEnv,
): Promise<ScreenshotResult> {
  ensureWaylandWindowSupport(displayServer, 'capture a specific window');

  const windowList = await listScreenshotWindows({ ...input, env, findCommand, runCommand });
  const selectedWindow = resolveSelectedWindow(windowList.windows, input, target);

  const command = await findCommand('grim');
  if (!command) {
    const installHint = 'Install grim for non-interactive Wayland window screenshots. Example on Arch: sudo pacman -S grim.';
    throw new ScreenshotError('missing_dependency', `window capture requires grim on Wayland. ${installHint}`, { recoverable: true, installHint });
  }

  const warnings = [...windowList.warnings];
  const toplevelIdentifier = await resolveHyprlandToplevelIdentifier(selectedWindow, findCommand, runCommand, input.signal, env);
  await rm(outputPath, { force: true }).catch(() => undefined);
  const result = await runCommand(command, ['-T', toplevelIdentifier, outputPath], { signal: input.signal, env });
  if (result.code !== 0) {
    throw new ScreenshotError(
      'capture_failed',
      `grim failed to capture Hyprland window ${selectedWindow.id} with toplevel identifier ${toplevelIdentifier}${formatCommandOutput(result)}`,
      { recoverable: true },
    );
  }

  const size = await getNonEmptyFileSize(outputPath);
  if (size === null) {
    throw new ScreenshotError(
      'capture_failed',
      `grim exited successfully but did not create a non-empty window screenshot at ${outputPath}`,
      { recoverable: true },
    );
  }

  return {
    action: 'capture',
    target,
    outputPath,
    displayServer,
    screenshotProgram: 'grim',
    command,
    outputSizeBytes: size,
    warnings,
    window: selectedWindow,
    windowBackend: windowList.backend,
  };
}

function normalizeAction(action: ScreenshotAction | undefined): ScreenshotAction {
  if (action === undefined || action === 'capture' || action === 'list-windows') return action ?? 'capture';
  throw new ScreenshotError('validation_error', 'screenshot action must be one of: capture, list-windows', { recoverable: false });
}

function normalizeTarget(target: ScreenshotCaptureTarget | undefined): ScreenshotCaptureTarget {
  if (target === undefined || target === 'screen' || target === 'active-window' || target === 'window') return target ?? 'screen';
  throw new ScreenshotError('validation_error', 'screenshot target must be one of: screen, active-window, window', { recoverable: false });
}

function normalizeMatchMode(match: ScreenshotWindowMatchMode | undefined): ScreenshotWindowMatchMode {
  if (match === undefined || match === 'exact' || match === 'contains' || match === 'regex') return match ?? 'contains';
  throw new ScreenshotError('validation_error', 'screenshot match must be one of: exact, contains, regex', { recoverable: false });
}

function resolveSelectedWindow(windows: ScreenshotWindow[], input: ScreenshotInput, target: Exclude<ScreenshotCaptureTarget, 'screen'>): ScreenshotWindow {
  if (target === 'active-window') {
    const focused = windows.find((window) => window.focused);
    if (!focused) {
      throw new ScreenshotError('capture_failed', 'no focused Wayland window was reported by the compositor. Use action=list-windows and select a windowId instead.', { recoverable: true });
    }
    return focused;
  }

  const windowId = input.windowId?.trim();
  if (windowId) {
    const byId = windows.find((window) => window.id === windowId);
    if (!byId) {
      throw new ScreenshotError('validation_error', `no Wayland window matched windowId ${windowId}. Use action=list-windows to inspect available ids.`, { recoverable: false });
    }
    return byId;
  }

  const title = input.windowTitle?.trim();
  if (!title) {
    throw new ScreenshotError('validation_error', 'target=window requires windowId or windowTitle. Use action=list-windows first for reliable ids.', { recoverable: false });
  }

  const matchMode = normalizeMatchMode(input.match);
  const matched = windows.filter((window) => matchesWindowTitle(window.title, title, matchMode));
  if (matched.length === 0) {
    throw new ScreenshotError('validation_error', `no Wayland window title matched ${title}. Use action=list-windows to inspect available titles.`, { recoverable: false });
  }
  if (matched.length > 1) {
    const ids = matched.map((window) => `${window.id} (${window.title || 'untitled'})`).join(', ');
    throw new ScreenshotError('validation_error', `windowTitle matched multiple windows: ${ids}. Use windowId for an unambiguous capture.`, { recoverable: false });
  }
  return matched[0];
}

function matchesWindowTitle(actualTitle: string, requestedTitle: string, matchMode: ScreenshotWindowMatchMode): boolean {
  const actual = actualTitle.toLocaleLowerCase();
  const requested = requestedTitle.toLocaleLowerCase();
  if (matchMode === 'exact') return actual === requested;
  if (matchMode === 'contains') return actual.includes(requested);
  try {
    return new RegExp(requestedTitle, 'iu').test(actualTitle);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ScreenshotError('validation_error', `invalid windowTitle regex: ${message}`, { recoverable: false });
  }
}

function ensureWaylandWindowSupport(displayServer: ScreenshotDisplayServer, operation: string): void {
  if (displayServer === 'wayland' || displayServer === 'wayland+x11') return;
  throw new ScreenshotError(
    'unsupported_display_server',
    `screenshot can ${operation} only in a Wayland session. Current display is ${displayServer}.`,
    { recoverable: true },
  );
}

function ensureHyprlandWindowSession(env: NodeJS.ProcessEnv): void {
  const desktop = [env.XDG_CURRENT_DESKTOP, env.XDG_SESSION_DESKTOP, env.DESKTOP_SESSION].filter(Boolean).join(' ').toLocaleLowerCase();
  if (env.HYPRLAND_INSTANCE_SIGNATURE || desktop.includes('hyprland')) return;
  throw new ScreenshotError(
    'unsupported_display_server',
    'Wayland window listing and targeted window capture are currently supported only on Hyprland. Full-screen screenshots still support the generic Linux screenshot backends.',
    { recoverable: false },
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

function noGraphicalSessionError(): ScreenshotError {
  return new ScreenshotError(
    'no_graphical_session',
    'screenshot requires a graphical Linux session, but neither DISPLAY nor WAYLAND_DISPLAY is set. Pi appears to be running in a pure shell, TTY, SSH, container, or headless session; start Pi inside an X11/Wayland desktop session or expose a graphical display before retrying.',
    { recoverable: true },
  );
}

function getCandidatesForDisplay(displayServer: ScreenshotDisplayServer): ScreenshotCandidate[] {
  const accepts = (candidate: ScreenshotCandidate) => {
    if (candidate.display === 'both') return true;
    if (displayServer === 'wayland+x11') return true;
    return candidate.display === displayServer;
  };
  return SUPPORTED_CANDIDATES.filter(accepts);
}

function getWaylandWindowBackendsForEnv(env: NodeJS.ProcessEnv, target?: ScreenshotCaptureTarget): WaylandWindowBackendCandidate[] {
  void env;
  void target;
  return [HYPRLAND_WINDOW_BACKEND];
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
    ? 'Wayland: grim (wlroots), gnome-screenshot (GNOME), or spectacle (KDE). Targeted window listing/capture is Hyprland-only and needs hyprctl, grim, bash, gcc, pkg-config, wayland-scanner, and Wayland development files.'
    : displayServer === 'x11'
      ? 'X11: maim, scrot, gnome-screenshot, spectacle, or ImageMagick import.'
      : 'Wayland/X11: grim, gnome-screenshot, spectacle, maim, scrot, or ImageMagick import. Targeted Wayland window capture is Hyprland-only and needs hyprctl plus grim -T support.';
  const commandText = distroCommand ? ` Suggested command for this distro family: ${distroCommand}.` : '';
  return `Install one supported screenshot utility for the active desktop/session. ${sessionPackages}${commandText} For another distribution, use its package manager to install one of: grim, gnome-screenshot, spectacle, maim, scrot, imagemagick.`;
}

function buildWaylandWindowInstallHint(): string {
  return 'Hyprland window listing/capture requires hyprctl. Capturing a specific Hyprland window also requires grim, bash, gcc, pkg-config, wayland-scanner, and Wayland development files so the tool can resolve foreign toplevel identifiers for grim -T.';
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

function parseHyprlandWindows(stdout: string): ScreenshotWindow[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) throw new Error('expected hyprctl clients -j to return an array');

  return parsed
    .filter(isRecord)
    .map((client, index): ScreenshotWindow => {
      const at = toNumberTuple(client.at);
      const size = toNumberTuple(client.size);
      const workspace = isRecord(client.workspace) ? client.workspace : undefined;
      const id = stringValue(client.address) || `hyprland:${index}`;
      return {
        id,
        title: stringValue(client.title) ?? '',
        app: stringValue(client.class) ?? stringValue(client.initialClass),
        focused: numberValue(client.focusHistoryID) === 0,
        bounds: at && size ? normalizeBounds(at[0], at[1], size[0], size[1]) : undefined,
        workspace: stringValue(workspace?.name) ?? stringValue(workspace?.id),
        output: stringValue(client.monitor),
        pid: integerValue(client.pid),
        backend: 'hyprland',
      };
    });
}

interface HyprlandToplevelIdentifier {
  identifier: string;
  app?: string;
  title: string;
}

async function resolveHyprlandToplevelIdentifier(
  selectedWindow: ScreenshotWindow,
  findCommand: ScreenshotCommandFinder,
  runCommand: ScreenshotCommandRunner,
  signal: AbortSignal | undefined,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const bash = await findCommand('bash');
  if (!bash) {
    throw new ScreenshotError(
      'missing_dependency',
      'Hyprland window capture requires bash, gcc, pkg-config, wayland-scanner, Wayland development files, and grim so the tool can resolve a foreign toplevel identifier for grim -T.',
      { recoverable: true },
    );
  }

  const result = await runCommand(bash, ['-lc', buildHyprlandToplevelIdentifierProbeScript()], { signal, env });
  if (result.code !== 0) {
    throw new ScreenshotError(
      'capture_failed',
      `failed to resolve Hyprland foreign toplevel identifiers${formatCommandOutput(result)}`,
      { recoverable: true },
    );
  }

  const identifiers = parseHyprlandToplevelIdentifiers(result.stdout);
  const exactMatches = identifiers.filter((entry) => entry.title === selectedWindow.title && (!selectedWindow.app || entry.app === selectedWindow.app));
  const titleMatches = identifiers.filter((entry) => entry.title === selectedWindow.title);
  const appMatches = identifiers.filter((entry) => selectedWindow.app && entry.app === selectedWindow.app);
  const match = exactMatches[0] ?? (titleMatches.length === 1 ? titleMatches[0] : undefined) ?? (appMatches.length === 1 ? appMatches[0] : undefined);
  if (!match) {
    throw new ScreenshotError(
      'capture_failed',
      `could not map Hyprland window ${selectedWindow.id} (${selectedWindow.title || 'untitled'}) to a foreign toplevel identifier for grim -T`,
      { recoverable: true },
    );
  }
  return match.identifier;
}

function parseHyprlandToplevelIdentifiers(stdout: string): HyprlandToplevelIdentifier[] {
  const identifiers: HyprlandToplevelIdentifier[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^identifier=(\S+)\s+app_id=(.*?)\s+title=(.*)$/u);
    if (!match) continue;
    const [, identifier, app, title] = match;
    identifiers.push({ identifier, app: app || undefined, title });
  }
  return identifiers;
}

function buildHyprlandToplevelIdentifierProbeScript(): string {
  return String.raw`set -euo pipefail
work="$(mktemp -d /tmp/pi-hypr-toplevel-XXXXXX)"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT
proto="/usr/share/wayland-protocols/staging/ext-foreign-toplevel-list/ext-foreign-toplevel-list-v1.xml"
wayland-scanner client-header "$proto" "$work/ext-foreign-toplevel-list-v1.h"
wayland-scanner private-code "$proto" "$work/ext-foreign-toplevel-list-v1.c"
cat > "$work/list-ext-toplevels.c" <<'EOF'
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wayland-client.h>
#include "ext-foreign-toplevel-list-v1.h"
struct ctx { struct wl_display *display; struct wl_registry *registry; struct ext_foreign_toplevel_list_v1 *list; };
struct top { char *identifier; char *title; char *app_id; };
static void closed(void *data, struct ext_foreign_toplevel_handle_v1 *h) { (void)data; (void)h; }
static void done(void *data, struct ext_foreign_toplevel_handle_v1 *h) { struct top *t = data; printf("identifier=%s app_id=%s title=%s\n", t->identifier ? t->identifier : "", t->app_id ? t->app_id : "", t->title ? t->title : ""); fflush(stdout); ext_foreign_toplevel_handle_v1_destroy(h); free(t->identifier); free(t->title); free(t->app_id); free(t); }
static void title(void *data, struct ext_foreign_toplevel_handle_v1 *h, const char *title) { (void)h; struct top *t = data; free(t->title); t->title = strdup(title ? title : ""); }
static void app_id(void *data, struct ext_foreign_toplevel_handle_v1 *h, const char *app_id) { (void)h; struct top *t = data; free(t->app_id); t->app_id = strdup(app_id ? app_id : ""); }
static void identifier(void *data, struct ext_foreign_toplevel_handle_v1 *h, const char *identifier) { (void)h; struct top *t = data; free(t->identifier); t->identifier = strdup(identifier ? identifier : ""); }
static const struct ext_foreign_toplevel_handle_v1_listener top_listener = { closed, done, title, app_id, identifier };
static void toplevel(void *data, struct ext_foreign_toplevel_list_v1 *list, struct ext_foreign_toplevel_handle_v1 *h) { (void)list; (void)data; struct top *t = calloc(1, sizeof(*t)); ext_foreign_toplevel_handle_v1_add_listener(h, &top_listener, t); }
static void finished(void *data, struct ext_foreign_toplevel_list_v1 *list) { (void)data; (void)list; }
static const struct ext_foreign_toplevel_list_v1_listener list_listener = { toplevel, finished };
static void global(void *data, struct wl_registry *registry, uint32_t name, const char *interface, uint32_t version) { struct ctx *ctx = data; if (strcmp(interface, ext_foreign_toplevel_list_v1_interface.name) == 0) { ctx->list = wl_registry_bind(registry, name, &ext_foreign_toplevel_list_v1_interface, version < 1 ? version : 1); ext_foreign_toplevel_list_v1_add_listener(ctx->list, &list_listener, ctx); } }
static void global_remove(void *data, struct wl_registry *registry, uint32_t name) { (void)data; (void)registry; (void)name; }
static const struct wl_registry_listener registry_listener = { global, global_remove };
int main(void) { struct ctx ctx = {0}; ctx.display = wl_display_connect(NULL); if (!ctx.display) { fprintf(stderr, "failed to connect to wayland\n"); return 1; } ctx.registry = wl_display_get_registry(ctx.display); wl_registry_add_listener(ctx.registry, &registry_listener, &ctx); wl_display_roundtrip(ctx.display); if (!ctx.list) { fprintf(stderr, "ext_foreign_toplevel_list_v1 unavailable\n"); return 2; } wl_display_roundtrip(ctx.display); wl_display_roundtrip(ctx.display); ext_foreign_toplevel_list_v1_stop(ctx.list); wl_display_roundtrip(ctx.display); return 0; }
EOF
cc -Wall -Wextra -O2 "$work/list-ext-toplevels.c" "$work/ext-foreign-toplevel-list-v1.c" -I"$work" $(pkg-config --cflags --libs wayland-client) -o "$work/list-ext-toplevels"
"$work/list-ext-toplevels"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function integerValue(value: unknown): number | undefined {
  const number = numberValue(value);
  return number === undefined ? undefined : Math.trunc(number);
}

function parseInteger(value: string): number | undefined {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function toNumberTuple(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const first = numberValue(value[0]);
  const second = numberValue(value[1]);
  return first === undefined || second === undefined ? null : [first, second];
}

function normalizeBounds(x: number | undefined, y: number | undefined, width: number | undefined, height: number | undefined): ScreenshotBounds | undefined {
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function formatBoundsGeometry(bounds: ScreenshotBounds): string {
  return `${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`;
}

export function summarizeScreenshotResult(result: ScreenshotResult, options?: { inlineAttached?: boolean }): string {
  const lines = [
    `screenshot: ${result.outputPath}`,
    `display: ${result.displayServer}`,
    `target: ${formatScreenshotTarget(result)}`,
    `program: ${result.screenshotProgram} (${basename(result.command)})`,
    `image size: ${result.outputSizeBytes.toLocaleString('en-US')} bytes`,
    options?.inlineAttached ? 'inline image: attached in this tool result' : 'inline image: not attached; use outputPath only if you need the saved file',
    result.warnings.length ? `warnings: ${result.warnings.join('; ')}` : undefined,
  ].filter(Boolean);
  return lines.join('\n');
}

export function summarizeWindowListResult(result: ScreenshotWindowListResult): string {
  const visibleWindows = result.windows.slice(0, 50);
  const lines = [
    'screenshot: list-windows',
    `display: ${result.displayServer}`,
    `backend: ${result.backend} (${basename(result.command)})`,
    `available windows: ${result.windows.length}`,
    ...visibleWindows.map(formatWindowSummaryLine),
    result.windows.length > visibleWindows.length ? `... ${result.windows.length - visibleWindows.length} more window(s) omitted from summary` : undefined,
    result.warnings.length ? `warnings: ${result.warnings.join('; ')}` : undefined,
  ].filter(Boolean);
  return lines.join('\n');
}

function formatScreenshotTarget(result: ScreenshotResult): string {
  if (!result.window) return result.target;
  const title = result.window.title ? ` · ${result.window.title}` : '';
  const app = result.window.app ? ` · ${result.window.app}` : '';
  const geometry = result.window.bounds ? ` · ${formatBoundsGeometry(result.window.bounds)}` : '';
  return `${result.target} · ${result.window.id}${title}${app}${geometry}`;
}

function formatWindowSummaryLine(window: ScreenshotWindow): string {
  const focused = window.focused ? 'focused' : 'window';
  const app = window.app ? ` · ${window.app}` : '';
  const title = window.title ? ` · ${window.title}` : ' · untitled';
  const geometry = window.bounds ? ` · ${formatBoundsGeometry(window.bounds)}` : '';
  const workspace = window.workspace ? ` · workspace ${window.workspace}` : '';
  const output = window.output ? ` · output ${window.output}` : '';
  return `- ${focused}: ${window.id}${app}${title}${geometry}${workspace}${output}`;
}
