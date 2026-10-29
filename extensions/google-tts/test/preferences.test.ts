import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as config from "../src/config.ts";

function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), "pi-tts-preferences-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return join(root, "google-tts", "settings.json");
}

function api() {
  assert.equal(typeof (config as any).loadPreferences, "function", "preferences can be loaded");
  assert.equal(typeof (config as any).savePreferences, "function", "preferences can be saved");
  return config as any;
}

test("missing global preferences use existing defaults and do not create a file", t => {
  const file = fixture(t);
  const { loadPreferences } = api();
  assert.deepEqual(loadPreferences(file), { config: config.defaultConfig, autoRead: false, devices: [], output: null });
  assert.throws(() => statSync(file), { code: "ENOENT" });
});

test("settings and named devices persist without credentials and survive a new load", t => {
  const file = fixture(t);
  const { loadPreferences, savePreferences } = api();
  const settings = loadPreferences(file);
  Object.assign(settings.config, { enabled: false, model: "gemini-3.8-flash-tts", voice: "Puck", style: "friendly", speed: 1.5, location: "us-central1", maxCharacters: 2500 });
  settings.devices.push({ name: "Portátil 🐈", port: 14713 }, { name: "Móvil", port: 14714 });
  settings.output = "Móvil";
  settings.autoRead = true;
  savePreferences(file, settings);
  assert.deepEqual(loadPreferences(file), settings);
  const json = readFileSync(file, "utf8");
  assert.doesNotMatch(json, /credentials|private_key|access_token/i);
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test("saved settings whitelist extension fields and discard unrelated credential-like properties", t => {
  const file = fixture(t);
  const { loadPreferences, savePreferences } = api();
  const value = loadPreferences(file);
  value.credentials = "do-not-save";
  value.config.private_key = "do-not-save";
  value.devices.push({ name: "PC", port: 14713, access_token: "do-not-save" });
  savePreferences(file, value);
  assert.doesNotMatch(readFileSync(file, "utf8"), /do-not-save|credentials|private_key|access_token/);
});

test("invalid preferences and device ports are rejected without replacing saved data", t => {
  const file = fixture(t);
  const { loadPreferences, savePreferences } = api();
  const valid = loadPreferences(file);
  valid.devices.push({ name: "PC", port: 14713 });
  valid.output = "PC";
  savePreferences(file, valid);
  const original = readFileSync(file, "utf8");
  for (const invalid of [
    { ...valid, devices: [{ name: "PC", port: 0 }] },
    { ...valid, devices: [{ name: "PC", port: 65536 }] },
    { ...valid, devices: [{ name: "PC", port: 14713.5 }] },
    { ...valid, devices: [{ name: "PC\u001b[2J", port: 14713 }] },
    { ...valid, devices: [{ name: "PC", port: 1 }, { name: "pc", port: 2 }] },
    { ...valid, output: "unknown" },
    { ...valid, config: { ...valid.config, speed: 10 } },
    { ...valid, config: { ...valid.config, location: "../../invalid" } },
  ]) {
    assert.throws(() => savePreferences(file, invalid));
    assert.equal(readFileSync(file, "utf8"), original);
  }
  writeFileSync(file, "{malformed");
  assert.throws(() => loadPreferences(file), /preferencias/i);
  assert.equal(readFileSync(file, "utf8"), "{malformed");
});
