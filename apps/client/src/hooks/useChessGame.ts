import { useState, useCallback, useRef, useEffect } from 'react';
import { Chess } from 'chess.js';
import { apiService, type GameState, type AIMoveRequest } from '../services/api';
import { chessSounds } from '../utils/sounds';

export interface AISettings {
  whiteModel: string;
  blackModel: string;
}

export const useChessGame = () => {
  const [gameId] = useState(() => `game_${Date.now()}`);
  const [game, setGame] = useState(() => new Chess());
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [gameActive, setGameActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [invalidMove, setInvalidMove] = useState<{ from: string; to: string } | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [lastReasoning, setLastReasoning] = useState<string | null>(null);
  const [moveCount, setMoveCount] = useState(0);
  const [forfeitResult, setForfeitResult] = useState<{ result: string; reason: string } | null>(null);

  // Refs to avoid stale closures in the game loop
  const gameRef = useRef(game);
  const gameActiveRef = useRef(gameActive);
  const isThinkingRef = useRef(isThinking);
  const aiSettingsRef = useRef<AISettings | null>(null);
  const retryCountRef = useRef(0);
  const uciHistoryRef = useRef<string[]>([]);

  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => { gameActiveRef.current = gameActive; }, [gameActive]);
  useEffect(() => { isThinkingRef.current = isThinking; }, [isThinking]);

  const startGame = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Initialize game locally (no server needed for AI vs AI)
      const newGame = new Chess();
      
      setGame(newGame);
      gameRef.current = newGame;
      setGameState(null);
      setGameActive(true);
      gameActiveRef.current = true;
      setLastMove(null);
      setSelectedSquare(null);
      setLastReasoning(null);
      setMoveCount(0);
      retryCountRef.current = 0;
      
      // Play game start sound
      chessSounds.playGameStart();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start game');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const makeMove = useCallback(async (from: string, to: string, promotion?: string) => {
    if (!gameActiveRef.current) {
      console.log('❌ makeMove blocked: gameActive=', gameActiveRef.current);
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Make move directly on client-side chess.js instance
      const g = gameRef.current;
      console.log('🎲 Current FEN before move:', g.fen());
      console.log('🎲 Attempting move:', { from, to, promotion });
      
      const move = g.move({ from, to, promotion });
      console.log('🎲 Move result:', move);
      
      if (move) {
        console.log('✅ Move successful! New FEN:', g.fen());
        
        // Add move to UCI history
        const uciMove = from + to + (promotion || '');
        uciHistoryRef.current = [...uciHistoryRef.current, uciMove];
        
        // Play appropriate sound
        if (move.captured) {
          chessSounds.playCapture();
        } else if (move.flags.includes('k') || move.flags.includes('q')) {
          chessSounds.playCastle();
        } else if (move.promotion) {
          chessSounds.playPromote();
        } else {
          chessSounds.playMove();
        }
        
        // Check for check
        if (g.inCheck()) {
          chessSounds.playCheck();
        }
        
        // Update state with the mutated game (use the same instance to preserve history)
        setGame(g);
        gameRef.current = g;
        setLastMove({ from, to });
        setSelectedSquare(null);
        setMoveCount(c => c + 1);

        if (g.isGameOver()) {
          setGameActive(false);
          gameActiveRef.current = false;
          chessSounds.playGameEnd();
        }
        return true;
      } else {
        console.error('❌ chess.js rejected the move');
        return false;
      }
    } catch (err) {
      console.error('❌ makeMove exception:', err);
      setError(err instanceof Error ? err.message : 'Failed to make move');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const doAIMove = useCallback(async () => {
    const settings = aiSettingsRef.current;
    const g = gameRef.current;
    if (!settings || !gameActiveRef.current || isThinkingRef.current) return;
    if (g.isGameOver()) return;

    setIsThinking(true);
    isThinkingRef.current = true;
    setError(null);

    try {
      const currentTurn = g.turn();
      const model = currentTurn === 'w' ? settings.whiteModel : settings.blackModel;

      // Get legal moves in UCI format
      const verboseMoves = g.moves({ verbose: true });
      const legalMoves = verboseMoves.map(m => {
        const move = m.from + m.to + (m.promotion || '');
        return move;
      });

      // Group moves by piece
      const pieceMovesMap = new Map<string, { piece: string; square: string; moves: string[] }>();
      
      for (const move of verboseMoves) {
        const key = `${move.piece}_${move.from}`;
        const pieceNames: Record<string, string> = {
          'p': 'Pawn', 'n': 'Knight', 'b': 'Bishop', 
          'r': 'Rook', 'q': 'Queen', 'k': 'King'
        };
        const pieceName = pieceNames[move.piece] || move.piece;
        
        if (!pieceMovesMap.has(key)) {
          pieceMovesMap.set(key, {
            piece: pieceName,
            square: move.from,
            moves: []
          });
        }
        
        const uciMove = move.from + move.to + (move.promotion || '');
        pieceMovesMap.get(key)!.moves.push(uciMove);
      }
      
      const piecesMoves = Array.from(pieceMovesMap.values());

      const request: AIMoveRequest = {
        provider: 'openrouter',
        model,
        fen: g.fen(),
        moveHistory: uciHistoryRef.current,
        playerColor: currentTurn,
        legalMoves,
        piecesMoves,
      };

      console.log('🤖 Requesting AI move:', request);
      const response = await apiService.getAIMove(request);
      console.log('✅ AI response:', response);
      
      if (response.success && response.move) {
        const moveUci = response.move;
        const from = moveUci.substring(0, 2);
        const to = moveUci.substring(2, 4);
        const promotion = moveUci.length > 4 ? moveUci[4] : undefined;

        console.log(`🎯 Parsed move: from=${from}, to=${to}, promotion=${promotion}`);

        if (response.reasoning) {
          setLastReasoning(response.reasoning);
        }

        const validMoves = g.moves({ verbose: true });
        console.log(`📋 Valid moves available:`, validMoves.map(m => `${m.from}->${m.to}`).join(', '));
        console.log(`🔍 Looking for move: ${from}->${to}${promotion ? ` (promotion: ${promotion})` : ''}`);
        
        const isValidMove = validMoves.some(m => 
          m.from === from && m.to === to && (!promotion || m.promotion === promotion)
        );

        console.log(`✔️ Move valid: ${isValidMove}`);

        if (isValidMove) {
          console.log('📍 Calling makeMove...');
          // Clear any previous invalid move display
          setInvalidMove(null);
          const result = await makeMove(from, to, promotion);
          console.log('📍 makeMove result:', result);
          
          if (result) {
            // Move succeeded, reset retry counter
            retryCountRef.current = 0;
          } else {
            // Move failed, increment retry counter
            retryCountRef.current += 1;
            // Show the failed move attempt
            setInvalidMove({ from, to });
            
            if (retryCountRef.current >= 3) {
              const loser = currentTurn === 'w' ? 'White' : 'Black';
              const winner = currentTurn === 'w' ? 'Black' : 'White';
              const result = winner === 'White' ? '1-0' : '0-1';
              setForfeitResult({ result, reason: `${loser} forfeits after 3 invalid move attempts` });
              setError(`${loser} forfeits after 3 invalid move attempts. ${winner} wins!`);
              setGameActive(false);
              gameActiveRef.current = false;
              retryCountRef.current = 0;
            } else {
              console.log(`⚠️ Retry attempt ${retryCountRef.current}/3`);
              // Trigger another attempt by incrementing moveCount
              setMoveCount(c => c + 1);
            }
          }
        } else {
          // Invalid move suggested - show it visually
          setInvalidMove({ from, to });
          retryCountRef.current += 1;
          
          if (retryCountRef.current >= 3) {
            const loser = currentTurn === 'w' ? 'White' : 'Black';
            const winner = currentTurn === 'w' ? 'Black' : 'White';
            const result = winner === 'White' ? '1-0' : '0-1';
            console.error(`❌ ${loser} suggested invalid move 3 times:`, moveUci);
            setForfeitResult({ result, reason: `${loser} forfeits after 3 invalid move attempts` });
            setError(`${loser} forfeits after 3 invalid move attempts. ${winner} wins!`);
            setGameActive(false);
            gameActiveRef.current = false;
            retryCountRef.current = 0;
          } else {
            console.error(`❌ Invalid move (attempt ${retryCountRef.current}/3):`, moveUci, 'Valid moves:', validMoves.map(m => m.from + m.to));
            setError(`Invalid move attempt ${retryCountRef.current}/3. Retrying...`);
            // Trigger retry by incrementing moveCount
            setMoveCount(c => c + 1);
          }
        }
      } else {
        console.error('❌ AI failed to provide valid move');
        setError('AI failed to provide a valid move');
        setGameActive(false);
        gameActiveRef.current = false;
      }
    } catch (err) {
      console.error('❌ AI move error:', err);
      setError(err instanceof Error ? err.message : 'Failed to get AI move');
    } finally {
      setIsThinking(false);
      isThinkingRef.current = false;
    }
  }, [makeMove]);

  // Effect-driven game loop: triggers after every move
  useEffect(() => {
    if (!gameActive || !aiSettingsRef.current) return;
    if (gameRef.current.isGameOver()) return;

    const timer = setTimeout(() => {
      doAIMove();
    }, 500);

    return () => clearTimeout(timer);
  }, [gameActive, moveCount, doAIMove]);

  const startAIVsAIGame = useCallback(async (aiSettings: AISettings) => {
    aiSettingsRef.current = aiSettings;
    await startGame();
  }, [startGame]);

  const resign = useCallback(() => {
    if (!gameActiveRef.current) return;
    setGameActive(false);
    gameActiveRef.current = false;
    const winner = gameRef.current.turn() === 'w' ? 'Black' : 'White';
    setError(`${winner} wins by resignation`);
  }, []);

  const resetGame = useCallback(() => {
    const newGame = new Chess();
    setGame(newGame);
    gameRef.current = newGame;
    setGameState(null);
    setGameActive(false);
    gameActiveRef.current = false;
    setIsThinking(false);
    isThinkingRef.current = false;
    setError(null);
    setLastMove(null);
    setInvalidMove(null);
    setSelectedSquare(null);
    setLastReasoning(null);
    setMoveCount(0);
    setForfeitResult(null);
    uciHistoryRef.current = [];
    aiSettingsRef.current = null;
  }, []);

  const handleSquareSelect = useCallback((square: string | null) => {
    setSelectedSquare(square);
  }, []);

  const isGameOver = useCallback(() => {
    return forfeitResult !== null || game.isCheckmate() || game.isStalemate() || game.isDraw() || game.isThreefoldRepetition() || game.isInsufficientMaterial();
  }, [game, forfeitResult]);

  const getGameResult = useCallback(() => {
    // Check for forfeit first
    if (forfeitResult) {
      return forfeitResult;
    }
    if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? 'Black' : 'White';
      return { result: winner === 'White' ? '1-0' : '0-1', reason: `${winner} wins by checkmate` };
    }
    if (game.isStalemate()) return { result: '1/2-1/2', reason: 'Stalemate' };
    if (game.isDraw()) return { result: '1/2-1/2', reason: 'Draw' };
    if (game.isThreefoldRepetition()) return { result: '1/2-1/2', reason: 'Draw by repetition' };
    if (game.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'Insufficient material' };
    return null;
  }, [game, forfeitResult]);

  return {
    gameId,
    game,
    gameState,
    isLoading,
    isThinking,
    gameActive,
    error,
    lastMove,
    invalidMove,
    selectedSquare,
    lastReasoning,
    startGame,
    makeMove,
    getAndExecuteAIMove: doAIMove,
    startAIVsAIGame,
    resign,
    resetGame,
    handleSquareSelect,
    isGameOver,
    getGameResult,
  };
};
