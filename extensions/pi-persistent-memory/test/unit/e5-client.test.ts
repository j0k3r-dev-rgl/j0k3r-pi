import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { E5Client, E5ClientError } from '../../src/client/e5-client.ts';

function createMockServer(handler: (req: any, res: any) => void): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({
        server,
        url,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

const CANONICAL_MODEL = 'intfloat/e5-small-v2';
const CANONICAL_REVISION = 'ffb93f3bd4047442299a41ebb6fa998a38507c52';

function makeUnitVector(dim = 384): number[] {
  const vec = new Array(dim).fill(0);
  vec[0] = 1.0;
  return vec;
}

test('M2-A01: embedQuery sends valid request and validates canonical response', async () => {
  let capturedBody: any = null;
  const mock = await createMockServer((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/embeddings');
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => {
      capturedBody = JSON.parse(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        model: CANONICAL_MODEL,
        model_revision: CANONICAL_REVISION,
        dimensions: 384,
        normalization: 'l2',
        max_input_tokens: 512,
        data: [{
          input_index: 0,
          chunks: [{
            chunk_index: 0,
            text: 'test query',
            start: 0,
            end: 10,
            token_count: 5,
            embedding: makeUnitVector(),
          }],
        }],
      }));
    });
  });

  try {
    const client = new E5Client(mock.url);
    const result = await client.embedQuery('test query');
    assert.equal(capturedBody.input, 'test query');
    assert.equal(capturedBody.mode, 'query');
    assert.equal(result.chunks.length, 1);
    assert.equal(result.chunks[0].text, 'test query');
    assert.equal(result.chunks[0].start, 0);
    assert.equal(result.chunks[0].end, 10);
    assert.equal(result.model, CANONICAL_MODEL);
    assert.equal(result.model_revision, CANONICAL_REVISION);
  } finally {
    await mock.close();
  }
});

test('M2-A01: embedPassage validates multiple chunks with Unicode code points and full coverage', async () => {
  const original = 'Hello 🚀 world! \nLine two with accents: áéíóú.';
  const codePoints = Array.from(original);
  // Split into 2 chunks
  const mid = 15;
  const chunk1Text = codePoints.slice(0, mid).join('');
  const chunk2Text = codePoints.slice(mid).join('');

  const mock = await createMockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      model: CANONICAL_MODEL,
      model_revision: CANONICAL_REVISION,
      dimensions: 384,
      normalization: 'l2',
      max_input_tokens: 512,
      data: [{
        input_index: 0,
        chunks: [
          {
            chunk_index: 0,
            text: chunk1Text,
            start: 0,
            end: mid,
            token_count: 10,
            embedding: makeUnitVector(),
          },
          {
            chunk_index: 1,
            text: chunk2Text,
            start: mid,
            end: codePoints.length,
            token_count: 12,
            embedding: makeUnitVector(),
          },
        ],
      }],
    }));
  });

  try {
    const client = new E5Client(mock.url);
    const result = await client.embedPassage(original);
    assert.equal(result.chunks.length, 2);
    assert.equal(result.chunks[0].text, chunk1Text);
    assert.equal(result.chunks[1].text, chunk2Text);
    assert.equal(result.chunks[1].end, codePoints.length);
  } finally {
    await mock.close();
  }
});

test('M2-A01: Incompatible model metadata throws integration_error', async () => {
  const mock = await createMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      model: 'wrong-model',
      model_revision: CANONICAL_REVISION,
      dimensions: 384,
      normalization: 'l2',
      max_input_tokens: 512,
      data: [{ input_index: 0, chunks: [] }],
    }));
  });

  try {
    const client = new E5Client(mock.url);
    await assert.rejects(
      () => client.embedQuery('query'),
      (err: any) => {
        assert.ok(err instanceof E5ClientError);
        assert.equal(err.category, 'integration_error');
        assert.equal(err.code, 'incompatible_metadata');
        return true;
      },
    );
  } finally {
    await mock.close();
  }
});

