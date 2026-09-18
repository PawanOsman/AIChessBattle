import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chess } from 'chess.js';
import { apiService, ApiError } from '../src/services/api.ts';
import { AIRequestTracker } from '../src/utils/aiRequestTracker.ts';
import { cloneWithHistory } from '../src/utils/chessPosition.ts';

const request = {
  provider: 'openrouter', model: 'test/model', fen: new Chess().fen(),
  moveHistory: [], playerColor: 'w', legalMoves: ['e2e4'],
};

test('only one AI request may own a turn', () => {
  const tracker = new AIRequestTracker();
  const pending = tracker.begin(request.fen);
  assert.ok(pending);
  assert.equal(tracker.begin(request.fen), null);
  assert.equal(tracker.isCurrent(pending, request.fen), true);
  assert.equal(tracker.isCurrent(pending, 'different position'), false);
  assert.equal(tracker.finish(pending), true);
  assert.ok(tracker.begin('next position'));
});

test('reset/pause invalidates late results even when a new game has the same FEN', () => {
  const tracker = new AIRequestTracker();
  const old = tracker.begin(request.fen);
  tracker.cancel();
  assert.equal(old.controller.signal.aborted, true);
  const current = tracker.begin(request.fen);
  assert.equal(tracker.isCurrent(old, request.fen), false);
  assert.equal(tracker.finish(old), false);
  assert.equal(tracker.isCurrent(current, request.fen), true);
  assert.equal(current.controller.signal.aborted, false);
});

test('immutable updates preserve all history and threefold repetition', () => {
  let game = new Chess();
  for (const san of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) {
    const before = game.fen();
    const previousLength = game.history().length;
    const next = cloneWithHistory(game);
    next.move(san);
    assert.equal(game.fen(), before);
    assert.equal(game.history().length, previousLength);
    assert.equal(next.history().length, previousLength + 1);
    game = next;
  }
  assert.equal(game.isThreefoldRepetition(), true);
  assert.equal(game.isGameOver(), true);
  assert.equal(new Chess().history().length, 0);
});

test('cloning preserves special-position history, en passant, castling, and promotion rights', () => {
  for (const [fen, moves, expected] of [
    [undefined, ['e4', 'a6', 'e5', 'd5'], 'exd6'],
    ['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', [], 'O-O'],
    ['7k/P7/8/8/8/8/8/7K w - - 0 1', [], 'a8=Q+'],
  ]) {
    const game = new Chess(fen);
    moves.forEach(san => game.move(san));
    const clone = cloneWithHistory(game);
    assert.equal(clone.fen(), game.fen());
    assert.deepEqual(clone.history(), game.history());
    assert.ok(clone.moves().includes(expected));
  }
});

test('AI calls are a single POST and validate the successful response', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/ai/move');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), request);
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ success: true, move: 'e2e4', reasoning: 'Controls the center.', confidence: 0.8 });
  });
  const result = await apiService.getAIMove(request);
  assert.equal(result.move, 'e2e4');
  assert.equal(result.reasoning, 'Controls the center.');
  assert.equal(result.provider, 'openrouter');
  assert.equal(fetch.mock.callCount(), 1);
});

test('server errors retain actionable details and never trigger another paid request', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({
    error: 'Failed to get AI move', details: 'The model is rate limited.', code: 'RATE_LIMITED', retryable: true,
  }, { status: 429 }));
  await assert.rejects(apiService.getAIMove(request), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.message, 'The model is rate limited.');
    assert.equal(error.status, 429);
    assert.equal(error.code, 'RATE_LIMITED');
    assert.equal(error.retryable, true);
    return true;
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test('malformed, partial, and non-JSON AI replies fail without client retries', async t => {
  const replies = [
    { success: true }, { success: true, move: 'e2e' }, { success: true, move: 'e2e4 extra' },
    { success: false, move: 'e2e4' }, null,
  ];
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(replies.shift()));
  for (let i = 0; i < 5; i++) await assert.rejects(apiService.getAIMove(request), ApiError);
  assert.equal(fetch.mock.callCount(), 5);
  fetch.mock.mockImplementation(async () => new Response('<html>Bad gateway</html>', { status: 502 }));
  await assert.rejects(apiService.getAIMove(request), /unreadable AI response/);
  assert.equal(fetch.mock.callCount(), 6);
});

test('pausing cancels the browser request and does not retry it', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  }));
  const controller = new AbortController();
  const result = assert.rejects(apiService.getAIMove(request, controller.signal), { name: 'AbortError' });
  controller.abort();
  await result;
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(fetch.mock.calls[0].arguments[1].signal.aborted, true);
});

test('a hung AI request times out and releases its timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  }));
  const result = assert.rejects(apiService.getAIMove(request), error => {
    assert.equal(error.code, 'TIMEOUT');
    assert.equal(error.retryable, true);
    return true;
  });
  t.mock.timers.tick(180_000);
  await result;
  assert.equal(fetch.mock.callCount(), 1);
});
