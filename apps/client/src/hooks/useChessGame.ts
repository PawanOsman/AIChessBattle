import { useState, useCallback, useRef, useEffect } from 'react';
import { Chess } from 'chess.js';
import { apiService, type GameState, type AIMoveRequest } from '../services/api';
import { AIRequestTracker } from '../utils/aiRequestTracker';
import { cloneWithHistory } from '../utils/chessPosition';
import { GameTelemetry, type GameTelemetrySnapshot, type MoveRecord, type AIRequestRecord } from '../utils/gameTelemetry';
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
  const [telemetry, setTelemetry] = useState<GameTelemetrySnapshot>({
    moveRecords: [], requestRecords: [], activeRequest: null,
  });
  const [moveDelayMs, updateMoveDelayMs] = useState(500);
  const [soundEnabled, updateSoundEnabled] = useState(() => chessSounds.isEnabled());

  const gameRef = useRef(game);
  const gameActiveRef = useRef(false);
  const aiSettingsRef = useRef<AISettings | null>(null);
  const requestsRef = useRef(new AIRequestTracker());
  const telemetryRef = useRef(new GameTelemetry());

  useEffect(() => {
    const requests = requestsRef.current;
    const recorder = telemetryRef.current;
    return () => {
      requests.cancel();
      recorder.reset();
    };
  }, []);

  const cancelAIMove = useCallback(() => {
    requestsRef.current.cancel();
    const activeRequest = telemetryRef.current.getSnapshot().activeRequest;
    if (activeRequest) {
      const snapshot = telemetryRef.current.finish(activeRequest, 'cancelled');
      if (snapshot) setTelemetry(snapshot);
    }
    setIsThinking(false);
  }, []);

  const setMoveDelayMs = useCallback((value: number) => {
    if (Number.isFinite(value)) updateMoveDelayMs(Math.max(0, Math.min(10_000, value)));
  }, []);

  const setSoundEnabled = useCallback((enabled: boolean) => {
    chessSounds.setEnabled(enabled);
    updateSoundEnabled(enabled);
  }, []);

  const pauseGame = useCallback(() => {
    gameActiveRef.current = false;
    setGameActive(false);
    cancelAIMove();
  }, [cancelAIMove]);

  const initializeGame = useCallback((settings: AISettings | null) => {
    cancelAIMove();
    setTelemetry(telemetryRef.current.reset());
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

  const applyMove = useCallback((from: string, to: string, promotion?: string, allowPaused = false) => {
    if (!gameActiveRef.current && !allowPaused) return null;

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
    return move;
  }, []);

  const makeMove = useCallback(async (from: string, to: string, promotion?: string) => {
    if (!gameActiveRef.current) return false;
    cancelAIMove();
    setError(null);
    setIsLoading(true);
    try {
      return Boolean(applyMove(from, to, promotion));
    } catch (err) {
      pauseGame();
      setError(err instanceof Error ? err.message : 'Failed to make move');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [applyMove, cancelAIMove, pauseGame]);

  const doAIMove = useCallback(async (singleStep = false) => {
    const settings = aiSettingsRef.current;
    const position = gameRef.current;
    if (!settings || position.isGameOver() || forfeitResult
      || (singleStep ? gameActiveRef.current : !gameActiveRef.current)) return false;

    const pending = requestsRef.current.begin(position.fen());
    if (!pending) return false;
    const currentTurn = position.turn();
    const model = currentTurn === 'w' ? settings.whiteModel : settings.blackModel;
    const timedRequest = telemetryRef.current.begin(currentTurn, model);
    if (!timedRequest) {
      requestsRef.current.finish(pending);
      return false;
    }
    setTelemetry(telemetryRef.current.getSnapshot());
    setIsThinking(true);
    setError(null);
    setInvalidMove(null);

    const isCurrent = () => (singleStep || gameActiveRef.current)
      && requestsRef.current.isCurrent(pending, gameRef.current.fen());
    const finish = (status: AIRequestRecord['status'], move?: Omit<MoveRecord, 'durationMs'>) => {
      if (!requestsRef.current.finish(pending)) return;
      const snapshot = telemetryRef.current.finish(timedRequest, status, move);
      if (snapshot) setTelemetry(snapshot);
      setIsThinking(false);
    };

    try {
      const legalMoves = position.moves({ verbose: true }).map(move => move.from + move.to + (move.promotion || ''));
      const request: AIMoveRequest = {
        provider: 'openrouter',
        model,
        fen: pending.fen,
        moveHistory: position.history({ verbose: true }).map(move => move.from + move.to + (move.promotion || '')),
        playerColor: currentTurn,
        legalMoves,
      };

      const response = await apiService.getAIMove(request, pending.controller.signal);
      if (!isCurrent()) return false;

      // Exact UCI matching requires the promotion suffix and rejects partial moves.
      if (!response.success || !legalMoves.includes(response.move)) {
        if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(response.move)) {
          setInvalidMove({ from: response.move.slice(0, 2), to: response.move.slice(2, 4) });
        }
        throw new Error('The AI returned an illegal move. Resume to try this turn again.');
      }

      const move = applyMove(response.move.slice(0, 2), response.move.slice(2, 4), response.move[4], singleStep);
      if (!move) {
        finish('cancelled');
        return false;
      }
      finish('completed', {
        ply: request.moveHistory.length + 1, color: currentTurn, model,
        actualModel: response.model, san: move.san, uci: response.move,
        fenBefore: pending.fen, fenAfter: gameRef.current.fen(), reasoning: response.reasoning,
      });
      setLastReasoning(response.reasoning || null);
      return true;
    } catch (err) {
      // Reset, pause, resignation, or a newer turn owns the UI now.
      if (!isCurrent()) return false;
      finish('failed');
      pauseGame();
      setError(err instanceof Error ? err.message : 'Failed to get AI move');
      return false;
    }
  }, [applyMove, pauseGame, forfeitResult]);

  const stepAIMove = useCallback(() => doAIMove(true), [doAIMove]);

  useEffect(() => {
    if (!gameActive || !aiSettingsRef.current || game.isGameOver()) return;
    const timer = setTimeout(() => { void doAIMove(); }, moveDelayMs);
    return () => clearTimeout(timer);
  }, [gameActive, game, doAIMove, moveDelayMs]);

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
    setTelemetry(telemetryRef.current.reset());
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
    ...telemetry, moveDelayMs, setMoveDelayMs, soundEnabled, setSoundEnabled, stepAIMove,
    startGame, makeMove, getAndExecuteAIMove: doAIMove, startAIVsAIGame,
    pauseGame, resumeGame, resign, resetGame, handleSquareSelect, isGameOver, getGameResult,
  };
};
