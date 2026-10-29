import { test } from "node:test";
import assert from "node:assert/strict";
import { GoogleTTSService } from "../src/tts-service.ts";

test("voice catalog requests the current project with search and pagination without synthesis", async t => {
  const service = new GoogleTTSService("unused") as any;
  t.mock.method(service, "loadServiceAccount", () => ({ project_id: "demo-project" }));
  t.mock.method(service, "getAccessToken", async () => "fake-token");
  const calls: { url: string; options: any }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL, options: any) => {
    calls.push({ url: String(url), options });
    const next = new URL(String(url)).searchParams.get("pageToken");
    const result = next ? { voices: [{ id: "voice_123", displayName: "Spanish Narrator", languageCode: "es-AR", gender: "female" }] } : { voices: [{ id: "voice_arg", displayName: "Narrator", languageCode: "es-AR", description: "Firm" }], nextPageToken: "opaque-next" };
    return new Response(JSON.stringify(result), { status: 200 });
  });
  assert.equal(typeof service.listVoices, "function", "a dynamic catalog must be available");
  const first = await service.listVoices({ search: "narrator" }, new AbortController().signal);
  const second = await service.listVoices({ search: "narrator", pageToken: first.nextPageToken }, new AbortController().signal);
  assert.equal(first.voices[0].id, "voice_arg");
  assert.equal(first.nextPageToken, "opaque-next");
  assert.equal(second.voices[0].id, "voice_123");
  assert.equal(second.voices[0].displayName, "Spanish Narrator");
  assert.equal(second.voices[0].languageCode, "es-AR");
  const url = new URL(calls[0].url);
  assert.equal(url.origin, "https://aiplatform.googleapis.com");
  assert.equal(url.pathname, "/v1beta1/projects/demo-project/locations/global/voices");
  assert.equal(url.searchParams.get("search"), "Argentin");
  assert.equal(url.searchParams.get("pageSize"), "1000");
  assert.equal(new URL(calls[1].url).searchParams.get("pageToken"), "opaque-next");
  assert.equal(new URL(calls[1].url).searchParams.get("search"), "Argentin");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Authorization, "Bearer fake-token");
  assert.equal(calls[0].options.redirect, "error");
});

test("voice catalog exposes only voices identified as Argentine Spanish across pages", async t => {
  const service = new GoogleTTSService("unused") as any;
  t.mock.method(service, "loadServiceAccount", () => ({ project_id: "test" }));
  t.mock.method(service, "getAccessToken", async () => "token");
  t.mock.method(globalThis, "fetch", async (url: string | URL) => {
    const next = new URL(String(url)).searchParams.get("pageToken");
    return new Response(JSON.stringify(next ? {
      voices: [
        { id: "regional", display_name: "Regional", language_code: "es-419", region_code: "AR" },
        { id: "accent", languageCode: "es", accent: "Argentinian" },
        { id: "accent-es", languageCode: "es", accent: "Español argentino" },
        { id: "spanish", languageCode: "es-ES", accent: "Spanish" },
        { id: "conflict", languageCode: "es-MX", regionCode: "AR" },
        { id: "unknown-language", regionCode: "AR" },
      ],
    } : {
      voices: [
        { id: "argentine", languageCode: "ES-ar" },
        { id: "unknown", displayName: "Unknown" },
        { id: "neutral", languageCode: "es-419" },
        { id: "english", languageCode: "en-US", regionCode: "AR" },
        { id: "negative", languageCode: "es", accent: "not Argentinian" },
        { id: "conflicting-region", languageCode: "es-AR", regionCode: "US" },
      ],
      nextPageToken: "next",
    }));
  });
  const signal = new AbortController().signal;
  const first = await service.listVoices({}, signal);
  assert.deepEqual(first.voices.map((voice: any) => voice.id), ["argentine"]);
  assert.equal(first.nextPageToken, "next");
  const second = await service.listVoices({ pageToken: first.nextPageToken }, signal);
  assert.deepEqual(second.voices.map((voice: any) => voice.id), ["regional", "accent", "accent-es"]);
});

