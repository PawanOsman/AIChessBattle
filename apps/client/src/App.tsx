import { useState, useEffect, useMemo } from 'react';
import { Chessboard } from './components/ChessBoard/index';
import { customPieces } from './components/ChessBoard/customPieces';
import { GameControls } from './components/GameControls';
import { AISettings } from './components/AISettings';
import { GameResultDialog } from './components/GameResultDialog';
import { useChessGame, type AISettings as AISettingsType } from './hooks/useChessGame';
import { apiService, type ProviderInfo } from './services/api';
import './App.css';

const defaultAISettings: AISettingsType = {
  whiteModel: '',
  blackModel: '',
};

function App() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [aiSettings, setAISettings] = useState<AISettingsType>(defaultAISettings);
  const [showSettings, setShowSettings] = useState(true);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [showResultDialog, setShowResultDialog] = useState(true);

  const {
    game,
    isLoading,
    isThinking,
    gameActive,
    error,
    lastMove,
    invalidMove,
    lastReasoning,
    startAIVsAIGame,
    pauseGame,
    resumeGame,
    resetGame,
    isGameOver,
    getGameResult,
  } = useChessGame();

  useEffect(() => {
    const loadProviders = async () => {
      try {
        const data = await apiService.getProviders();
        setProviders(data);
        const openrouter = data.find(p => p.id === 'openrouter');
        if (openrouter && openrouter.models.length > 0) {
          setAISettings({
            whiteModel: openrouter.models[0]?.id || '',
            blackModel: openrouter.models[0]?.id || '',
          });
        }
      } catch (err) {
        console.error('Failed to load providers:', err);
      }
    };
    loadProviders();
  }, []);

  const handleNewGame = () => {
    resetGame();
    setShowSettings(true);
    setShowResultDialog(true);
  };

  const handleStartAIGame = async () => {
    if (await startAIVsAIGame(aiSettings)) {
      setShowSettings(false);
      setShowResultDialog(true);
    }
  };

  const handleFlip = () => {
    setOrientation(prev => prev === 'white' ? 'black' : 'white');
  };

  const handleCloseDialog = () => {
    setShowResultDialog(false);
  };

  const gameResult = isGameOver() ? getGameResult() : null;
  const moveHistory = useMemo(() => game.history(), [game]);
  const capturedPieces = useMemo(() => {
    const captures: Record<'w' | 'b', string[]> = { w: [], b: [] };
    for (const move of game.history({ verbose: true })) {
      if (move.captured) captures[move.color].push(move.captured);
    }
    const pieceOrder: Record<string, number> = { p: 1, n: 2, b: 3, r: 4, q: 5 };
    captures.w.sort((a, b) => pieceOrder[a] - pieceOrder[b]);
    captures.b.sort((a, b) => pieceOrder[a] - pieceOrder[b]);
    return captures;
  }, [game]);

  const getModelLabel = (modelId: string) => {
    const openrouter = providers.find(p => p.id === 'openrouter');
    const m = openrouter?.models.find(m => m.id === modelId);
    return m?.name || modelId;
  };

  const calculateMaterialScore = (pieces: string[]): number => {
    const pieceValues: Record<string, number> = {
      p: 1,
      n: 3,
      b: 3,
      r: 5,
      q: 9,
    };
    
    return pieces.reduce((sum, piece) => sum + (pieceValues[piece] || 0), 0);
  };

  const getMaterialAdvantage = (color: 'w' | 'b'): number => {
    const whiteCaptured = capturedPieces.w;
    const blackCaptured = capturedPieces.b;
    
    const whiteScore = calculateMaterialScore(whiteCaptured);
    const blackScore = calculateMaterialScore(blackCaptured);
    
    return color === 'w' ? whiteScore - blackScore : blackScore - whiteScore;
  };

  const renderCapturedPieces = (pieces: string[], color: 'w' | 'b') => {
    if (pieces.length === 0) return null;
    
    const pieceSymbols: Record<string, string> = {
      p: color === 'w' ? '♙' : '♟',
      n: color === 'w' ? '♘' : '♞',
      b: color === 'w' ? '♗' : '♝',
      r: color === 'w' ? '♖' : '♜',
      q: color === 'w' ? '♕' : '♛',
    };
    
    const advantage = getMaterialAdvantage(color);
    
    return (
      <span className="captured-pieces">
        {pieces.map((piece, i) => (
          <span key={i} className="captured-piece">{pieceSymbols[piece]}</span>
        ))}
        {advantage > 0 && (
          <span className="material-score">+{advantage}</span>
        )}
      </span>
    );
  };

  return (
    <div className="app">
      {/* ---- TOP: Black player bar ---- */}
      <div className="top-bar">
        <div className="player-bar">
          {!showSettings && (
            <>
              <span className="pb-icon black-icon">♔</span>
              <span className="pb-name">{getModelLabel(aiSettings.blackModel)}</span>
              {renderCapturedPieces(capturedPieces.b, 'b')}
              <span className="pb-side">Black</span>
              {gameActive && game.turn() === 'b' && (
                <span className={`pb-dot ${isThinking ? 'dot-think' : 'dot-active'}`} />
              )}
            </>
          )}
        </div>
      </div>

      {/* ---- Board ---- */}
      <div className="board-col">
        <div className="board-frame">
          <Chessboard
            options={{
              position: game.fen(),
              boardOrientation: orientation,
              pieces: customPieces,
              showAnimations: true,
              animationDurationInMs: 300,
              allowDragging: false,
              showNotation: true,
              arrows: [
                ...(lastMove ? [{
                  startSquare: lastMove.from,
                  endSquare: lastMove.to,
                  color: '#eab308'
                }] : []),
                ...(invalidMove ? [{
                  startSquare: invalidMove.from,
                  endSquare: invalidMove.to,
                  color: '#dc2626'
                }] : [])
              ],
              boardStyle: {
                borderRadius: '4px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
              },
              lightSquareStyle: {
                backgroundColor: '#ebecd0',
              },
              darkSquareStyle: {
                backgroundColor: '#779556',
              },
            }}
          />
        </div>
      </div>

      {/* ---- Side panel ---- */}
      <div className="side-col">
        {showSettings ? (
          <div className="side-inner">
            <AISettings
              settings={aiSettings}
              onSettingsChange={setAISettings}
              providers={providers}
            />
            <button
              onClick={handleStartAIGame}
              disabled={!aiSettings.whiteModel || !aiSettings.blackModel || isLoading}
              className="btn-start"
            >
              {isLoading ? 'Starting...' : 'Start Game'}
            </button>
            {error && <div className="err-box">{error}</div>}
            {providers.length === 0 && (
              <div className="warn-box">
                <strong>No providers found</strong>
                <p>Start the server with API keys in <code>.env</code></p>
              </div>
            )}
          </div>
        ) : (
          <div className="side-inner">
            {/* Move list */}
            <div className="move-list-wrap">
              <div className="ml-head">Moves</div>
              <div className="ml-body">
                {moveHistory.length === 0 ? (
                  <div className="ml-empty">Waiting for first move...</div>
                ) : (
                  moveHistory.reduce<React.ReactElement[]>((rows, move, i) => {
                    if (i % 2 === 0) {
                      rows.push(
                        <div key={i} className="ml-row">
                          <span className="ml-num">{Math.floor(i / 2) + 1}.</span>
                          <span className="ml-w">{move}</span>
                          <span className="ml-b">{moveHistory[i + 1] || ''}</span>
                        </div>
                      );
                    }
                    return rows;
                  }, [])
                )}
              </div>
            </div>

            {/* AI Reasoning - Always visible */}
            {lastReasoning && (
              <div className="reasoning-box">
                <div className="reasoning-label">Last Move Reasoning:</div>
                <div className="reasoning-text">{lastReasoning}</div>
              </div>
            )}

            {/* Status */}
            {isThinking && (
              <div className="status-bar thinking">
                <div className="spinner" />
                {game.turn() === 'w' ? 'White' : 'Black'} is thinking...
              </div>
            )}
            {error && !gameResult && (
              <div className="err-box">{error}</div>
            )}
            {!gameActive && !gameResult && (
              <div className="status-bar">Game paused. Resume to continue this position.</div>
            )}

            {/* Controls */}
            <div className="ctrl-wrap">
              <GameControls
                onNewGame={handleNewGame}
                onFlip={handleFlip}
                onPauseResume={gameActive ? pauseGame : resumeGame}
                isPaused={!gameActive}
                gameOver={gameResult !== null}
              />
            </div>
          </div>
        )}
      </div>

      {/* Game Result Dialog */}
      {gameResult && showResultDialog && (
        <GameResultDialog
          result={gameResult.result}
          reason={gameResult.reason}
          onClose={handleCloseDialog}
        />
      )}

      {/* ---- BOTTOM: White player bar ---- */}
      <div className="bot-bar">
        <div className="player-bar">
          {!showSettings && (
            <>
              <span className="pb-icon white-icon">♚</span>
              <span className="pb-name">{getModelLabel(aiSettings.whiteModel)}</span>
              {renderCapturedPieces(capturedPieces.w, 'w')}
              <span className="pb-side">White</span>
              {gameActive && game.turn() === 'w' && (
                <span className={`pb-dot ${isThinking ? 'dot-think' : 'dot-active'}`} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
