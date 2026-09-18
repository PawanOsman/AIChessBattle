import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';
import { Chess } from 'chess.js';
import { AIServiceError, AIMoveRequest, OpenRouterProvider } from '../src/services/aiService';

const MODEL = 'openai/gpt-test';
const START_FEN = new Chess().fen();
const request = (changes: Partial<AIMoveRequest> = {}): AIMoveRequest => ({
  fen: START_FEN,
  playerColor: 'w',
  moveHistory: [],
  model: MODEL,
  ...changes,
});

type Reply = {
  body?: unknown;
  status?: number;
  headers?: Record<string, string>;
  untilAborted?: boolean;
};
type WireRequest = Record<string, any>;
type ProviderOptions = NonNullable<ConstructorParameters<typeof OpenRouterProvider>[1]>;
type MockModelMetadata = {
  supported_parameters?: string[];
  reasoning?: { supported_efforts?: string[] | null; supports_max_tokens?: boolean };
  top_provider?: { max_completion_tokens?: number | null };
};

function completion(content: string | null, finishReason = 'stop', model = MODEL): Reply {
  return {
    body: {
      id: 'test-completion',
      object: 'chat.completion',
      model,
      choices: [{ index: 0, finish_reason: finishReason, message: { role: 'assistant', content } }],
    },
  };
}

function moveReply(move = 'e2e4', finishReason = 'stop'): Reply {
  return completion(JSON.stringify({ move, reasoning: 'Control the center.' }), finishReason);
}

// Exercise the actual SDK request/response handling without network access or an API key.
function mockProvider(replies: Reply[], options: ProviderOptions = {}, metadata?: string[] | MockModelMetadata) {
  const requests: WireRequest[] = [];
  const client = new OpenAI({
    apiKey: 'test-only-key',
    baseURL: 'https://example.test',
    maxRetries: 0,
    fetch: async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      assert.ok(url.startsWith('https://example.test/'), 'all requests stay inside the mock');
      if (url.endsWith('/models')) {
        return Response.json({
          object: 'list',
          data: [{
            id: MODEL,
            name: 'Test model',
            ...(Array.isArray(metadata) ? { supported_parameters: metadata } : metadata),
          }],
        });
      }
      assert.ok(url.endsWith('/chat/completions'));
      assert.equal(typeof init?.body, 'string');
      requests.push(JSON.parse(init!.body as string));
      const reply = replies[requests.length - 1];
      assert.ok(reply, `unexpected extra completion request ${requests.length}`);
      if (reply.untilAborted) {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const abort = () => reject(new DOMException('Mock request aborted', 'AbortError'));
          if (signal?.aborted) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        });
      }
      return Response.json(reply.body, { status: reply.status ?? 200, headers: reply.headers });
    },
  });
  const provider = new OpenRouterProvider('test-only-key', { client, retryBaseMs: 0, ...options });
  return { provider, requests };
}

test('strict schema uses server legal moves and ignores incorrect client move hints', async () => {
  const { provider, requests } = mockProvider([moveReply()]);
  const result = await provider.getMove(request({
    legalMoves: ['e2e5'],
    piecesMoves: [{ piece: 'p', square: 'e2', moves: ['e2e5'] }],
  }));
  assert.equal(result.move, 'e2e4');
  assert.equal(result.reasoning, 'Control the center.');
  assert.equal(requests.length, 1);
  const format = requests[0].response_format;
  assert.equal(format.type, 'json_schema');
  assert.equal(format.json_schema.strict, true);
  const schema = format.json_schema.schema;
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(new Set(schema.required), new Set(['move', 'reasoning']));
  const expected = new Chess().moves({ verbose: true }).map(move => move.from + move.to + (move.promotion ?? ''));
  assert.deepEqual(new Set(schema.properties.move.enum), new Set(expected));
  assert.ok(!JSON.stringify(requests[0].messages).includes('e2e5'));
});

test('castling, en passant, and all four promotion choices survive UCI validation', async t => {
  const enPassant = new Chess();
  ['e4', 'a6', 'e5', 'd5'].forEach(move => enPassant.move(move));
  const cases = [
    { name: 'kingside castling', fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', move: 'e1g1' },
    { name: 'queenside castling', fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', move: 'e1c1' },
    { name: 'en passant', fen: enPassant.fen(), move: 'e5d6' },
    ...['q', 'r', 'b', 'n'].map(piece => ({
      name: `promotion to ${piece}`,
      fen: '7k/P7/8/8/8/8/8/7K w - - 0 1',
      move: `a7a8${piece}`,
    })),
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const { provider, requests } = mockProvider([moveReply(fixture.move)]);
      assert.equal((await provider.getMove(request({ fen: fixture.fen }))).move, fixture.move);
      assert.ok(requests[0].response_format.json_schema.schema.properties.move.enum.includes(fixture.move));
    });
  }
});