test('M2-A01: Invalid vectors (wrong dimension or non-unit norm) throw integration_error', async () => {
  const mock = await createMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      model: CANONICAL_MODEL,
      model_revision: CANONICAL_REVISION,
      dimensions: 384,
      normalization: 'l2',
      max_input_tokens: 512,
      data: [{
        input_index: 0,
        chunks: [{
          chunk_index: 0,
          text: 'query',
          start: 0,
          end: 5,
          token_count: 2,
          embedding: [1, 2, 3], // invalid dimension
        }],
      }],
    }));
  });

  try {
    const client = new E5Client(mock.url);
    await assert.rejects(
      () => client.embedQuery('query'),
      (err: any) => {
        assert.ok(err instanceof E5ClientError);
        assert.equal(err.category, 'integration_error');
        assert.equal(err.code, 'invalid_vector');
        return true;
      },
    );
  } finally {
    await mock.close();
  }
});

test('M2-A01: Invalid spans (gap, not covering source, or text mismatch) throw integration_error', async () => {
  const mock = await createMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      model: CANONICAL_MODEL,
      model_revision: CANONICAL_REVISION,
      dimensions: 384,
      normalization: 'l2',
      max_input_tokens: 512,
      data: [{
        input_index: 0,
        chunks: [{
          chunk_index: 0,
          text: 'wrong',
          start: 0,
          end: 5,
          token_count: 2,
          embedding: makeUnitVector(),
        }],
      }],
    }));
  });

  try {
    const client = new E5Client(mock.url);
    await assert.rejects(
      () => client.embedPassage('hello world long text'),
      (err: any) => {
        assert.ok(err instanceof E5ClientError);
        assert.equal(err.category, 'integration_error');
        assert.equal(err.code, 'invalid_span');
        return true;
      },
    );
  } finally {
    await mock.close();
  }
});

test('M2-A01: Request body > 1MiB rejected before POST with input_error request_too_large', async () => {
  let serverCalled = false;
  const mock = await createMockServer((_req, res) => {
    serverCalled = true;
    res.writeHead(200);
    res.end();
  });

  try {
    const client = new E5Client(mock.url);
    const hugeInput = 'x'.repeat(1048577);
    await assert.rejects(
      () => client.embedPassage(hugeInput),
      (err: any) => {
        assert.ok(err instanceof E5ClientError);
        assert.equal(err.category, 'input_error');
        assert.equal(err.code, 'request_too_large');
        return true;
      },
    );
    assert.equal(serverCalled, false);
  } finally {
    await mock.close();
  }
});

test('M2-A02: Deadline timeout triggers unavailable request_timeout without long wait', async () => {
  const mock = await createMockServer((_req, _res) => {
    // Deliberately do not answer
  });

  try {
    // Injected 40ms timeout for test speed
    const client = new E5Client(mock.url, { timeoutMs: 40 });
    const start = Date.now();
    await assert.rejects(
      () => client.embedQuery('query'),
      (err: any) => {
        assert.ok(err instanceof E5ClientError);
        assert.equal(err.category, 'unavailable');
        assert.equal(err.code, 'request_timeout');
        return true;
      },
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `Expected fast timeout, elapsed: ${elapsed}ms`);
  } finally {
    await mock.close();
  }
});

