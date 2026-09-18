import { Chess } from 'chess.js';

export function cloneWithHistory(game: Chess): Chess {
  const clone = new Chess();
  // Cloning only the FEN loses move history and threefold-repetition detection.
  clone.loadPgn(game.pgn());
  return clone;
}