test('invalid positions, wrong turn, and finished games make no provider call', async t => {
  for (const fixture of [
    { name: 'invalid FEN', changes: { fen: 'this is not a FEN' } },
    { name: 'wrong player', changes: { playerColor: 'b' as const } },
    { name: 'checkmate', changes: { fen: '7k/6Q1/5K2/8/8/8/8/8 b - - 0 1', playerColor: 'b' as const } },
    { name: 'stalemate', changes: { fen: '7k/5K2/6Q1/8/8/8/8/8 b - - 0 1', playerColor: 'b' as const } },
    { name: 'insufficient material', changes: { fen: '7k/8/8/8/8/8/8/7K w - - 0 1' } },
  ]) {
    await t.test(fixture.name, async () => {
      const { provider, requests } = mockProvider([]);
      await assert.rejects(provider.getMove(request(fixture.changes)), AIServiceError);
      assert.equal(requests.length, 0);
    });
  }
});

test('complete fenced JSON is accepted', async () => {
  const { provider, requests } = mockProvider([
    completion('```json\n{"move":"g1f3","reasoning":"Develop a knight."}\n```'),
  ]);
  assert.equal((await provider.getMove(request())).move, 'g1f3');
  assert.equal(requests.length, 1);
});

test('verified threefold repetition history ends the game before any provider call', async () => {
  const game = new Chess();
  const history = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'];
  history.forEach(move => game.move(move));
  assert.equal(game.isThreefoldRepetition(), true);
  const { provider, requests } = mockProvider([]);
  await assert.rejects(provider.getMove(request({ fen: game.fen(), moveHistory: history })), {
    code: 'GAME_OVER',
  });
  assert.equal(requests.length, 0);
});

test('promotion without a piece suffix is rejected before a legal underpromotion is returned', async () => {
  const { provider, requests } = mockProvider([moveReply('a7a8'), moveReply('a7a8n')]);
  const result = await provider.getMove(request({ fen: '7k/P7/8/8/8/8/8/7K w - - 0 1' }));
  assert.equal(result.move, 'a7a8n');
  assert.equal(requests.length, 2);
});

test('malformed, missing, and illegal responses are retried with correction feedback', async t => {
  const cases: { name: string; reply: Reply }[] = [
    { name: 'missing choices', reply: { body: { id: 'no-choices' } } },
    { name: 'empty choices', reply: { body: { choices: [] } } },
    { name: 'empty content', reply: completion(null) },
    { name: 'truncated JSON', reply: completion('{"move":"e2e4","reasoning":"unfinished') },
    { name: 'illegal move', reply: moveReply('e2e5') },
    { name: 'wrong side move', reply: moveReply('e7e5') },
    { name: 'missing move', reply: completion('{"reasoning":"Develop."}') },
    { name: 'missing reasoning', reply: completion('{"move":"e2e4"}') },
    { name: 'invalid reasoning type', reply: completion('{"move":"e2e4","reasoning":123}') },
    { name: 'JSON embedded in prose', reply: completion('Here is a move: {"move":"e2e4","reasoning":"Develop."}') },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const { provider, requests } = mockProvider([fixture.reply, moveReply('d2d4')]);
      assert.equal((await provider.getMove(request())).move, 'd2d4');
      assert.equal(requests.length, 2);
      assert.notDeepEqual(requests[1].messages, requests[0].messages, 'retry explains the previous response failure');
    });
  }
});

test('a length finish reason is retried with a larger token budget even for complete JSON', async () => {
  const { provider, requests } = mockProvider([moveReply('e2e4', 'length'), moveReply('d2d4')], {
    maxTokens: 256,
    maxRetryTokens: 1024,
  });
  assert.equal((await provider.getMove(request())).move, 'd2d4');
  assert.equal(requests.length, 2);
  const tokens = (wire: WireRequest) => wire.max_tokens ?? wire.max_completion_tokens;
  assert.ok(tokens(requests[1]) > tokens(requests[0]));
  assert.ok(tokens(requests[1]) <= 1024);
});

