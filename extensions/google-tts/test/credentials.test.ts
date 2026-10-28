import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as config from "../src/config.ts";
import { GoogleTTSService } from "../src/tts-service.ts";

function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), "pi-tts-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, envFile: join(root, ".env") };
}

function resolvePath(envFile: string, env: Record<string, string | undefined> = {}) {
  assert.equal(typeof config.getCredentialsPath, "function", "credentials must be resolved from local configuration");
  return config.getCredentialsPath(envFile, env);
}

test("reads a quoted credentials path without modifying the supplied environment", t => {
  const { root, envFile } = fixture(t);
  const value = join(root, "private directory", "account.json");
  writeFileSync(envFile, `# Private local configuration\nGOOGLE_TTS_CREDENTIALS_PATH="${value}"\n`);
  const env = Object.freeze({ UNRELATED: "unchanged" });
  assert.equal(resolvePath(envFile, env), value);
  assert.deepEqual(env, { UNRELATED: "unchanged" });
});

test("explicit environment wins and does not need an env file", t => {
  const { root, envFile } = fixture(t);
  const value = join(root, "account.json");
  assert.equal(resolvePath(envFile, { GOOGLE_TTS_CREDENTIALS_PATH: value }), value);
  writeFileSync(envFile, 'GOOGLE_TTS_CREDENTIALS_PATH="/different/example.json"');
  assert.equal(resolvePath(envFile, { GOOGLE_TTS_CREDENTIALS_PATH: value }), value);
});

test("missing, blank and relative paths fail safely without an implicit personal fallback", t => {
  const { envFile } = fixture(t);
  assert.throws(() => resolvePath(envFile), /GOOGLE_TTS_CREDENTIALS_PATH/);
  for (const value of ["", "relative-private-account.json", "~/private-account.json"]) {
    writeFileSync(envFile, `GOOGLE_TTS_CREDENTIALS_PATH="${value}"`);
    assert.throws(() => resolvePath(envFile), error => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes("private-account.json"));
      return true;
    });
  }
});

test("unreadable local env reports a safe configuration error", t => {
  const { envFile } = fixture(t);
  mkdirSync(envFile);
  assert.throws(() => resolvePath(envFile), error => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(envFile));
    return true;
  });
});

test("service resolves credentials lazily and requires the configured project", t => {
  const { root } = fixture(t);
  const file = join(root, "private-account.json");
  let reads = 0;
  const service = new GoogleTTSService(() => { reads++; return file; });
  assert.equal(reads, 0);
  writeFileSync(file, JSON.stringify({ client_email: "example@example.invalid", private_key: "dummy-not-a-key" }));
  assert.throws(() => (service as any).loadServiceAccount(), /project_id/);
  writeFileSync(file, JSON.stringify({ service_account: {
    client_email: "example@example.invalid", private_key: "dummy-not-a-key", project_id: "example-project",
  } }));
  assert.equal((service as any).loadServiceAccount().project_id, "example-project");
  assert.equal(reads, 2);
});

test("missing or malformed credentials never expose the configured filename", t => {
  const { root } = fixture(t);
  const file = join(root, "private-account.json");
  const service = new GoogleTTSService(file);
  for (const contents of [undefined, "invalid private contents", "null"]) {
    if (contents !== undefined) writeFileSync(file, contents);
    assert.throws(() => (service as any).loadServiceAccount(), error => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes(root));
      assert.ok(!error.message.includes("private-account.json"));
      assert.ok(!error.message.includes("private contents"));
      return true;
    });
  }
});
