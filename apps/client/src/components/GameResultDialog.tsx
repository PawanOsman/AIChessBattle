import { useEffect, useId, useRef } from 'react';
import './GameResultDialog.css';

interface GameResultDialogProps {
  result: string;
  reason: string;
  onClose: () => void;
  onRematch?: () => void;
  summary?: string;
}

export function GameResultDialog({ result, reason, onClose, onRematch, summary }: GameResultDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reviewRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const reasonId = useId();
  const summaryId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Native modal dialogs make the background inert and keep keyboard focus inside.
    dialog.showModal();
    reviewRef.current?.focus();
    return () => {
      dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const winner = result === '1-0' ? 'White wins' : result === '0-1' ? 'Black wins' : 'Draw';

  return (
    <dialog
      ref={dialogRef}
      className="game-result-dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={summary ? `${reasonId} ${summaryId}` : reasonId}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
    >
      <button type="button" className="result-dialog-close" aria-label="Close match result" onClick={onClose}>
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
      </button>
      <div className="result-dialog-main">
        <p className="result-dialog-eyebrow">Match complete</p>
        <div className="result-dialog-score">{result}</div>
        <h2 id={titleId}>{winner}</h2>
        <p id={reasonId} className="result-dialog-reason">{reason}</p>
        {summary && <p id={summaryId} className="result-dialog-summary">{summary}</p>}
      </div>
      <div className="result-dialog-actions">
        <button type="button" ref={reviewRef} className="result-dialog-button result-dialog-primary" onClick={onClose}>Review match</button>
        {onRematch && <button type="button" className="result-dialog-button" onClick={onRematch}>Rematch</button>}
      </div>
    </dialog>
  );
}
