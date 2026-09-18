import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameTelemetry } from '../src/utils/gameTelemetry.ts';

const move = {
  ply: 1, color: 'w', model: 'provider/white', actualModel: 'provider/white-v2',
  san: 'e4', uci: 'e2e4', fenBefore: 'before', fenAfter: 'after', reasoning: 'Takes the center.',
};

test('one completed request and its applied move share exact elapsed time', () => {
  let now = 100;
  const recorder = new GameTelemetry(() => now);
  const request = recorder.begin('w', 'provider/white');
  assert.deepEqual(recorder.getSnapshot().activeRequest, {
    color: 'w', model: 'provider/white', startedAt: 100,
  });
  assert.equal(recorder.begin('b', 'provider/black'), null);
  now = 1_654.5;
  const snapshot = recorder.finish(request, 'completed', move);
  assert.equal(snapshot.activeRequest, null);
  assert.deepEqual(snapshot.moveRecords, [{ ...move, durationMs: 1_554.5 }]);
  assert.deepEqual(snapshot.requestRecords, [{
    color: 'w', model: 'provider/white', durationMs: 1_554.5, status: 'completed',
  }]);
});

test('failure and cancellation consume time without adding played moves', () => {
  let now = 0;
  const recorder = new GameTelemetry(() => now);
  const failed = recorder.begin('w', 'provider/white');
  now = 2_000;
  recorder.finish(failed, 'failed');
  const cancelled = recorder.begin('w', 'provider/white');
  now = 2_750;
  recorder.finish(cancelled, 'cancelled');
  // An aborting transport can still reject/resolve later; it must count only once.
  now = 5_000;
  assert.equal(recorder.finish(cancelled, 'failed'), null);
  assert.equal(recorder.finish(cancelled, 'completed', move), null);
  assert.equal(recorder.getSnapshot().moveRecords.length, 0);
  assert.deepEqual(recorder.getSnapshot().requestRecords.map(record => [record.status, record.durationMs]), [
    ['failed', 2_000], ['cancelled', 750],
  ]);
});

test('late cancelled response cannot complete or clear the next turn', () => {
  let now = 500;
  const recorder = new GameTelemetry(() => now);
  const oldRequest = recorder.begin('w', 'provider/white');
  now = 900;
  recorder.finish(oldRequest, 'cancelled');
  const nextRequest = recorder.begin('w', 'provider/white');
  now = 1_500;
  assert.equal(recorder.finish(oldRequest, 'completed', move), null);
  assert.equal(recorder.getSnapshot().activeRequest, nextRequest);
  now = 2_000;
  const snapshot = recorder.finish(nextRequest, 'completed', move);
  assert.equal(snapshot.requestRecords.length, 2);
  assert.equal(snapshot.moveRecords[0].durationMs, 1_100);
});

test('reset discards prior work and stale responses even with identical timestamps and models', () => {
  let now = 100;
  const recorder = new GameTelemetry(() => now);
  const oldRequest = recorder.begin('w', 'provider/white');
  assert.deepEqual(recorder.reset(), { activeRequest: null, moveRecords: [], requestRecords: [] });
  const newRequest = recorder.begin('w', 'provider/white');
  assert.deepEqual(oldRequest, newRequest);
  assert.notEqual(oldRequest, newRequest);
  now = 400;
  assert.equal(recorder.finish(oldRequest, 'cancelled'), null);
  assert.equal(recorder.finish(oldRequest, 'completed', move), null);
  assert.equal(recorder.getSnapshot().activeRequest, newRequest);
  const snapshot = recorder.finish(newRequest, 'completed', move);
  assert.equal(snapshot.moveRecords.length, 1);
  assert.equal(snapshot.requestRecords.length, 1);
  assert.equal(snapshot.moveRecords[0].durationMs, 300);
});

test('playback delay and paused time are excluded, but whole request retry time is included', () => {
  let now = 10_000;
  const recorder = new GameTelemetry(() => now);
  const white = recorder.begin('w', 'provider/white');
  now += 8_000; // A single POST may include several server-side provider attempts.
  recorder.finish(white, 'completed', move);
  now += 60_000; // A user pause and presentation delay must not count as inference time.
  const black = recorder.begin('b', 'provider/black');
  now += 2_000;
  const snapshot = recorder.finish(black, 'completed', {
    ...move, ply: 2, color: 'b', model: 'provider/black', san: 'e5', uci: 'e7e5',
  });
  assert.deepEqual(snapshot.moveRecords.map(record => record.durationMs), [8_000, 2_000]);
  assert.equal(snapshot.requestRecords.reduce((sum, record) => sum + record.durationMs, 0), 10_000);
});

test('published snapshots stay immutable across further turns and reset', () => {
  let now = 0;
  const recorder = new GameTelemetry(() => now);
  const first = recorder.begin('w', 'provider/white');
  const thinking = recorder.getSnapshot();
  now = 10;
  const played = recorder.finish(first, 'completed', move);
  const second = recorder.begin('b', 'provider/black');
  now = 20;
  recorder.finish(second, 'failed');
  recorder.reset();
  assert.equal(thinking.activeRequest, first);
  assert.equal(thinking.requestRecords.length, 0);
  assert.equal(played.activeRequest, null);
  assert.equal(played.requestRecords.length, 1);
  assert.equal(played.moveRecords.length, 1);
});