test('all response failures stop after three SDK calls by default', async () => {
  const { provider, requests } = mockProvider(Array.from({ length: 3 }, () => completion(null)));
  await assert.rejects(provider.getMove(request()), AIServiceError);
  assert.equal(requests.length, 3);
});

test('retryable HTTP and top-level provider errors recover', async t => {
  for (const fixture of [
    { name: 'HTTP 429', reply: { status: 429, body: { error: { message: 'Rate limited', code: 429 } }, headers: { 'retry-after': '0' } } },
    { name: 'HTTP 503', reply: { status: 503, body: { error: { message: 'Unavailable', code: 503 } } } },
    { name: 'HTTP 200 with error', reply: { body: { error: { message: 'Unavailable', code: 503 } } } },
  ]) {
    await t.test(fixture.name, async () => {
      const { provider, requests } = mockProvider([fixture.reply, moveReply()]);
      assert.equal((await provider.getMove(request())).move, 'e2e4');
      assert.equal(requests.length, 2);
    });
  }
});

test('authentication, credit, and unrelated request errors fail without retries', async t => {
  for (const status of [400, 401, 402, 403, 404, 422]) {
    await t.test(`HTTP ${status}`, async () => {
      const { provider, requests } = mockProvider([
        { status, body: { error: { message: 'Request rejected', code: status } } },
      ]);
      await assert.rejects(provider.getMove(request()), AIServiceError);
      assert.equal(requests.length, 1);
    });
  }
});

test('a Retry-After longer than the move budget fails without another paid request', async () => {
  const { provider, requests } = mockProvider([
    {
      status: 429,
      body: { error: { message: 'Rate limited', code: 429 } },
      headers: { 'retry-after': '60' },
    },
  ], { moveTimeoutMs: 1000 });
  const start = Date.now();
  await assert.rejects(provider.getMove(request()), { code: 'AI_RATE_LIMITED', retryAfterMs: 60000 });
  assert.equal(requests.length, 1);
  assert.ok(Date.now() - start < 1000);
});

test('temporary reserved spending capacity can retry only with an explicit marker and Retry-After', async t => {
  const capacityError = {
    error: {
      message: 'Temporary spending capacity unavailable',
      code: 402,
      metadata: { limit_source: 'openrouter_in_flight_budget' },
    },
  };
  await t.test('explicit temporary capacity and Retry-After recover', async () => {
    const { provider, requests } = mockProvider([
      { status: 402, body: capacityError, headers: { 'retry-after': '0' } },
      moveReply(),
    ]);
    assert.equal((await provider.getMove(request())).move, 'e2e4');
    assert.equal(requests.length, 2);
  });
  await t.test('exhausted retries expose capacity as a temporary rate limit', async () => {
    const { provider, requests } = mockProvider([
      { status: 402, body: capacityError, headers: { 'retry-after': '0' } },
    ], { maxAttempts: 1 });
    await assert.rejects(provider.getMove(request()), {
      code: 'AI_CAPACITY_LIMIT', status: 429, retryable: true,
    });
    assert.equal(requests.length, 1);
  });
  for (const fixture of [
    { name: 'missing Retry-After', reply: { status: 402, body: capacityError } },
    { name: 'invalid Retry-After', reply: { status: 402, body: capacityError, headers: { 'retry-after': 'soon' } } },
    { name: 'ordinary credits error despite Retry-After', reply: { status: 402, body: { error: { code: 402, message: 'Insufficient credits' } }, headers: { 'retry-after': '0' } } },
  ]) {
    await t.test(fixture.name, async () => {
      const { provider, requests } = mockProvider([fixture.reply]);
      await assert.rejects(provider.getMove(request()), { code: 'AI_CREDITS_EXHAUSTED', retryable: false });
      assert.equal(requests.length, 1);
    });
  }
});

test('the returned model identifies the actual routed provider model', async () => {
  const { provider } = mockProvider([
    completion('{"move":"e2e4","reasoning":"Control the center."}', 'stop', 'openai/actual-model'),
  ]);
  const result = await provider.getMove(request({ model: 'openrouter/auto' }));
  assert.equal(result.model, 'openai/actual-model');
});

test('empty completion model falls back to the requested model', async () => {
  const { provider } = mockProvider([
    completion('{"move":"e2e4","reasoning":"Control the center."}', 'stop', ''),
  ]);
  assert.equal((await provider.getMove(request())).model, MODEL);
});

