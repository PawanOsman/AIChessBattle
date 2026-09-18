import { memo, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from './components/ChessBoard/index';
import { customPieces } from './components/ChessBoard/customPieces';
import { GameControls } from './components/GameControls';
import { AISettings } from './components/AISettings';
import { GameResultDialog } from './components/GameResultDialog';
import { GameStats } from './components/GameStats';
import { PlayerBar } from './components/PlayerBar';
import { Icon } from './components/Icon';
import { useChessGame, type AISettings as AISettingsType } from './hooks/useChessGame';
import { apiService, type ProviderInfo } from './services/api';
import { formatDuration } from './utils/formatTime';
import { buildGamePgn, downloadText } from './utils/gameExport';
import './App.css';

const START_FEN = new Chess().fen();
const Board = memo(function Board({ fen, orientation, move }: {
  fen: string; orientation: 'white' | 'black'; move?: { from: string; to: string } | null;
}) {
  return <Chessboard options={{
    position: fen, boardOrientation: orientation, pieces: customPieces,
    showAnimations: true, animationDurationInMs: 250, allowDragging: false, showNotation: true,
    arrows: move ? [{ startSquare: move.from, endSquare: move.to, color: 'rgba(234,179,8,0.8)' }] : [],
    boardStyle: { borderRadius: '4px', boxShadow: '0 4px 24px rgba(0,0,0,.3)' },
    lightSquareStyle: { backgroundColor: '#ebecd0' }, darkSquareStyle: { backgroundColor: '#779556' },
  }} />;
});

function App() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerReload, setProviderReload] = useState(0);
  const [aiSettings, setAISettings] = useState<AISettingsType>({ whiteModel: '', blackModel: '' });
  const [showSettings, setShowSettings] = useState(true);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [showResultDialog, setShowResultDialog] = useState(true);
  const [tab, setTab] = useState<'moves' | 'stats'>('moves');
  const [reviewPly, setReviewPly] = useState<number | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [matchDate, setMatchDate] = useState(() => new Date());
  const moveListRef = useRef<HTMLDivElement>(null);

  const {
    game, isLoading, isThinking, gameActive, error, lastMove,
    startAIVsAIGame, pauseGame, resumeGame, resetGame, isGameOver, getGameResult,
    moveRecords, requestRecords, activeRequest, stepAIMove,
    moveDelayMs, setMoveDelayMs, soundEnabled, setSoundEnabled,
  } = useChessGame();

  useEffect(() => {
    let cancelled = false;
    void apiService.getProviders().then(data => {
      if (cancelled) return;
      setProviders(data);
      setProviderError(null);
      const models = data.find(provider => provider.id === 'openrouter')?.models || [];
      setAISettings(current => ({
        whiteModel: current.whiteModel || models[0]?.id || '',
        blackModel: current.blackModel || models[1]?.id || models[0]?.id || '',
      }));
    }).catch(() => {
      if (!cancelled) setProviderError('Could not load models. Check your connection to the server and try again.');
    }).finally(() => { if (!cancelled) setProvidersLoading(false); });
    return () => { cancelled = true; };
  }, [providerReload]);

  const gameResult = isGameOver() ? getGameResult() : null;
  const history = useMemo(() => game.history({ verbose: true }), [game]);
  const currentPly = reviewPly ?? history.length;
  const reviewing = reviewPly !== null;
  const reviewedMove = currentPly > 0 ? history[currentPly - 1] : undefined;
  const shownRecord = moveRecords.find(record => record.ply === currentPly);
  const boardFen = reviewing ? reviewedMove?.after || START_FEN : game.fen();
  const boardMove = reviewing ? reviewedMove : lastMove;
  const displayedPosition = useMemo(() => new Chess(boardFen), [boardFen]);
  const captures = useMemo(() => {
    const result: Record<'w' | 'b', string[]> = { w: [], b: [] };
    const values: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
    for (const move of history.slice(0, currentPly)) if (move.captured) result[move.color].push(move.captured);
    for (const color of ['w', 'b'] as const) result[color].sort((a, b) => values[a] - values[b]);
    let advantage = 0;
    for (const rank of displayedPosition.board()) for (const piece of rank) {
      if (piece) advantage += (values[piece.type] || 0) * (piece.color === 'w' ? 1 : -1);
    }
    return { pieces: result, advantage };
  }, [history, currentPly, displayedPosition]);
  const totalTimes = useMemo(() => requestRecords.reduce((totals, request) => {
    totals[request.color] += request.durationMs;
    return totals;
  }, { w: 0, b: 0 }), [requestRecords]);
  const timingByPly = useMemo(() => new Map(moveRecords.map(record => [record.ply, record])), [moveRecords]);

  useEffect(() => {
    if (!reviewing && tab === 'moves' && moveListRef.current) {
      moveListRef.current.scrollTop = moveListRef.current.scrollHeight;
    }
  }, [history.length, reviewing, tab]);

  const handleFlip = useCallback(() => setOrientation(current => current === 'white' ? 'black' : 'white'), []);
  const handlePauseResume = useCallback(() => {
    if (gameActive || isThinking) pauseGame();
    else { setReviewPly(null); resumeGame(); }
  }, [gameActive, isThinking, pauseGame, resumeGame]);
  const reviewMove = useCallback((ply: number) => {
    pauseGame();
    setReviewPly(Math.max(0, Math.min(history.length, ply)));
  }, [pauseGame, history.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || target.closest('input, textarea, select, button, [contenteditable="true"], [role="combobox"]')) return;
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); handleFlip(); }
      if (showSettings || (showResultDialog && gameResult)) return;
      if (event.code === 'Space' && !gameResult) { event.preventDefault(); handlePauseResume(); }
      if (history.length && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault(); reviewMove(currentPly + (event.key === 'ArrowLeft' ? -1 : 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentPly, gameResult, handleFlip, handlePauseResume, history.length, reviewMove, showResultDialog, showSettings]);

  const handleNewGame = () => {
    resetGame(); setReviewPly(null); setShowSettings(true); setShowResultDialog(true); setCopyStatus('');
  };
  const handleStart = async () => {
    if (await startAIVsAIGame(aiSettings)) {
      setMatchDate(new Date()); setReviewPly(null); setShowSettings(false); setShowResultDialog(true); setTab('moves'); setCopyStatus('');
    }
  };
  const exportPgn = () => downloadText('ai-chess-battle.pgn', buildGamePgn(game, moveRecords, aiSettings, gameResult?.result, matchDate), 'application/x-chess-pgn');
  const exportStats = () => {
    const elapsedMs = activeRequest ? Math.max(0, performance.now() - activeRequest.startedAt) : 0;
    const totals = { ...totalTimes };
    if (activeRequest) totals[activeRequest.color] += elapsedMs;
    downloadText('ai-chess-battle-stats.json', JSON.stringify({
      date: matchDate.toISOString(), exportedAt: new Date().toISOString(), models: aiSettings, result: gameResult,
      timing: 'Browser request duration in milliseconds; includes network and provider retries; excludes pauses and between-move delay. Totals include any active request at export time.',
      totalRequestMs: totals, moves: moveRecords, requests: requestRecords,
      activeRequest: activeRequest ? { color: activeRequest.color, model: activeRequest.model, elapsedMs, status: 'in_progress' } : null,
    }, null, 2), 'application/json');
  };
  const copyFen = async () => {
    try { await navigator.clipboard.writeText(boardFen); setCopyStatus('Position copied'); }
    catch { setCopyStatus('Could not copy. Try exporting the PGN.'); }
  };

  const renderPlayer = (color: 'w' | 'b') => <PlayerBar color={color}
    model={color === 'w' ? aiSettings.whiteModel : aiSettings.blackModel}
    totalMs={totalTimes[color]} active={activeRequest?.color === color ? activeRequest : null}
    isTurn={!showSettings && (reviewing || !gameResult) && !displayedPosition.isGameOver() && displayedPosition.turn() === color}
    captures={captures.pieces[color]} advantage={captures.advantage * (color === 'w' ? 1 : -1)} />;
  const status = showSettings ? 'Ready to play' : gameResult ? gameResult.reason : isThinking ? `${game.turn() === 'w' ? 'White' : 'Black'} is thinking` : gameActive ? `${game.turn() === 'w' ? 'White' : 'Black'} to move` : 'Match paused';

  return <div className="app">
    <header className="app-header">
      <div className="brand"><span aria-hidden="true">♞</span><strong>AI Chess<span> Battle</span></strong></div>
      <div className={`match-status ${isThinking ? 'status-thinking' : ''}`} role="status"><span className={`status-dot ${gameActive || isThinking ? 'status-live' : ''}`} />{status}</div>
      <span className="shortcut-hint"><kbd>Space</kbd> pause <kbd>F</kbd> flip</span>
    </header>
    <div className="top-bar">{renderPlayer(orientation === 'white' ? 'b' : 'w')}</div>
    <main className="board-col" aria-label="Chess board">
      <div className="board-frame"><Board fen={boardFen} orientation={orientation} move={boardMove} /></div>
      <div className="board-toolbar">
        <span>{reviewing ? currentPly === 0 ? 'Starting position' : `Reviewing ${Math.ceil(currentPly / 2)}${currentPly % 2 ? '.' : '…'} ${reviewedMove?.san}` : showSettings ? 'Your next match starts here' : game.inCheck() ? 'Check' : 'Live position'}</span>
        <div className="board-tools">
          {reviewing && <button className="text-button live-link" onClick={() => setReviewPly(null)}>Return to live</button>}
          <button className="icon-button" onClick={handleFlip} title="Flip board (F)" aria-label="Flip board"><Icon name="flip" /></button>
          <button className="icon-button" onClick={copyFen} title="Copy this position as FEN" aria-label="Copy position as FEN"><Icon name="copy" /></button>
        </div>
      </div>
      {copyStatus && <span className="copy-feedback" role="status">{copyStatus}</span>}
    </main>
    <div className="bot-bar">{renderPlayer(orientation === 'white' ? 'w' : 'b')}</div>
    <aside className="side-col" aria-label={showSettings ? 'Match setup' : 'Match information'}>
      {showSettings ? <div className="setup-panel">
        <div className="panel-heading"><span className="eyebrow">The arena</span><h1>Set up a match</h1><p>Pick your players. Watch their next move.</p></div>
        {providersLoading ? <div className="loading-models" role="status"><span className="spinner" />Loading available models…</div> : <AISettings settings={aiSettings} onSettingsChange={setAISettings} providers={providers} />}
        {providerError && <div className="err-box" role="alert">{providerError}<button className="text-button" onClick={() => { setProvidersLoading(true); setProviderReload(value => value + 1); }}>Try again</button></div>}
        {!providersLoading && !providerError && !providers.some(provider => provider.id === 'openrouter') && <div className="warn-box">No AI provider is connected. Add your OpenRouter key in the server configuration, then restart the server and reload this page.</div>}
        <div className="setup-footer">
          <button onClick={() => setSoundEnabled(!soundEnabled)} className="text-button" aria-pressed={soundEnabled}><Icon name={soundEnabled ? 'volume' : 'mute'} />Sound {soundEnabled ? 'on' : 'off'}</button>
          <button onClick={handleFlip} className="text-button"><Icon name="flip" />Flip board</button>
        </div>
        <button onClick={() => void handleStart()} disabled={providersLoading || !!providerError || !providers.length || !aiSettings.whiteModel || !aiSettings.blackModel || isLoading} className="btn-start"><Icon name="play" />Start match</button>
        {error && <div className="err-box" role="alert">{error}</div>}
        <div className="setup-note"><strong>Every move, in view.</strong><p>Compare thinking time, review decisions, and export the finished game.</p></div>
      </div> : <>
        <div className="match-panel-heading"><div><span className="eyebrow">Match centre</span><h2>{gameResult ? 'Match complete' : `Move ${Math.floor(history.length / 2) + 1}`}</h2></div><span className="match-count">{history.length} moves played</span></div>
        {gameResult && <div className="result-inline"><strong>{gameResult.result}</strong><span>{gameResult.reason}</span></div>}
        <div className="panel-tabs" role="tablist" aria-label="Match details">
          <button id="moves-tab" role="tab" aria-selected={tab === 'moves'} aria-controls="moves-panel" onClick={() => setTab('moves')}>Moves <span>{history.length}</span></button>
          <button id="stats-tab" role="tab" aria-selected={tab === 'stats'} aria-controls="stats-panel" onClick={() => setTab('stats')}>Statistics</button>
        </div>
        <div className="panel-content">
          {tab === 'stats' ? <div id="stats-panel" role="tabpanel" aria-labelledby="stats-tab"><GameStats moveRecords={moveRecords} requestRecords={requestRecords} activeRequest={activeRequest} whiteModel={aiSettings.whiteModel} blackModel={aiSettings.blackModel} /></div> :
          <div id="moves-panel" className="moves-panel" role="tabpanel" aria-labelledby="moves-tab">
            <div className="move-list-wrap">
              <div className="ml-head"><span>#</span><span><i className="side-marker marker-white" />White</span><span><i className="side-marker marker-black" />Black</span></div>
              <div className="ml-body" ref={moveListRef}>
                {!history.length ? <div className="ml-empty"><span aria-hidden="true">♟</span><strong>Waiting for the opening move</strong><p>Move times and decisions will appear here.</p></div> : Array.from({ length: Math.ceil(history.length / 2) }, (_, row) => <div className="ml-row" key={row}>
                  <span className="ml-num">{row + 1}.</span>
                  {[row * 2, row * 2 + 1].map(index => {
                    const move = history[index]; const record = timingByPly.get(index + 1);
                    return move ? <button key={index} className={`move-cell ${currentPly === index + 1 ? 'move-selected' : ''}`} aria-label={`Review ${move.color === 'w' ? 'White' : 'Black'} move ${row + 1}: ${move.san}${record ? `, ${formatDuration(record.durationMs)}` : ''}`} aria-pressed={reviewPly === index + 1} onClick={() => reviewMove(index + 1)}><strong>{move.san}</strong><span>{record ? formatDuration(record.durationMs) : '—'}</span></button> : <span key={index} className="move-cell move-pending">{isThinking ? 'Thinking…' : '—'}</span>;
                  })}
                </div>)}
              </div>
            </div>
            <div className="history-controls" aria-label="Review moves">
              <button className="icon-button" aria-label="Starting position" disabled={!history.length || currentPly === 0} onClick={() => reviewMove(0)}><Icon name="first" /></button>
              <button className="icon-button" aria-label="Previous move" disabled={!history.length || currentPly === 0} onClick={() => reviewMove(currentPly - 1)}><Icon name="chevronLeft" /></button>
              <span>{reviewing ? `${currentPly} / ${history.length}` : 'Live board'}</span>
              <button className="icon-button" aria-label="Next move" disabled={currentPly >= history.length} onClick={() => reviewMove(currentPly + 1)}><Icon name="chevronRight" /></button>
              <button className="icon-button" aria-label="Return to live position" disabled={!reviewing} onClick={() => setReviewPly(null)}><Icon name="last" /></button>
            </div>
            {shownRecord && <div className="reasoning-box"><div className="reasoning-label"><span>{reviewing ? 'Move insight' : 'Latest decision'} · {shownRecord.san}</span><span>{formatDuration(shownRecord.durationMs)}</span></div><p className="reasoning-text">{shownRecord.reasoning || 'No explanation was returned for this move.'}</p>{shownRecord.actualModel && shownRecord.actualModel !== shownRecord.model && <small className="actual-model">Played by {shownRecord.actualModel}</small>}</div>}
          </div>}
        </div>
        <div className="controls-panel">
          {error && !gameResult && <div className="err-box" role="alert">{error}</div>}
          {!gameActive && !isThinking && !gameResult && <div className="paused-hint">Paused{reviewing ? ' for review' : ''}. Resume or play one move.</div>}
          <GameControls onNewGame={handleNewGame} onFlip={handleFlip} onPauseResume={handlePauseResume}
            onStep={() => { setReviewPly(null); void stepAIMove(); }} onRematch={() => void handleStart()}
            onExport={exportPgn} onExportStats={exportStats} onSoundChange={setSoundEnabled} onDelayChange={setMoveDelayMs}
            isPaused={!gameActive && !isThinking} isThinking={isThinking} gameOver={!!gameResult} hasMoves={history.length > 0} hasStats={requestRecords.length > 0 || !!activeRequest}
            soundEnabled={soundEnabled} moveDelayMs={moveDelayMs} />
        </div>
      </>}
    </aside>
    {gameResult && showResultDialog && <GameResultDialog result={gameResult.result} reason={gameResult.reason}
      summary={`${history.length} moves played · Total AI request time\nWhite ${formatDuration(totalTimes.w)} · Black ${formatDuration(totalTimes.b)}`}
      onClose={() => setShowResultDialog(false)} onRematch={() => void handleStart()} />}
  </div>;
}

export default App;
