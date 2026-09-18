import { Icon } from './Icon';

interface GameControlsProps {
  onNewGame: () => void;
  onFlip: () => void;
  onPauseResume: () => void;
  onStep: () => void;
  onRematch: () => void;
  onExport: () => void;
  onExportStats: () => void;
  onSoundChange: (enabled: boolean) => void;
  onDelayChange: (delay: number) => void;
  isPaused: boolean;
  isThinking: boolean;
  gameOver: boolean;
  hasMoves: boolean;
  hasStats: boolean;
  soundEnabled: boolean;
  moveDelayMs: number;
}

export function GameControls(props: GameControlsProps) {
  return (
    <section className="game-controls" aria-label="Game controls">
      <div className="controls-play">
        <button onClick={props.onPauseResume} disabled={props.gameOver} className="control-btn control-btn-primary" title="Pause or resume (Space)">
          <Icon name={props.isPaused ? 'play' : 'pause'} />{props.isPaused ? 'Resume' : 'Pause'}
        </button>
        <button onClick={props.onStep} disabled={!props.isPaused || props.isThinking || props.gameOver} className="control-btn" title="Request one move while paused">
          <Icon name="step" />One move
        </button>
      </div>
      <div className="playback-preferences">
        <label htmlFor="move-delay">Between moves</label>
        <select id="move-delay" value={props.moveDelayMs} onChange={event => props.onDelayChange(Number(event.target.value))}>
          <option value={0}>No delay</option><option value={500}>0.5 seconds</option>
          <option value={1500}>1.5 seconds</option><option value={3000}>3 seconds</option>
        </select>
        <button className="icon-button" onClick={() => props.onSoundChange(!props.soundEnabled)} aria-label={props.soundEnabled ? 'Mute sounds' : 'Enable sounds'} aria-pressed={props.soundEnabled} title={props.soundEnabled ? 'Mute sounds' : 'Enable sounds'}>
          <Icon name={props.soundEnabled ? 'volume' : 'mute'} />
        </button>
      </div>
      <div className="controls-tools">
        <button onClick={props.onFlip} className="control-btn" title="Flip board (F)"><Icon name="flip" />Flip</button>
        <button onClick={props.onExport} disabled={!props.hasMoves} className="control-btn" title="Download PGN with move times"><Icon name="download" />PGN</button>
        <button onClick={props.onExportStats} disabled={!props.hasStats} className="control-btn" title="Download game statistics as JSON"><Icon name="download" />Stats</button>
      </div>
      <div className="controls-secondary">
        <button onClick={props.onNewGame} className="text-button"><Icon name="plus" />New match</button>
        <button onClick={props.onRematch} className="text-button"><Icon name="repeat" />Rematch</button>
      </div>
    </section>
  );
}
