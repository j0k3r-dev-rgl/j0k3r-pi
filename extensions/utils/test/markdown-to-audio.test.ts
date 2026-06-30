import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import utilsExtension from '../index.js';
import { convertMarkdownToAudio, markdownToPlainText, type CommandRunner } from '../src/markdown-to-audio.js';

type Tool = {
  name: string;
  description: string;
  parameters: { type: string; [key: string]: unknown };
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

async function tempMarkdown(name = 'note.md', content = '# Hola\n\nEsto es **importante**. [Link](https://example.test).') {
  const dir = join(tmpdir(), `pi-utils-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, content, 'utf8');
  return { dir, path };
}

describe('markdownToPlainText', () => {
  it('turns common markdown syntax into readable speech text', () => {
    const text = markdownToPlainText(`---\ntitle: Demo\n---\n# Título\n\n![alt voz](img.png)\n\nHola **mundo** y [Pi](https://pi.test).\n\n- uno\n- dos\n\n\`inline\`\n\n\`\`\`ts\nconst secret = true;\n\`\`\``);

    expect(text).toContain('Título.');
    expect(text).toContain('alt voz');
    expect(text).toContain('Hola mundo y Pi.');
    expect(text).toContain('uno.');
    expect(text).toContain('dos.');
    expect(text).toContain('inline');
    expect(text).not.toContain('title: Demo');
    expect(text).not.toContain('https://pi.test');
    expect(text).not.toContain('const secret');
  });

  it('uses markdown structure to create more narration-friendly plain text without editing the source', () => {
    const source = `# Informe de IA\n\n## Chips y mercado\n\n- Nvidia acelera nuevos procesadores\n- OpenAI presenta novedades: más contexto\n\nMás detalles en https://example.test/noticia.\n\n| Actor | Impacto |\n| --- | --- |\n| AMD | Competencia |`;

    const text = markdownToPlainText(source);

    expect(text).toContain('Informe de IA.');
    expect(text).toContain('Chips y mercado.');
    expect(text).toContain('Nvidia acelera nuevos procesadores.');
    expect(text).toContain('OpenAI presenta novedades: más contexto.');
    expect(text).not.toContain('https://example.test/noticia');
    expect(text).not.toContain('| --- |');
    expect(source).toContain('- Nvidia acelera nuevos procesadores');
  });
});

