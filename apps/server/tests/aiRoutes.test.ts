import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { test, TestContext } from 'node:test';
import express from 'express';
import { aiJsonErrorHandler, createAIRouter } from '../src/routes/ai';
import { AIServiceError } from '../src/services/aiService';

type RouteService = Parameters<typeof createAIRouter>[0];

const position = {
  provider: 'openrouter',
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  playerColor: 'w',
};

function fakeService(overrides: Partial<RouteService> = {}): RouteService {
  return {
    getAvailableProviders: () => ['openrouter'],
    getModels: () => [],
    searchModels: async () => [],
    getMove: async () => ({ move: 'e2e4' }),
    ...overrides,
  };
}

async function serve(t: TestContext, service: RouteService): Promise<string> {
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/ai', createAIRouter(service));
  app.use(aiJsonErrorHandler);
  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/api/ai`;
}

function post(base: string, path: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('model search awaits the provider and returns an array', async t => {
  const models = [{ id: 'vendor/model', name: 'Model' }];
  const base = await serve(t, fakeService({
    searchModels: async (provider, query) => {
      assert.equal(provider, 'openrouter');
      assert.equal(query, 'model');
      return models;
    },
  }));
  const response = await fetch(`${base}/models/search?q=model`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { models });
  assert.equal((await fetch(`${base}/models/search?q=a&q=b`)).status, 400);
});

test('move validation rejects malformed inputs before calling a provider', async t => {
  let calls = 0;
  const base = await serve(t, fakeService({
    getMove: async () => { calls++; return { move: 'e2e4' }; },
  }));
  const invalidBodies = [
    null,
    [],
    {},
    { ...position, provider: {} },
    { ...position, fen: 42 },
    { ...position, playerColor: 'white' },
    { ...position, model: '' },
    { ...position, moveHistory: 'e4' },
    { ...position, moveHistory: [42] },
    { ...position, moveHistory: ['x'.repeat(21)] },
    { ...position, moveHistory: Array(2001).fill('e4') },
  ];
  for (const body of invalidBodies) {
    const response = await post(base, '/move', body);
    assert.equal(response.status, 400, JSON.stringify(body)?.slice(0, 200));
    assert.equal((await response.json() as { retryable: boolean }).retryable, false);
  }
  assert.equal(calls, 0);
});

test('move requests omit untrusted move lists and expose the actual response model', async t => {
  const base = await serve(t, fakeService({
    getMove: async (provider, request, signal) => {
      assert.equal(provider, 'openrouter');
      assert.deepEqual(request, {
        fen: position.fen,
        playerColor: 'w',
        moveHistory: [],
        model: 'vendor/requested',
      });
      assert(signal instanceof AbortSignal);
      assert.equal(signal.aborted, false);
      return { move: 'e2e4', reasoning: 'Central control.', model: 'vendor/actual' };
    },
  }));
  const response = await post(base, '/move', {
    ...position,
    model: 'vendor/requested',
    legalMoves: ['e2e5'],
    piecesMoves: [{ square: 'e2', moves: ['e5'] }],
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    provider: 'openrouter',
    model: 'vendor/actual',
    move: 'e2e4',
    reasoning: 'Central control.',
  });
});

test('provider failures preserve actionable HTTP status and error code', async t => {
  const base = await serve(t, fakeService({
    getMove: async () => { throw new AIServiceError('Provider is rate limited.', 429, 'RATE_LIMITED', true); },
  }));
  const response = await post(base, '/move', position);
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'Failed to get AI move',
    details: 'Provider is rate limited.',
    code: 'RATE_LIMITED',
    retryable: true,
  });
});

test('malformed and oversized JSON receives JSON errors', async t => {
  const base = await serve(t, fakeService());
  const malformed = await fetch(`${base}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"fen":',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json() as { code: string }).code, 'INVALID_JSON');

  const oversized = await post(base, '/move', { ...position, padding: 'x'.repeat(17000) });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json() as { code: string }).code, 'REQUEST_TOO_LARGE');
});

test('analysis attributes provider errors and reports partial success', async t => {
  const base = await serve(t, fakeService({
    getMove: async provider => {
      if (provider === 'unavailable') throw new AIServiceError('Not configured.', 400, 'PROVIDER_UNAVAILABLE');
      return { move: 'e2e4' };
    },
  }));
  const response = await post(base, '/analyze', { ...position, providers: ['openrouter', 'unavailable'] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    analysis: [{ provider: 'openrouter', move: 'e2e4' }],
    errors: [{ provider: 'unavailable', error: 'Not configured.', status: 400, code: 'PROVIDER_UNAVAILABLE', retryable: false }],
    totalRequested: 2,
    successful: 1,
  });
});

test('analysis does not report success when every provider fails', async t => {
  const base = await serve(t, fakeService({
    getMove: async () => { throw new AIServiceError('Request timed out.', 504, 'AI_TIMEOUT', true); },
  }));
  const response = await post(base, '/analyze', { ...position, providers: ['openrouter'] });
  assert.equal(response.status, 504);
  const body = await response.json() as {
    success: boolean;
    code: string;
    errors: Array<{ provider: string }>;
    successful: number;
  };
  assert.equal(body.success, false);
  assert.equal(body.code, 'ANALYSIS_FAILED');
  assert.equal(body.errors[0].provider, 'openrouter');
  assert.equal(body.successful, 0);
});

test('analysis rejects empty and duplicate providers before calling AI', async t => {
  let calls = 0;
  const base = await serve(t, fakeService({
    getMove: async () => { calls++; return { move: 'e2e4' }; },
  }));
  for (const providers of [[], ['openrouter', 'openrouter'], [{}], 'openrouter']) {
    assert.equal((await post(base, '/analyze', { ...position, providers })).status, 400);
  }
  assert.equal(calls, 0);
});

for (const route of ['/move', '/analyze']) {
  test(`${route} cancels upstream work when its client disconnects`, { timeout: 5000 }, async t => {
    let started!: () => void;
    let aborted!: () => void;
    const providerStarted = new Promise<void>(resolve => { started = resolve; });
    const providerAborted = new Promise<void>(resolve => { aborted = resolve; });
    const base = await serve(t, fakeService({
      getMove: async (_provider, _request, signal) => new Promise((_resolve, reject) => {
        assert(signal);
        signal.addEventListener('abort', () => {
          aborted();
          reject(new AIServiceError('Request cancelled.', 499, 'REQUEST_ABORTED'));
        }, { once: true });
        started();
      }),
    }));
    const client = httpRequest(`${base}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    client.on('error', () => {});
    t.after(() => client.destroy());
    client.end(JSON.stringify({ ...position, providers: ['openrouter'] }));
    await providerStarted;
    client.destroy();
    await providerAborted;
  });
}
