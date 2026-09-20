import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// We import the modules that we are about to implement
import { evaluateSystemOne } from '../src/providers/typesafe-client.ts';
import { sanitizeState, sanitizeError } from '../src/security.ts';
import { AuthError, TimeoutError, RateLimitError, ApiError } from '../src/types.ts';

test('MINI-001: sanitizeState redacts secrets, tokens, and api keys', () => {
  const secretKey = 'ts_live_secret_key_12345';
  process.env.TYPESAFE_API_KEY = secretKey;

  const rawState = {
    prompt: `Analyze this request with authorization Bearer abcdef1234567890 and key ${secretKey}`,
    nested: {
      password: 'superSecretPassword123',
      privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----',
      normalField: 'hello world',
      count: 42
    },
    list: [
      `env var TYPESAFE_API_KEY=${secretKey}`,
      'clean item'
    ]
  };

  const sanitized = sanitizeState(rawState);

  // Assert no secretKey or sensitive strings leak
  const json = JSON.stringify(sanitized);
  assert.ok(!json.includes(secretKey), 'Must not contain TYPESAFE_API_KEY');
  assert.ok(!json.includes('abcdef1234567890'), 'Must not contain raw Bearer token');
  assert.ok(!json.includes('superSecretPassword123'), 'Must not contain password');
  assert.ok(!json.includes('BEGIN RSA PRIVATE KEY'), 'Must not contain private key');
  assert.equal(sanitized.nested.normalField, 'hello world');
  assert.equal(sanitized.nested.count, 42);
  assert.equal(sanitized.list[1], 'clean item');
});

test('MINI-001: evaluateSystemOne throws AuthError when API key is missing', async () => {
  await assert.rejects(
    async () => {
      await evaluateSystemOne(
        { state: 'test', questions: { q: { type: 'noul', instructions: 'test' } } },
        { apiKey: '' }
      );
    },
    (err) => {
      assert.ok(err instanceof AuthError, 'Must be an AuthError');
      assert.equal(err.code, 'AUTH_ERROR');
      return true;
    }
  );
});

test('MINI-001: evaluateSystemOne sends sanitized payload and parses Choice/Noul/Score responses', async () => {
  let receivedAuth = '';
  let receivedBody = null;

  const server = http.createServer((req, res) => {
    receivedAuth = req.headers['authorization'] || '';
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      receivedBody = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        model: 'jev-1.13.0',
        answers: {
          q_noul: { type: 'noul', noul: 0.95 },
          q_choice: {
            type: 'choice',
            choice: 'opt_a',
            confidence: 0.88,
            probabilities: { opt_a: 0.88, opt_b: 0.12 }
          },
          q_score: {
            type: 'score',
            score: 2.5,
            confidence: 0.75,
            probabilities: { '1': 0.1, '2': 0.4, '3': 0.5 }
          }
        },
        usage: { input_tokens: 150, output_tokens: 45 }
      }));
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const endpoint = `http://127.0.0.1:${port}/v1/systemone`;

  try {
    const response = await evaluateSystemOne(
      {
        state: { text: 'Testing evaluate', secret: 'Bearer secret_token_xyz' },
        questions: {
          q_noul: { type: 'Noul', instructions: 'Is this a test?' },
          q_choice: { type: 'Choice', instructions: 'Pick one', criteria: { opt_a: 'Option A', opt_b: 'Option B' } },
          q_score: { type: 'Score', instructions: 'Rate quality', criteria: ['Low', 'Medium', 'High'] }
        },
        model: 'jev-latest'
      },
      {
        endpoint,
        apiKey: 'test-key-mock'
      }
    );

    assert.equal(receivedAuth, 'Bearer test-key-mock');
    assert.equal(receivedBody.model, 'jev-latest');
    assert.equal(receivedBody.questions.q_noul.type, 'noul');
    assert.equal(receivedBody.questions.q_choice.type, 'choice');
    assert.equal(receivedBody.questions.q_score.type, 'score');
    assert.ok(!JSON.stringify(receivedBody.state).includes('secret_token_xyz'), 'State must be sanitized');

    assert.equal(response.model, 'jev-1.13.0');
    assert.equal(response.usage.input_tokens, 150);
    assert.equal(response.usage.output_tokens, 45);
    assert.ok(response.latency_ms >= 0);
    assert.equal(response.answers.q_noul.noul, 0.95);
    assert.equal(response.answers.q_choice.choice, 'opt_a');
    assert.equal(response.answers.q_score.score, 2.5);
  } finally {
    server.close();
  }
});

test('MINI-001: evaluateSystemOne enforces timeout and raises TimeoutError', async () => {
  const server = http.createServer((_req, _res) => {
    // Deliberately do not answer to trigger timeout
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const endpoint = `http://127.0.0.1:${port}/v1/systemone`;

  try {
    await assert.rejects(
      async () => {
        await evaluateSystemOne(
          { state: 'timeout test', questions: { q: { type: 'noul', instructions: 'test' } } },
          { endpoint, apiKey: 'test-key', timeout: 50 }
        );
      },
      (err) => {
        assert.ok(err instanceof TimeoutError, `Expected TimeoutError, got ${err.constructor.name}`);
        assert.equal(err.code, 'TIMEOUT_ERROR');
        return true;
      }
    );
  } finally {
    server.close();
  }
});

test('MINI-001: evaluateSystemOne maps HTTP error status codes to typed errors', async () => {
  let returnStatus = 429;
  const server = http.createServer((_req, res) => {
    res.writeHead(returnStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: { message: 'Rate limit exceeded' } }));
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const endpoint = `http://127.0.0.1:${port}/v1/systemone`;

  try {
    // Test 429 RateLimitError
    returnStatus = 429;
    await assert.rejects(
      async () => {
        await evaluateSystemOne(
          { state: 'test', questions: { q: { type: 'noul', instructions: 'test' } } },
          { endpoint, apiKey: 'test-key' }
        );
      },
      (err) => {
        assert.ok(err instanceof RateLimitError, 'Should be RateLimitError');
        return true;
      }
    );

    // Test 500 ApiError
    returnStatus = 500;
    await assert.rejects(
      async () => {
        await evaluateSystemOne(
          { state: 'test', questions: { q: { type: 'noul', instructions: 'test' } } },
          { endpoint, apiKey: 'test-key' }
        );
      },
      (err) => {
        assert.ok(err instanceof ApiError, 'Should be ApiError');
        assert.equal(err.status, 500);
        return true;
      }
    );
  } finally {
    server.close();
  }
});