test('known model capabilities choose schema, JSON object, or plain JSON instructions', async t => {
  for (const fixture of [
    { name: 'schema', parameters: ['structured_outputs', 'response_format'], format: 'json_schema' },
    { name: 'JSON object', parameters: ['response_format'], format: 'json_object' },
    { name: 'plain JSON', parameters: [], format: undefined },
  ]) {
    await t.test(fixture.name, async () => {
      const { provider, requests } = mockProvider([moveReply()], {}, fixture.parameters);
      await provider.loadModels();
      assert.equal((await provider.getMove(request())).move, 'e2e4');
      assert.equal(requests[0].response_format?.type, fixture.format);
      assert.match(JSON.stringify(requests[0].messages), /json/i);
    });
  }
});

test('reasoning settings respect explicit model capabilities and leave tokens for the move', async t => {
  const cases: {
    name: string;
    reasoning?: MockModelMetadata['reasoning'];
    cap?: number;
    expected: Record<string, string | number | boolean>;
  }[] = [
    { name: 'legacy catalog without reasoning metadata', expected: { effort: 'low', exclude: true } },
    { name: 'explicit null effort list accepts low', reasoning: { supported_efforts: null }, expected: { effort: 'low', exclude: true } },
    { name: 'enumerated efforts choose an available level', reasoning: { supported_efforts: ['high', 'medium'] }, expected: { effort: 'medium', exclude: true } },
    { name: 'omitted efforts do not invent a level', reasoning: {}, expected: { exclude: true } },
    { name: 'empty effort list does not invent a level', reasoning: { supported_efforts: [] }, expected: { exclude: true } },
    { name: 'supported token budget leaves most output for the response', reasoning: { supports_max_tokens: true }, expected: { max_tokens: 2048, exclude: true } },
    { name: 'model output cap limits the reasoning budget', reasoning: { supports_max_tokens: true }, cap: 4096, expected: { max_tokens: 1024, exclude: true } },
    { name: 'small output cap cannot reserve the entire response budget', reasoning: { supports_max_tokens: true }, cap: 1024, expected: { exclude: true } },
    { name: 'explicit unsupported token budget is omitted', reasoning: { supports_max_tokens: false }, expected: { exclude: true } },
    { name: 'effort and token budgets are never sent together', reasoning: { supported_efforts: ['low'], supports_max_tokens: true }, expected: { effort: 'low', exclude: true } },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const { provider, requests } = mockProvider([moveReply()], { maxTokens: 8192 }, {
        supported_parameters: ['structured_outputs', 'reasoning', 'temperature'],
        ...(fixture.reasoning !== undefined ? { reasoning: fixture.reasoning } : {}),
        ...(fixture.cap !== undefined ? { top_provider: { max_completion_tokens: fixture.cap } } : {}),
      });
      await provider.loadModels();
      assert.equal((await provider.getMove(request())).move, 'e2e4');
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0].reasoning, fixture.expected);
      assert.equal(requests[0].max_tokens, fixture.cap ?? 8192);
      assert.equal(requests[0].temperature, undefined);
    });
  }
});

test('unsupported structured format falls back within the same three-request budget', async () => {
  const { provider, requests } = mockProvider([
    { status: 400, body: { error: { message: 'response_format json_schema is not supported', code: 400 } } },
    { status: 400, body: { error: { message: 'response_format json_object is not supported', code: 400 } } },
    moveReply(),
  ]);
  assert.equal((await provider.getMove(request())).move, 'e2e4');
  assert.deepEqual(requests.map(wire => wire.response_format?.type), ['json_schema', 'json_object', undefined]);
});

test('an already cancelled move never reaches the provider', async () => {
  const { provider, requests } = mockProvider([]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(provider.getMove(request(), controller.signal), AIServiceError);
  assert.equal(requests.length, 0);
});

test('cancellation aborts an in-flight SDK request without retrying', async () => {
  const { provider, requests } = mockProvider([{ untilAborted: true }]);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30);
  try {
    await assert.rejects(provider.getMove(request(), controller.signal), AIServiceError);
    assert.equal(requests.length, 1);
  } finally {
    clearTimeout(timer);
  }
});

test('the total move deadline aborts a stalled provider request', async () => {
  const { provider, requests } = mockProvider([{ untilAborted: true }], {
    moveTimeoutMs: 60,
    requestTimeoutMs: 1000,
  });
  const start = Date.now();
  await assert.rejects(provider.getMove(request()), AIServiceError);
  assert.equal(requests.length, 1);
  assert.ok(Date.now() - start < 1000, 'move deadline must bound the entire request');
});
