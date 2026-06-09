import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { builtInPermissionPolicy } from '../src/defaults.js';
import { loadPermissionConfig } from '../src/config.js';
import { classifyPathTarget } from '../src/path-policy.js';
import {
  evaluateSecretDeny,
  isSecretLikeConfigKey,
  isSecretPathTarget,
  redactSecretPath,
  sanitizeSecretPromptDetails,
} from '../src/secrets.js';
import type { PermissionRequest } from '../src/types.js';

async function tempWorkspace(prefix: string) {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(cwd, 'src'), { recursive: true });
  return cwd;
}

async function requestForPath(rawPath: string, cwd: string): Promise<PermissionRequest> {
  const target = await classifyPathTarget(rawPath, { cwd, config: builtInPermissionPolicy });
  return {
    id: `req-${rawPath}`,
    source: 'tool_call',
    origin: 'main',
    tool: 'read',
    action: 'read',
    rawInputSummary: `read ${rawPath}`,
    target,
    mode: 'tui',
    hasUI: true,
    policyIdentity: 'test-policy',
    timestamp: '2026-06-09T00:00:00.000Z',
  };
}

describe('secret deny policy', () => {
  it.each([
    '.env',
    '.env.local',
    'config/private.pem',
    'config/client.key',
    'config/client.p12',
    'config/client.pfx',
    'nested/id_rsa',
    'nested/id_ed25519',
    'service-credentials.json',
  ])('matches default workspace secret glob %s', async (relativePath) => {
    const cwd = await tempWorkspace('permission-guard-secret-defaults-');
    await mkdir(join(cwd, 'config'), { recursive: true });
    await mkdir(join(cwd, 'nested'), { recursive: true });
    await writeFile(join(cwd, relativePath), 'sentinel secret content must not be read', 'utf8');

    const target = await classifyPathTarget(relativePath, { cwd, config: builtInPermissionPolicy });

    expect(isSecretPathTarget(target, builtInPermissionPolicy.secrets.denyPaths)).toMatchObject({
      matched: true,
      pattern: expect.any(String),
    });
  });

  it.each(['.ssh/id_rsa', '.ssh/config', '.aws/credentials', '.gnupg/private-keys-v1.d/key.key'])(
    'matches default home credential path %s', async (homeRelativePath) => {
      const cwd = await tempWorkspace('permission-guard-secret-home-');
      const home = join(cwd, 'home');
      const absolutePath = join(home, homeRelativePath);
      await mkdir(join(absolutePath, '..'), { recursive: true });
      await writeFile(absolutePath, 'sentinel home credential must not be read', 'utf8');

      const target = await classifyPathTarget(absolutePath, { cwd, config: builtInPermissionPolicy });

      expect(isSecretPathTarget(target, builtInPermissionPolicy.secrets.denyPaths, { homeDir: home })).toMatchObject({
        matched: true,
        pattern: expect.any(String),
      });
    },
  );

  it('denies secrets before workspace allow, outside ask, or session approval could grant access', async () => {
    const cwd = await tempWorkspace('permission-guard-secret-precedence-');
    await writeFile(join(cwd, '.env'), 'SENTINEL_SECRET=workspace', 'utf8');
    const request = await requestForPath('.env', cwd);

    const result = evaluateSecretDeny(builtInPermissionPolicy, request);

    expect(result).toMatchObject({
      decision: 'deny',
      finalDecision: 'deny',
      reasonCode: 'secret_path_denied',
      riskLevel: 'critical',
      details: {
        matchedLayer: 'secret',
        noPreview: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain('SENTINEL_SECRET');
  });

  it('treats secret-like config keys as invalid policy input without leaking values', async () => {
    const cwd = await tempWorkspace('permission-guard-secret-config-');
    const sentinel = 'sentinel-config-secret-value';
    await mkdir(join(cwd, '.pi'), { recursive: true });
    await writeFile(
      join(cwd, '.pi', 'permissions.json'),
      JSON.stringify({ password: sentinel, nested: { apiKey: sentinel }, secrets: { denyKeyPatterns: ['customSecret'] } }),
      'utf8',
    );

    const loaded = await loadPermissionConfig({ cwd, env: {}, homeDir: join(cwd, 'home') });

    expect(isSecretLikeConfigKey('apiKey', loaded.config.secrets.denyKeyPatterns)).toBe(true);
    expect(isSecretLikeConfigKey('customSecret', loaded.config.secrets.denyKeyPatterns)).toBe(true);
    expect(JSON.stringify(loaded.warnings)).toContain('password');
    expect(JSON.stringify(loaded.warnings)).toContain('nested.apiKey');
    expect(JSON.stringify(loaded.warnings)).not.toContain(sentinel);
    expect(JSON.stringify(loaded.config)).not.toContain(sentinel);
  });

  it('produces prompt-safe and audit-safe redaction without content previews', async () => {
    const cwd = await tempWorkspace('permission-guard-secret-redaction-');
    const sentinel = 'SENTINEL_PRIVATE_KEY_CONTENT';
    await writeFile(join(cwd, 'private.key'), sentinel, 'utf8');
    const request = await requestForPath('private.key', cwd);

    const redacted = redactSecretPath(request.target!.normalizedAbsolute);
    const promptDetails = sanitizeSecretPromptDetails(request, { matchedRule: '**/*.{pem,key,p12,pfx}' });

    expect(redacted).toMatch(/^\[REDACTED_PATH:[a-f0-9]{12}\]$/);
    expect(promptDetails).toMatchObject({ noPreview: true, safeTarget: redacted });
    expect(JSON.stringify({ redacted, promptDetails })).not.toContain('private.key');
    expect(JSON.stringify({ redacted, promptDetails })).not.toContain(sentinel);
  });
});