describe('convertMarkdownToAudio', () => {
  it('uses Piper first in auto mode and writes a wav next to the markdown by default', async () => {
    const file = await tempMarkdown('brief.md', '# Hola\n\nContenido para escuchar.');
    const runCommand: CommandRunner = vi.fn(async (command, args, options) => {
      expect(command).toBe('/usr/bin/piper-tts');
      expect(args).toEqual(['-m', '/voices/es.onnx', '-f', join(file.dir, 'brief.wav')]);
      expect(options.input).toContain('Hola');
      await writeFile(join(file.dir, 'brief.wav'), 'wav bytes');
      return { stdout: '', stderr: '', code: 0 };
    });

    const result = await convertMarkdownToAudio({
      path: file.path,
      cwd: file.dir,
      engine: 'auto',
      language: 'es_ES',
      findCommand: async (name) => (name === 'piper-tts' ? '/usr/bin/piper-tts' : null),
      findVoiceModel: async () => '/voices/es.onnx',
      runCommand,
    });

    expect(result.engine).toBe('piper');
    expect(result.outputPath).toBe(join(file.dir, 'brief.wav'));
    expect(result.voiceModel).toBe('/voices/es.onnx');
    expect(result.textCharCount).toBeGreaterThan(0);
    expect((await stat(result.outputPath)).size).toBeGreaterThan(0);
  });

  it('passes narration tuning controls to Piper', async () => {
    const file = await tempMarkdown('brief.md', '# Hola\n\nContenido para escuchar.');
    const outputPath = join(file.dir, 'brief.wav');
    const runCommand: CommandRunner = vi.fn(async (command, args) => {
      expect(command).toBe('/usr/bin/piper-tts');
      expect(args).toEqual([
        '-m', '/voices/es.onnx',
        '-f', outputPath,
        '--length-scale', '0.80',
        '--sentence-silence', '0.35',
        '--noise-scale', '0.55',
        '--noise-w', '0.65',
      ]);
      await writeFile(outputPath, 'wav bytes');
      return { stdout: '', stderr: '', code: 0 };
    });

    await convertMarkdownToAudio({
      path: file.path,
      cwd: file.dir,
      outputPath,
      engine: 'piper',
      speed: 1.25,
      sentenceSilence: 0.35,
      noiseScale: 0.55,
      noiseW: 0.65,
      findCommand: async (name) => (name === 'piper-tts' ? '/usr/bin/piper-tts' : null),
      findVoiceModel: async () => '/voices/es.onnx',
      runCommand,
    });
  });

  it('falls back to espeak-ng when Piper is unavailable', async () => {
    const file = await tempMarkdown();
    const outputPath = join(file.dir, 'speech.wav');
    const runCommand: CommandRunner = vi.fn(async (command, args, options) => {
      expect(command).toBe('/usr/bin/espeak-ng');
      expect(args).toEqual(['-w', outputPath, '-v', 'es', '-s', '175']);
      expect(options.input).toContain('Hola');
      await writeFile(outputPath, 'wav bytes');
      return { stdout: '', stderr: '', code: 0 };
    });

    const result = await convertMarkdownToAudio({
      path: file.path,
      cwd: file.dir,
      outputPath,
      engine: 'auto',
      language: 'es',
      findCommand: async (name) => (name === 'espeak-ng' ? '/usr/bin/espeak-ng' : null),
      runCommand,
    });

    expect(result.engine).toBe('espeak-ng');
    expect(result.outputPath).toBe(outputPath);
  });

  it('converts wav to mp3 with ffmpeg at the default speech bitrate when outputPath ends in mp3', async () => {
    const file = await tempMarkdown();
    const outputPath = join(file.dir, 'speech.mp3');
    const commands: string[] = [];
    const runCommand: CommandRunner = vi.fn(async (command, args, options) => {
      commands.push(command);
      if (command === '/usr/bin/espeak-ng') {
        expect(args[0]).toBe('-w');
        await writeFile(String(args[1]), 'wav bytes');
        return { stdout: '', stderr: '', code: 0 };
      }
      expect(command).toBe('/usr/bin/ffmpeg');
      expect(args).toEqual(['-y', '-i', expect.stringMatching(/\.wav$/), '-b:a', '64k', outputPath]);
      await writeFile(outputPath, 'mp3 bytes');
      return { stdout: '', stderr: '', code: 0 };
    });

    const result = await convertMarkdownToAudio({
      path: file.path,
      cwd: file.dir,
      outputPath,
      engine: 'espeak-ng',
      findCommand: async (name) => ({ 'espeak-ng': '/usr/bin/espeak-ng', ffmpeg: '/usr/bin/ffmpeg' })[name] ?? null,
      runCommand,
    });

    expect(commands).toEqual(['/usr/bin/espeak-ng', '/usr/bin/ffmpeg']);
    expect(result.format).toBe('mp3');
    expect(await readFile(outputPath, 'utf8')).toBe('mp3 bytes');
  });

  it('uses a custom mp3 bitrate when provided', async () => {
    const file = await tempMarkdown();
    const outputPath = join(file.dir, 'speech.mp3');
    const runCommand: CommandRunner = vi.fn(async (command, args) => {
      if (command === '/usr/bin/espeak-ng') {
        await writeFile(String(args[1]), 'wav bytes');
        return { stdout: '', stderr: '', code: 0 };
      }
      expect(command).toBe('/usr/bin/ffmpeg');
      expect(args).toEqual(['-y', '-i', expect.stringMatching(/\.wav$/), '-b:a', '48k', outputPath]);
      await writeFile(outputPath, 'mp3 bytes');
      return { stdout: '', stderr: '', code: 0 };
    });

    const result = await convertMarkdownToAudio({
      path: file.path,
      cwd: file.dir,
      outputPath,
      engine: 'espeak-ng',
      mp3BitrateKbps: 48,
      findCommand: async (name) => ({ 'espeak-ng': '/usr/bin/espeak-ng', ffmpeg: '/usr/bin/ffmpeg' })[name] ?? null,
      runCommand,
    });

    expect(result.format).toBe('mp3');
  });

  it('throws a helpful error when no supported engine is installed', async () => {
    const file = await tempMarkdown();
    await expect(convertMarkdownToAudio({
      path: file.path,
      cwd: file.dir,
      engine: 'auto',
      findCommand: async () => null,
    })).rejects.toThrow(/install piper-tts or espeak-ng/i);
  });
});

describe('utils extension tool', () => {
  it('registers markdown_to_audio', () => {
    const pi = createMockPi();
    utilsExtension(pi as any);

    const tool = pi.tools.find((entry) => entry.name === 'markdown_to_audio');
    expect(tool?.description).toMatch(/markdown/i);
    expect(tool?.parameters.type).toBe('object');
    expect(JSON.stringify(tool?.parameters)).toContain('sentenceSilence');
    expect(JSON.stringify(tool?.parameters)).toContain('noiseScale');
    expect(JSON.stringify(tool?.parameters)).toContain('noiseW');
    expect(JSON.stringify(tool?.parameters)).toContain('voiceQuality');
    expect(JSON.stringify(tool?.parameters)).toContain('mp3BitrateKbps');
  });
});
