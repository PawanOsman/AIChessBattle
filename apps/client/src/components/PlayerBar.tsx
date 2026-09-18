import { useEffect, useState } from 'react';
import type { ActiveAIRequest } from '../utils/gameTelemetry';
import { formatDuration } from '../utils/formatTime';

function RequestClock({ totalMs, active }: { totalMs: number; active: ActiveAIRequest | null }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, [active]);
  const elapsed = active ? Math.max(0, now - active.startedAt) : 0;
  return <div className={`player-clock ${active ? 'clock-running' : ''}`} title="Total AI request time, including retries and cancelled requests">
    <strong>{formatDuration(totalMs + elapsed)}</strong>
    <span>{active ? `Thinking · ${formatDuration(elapsed)}` : 'Total AI time'}</span>
  </div>;
}

interface PlayerBarProps {
  color: 'w' | 'b';
  model: string;
  totalMs: number;
  active: ActiveAIRequest | null;
  isTurn: boolean;
  captures: string[];
  advantage: number;
}

export function PlayerBar({ color, model, totalMs, active, isTurn, captures, advantage }: PlayerBarProps) {
  const pieces: Record<string, string> = color === 'w'
    ? { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' }
    : { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕' };
  return <div className={`player-bar ${isTurn ? 'player-to-move' : ''}`}>
    <span className={`player-avatar side-${color}`} aria-hidden="true">{color === 'w' ? '♔' : '♚'}</span>
    <div className="player-identity">
      <div className="player-meta"><span>{color === 'w' ? 'White' : 'Black'}</span>{isTurn && <span className="turn-label">To move</span>}</div>
      <span className="pb-name" title={model}>{model ? model.split('/').slice(1).join('/') || model : 'Choose a model'}</span>
      {(captures.length > 0 || advantage > 0) && <span className="captured-pieces" aria-label={`Captured pieces${advantage > 0 ? `, material advantage ${advantage}` : ''}`}>
        {captures.map((piece, index) => <span key={index} aria-hidden="true">{pieces[piece]}</span>)}
        {advantage > 0 && <span className="material-score">+{advantage}</span>}
      </span>}
    </div>
    <RequestClock totalMs={totalMs} active={active} />
  </div>;
}
