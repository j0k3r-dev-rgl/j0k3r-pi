import test from 'node:test';
import assert from 'node:assert/strict';
import { getNtfyUrl, sendSupervisorNotification } from '../src/notify.ts';

test('Supervisor Notify: resolves ntfy URL from environment variable', () => {
  const orig = process.env.PI_NTFY_URL;
  try {
    process.env.PI_NTFY_URL = 'https://ntfy.sh/test-sup-topic';
    assert.equal(getNtfyUrl(), 'https://ntfy.sh/test-sup-topic');
  } finally {
    if (orig !== undefined) process.env.PI_NTFY_URL = orig;
    else delete process.env.PI_NTFY_URL;
  }
});

test('Supervisor Notify: sends notification with expected headers, tags and body', async () => {
  const orig = process.env.PI_NTFY_URL;
  const originalFetch = globalThis.fetch;
  const recordedCalls: any[] = [];

  globalThis.fetch = (async (url: any, init: any) => {
    recordedCalls.push({ url, init });
    return {
      ok: true,
      body: { cancel: async () => {} },
    } as any;
  }) as any;

  try {
    process.env.PI_NTFY_URL = 'https://ntfy.sh/test-sup-topic';
    await sendSupervisorNotification({
      title: 'Pi: Cambio de modelo',
      body: 'Modelo conmutado a second/gpt-6.1-sol por cuota agotada.',
      priority: 'high',
      tags: 'shuffle,robot',
    });

    assert.equal(recordedCalls.length, 1);
    assert.equal(recordedCalls[0].url, 'https://ntfy.sh/test-sup-topic');
    assert.equal(recordedCalls[0].init.method, 'POST');
    assert.equal(recordedCalls[0].init.headers.Title, 'Pi: Cambio de modelo');
    assert.equal(recordedCalls[0].init.headers.Priority, 'high');
    assert.equal(recordedCalls[0].init.headers.Tags, 'shuffle,robot');
    assert.equal(recordedCalls[0].init.body, 'Modelo conmutado a second/gpt-6.1-sol por cuota agotada.');
  } finally {
    globalThis.fetch = originalFetch;
    if (orig !== undefined) process.env.PI_NTFY_URL = orig;
    else delete process.env.PI_NTFY_URL;
  }
});

test('Supervisor Notify: safely swallows network errors without throwing', async () => {
  const orig = process.env.PI_NTFY_URL;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error('Network timeout');
  }) as any;

  try {
    process.env.PI_NTFY_URL = 'https://ntfy.sh/test-sup-topic';
    await assert.doesNotReject(async () => {
      await sendSupervisorNotification({
        title: 'Pi: Test',
        body: 'Message',
      });
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (orig !== undefined) process.env.PI_NTFY_URL = orig;
    else delete process.env.PI_NTFY_URL;
  }
});