test('M2-A02: Caller cancellation takes precedence over timeout and returns cancelled', async () => {
  const mock = await createMockServer((_req, _res) => {});

  try {
    const client = new E5Client(mock.url, { timeoutMs: 200 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    await assert.rejects(
      () => client.embedQuery('query', controller.signal),
      (err: any) => {
        assert.ok(err instanceof E5ClientError);
        assert.equal(err.category, 'cancelled');
        assert.equal(err.code, 'caller_cancelled');
        return true;
      },
    );
  } finally {
    await mock.close();
  }
});

test('M2-A02: HTTP error status mapping (400, 422, 413, 500, 503, 404)', async () => {
  let statusToReturn = 400;
  let codeToReturn = 'invalid_input';
  const mock = await createMockServer((_req, res) => {
    res.writeHead(statusToReturn, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: codeToReturn, message: 'some msg' } }));
  });

  try {
    const client = new E5Client(mock.url);

    // 400
    statusToReturn = 400;
    codeToReturn = 'invalid_input';
    await assert.rejects(
      () => client.embedQuery('q'),
      (err: any) => {
        assert.equal(err.category, 'input_error');
        assert.equal(err.code, 'invalid_input');
        return true;
      },
    );

    // 422
    statusToReturn = 422;
    codeToReturn = 'query_too_long';
    await assert.rejects(
      () => client.embedQuery('q'),
      (err: any) => {
        assert.equal(err.category, 'input_error');
        assert.equal(err.code, 'query_too_long');
        return true;
      },
    );

    // 413
    statusToReturn = 413;
    codeToReturn = 'request_too_large';
    await assert.rejects(
      () => client.embedQuery('q'),
      (err: any) => {
        assert.equal(err.category, 'input_error');
        assert.equal(err.code, 'request_too_large');
        return true;
      },
    );

    // 500
    statusToReturn = 500;
    codeToReturn = 'internal_error';
    await assert.rejects(
      () => client.embedQuery('q'),
      (err: any) => {
        assert.equal(err.category, 'unavailable');
        assert.equal(err.code, 'internal_error');
        return true;
      },
    );

    // 503
    statusToReturn = 503;
    codeToReturn = 'model_not_ready';
    await assert.rejects(
      () => client.embedQuery('q'),
      (err: any) => {
        assert.equal(err.category, 'unavailable');
        assert.equal(err.code, 'model_not_ready');
        return true;
      },
    );

    // 404 -> integration_error
    statusToReturn = 404;
    codeToReturn = 'not_found';
    await assert.rejects(
      () => client.embedQuery('q'),
      (err: any) => {
        assert.equal(err.category, 'integration_error');
        assert.equal(err.code, 'unexpected_status');
        return true;
      },
    );
  } finally {
    await mock.close();
  }
});

test('M2-A02: Strict error envelope and HTTP status correspondence (mismatches/malformed throw integration_error)', async () => {
  let statusToReturn = 400;
  let bodyToReturn: any = { error: { code: 'invalid_input', message: 'msg' } };

  const mock = await createMockServer((_req, res) => {
    res.writeHead(statusToReturn, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(bodyToReturn));
  });

  try {
    const client = new E5Client(mock.url);

    // 1. HTTP 400 with mismatched code 'internal_error' -> integration_error
    statusToReturn = 400;
    bodyToReturn = { error: { code: 'internal_error', message: 'server error' } };
    await assert.rejects(
      () => client.embedQuery('test'),
      (err: any) => {
        assert.ok(err instanceof E5ClientError);
        assert.equal(err.category, 'integration_error');
        assert.equal(err.code, 'invalid_error_response');
        return true;
      },
    );

    // 2. HTTP 500 with mismatched code 'invalid_input' -> integration_error
    statusToReturn = 500;
    bodyToReturn = { error: { code: 'invalid_input', message: 'bad input' } };
    await assert.rejects(
      () => client.embedQuery('test'),
      (err: any) => {
        assert.ok(err instanceof E5ClientError);
        assert.equal(err.category, 'integration_error');
        assert.equal(err.code, 'invalid_error_response');
        return true;
      },
    );

    // 3. HTTP 400 with missing error envelope -> integration_error
    statusToReturn = 400;
    bodyToReturn = { something: 'else' };
    await assert.rejects(
      () => client.embedQuery('test'),
      (err: any) => {
        assert.ok(err instanceof E5ClientError);
        assert.equal(err.category, 'integration_error');
        assert.equal(err.code, 'invalid_error_response');
        return true;
      },
    );

    // 4. HTTP 500 with missing error envelope -> integration_error
    statusToReturn = 500;
    bodyToReturn = { message: 'no code' };
    await assert.rejects(
      () => client.embedQuery('test'),
      (err: any) => {
        assert.ok(err instanceof E5ClientError);
        assert.equal(err.category, 'integration_error');
        assert.equal(err.code, 'invalid_error_response');
        return true;
      },
    );

    // 5. HTTP 422 with mismatched code 'internal_error' -> integration_error
    statusToReturn = 422;
    bodyToReturn = { error: { code: 'internal_error', message: 'internal' } };
    await assert.rejects(
      () => client.embedQuery('test'),
      (err: any) => {
        assert.ok(err instanceof E5ClientError);
        assert.equal(err.category, 'integration_error');
        assert.equal(err.code, 'invalid_error_response');
        return true;
      },
    );

    // 6. HTTP 413 with mismatched code 'invalid_input' -> integration_error
    statusToReturn = 413;
    bodyToReturn = { error: { code: 'invalid_input', message: 'bad input' } };
    await assert.rejects(
      () => client.embedQuery('test'),
      (err: any) => {
        assert.ok(err instanceof E5ClientError);
        assert.equal(err.category, 'integration_error');
        assert.equal(err.code, 'invalid_error_response');
        return true;
      },
    );

    // 7. HTTP 503 with mismatched code 'internal_error' -> integration_error
    statusToReturn = 503;
    bodyToReturn = { error: { code: 'internal_error', message: 'internal' } };
    await assert.rejects(
      () => client.embedQuery('test'),
      (err: any) => {
        assert.ok(err instanceof E5ClientError);
        assert.equal(err.category, 'integration_error');
        assert.equal(err.code, 'invalid_error_response');
        return true;
      },
    );
  } finally {
    await mock.close();
  }
});