test("voice catalog finds real Argentina Spanish metadata without paging through unrelated voices", async t => {
  const service = new GoogleTTSService("unused") as any;
  t.mock.method(service, "loadServiceAccount", () => ({ project_id: "test" }));
  t.mock.method(service, "getAccessToken", async () => "token");
  const calls: URL[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL) => {
    calls.push(new URL(String(url)));
    return new Response(JSON.stringify({ voices: [
      { id: "es-419-advisor-1", displayName: "Authoritative Advisor 1", languageCode: "es-419", regionCode: "419", accent: "Argentina Spanish", description: "Lawyer from Argentina" },
      { id: "es-419-assistant-10", displayName: "Digital Assistant 10", languageCode: "es-419", regionCode: "419", accent: "Argentina Spanish", description: "Argentine Spanish assistant" },
      { id: "neutral", displayName: "Neutral", languageCode: "es-419", regionCode: "419", accent: "Latin American Spanish" },
      { id: "conflict", languageCode: "es-MX", regionCode: "MX", accent: "Argentina Spanish" },
      { id: "conflict-global", languageCode: "es-MX", regionCode: "419", accent: "Argentina Spanish" },
      { id: "negative", languageCode: "es-419", regionCode: "419", accent: "Not Argentina Spanish" },
    ] }));
  });
  const signal = new AbortController().signal;
  const all = await service.listVoices({}, signal);
  assert.deepEqual(all.voices.map((voice: any) => voice.id), ["es-419-advisor-1", "es-419-assistant-10"]);
  assert.equal(all.nextPageToken, undefined);
  const filtered = await service.listVoices({ search: "ASSISTANT" }, signal);
  assert.deepEqual(filtered.voices.map((voice: any) => voice.id), ["es-419-assistant-10"]);
  const byDescription = await service.listVoices({ search: "LAWYER" }, signal);
  assert.deepEqual(byDescription.voices.map((voice: any) => voice.id), ["es-419-advisor-1"]);
  assert.ok(calls.every(url => url.searchParams.get("search") === "Argentin"));
  assert.ok(calls.every(url => url.searchParams.get("pageSize") === "1000"));
});

test("voice catalog errors are safe and cancellation is propagated", async t => {
  const service = new GoogleTTSService("unused") as any;
  t.mock.method(service, "loadServiceAccount", () => ({ project_id: "test" }));
  t.mock.method(service, "getAccessToken", async () => "fake-token");
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("sensitive provider details", { status: 403 }));
  assert.equal(typeof service.listVoices, "function", "a dynamic catalog must be available");
  await assert.rejects(service.listVoices({}, new AbortController().signal), (error: Error) => /403/.test(error.message) && !/sensitive|fake-token/.test(error.message));
  fetch.mock.mockImplementation(async () => new Response("not json", { status: 200 }));
  await assert.rejects(service.listVoices({}, new AbortController().signal), /catálogo/i);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(service.listVoices({}, controller.signal), { name: "AbortError" });
});

test("voice catalog preserves empty pages and alternate response names without truncating IDs", async t => {
  const service = new GoogleTTSService("unused") as any;
  t.mock.method(service, "loadServiceAccount", () => ({ project_id: "test" }));
  t.mock.method(service, "getAccessToken", async () => "token");
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ next_page_token: "next", voices: [] })));
  assert.deepEqual(await service.listVoices({}, new AbortController().signal), { voices: [], nextPageToken: "next" });
  fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ voices: [{ id: "valid-id", display_name: "Nombre\u001b[2J", language_code: "es-AR" }] })));
  const page = await service.listVoices({}, new AbortController().signal);
  assert.equal(page.voices[0].id, "valid-id");
  assert.equal(page.voices[0].languageCode, "es-AR");
  assert.doesNotMatch(page.voices[0].displayName, /\u001b/);
  fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ voices: [{ id: "a".repeat(81), languageCode: "es-AR" }] })));
  await assert.rejects(service.listVoices({}, new AbortController().signal), /catálogo/i);
  fetch.mock.mockImplementation(async () => new Response("x".repeat(1024 * 1024 + 1)));
  await assert.rejects(service.listVoices({}, new AbortController().signal), /catálogo/i);
});

test("SSE split across reads preserves every audio part and requires completion", async t => {
  const service = new GoogleTTSService("unused") as any;
  t.mock.method(service, "loadServiceAccount", () => ({ project_id: "test" }));
  t.mock.method(service, "getAccessToken", async () => "token");
  const text = 'data: {"candidates":[{"content":{"parts":[{"inlineData":{"data":"AQI="}},{"inlineData":{"data":"AwQ="}}]}}]}\r\n\r\ndata: {"candidates":[{"finishReason":"STOP"}]}\n\n';
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start(controller) {
    const bytes = new TextEncoder().encode(text);
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    controller.close();
  }})));
  const chunks: Buffer[] = [];
  for await (const chunk of service.stream("hola", "Kore", "friendly", "model", "global", new AbortController().signal)) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), Buffer.from([1, 2, 3, 4]));
});

test("SSE without terminal finish is rejected", async t => {
  const service = new GoogleTTSService("unused") as any;
  t.mock.method(service, "loadServiceAccount", () => ({ project_id: "test" }));
  t.mock.method(service, "getAccessToken", async () => "token");
  t.mock.method(globalThis, "fetch", async () => new Response('data: {"candidates":[{"content":{"parts":[{"inlineData":{"data":"AQI="}}]}}]}\n\n'));
  await assert.rejects(async () => { for await (const _ of service.stream("hola", "Kore", "friendly", "model", "global", new AbortController().signal)) {} }, /incompleto/);
});
