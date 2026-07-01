import { mkdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import utilsExtension from '../index.js';
import { captureScreenshot, type ScreenshotCommandRunner } from '../src/screenshot.js';

type Tool = {
  name: string;
  description: string;
  parameters: { type: string; [key: string]: unknown };
  promptGuidelines?: string[];
  execute: (...args: unknown[]) => Promise<unknown> | unknown;
};

function createMockPi() {
  const tools: Tool[] = [];
  return {
    tools,
    registerTool(tool: Tool) {
      tools.push(tool);
    },
  };
}

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

async function tempOutput(name = 'screen.png') {
  const dir = join(tmpdir(), `pi-utils-screenshot-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return { dir, outputPath: join(dir, name) };
}

async function writeTinyPng(path: string) {
  await writeFile(path, TINY_PNG);
}

describe('captureScreenshot', () => {
  it('rejects non-linux platforms with a clear Linux-only error', async () => {
    const file = await tempOutput();

    await expect(captureScreenshot({
      cwd: file.dir,
      outputPath: file.outputPath,
      platform: 'darwin',
      env: { DISPLAY: ':0' },
      findCommand: async () => '/usr/bin/gnome-screenshot',
    })).rejects.toMatchObject({ code: 'unsupported_platform' });
  });

  it('rejects pure shell or headless sessions without DISPLAY or WAYLAND_DISPLAY', async () => {
    const file = await tempOutput();
    const findCommand = vi.fn(async () => '/usr/bin/grim');

    await expect(captureScreenshot({
      cwd: file.dir,
      outputPath: file.outputPath,
      platform: 'linux',
      env: { SSH_TTY: '/dev/pts/1' },
      findCommand,
    })).rejects.toMatchObject({ code: 'no_graphical_session' });
    expect(findCommand).not.toHaveBeenCalled();
  });

  it('defaults screenshots to the system temporary directory when outputPath is omitted', async () => {
    const file = await tempOutput();
    const expectedPath = join(tmpdir(), 'pi-screenshot-2026-07-01T00-00-00-000Z.png');
    const runCommand: ScreenshotCommandRunner = vi.fn(async (command, args) => {
      expect(command).toBe('/usr/bin/maim');
      expect(args).toEqual([expectedPath]);
      await writeTinyPng(String(args[0]));
      return { stdout: '', stderr: '', code: 0 };
    });

    const result = await captureScreenshot({
      cwd: file.dir,
      platform: 'linux',
      env: { DISPLAY: ':0' },
      now: () => new Date('2026-07-01T00:00:00.000Z'),
      findCommand: async (name) => (name === 'maim' ? '/usr/bin/maim' : null),
      runCommand,
    });

    expect(result.outputPath).toBe(expectedPath);
    expect(result.outputPath.startsWith(tmpdir())).toBe(true);
  });

  it('uses grim first on Wayland and writes a png screenshot', async () => {
    const file = await tempOutput('wayland.png');
    const runCommand: ScreenshotCommandRunner = vi.fn(async (command, args) => {
      expect(command).toBe('/usr/bin/grim');
      expect(args).toEqual([file.outputPath]);
      await writeTinyPng(file.outputPath);
      return { stdout: '', stderr: '', code: 0 };
    });

    const result = await captureScreenshot({
      cwd: file.dir,
      outputPath: file.outputPath,
      platform: 'linux',
      env: { WAYLAND_DISPLAY: 'wayland-1', XDG_CURRENT_DESKTOP: 'sway' },
      findCommand: async (name) => (name === 'grim' ? '/usr/bin/grim' : null),
      runCommand,
    });

    expect(result.displayServer).toBe('wayland');
    expect(result.screenshotProgram).toBe('grim');
    expect(result.command).toBe('/usr/bin/grim');
    expect(result.outputPath).toBe(file.outputPath);
    expect((await stat(file.outputPath)).size).toBeGreaterThan(0);
  });

  it('uses an X11-capable utility when DISPLAY is present', async () => {
    const file = await tempOutput('x11.png');
    const runCommand: ScreenshotCommandRunner = vi.fn(async (command, args) => {
      expect(command).toBe('/usr/bin/maim');
      expect(args).toEqual([file.outputPath]);
      await writeTinyPng(file.outputPath);
      return { stdout: '', stderr: '', code: 0 };
    });

    const result = await captureScreenshot({
      cwd: file.dir,
      outputPath: file.outputPath,
      platform: 'linux',
      env: { DISPLAY: ':0', XDG_CURRENT_DESKTOP: 'i3' },
      findCommand: async (name) => (name === 'maim' ? '/usr/bin/maim' : null),
      runCommand,
    });

    expect(result.displayServer).toBe('x11');
    expect(result.screenshotProgram).toBe('maim');
  });

  it('falls back to another installed program when the first one fails', async () => {
    const file = await tempOutput('fallback.png');
    const commands: string[] = [];
    const runCommand: ScreenshotCommandRunner = vi.fn(async (command, args) => {
      commands.push(command);
      if (command.endsWith('/grim')) {
        return { stdout: '', stderr: 'compositor does not support screencopy', code: 1 };
      }
      expect(command).toBe('/usr/bin/gnome-screenshot');
      expect(args).toEqual(['-f', file.outputPath]);
      await writeTinyPng(file.outputPath);
      return { stdout: '', stderr: '', code: 0 };
    });

    const result = await captureScreenshot({
      cwd: file.dir,
      outputPath: file.outputPath,
      platform: 'linux',
      env: { WAYLAND_DISPLAY: 'wayland-0', XDG_CURRENT_DESKTOP: 'GNOME' },
      findCommand: async (name) => ({ grim: '/usr/bin/grim', 'gnome-screenshot': '/usr/bin/gnome-screenshot' })[name] ?? null,
      runCommand,
    });

    expect(commands).toEqual(['/usr/bin/grim', '/usr/bin/gnome-screenshot']);
    expect(result.screenshotProgram).toBe('gnome-screenshot');
    expect(result.warnings.join('\n')).toMatch(/grim failed/i);
  });

  it('explains how to install dependencies for the detected distro when no screenshot program exists', async () => {
    const file = await tempOutput();

    await expect(captureScreenshot({
      cwd: file.dir,
      outputPath: file.outputPath,
      platform: 'linux',
      env: { DISPLAY: ':0' },
      findCommand: async () => null,
      readOsRelease: async () => 'ID=arch\nID_LIKE=arch\n',
    })).rejects.toMatchObject({
      code: 'missing_dependency',
      installHint: expect.stringContaining('sudo pacman -S'),
    });
  });
});

describe('screenshot tool registration', () => {
  it('registers screenshot with Linux/headless/dependency guidance', () => {
    const pi = createMockPi();
    utilsExtension(pi as any);

    const tool = pi.tools.find((entry) => entry.name === 'screenshot');
    expect(tool?.description).toMatch(/linux/i);
    expect(tool?.parameters.type).toBe('object');
    expect(JSON.stringify(tool?.parameters)).toContain('outputPath');
    expect(tool?.promptGuidelines?.join('\n')).toMatch(/DISPLAY|WAYLAND_DISPLAY/);
    expect(tool?.promptGuidelines?.join('\n')).toMatch(/install/i);
    expect(tool?.promptGuidelines?.join('\n')).toMatch(/default temporary output path/i);
  });

  it('captures and returns the screenshot image inline in one tool call', async () => {
    const pi = createMockPi();
    utilsExtension(pi as any);
    const tool = pi.tools.find((entry) => entry.name === 'screenshot');
    const file = await tempOutput('inline.png');

    const result: any = await tool?.execute('tool-call-1', {
      outputPath: file.outputPath,
      platform: 'linux',
      findCommand: async (name: string) => (name === 'grim' ? '/usr/bin/grim' : null),
      runCommand: async (_command: string, _args: string[]) => {
        await writeTinyPng(file.outputPath);
        return { stdout: '', stderr: '', code: 0 };
      },
    }, undefined, undefined, {
      cwd: file.dir,
      env: { WAYLAND_DISPLAY: 'wayland-1' },
    });

    expect(result).toMatchObject({ details: { status: 'success' } });
    expect(result?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('screenshot:') }),
      expect.objectContaining({ type: 'image', mimeType: 'image/png', data: TINY_PNG.toString('base64') }),
    ]));
  });

  it('returns actionable missing dependency failures from the tool wrapper', async () => {
    const pi = createMockPi();
    utilsExtension(pi as any);
    const tool = pi.tools.find((entry) => entry.name === 'screenshot');
    const file = await tempOutput('tool.png');

    const result = await tool?.execute('tool-call-1', {
      outputPath: file.outputPath,
      findCommand: async () => null,
    }, undefined, undefined, {
      cwd: file.dir,
      env: { DISPLAY: ':0' },
    });

    expect(result).toMatchObject({
      details: {
        status: 'failure',
        error: {
          code: 'missing_dependency',
          recoverable: true,
        },
      },
      isError: true,
    });
    expect(JSON.stringify(result)).toMatch(/install/i);
  });
});