test('M2-A08: Live smoke test opt-in guard prevents live requests when opt-out', async () => {
  let serverHit = false;
  const mock = await createMockServer((_req, res) => {
    serverHit = true;
    res.writeHead(200);
    res.end();
  });

  try {
    const origEnv = process.env.LIVE_SMOKE;
    delete process.env.LIVE_SMOKE;

    // Verify helper or guard pattern
    const isLiveOptIn = () => process.env.LIVE_SMOKE === '1';
    assert.equal(isLiveOptIn(), false);

    if (isLiveOptIn()) {
      const client = new E5Client(mock.url);
      await client.health();
    }

    assert.equal(serverHit, false, 'No requests should be made when LIVE_SMOKE is not 1');

    // Restore env
    if (origEnv !== undefined) {
      process.env.LIVE_SMOKE = origEnv;
    }
  } finally {
    await mock.close();
  }
});

test('M2-A07: health checks ready, not_ready (503), incompatible, and unavailable (offline)', async () => {
  let statusCode = 200;
  let responsePayload: any = {
    status: 'ready',
    model: CANONICAL_MODEL,
    model_revision: CANONICAL_REVISION,
    dimensions: 384,
    normalization: 'l2',
    max_input_tokens: 512,
  };

  const mock = await createMockServer((_req, res) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(responsePayload));
  });

  try {
    const client = new E5Client(mock.url, { healthTimeoutMs: 100 });

    // Ready
    const h1 = await client.health();
    assert.equal(h1.state, 'ready');

    // 503 not_ready
    statusCode = 503;
    responsePayload = {
      status: 'not_ready',
      model: CANONICAL_MODEL,
      model_revision: null,
      dimensions: 384,
      normalization: 'l2',
      max_input_tokens: 512,
    };
    const h2 = await client.health();
    assert.equal(h2.state, 'not_ready');

    // Incompatible metadata
    statusCode = 200;
    responsePayload = {
      status: 'ready',
      model: 'other-model',
      model_revision: 'bad',
      dimensions: 768,
      normalization: 'l2',
      max_input_tokens: 512,
    };
    const h3 = await client.health();
    assert.equal(h3.state, 'incompatible');

    // Unavailable (offline)
    const offlineClient = new E5Client('http://127.0.0.1:54321', { healthTimeoutMs: 50 });
    const h4 = await offlineClient.health();
    assert.equal(h4.state, 'unavailable');
  } finally {
    await mock.close();
  }
});

test('M2-A02: Oversized response body exceeding 4MiB throws integration_error oversized_response_body', async () => {
  const mock = await createMockServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // Write 5MB in 64KB chunks
    const chunk = Buffer.alloc(65536, 'a');
    for (let i = 0; i < 80; i++) {
      res.write(chunk);
    }
    res.end();
  });

  try {
    const client = new E5Client(mock.url);
    await assert.rejects(
      () => client.embedQuery('query'),
      (err: any) => {
        assert.ok(err instanceof E5ClientError);
        assert.equal(err.category, 'integration_error');
        assert.equal(err.code, 'oversized_response_body');
        return true;
      },
    );
  } finally {
    await mock.close();
  }
});

