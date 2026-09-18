import { useState, useCallback, useRef, useEffect } from 'react';
import { Chess } from 'chess.js';
import { apiService, type GameState, type AIMoveRequest } from '../services/api';
import { AIRequestTracker } from '../utils/aiRequestTracker';
import { cloneWithHistory } from '../utils/chessPosition';
import { chessSounds } from '../utils/sounds';

export interface AISettings {
  whiteModel: string;
  blackModel: string;
}

export const useChessGame = () => {
  const [gameId] = useState(() => `game_${Date.now()}`);
  const [game, setGame] = useState(() => new Chess());
  const [gameState] = useState<GameState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [gameActive, setGameActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [invalidMove, setInvalidMove] = useState<{ from: string; to: string } | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [lastReasoning, setLastReasoning] = useState<string | null>(null);
  const [forfeitResult, setForfeitResult] = useState<{ result: string; reason: string } | null>(null);

  const gameRef = useRef(game);
  const gameActiveRef = useRef(false);
  const aiSettingsRef = useRef<AISettings | null>(null);
  const requestsRef = useRef(new AIRequestTracker());

  useEffect(() => {
    const requests = requestsRef.current;
    return () => requests.cancel();
  }, []);

  const cancelAIMove = useCallback(() => {
    requestsRef.current.cancel();
    setIsThinking(false);
  }, []);

  const pauseGame = useCallback(() => {
    gameActiveRef.current = false;
    setGameActive(false);
    cancelAIMove();
  }, [cancelAIMove]);

  const initializeGame = useCallback((settings: AISettings | null) => {
    cancelAIMove();
    const nextGame = new Chess();
    gameRef.current = nextGame;
    aiSettingsRef.current = settings;
    gameActiveRef.current = true;
    setGame(nextGame);
    setGameActive(true);
    setIsLoading(false);
    setError(null);
    setLastMove(null);
    setInvalidMove(null);
    setSelectedSquare(null);
    setLastReasoning(null);
    setForfeitResult(null);
    chessSounds.playGameStart();
  }, [cancelAIMove]);

  const startGame = useCallback(async () => {
    initializeGame(null);
  }, [initializeGame]);

  const applyMove = useCallback((from: string, to: string, promotion?: string) => {
    if (!gameActiveRef.current) return false;

    // Use a fresh React state value without losing the repetition/history data.
    const nextGame = cloneWithHistory(gameRef.current);
    const move = nextGame.move({ from, to, promotion });
    gameRef.current = nextGame;
    setGame(nextGame);
    setLastMove({ from: move.from, to: move.to });
    setInvalidMove(null);
    setSelectedSquare(null);

    if (move.promotion) chessSounds.playPromote();
    else if (move.captured) chessSounds.playCapture();
    else if (move.flags.includes('k') || move.flags.includes('q')) chessSounds.playCastle();
    else chessSounds.playMove();

    if (nextGame.inCheck()) chessSounds.playCheck();
    if (nextGame.isGameOver()) {
      gameActiveRef.current = false;
      setGameActive(false);
      chessSounds.playGameEnd();
    }
    return true;
  }, []);

  const makeMove = useCallback(async (from: string, to: string, promotion?: string) => {
    if (!gameActiveRef.current) return false;
    cancelAIMove();
    setError(null);
    setIsLoading(true);
    try {
      return applyMove(from, to, promotion);
    } catch (err) {
      pauseGame();
      setError(err instanceof Error ? err.message : 'Failed to make move');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [applyMove, cancelAIMove, pauseGame]);

  const doAIMove = useCallback(async () => {
    const settings = aiSettingsRef.current;
    const position = gameRef.current;
    if (!settings || !gameActiveRef.current || position.isGameOver()) return;

    const pending = requestsRef.current.begin(position.fen());
    if (!pending) return;
    setIsThinking(true);
    setError(null);

    const isCurrent = () => gameActiveRef.current && requestsRef.current.isCurrent(pending, gameRef.current.fen());

    try {
      const currentTurn = position.turn();
      const legalMoves = position.moves({ verbose: true }).map(move => move.from + move.to + (move.promotion || ''));
      const request: AIMoveRequest = {
        provider: 'openrouter',
        model: currentTurn === 'w' ? settings.whiteModel : settings.blackModel,
        fen: pending.fen,
        moveHistory: position.history({ verbose: true }).map(move => move.from + move.to + (move.promotion || '')),
        playerColor: currentTurn,
        legalMoves,
      };

      const response = await apiService.getAIMove(request, pending.controller.signal);
      if (!isCurrent()) return;

      // Exact UCI matching requires the promotion suffix and rejects partial moves.
      if (!response.success || !legalMoves.includes(response.move)) {
        if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(response.move)) {
          setInvalidMove({ from: response.move.slice(0, 2), to: response.move.slice(2, 4) });
        }
        throw new Error('The AI returned an illegal move. Resume to try this turn again.');
      }

      if (applyMove(response.move.slice(0, 2), response.move.slice(2, 4), response.move[4])) {
        setLastReasoning(response.reasoning || null);
      }
    } catch (err) {
      // Reset, pause, resignation, or a newer turn owns the UI now.
      if (!isCurrent()) return;
      pauseGame();
      setError(err instanceof Error ? err.message : 'Failed to get AI move');
    } finally {
      // A late completion must not clear the next game's thinking indicator.
      if (requestsRef.current.finish(pending)) setIsThinking(false);
    }
  }, [applyMove, pauseGame]);

  useEffect(() => {
    if (!gameActive || !aiSettingsRef.current || game.isGameOver()) return;
    const timer = setTimeout(() => { void doAIMove(); }, 500);
    return () => clearTimeout(timer);
  }, [gameActive, game, doAIMove]);

  const startAIVsAIGame = useCallback(async (settings: AISettings) => {
    if (!settings.whiteModel.trim() || !settings.blackModel.trim()) {
      setError('Select a model for both White and Black.');
      return false;
    }
    initializeGame({ ...settings });
    return true;
  }, [initializeGame]);

  const resumeGame = useCallback(() => {
    if (!aiSettingsRef.current || gameRef.current.isGameOver() || forfeitResult) return;
    setError(null);
    setInvalidMove(null);
    gameActiveRef.current = true;
    setGameActive(true);
  }, [forfeitResult]);

  const resign = useCallback(() => {
    if (!gameActiveRef.current) return;
    pauseGame();
    const winner = gameRef.current.turn() === 'w' ? 'Black' : 'White';
    setForfeitResult({ result: winner === 'White' ? '1-0' : '0-1', reason: `${winner} wins by resignation` });
  }, [pauseGame]);

  const resetGame = useCallback(() => {
    pauseGame();
    const nextGame = new Chess();
    gameRef.current = nextGame;
    aiSettingsRef.current = null;
    setGame(nextGame);
    setIsLoading(false);
    setError(null);
    setLastMove(null);
    setInvalidMove(null);
    setSelectedSquare(null);
    setLastReasoning(null);
    setForfeitResult(null);
  }, [pauseGame]);

  const handleSquareSelect = useCallback((square: string | null) => {
    setSelectedSquare(square);
  }, []);

  const isGameOver = useCallback(() => forfeitResult !== null || game.isGameOver(), [game, forfeitResult]);

  const getGameResult = useCallback(() => {
    if (forfeitResult) return forfeitResult;
    if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? 'Black' : 'White';
      return { result: winner === 'White' ? '1-0' : '0-1', reason: `${winner} wins by checkmate` };
    }
    if (game.isStalemate()) return { result: '1/2-1/2', reason: 'Stalemate' };
    if (game.isThreefoldRepetition()) return { result: '1/2-1/2', reason: 'Draw by repetition' };
    if (game.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'Insufficient material' };
    if (game.isDraw()) return { result: '1/2-1/2', reason: 'Draw' };
    return null;
  }, [game, forfeitResult]);

  return {
    gameId, game, gameState, isLoading, isThinking, gameActive, error,
    lastMove, invalidMove, selectedSquare, lastReasoning,
    startGame, makeMove, getAndExecuteAIMove: doAIMove, startAIVsAIGame,
    pauseGame, resumeGame, resign, resetGame, handleSquareSelect, isGameOver, getGameResult,
  };
};
