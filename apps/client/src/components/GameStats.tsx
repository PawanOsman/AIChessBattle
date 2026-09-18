import { useEffect, useMemo, useState } from 'react';
import type { ActiveAIRequest, AIRequestRecord, MoveRecord } from '../utils/gameTelemetry';
import { activeRequestDuration, aggregateGameStats } from '../utils/gameStats';
import { formatDuration } from '../utils/formatTime';
import './GameStats.css';

interface GameStatsProps {
  moveRecords: MoveRecord[];
  requestRecords: AIRequestRecord[];
  activeRequest: ActiveAIRequest | null;
  whiteModel: string;
  blackModel: string;
}

const durationOrDash = (duration: number | null) => duration === null ? '—' : formatDuration(duration);

export function GameStats({ moveRecords, requestRecords, activeRequest, whiteModel, blackModel }: GameStatsProps) {
  const stats = useMemo(() => aggregateGameStats(moveRecords, requestRecords), [moveRecords, requestRecords]);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (!activeRequest) return;
    const timer = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(timer);
  }, [activeRequest]);

  const activeMs = activeRequestDuration(activeRequest, now);
  const totals = {
    w: stats.w.totalRequestTimeMs + (activeRequest?.color === 'w' ? activeMs : 0),
    b: stats.b.totalRequestTimeMs + (activeRequest?.color === 'b' ? activeMs : 0),
  };
  const combinedTotal = totals.w + totals.b;
  const whiteShare = combinedTotal > 0 ? totals.w / combinedTotal * 100 : 50;

  return (
    <section className="game-stats" aria-labelledby="game-stats-title">
      <div className="game-stats-heading">
        <h3 id="game-stats-title">Model performance</h3>
        <span>{moveRecords.length} {moveRecords.length === 1 ? 'ply' : 'plies'}</span>
      </div>
      <div className="game-stats-seats">
        {(['w', 'b'] as const).map(color => {
          const seat = stats[color];
          const side = color === 'w' ? 'White' : 'Black';
          const model = color === 'w' ? whiteModel : blackModel;
          const isActive = activeRequest?.color === color;
          return (
            <div className={`game-stats-seat${isActive ? ' game-stats-seat-active' : ''}`} key={color}>
              <div className="game-stats-side">
                <span className={`game-stats-marker game-stats-marker-${color}`} aria-hidden="true" />
                <span>{side}</span>
                {isActive && <span className="game-stats-live">Live</span>}
              </div>
              <p className="game-stats-model" title={model}>{model || 'No model selected'}</p>
              <dl>
                <div className="game-stats-total"><dt>Total request time</dt><dd>{formatDuration(totals[color])}</dd></div>
                <div><dt>Moves played</dt><dd>{seat.completedMoves}</dd></div>
                <div><dt>Average / move</dt><dd>{durationOrDash(seat.averageMoveMs)}</dd></div>
                <div><dt>Last move</dt><dd>{durationOrDash(seat.lastMoveMs)}</dd></div>
              </dl>
              <div className={`game-stats-current${isActive ? ' is-active' : ''}`}>
                {isActive ? <>Current request <strong>{formatDuration(activeMs)}</strong></> : 'No request in progress'}
              </div>
            </div>
          );
        })}
      </div>
      <div
        className={`game-stats-comparison${combinedTotal === 0 ? ' is-empty' : ''}`}
        role="img"
        aria-label={`Request time: White ${formatDuration(totals.w)}, Black ${formatDuration(totals.b)}`}
      >
        <span className="game-stats-bar-white" style={{ width: `${whiteShare}%` }} />
        <span className="game-stats-bar-black" style={{ width: `${100 - whiteShare}%` }} />
      </div>
      <details className="game-stats-details">
        <summary>Timing details</summary>
        <table>
          <caption className="game-stats-sr-only">Request and move timing by side</caption>
          <thead><tr><th scope="col">Metric</th><th scope="col">White</th><th scope="col">Black</th></tr></thead>
          <tbody>
            <tr><th scope="row">Fastest move</th><td>{durationOrDash(stats.w.fastestMoveMs)}</td><td>{durationOrDash(stats.b.fastestMoveMs)}</td></tr>
            <tr><th scope="row">Slowest move</th><td>{durationOrDash(stats.w.slowestMoveMs)}</td><td>{durationOrDash(stats.b.slowestMoveMs)}</td></tr>
            <tr><th scope="row">Failed requests</th><td>{stats.w.failedRequests}</td><td>{stats.b.failedRequests}</td></tr>
            <tr><th scope="row">Cancelled requests</th><td>{stats.w.cancelledRequests}</td><td>{stats.b.cancelledRequests}</td></tr>
          </tbody>
        </table>
        <p>Average, fastest and slowest use completed moves. Totals also include failed, cancelled and current requests.</p>
      </details>
      <p className="game-stats-note">Measured in your browser, including retries and network time. Pauses and move delay are excluded.</p>
    </section>
  );
}
