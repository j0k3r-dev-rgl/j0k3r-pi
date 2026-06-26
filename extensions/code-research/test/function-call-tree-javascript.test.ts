import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { executeFunctionCallTree } from '../src/core/function-call-tree-resolver.js';

async function createProject(files: Record<string, string>): Promise<string> {
  const rootDir = join(tmpdir(), `pi-function-call-tree-js-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootDir, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(rootDir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }

  return rootDir;
}

describe('function_call_tree JavaScript', () => {
  it('follows imported functions recursively across project files', async () => {
    const rootDir = await createProject({
      'src/service.js': `export function runService() {\n  helper();\n}\n\nfunction helper() {}\n`,
      'src/controller.js': `import { runService } from './service.js';\n\nexport function handle() {\n  runService();\n}\n`,
    });

    const execution = await executeFunctionCallTree(rootDir, {
      path: 'src/controller.js',
      symbol: 'handle',
      language: 'js',
      max_depth: 5,
      include_external: true,
    });

    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;

    expect(execution.result.root.symbol).toBe('handle');
    expect(execution.result.root.kind).toBe('function');
    expect(execution.result.root.children?.[0].symbol).toBe('runService');
    expect(execution.result.root.children?.[0].children?.[0].symbol).toBe('helper');
    expect(execution.result.stats.application_nodes).toBe(3);
  });

  it('ignores generated output directories that contain oversized bundled files', async () => {
    const rootDir = await createProject({
      'package.json': `{"name":"fixture","type":"module"}\n`,
      'app/service.js': `export function runService() {\n  helper();\n}\n\nfunction helper() {}\n`,
      'app/routes/controller.js': `import { runService } from '../service.js';\n\nexport async function loader() {\n  runService();\n}\n`,
      'build/server/index.js': `export const bundle = "${'x'.repeat(1024 * 1024 + 64)}";\n`,
      '.react-router/types/routes.js': `export const generated = true;\n`,
    });

    const execution = await executeFunctionCallTree(rootDir, {
      path: 'app/routes/controller.js',
      symbol: 'loader',
      language: 'js',
      kind: 'function',
      max_depth: 5,
      include_external: true,
    });

    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;

    expect(execution.result.root.symbol).toBe('loader');
    expect(execution.result.root.children?.[0].symbol).toBe('runService');
    expect(execution.result.root.children?.[0].children?.[0].symbol).toBe('helper');
  });

  it('resolves js project aliases from tsconfig paths for javascript files', async () => {
    const rootDir = await createProject({
      'tsconfig.json': `{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "~/*": ["./app/*"]
    },
    "allowJs": true
  }
}
`,
      'app/server/auth/guards.server.js': `export async function requirePermission(request, roles) {\n  return requireAuthenticated(request, roles);\n}\n\nasync function requireAuthenticated(request, roles) {\n  return { request, roles, token: 'x' };\n}\n`,
      'app/routes/root/resenia.js': `import { requirePermission } from '~/server/auth/guards.server.js';\n\nexport async function loader({ request }) {\n  return requirePermission(request, ['ROLE_ROOT']);\n}\n`,
    });

    const execution = await executeFunctionCallTree(rootDir, {
      path: 'app/routes/root/resenia.js',
      symbol: 'loader',
      language: 'js',
      kind: 'function',
      max_depth: 5,
      include_external: true,
    });

    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;

    const child = execution.result.root.children?.[0];
    expect(child?.symbol).toBe('requirePermission');
    expect(child?.node_type).toBe('application');
    expect(child?.children?.[0].symbol).toBe('requireAuthenticated');
    expect(execution.result.stats.application_nodes).toBe(3);
  });

  it('treats destructured exported bindings from internal alias modules as application call targets', async () => {
    const rootDir = await createProject({
      'tsconfig.json': `{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "~/*": ["./app/*"]
    },
    "allowJs": true
  }
}
`,
      'app/services/cookies.service.server.js': `const authSessionStorage = {\n  getSession: async function getSession(cookieHeader) {\n    return { cookieHeader };\n  },\n};\n\nexport const { getSession, commitSession } = authSessionStorage;\n`,
      'app/server/auth/session.server.js': `import { getSession } from '~/services/cookies.service.server.js';\n\nexport async function getSessionInfo(request) {\n  return getSession(request.headers.get('Cookie'));\n}\n`,
      'app/routes/root/resenia.js': `import { getSessionInfo } from '~/server/auth/session.server.js';\n\nexport async function loader({ request }) {\n  return getSessionInfo(request);\n}\n`,
    });

    const execution = await executeFunctionCallTree(rootDir, {
      path: 'app/routes/root/resenia.js',
      symbol: 'loader',
      language: 'js',
      kind: 'function',
      max_depth: 5,
      include_external: true,
    });

    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;

    const getSessionInfo = execution.result.root.children?.[0];
    expect(getSessionInfo?.symbol).toBe('getSessionInfo');
    expect(getSessionInfo?.node_type).toBe('application');
    expect(getSessionInfo?.children?.[0].symbol).toBe('getSession');
    expect(getSessionInfo?.children?.[0].node_type).toBe('application');
    expect(execution.result.stats.application_nodes).toBe(3);
  });

  it('resolves absolute file paths outside cwd by deriving the project root from js markers', async () => {
    const rootDir = await createProject({
      'package.json': `{"name":"fixture","type":"module"}\n`,
      'app/service.js': `export function runService() {\n  helper();\n}\n\nfunction helper() {}\n`,
      'app/routes/controller.js': `import { runService } from '../service.js';\n\nexport async function loader() {\n  runService();\n}\n`,
    });

    const execution = await executeFunctionCallTree('/tmp', {
      path: resolve(rootDir, 'app/routes/controller.js'),
      symbol: 'loader',
      language: 'js',
      kind: 'function',
      max_depth: 5,
      include_external: true,
    });

    expect(execution.status).toBe('ok');
    if (execution.status !== 'ok') return;

    expect(execution.result.root.symbol).toBe('loader');
    expect(execution.result.root.children?.[0].symbol).toBe('runService');
    expect(execution.result.root.children?.[0].children?.[0].symbol).toBe('helper');
  });
});
