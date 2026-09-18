import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chess } from 'chess.js';
import { buildGamePgn } from '../src/utils/gameExport.ts';

test('PGN export preserves moves, model attribution, result, date, and per-move times', () => {
  const game = new Chess();
  const records = ['f3', 'e5', 'g4', 'Qh4#'].map((san, index) => {
    const fenBefore = game.fen();
    const move = game.move(san);
    return { ply: index + 1, color: move.color, model: 'test/model', san: move.san,
      uci: move.from + move.to, fenBefore, fenAfter: game.fen(), durationMs: 1250 + index * 100,
      reasoning: 'A {short} explanation.' };
  });
  const fen = game.fen();
  const pgn = buildGamePgn(game, records, { whiteModel: 'provider/white', blackModel: 'provider/black' }, '0-1', new Date(2026, 8, 18));
  const imported = new Chess();
  imported.loadPgn(pgn);
  assert.deepEqual(imported.history(), game.history());
  assert.equal(imported.fen(), fen);
  assert.equal(imported.getHeaders().White, 'provider/white');
  assert.equal(imported.getHeaders().Black, 'provider/black');
  assert.equal(imported.getHeaders().Date, '2026.09.18');
  assert.equal(imported.getHeaders().Result, '0-1');
  assert.match(pgn, /\[%emt 1\.250\]/);
  assert.equal(imported.getComments().length, 4);
  assert.equal(game.fen(), fen, 'export must not change the live game');
  assert.equal(game.getComments().length, 0, 'comments belong only to the export');
});

test('PGN export preserves promotion and custom starting positions', () => {
  const game = new Chess('7k/P7/8/8/8/8/8/7K w - - 0 1');
  game.move('a8=Q+');
  const imported = new Chess();
  imported.loadPgn(buildGamePgn(game, [], { whiteModel: 'white', blackModel: 'black' }));
  assert.equal(imported.fen(), game.fen());
  assert.equal(imported.getHeaders().Result, '*');
  assert.deepEqual(imported.history(), ['a8=Q+']);
});
