import { Router } from 'express';
import { Chess } from 'chess.js';

const router = Router();

// Store active games in memory (in production, use a database)
const games = new Map<string, Chess>();

// Start a new game
router.post('/start', (req, res) => {
  const { gameId } = req.body;
  
  if (!gameId) {
    return res.status(400).json({ error: 'Game ID is required' });
  }
  
  const game = new Chess();
  games.set(gameId, game);
  
  res.json({
    gameId,
    fen: game.fen(),
    turn: game.turn(),
    isCheck: game.inCheck(),
    isCheckmate: game.isCheckmate(),
    isStalemate: game.isStalemate(),
    isDraw: game.isDraw(),
  });
});

// Get current game state
router.get('/state/:gameId', (req, res) => {
  const { gameId } = req.params;
  const game = games.get(gameId);
  
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }
  
  res.json({
    gameId,
    fen: game.fen(),
    turn: game.turn(),
    isCheck: game.inCheck(),
    isCheckmate: game.isCheckmate(),
    isStalemate: game.isStalemate(),
    isDraw: game.isDraw(),
    moveHistory: game.history(),
    pgn: game.pgn(),
  });
});

// Make a move
router.post('/move/:gameId', (req, res) => {
  const { gameId } = req.params;
  const { from, to, promotion } = req.body;
  
  const game = games.get(gameId);
  
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }
  
  try {
    const move = game.move({ from, to, promotion });
    
    if (!move) {
      return res.status(400).json({ error: 'Invalid move' });
    }
    
    res.json({
      success: true,
      move: {
        from: move.from,
        to: move.to,
        piece: move.piece,
        captured: move.captured,
        promotion: move.promotion,
        san: move.san,
      },
      fen: game.fen(),
      turn: game.turn(),
      isCheck: game.inCheck(),
      isCheckmate: game.isCheckmate(),
      isStalemate: game.isStalemate(),
      isDraw: game.isDraw(),
      gameOver: game.isGameOver(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: 'Invalid move', details: errorMessage });
  }
});

// Get legal moves for a position
router.get('/moves/:gameId', (req, res) => {
  const { gameId } = req.params;
  const game = games.get(gameId);
  
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }
  
  const moves = game.moves({ verbose: true });
  res.json({ moves });
});

// Get legal moves for a specific square
router.get('/moves/:gameId/:square', (req, res) => {
  const { gameId } = req.params;
  const square = (req.params as any).square;
  const game = games.get(gameId);
  
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }
  
  const moves = game.moves({ square: square as any, verbose: true });
  res.json({ moves });
});

export { router as gameRoutes };
