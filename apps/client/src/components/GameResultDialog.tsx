import React from 'react';
import './GameResultDialog.css';

interface GameResultDialogProps {
  result: string;
  reason: string;
  onClose: () => void;
}

export const GameResultDialog: React.FC<GameResultDialogProps> = ({
  result,
  reason,
  onClose,
}) => {
  const getWinner = () => {
    if (result === '1-0') return 'White Wins!';
    if (result === '0-1') return 'Black Wins!';
    return 'Draw!';
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>{getWinner()}</h2>
        </div>
        <div className="dialog-body">
          <div className="dialog-reason">{reason}</div>
        </div>
        <div className="dialog-footer">
          <button className="dialog-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
