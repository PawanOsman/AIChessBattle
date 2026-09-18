import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDuration } from '../src/utils/formatTime.ts';
import { activeRequestDuration, aggregateGameStats } from '../src/utils/gameStats.ts';

const move = (color, durationMs, ply = 1) => ({
  color, durationMs, ply, model: 'same/model', san: 'e4', uci: 'e2e4', fenBefore: '', fenAfter: '',
});
const request = (color, durationMs, status = 'completed') => ({ color, durationMs, status, model: 'same/model' });

test('duration formatting rounds consistently at second, minute, and hour boundaries', () => {
  for (const [value, expected] of [
    [0, '0 ms'], [-5, '0 ms'], [48.7, '49 ms'], [999, '999 ms'], [999.6, '1.0 s'],
    [1254, '1.3 s'], [59900, '59.9 s'], [59999, '1m 00s'], [65000, '1m 05s'],
    [3599999, '1h 00m 00s'], [3725000, '1h 02m 05s'], [NaN, '—'], [Infinity, '—'],
  ]) assert.equal(formatDuration(value), expected);
});

test('empty games show no move average rather than implying an instant successful move', () => {
  const stats = aggregateGameStats([], []);
  assert.deepEqual(stats.w, stats.b);
  assert.equal(stats.w.completedMoves, 0);
  assert.equal(stats.w.totalRequestTimeMs, 0);
  assert.equal(stats.w.averageMoveMs, null);
  assert.equal(stats.w.fastestMoveMs, null);
  assert.equal(stats.w.slowestMoveMs, null);
  assert.equal(stats.w.lastMoveMs, null);
  assert.notEqual(stats.w, stats.b);
});

test('same model on both sides retains separate move and request statistics', () => {
  const stats = aggregateGameStats(
    [move('w', 3000), move('b', 9000, 2), move('w', 1000, 3)],
    [request('w', 3000), request('b', 9000), request('w', 1000)],
  );
  assert.equal(stats.w.completedMoves, 2);
  assert.equal(stats.w.totalRequestTimeMs, 4000);
  assert.equal(stats.w.averageMoveMs, 2000);
  assert.equal(stats.w.fastestMoveMs, 1000);
  assert.equal(stats.w.slowestMoveMs, 3000);
  assert.equal(stats.w.lastMoveMs, 1000);
  assert.equal(stats.b.completedMoves, 1);
  assert.equal(stats.b.totalRequestTimeMs, 9000);
  assert.equal(stats.b.averageMoveMs, 9000);
});

test('failed and cancelled requests count toward total time without distorting move averages', () => {
  const stats = aggregateGameStats(
    [move('w', 2000)],
    [request('w', 4000, 'failed'), request('w', 500, 'cancelled'), request('w', 2000), request('b', 1500, 'cancelled')],
  );
  assert.equal(stats.w.totalRequestTimeMs, 6500);
  assert.equal(stats.w.successfulTimeMs, 2000);
  assert.equal(stats.w.averageMoveMs, 2000);
  assert.equal(stats.w.completedMoves, 1);
  assert.equal(stats.w.failedRequests, 1);
  assert.equal(stats.w.cancelledRequests, 1);
  assert.equal(stats.b.totalRequestTimeMs, 1500);
  assert.equal(stats.b.averageMoveMs, null);
  assert.equal(stats.b.cancelledRequests, 1);
});

test('zero-duration moves remain valid measurements and do not disappear from minima', () => {
  const stats = aggregateGameStats([move('w', 0), move('w', 2000, 3)], [request('w', 0), request('w', 2000)]);
  assert.equal(stats.w.completedMoves, 2);
  assert.equal(stats.w.fastestMoveMs, 0);
  assert.equal(stats.w.averageMoveMs, 1000);
});

test('active time uses the request start, excludes previous requests, and never becomes negative', () => {
  const active = { color: 'w', model: 'test/model', startedAt: 1000 };
  assert.equal(activeRequestDuration(active, 1500), 500);
  assert.equal(activeRequestDuration(active, 900), 0);
  assert.equal(activeRequestDuration(null, 1500), 0);
  assert.equal(activeRequestDuration({ ...active, startedAt: 1499 }, 1500), 1);
});
