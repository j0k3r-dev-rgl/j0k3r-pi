import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import codeResearchExtension from '../index.js';

interface RegisteredTool {
  name: string;
  execute: (toolCallId: any, params: any, signal: any, onUpdate: any, ctx: any) => Promise<any>;
}

async function createJavaProject(files: Record<string, string>): Promise<string> {
  const rootDir = join(tmpdir(), `pi-extension-entry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }

  return rootDir;
}

describe('code-research extension entry integration', () => {
  it('registers and executes find_symbol through the extension entrypoint', async () => {
    const tools: RegisteredTool[] = [];
    codeResearchExtension({
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    });

    const findSymbolTool = tools.find((tool) => tool.name === 'find_symbol');
    expect(findSymbolTool).toBeDefined();

    const rootDir = await createJavaProject({
      'src/main/java/ports/Service.java': `package ports;\npublic interface Service {\n  String run();\n}\n`,
      'src/main/java/impl/LocalService.java': `package impl;\n\nimport ports.Service;\n\npublic class LocalService implements Service {\n  public String run() {\n    return "local";\n  }\n}\n`,
    });

    const result = await findSymbolTool!.execute(
      'test-call',
      {
        path: 'src/main/java',
        symbol: 'Service',
        language: 'java',
        kind: 'interface',
      },
      undefined,
      undefined,
      { cwd: rootDir }
    );

    expect(result.details.found).toBe(1);
    expect(result.details.results[0].symbol).toBe('Service');
    expect(result.details.results[0].implementation_locations?.[0].symbol).toBe('LocalService');
  });

  it('registers and executes function_call_tree through the extension entrypoint', async () => {
    const tools: RegisteredTool[] = [];
    codeResearchExtension({
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    });

    const functionCallTreeTool = tools.find((tool) => tool.name === 'function_call_tree');
    expect(functionCallTreeTool).toBeDefined();

    const rootDir = await createJavaProject({
      'src/main/java/ports/Service.java': `package ports;\npublic interface Service {\n  void run();\n}\n`,
      'src/main/java/app/AppService.java': `package app;\n\nimport ports.Service;\n\npublic class AppService implements Service {\n  public void run() {\n    helper();\n  }\n\n  private void helper() {}\n}\n`,
      'src/main/java/web/Controller.java': `package web;\n\nimport ports.Service;\n\npublic class Controller {\n  private final Service service;\n\n  public Controller(Service service) {\n    this.service = service;\n  }\n\n  public void handle() {\n    service.run();\n  }\n}\n`,
    });

    const result = await functionCallTreeTool!.execute(
      'test-call',
      {
        path: 'src/main/java/web/Controller.java',
        symbol: 'handle',
        language: 'java',
        max_depth: 5,
        include_external: true,
      },
      undefined,
      undefined,
      { cwd: rootDir }
    );

    expect(result.details.root.symbol).toBe('handle');
    expect(result.details.root.class).toBe('Controller');
    expect(result.details.root.children?.[0].class).toBe('AppService');
    expect(result.details.root.children?.[0].children?.[0].symbol).toBe('helper');
  });
});
