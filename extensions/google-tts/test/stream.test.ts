import { test } from "node:test";
import assert from "node:assert/strict";
import { GoogleTTSService } from "../src/tts-service.ts";

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
