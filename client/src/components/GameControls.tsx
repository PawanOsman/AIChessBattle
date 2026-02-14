import React from 'react';

interface GameControlsProps {
  onNewGame: () => void;
  onFlip: () => void;
}

export const GameControls: React.FC<GameControlsProps> = ({
  onNewGame,
  onFlip,
}) => {
  return (
    <div className="game-controls">
      <button
        onClick={onNewGame}
        className="control-btn control-btn-primary"
        title="Start a new game"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
        </svg>
        <span>New Game</span>
      </button>
      
      <button
        onClick={onFlip}
        className="control-btn control-btn-secondary"
        title="Flip the board orientation"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M18 8.13C18 6.53 17.47 6 15.87 6H13.44C12.41 6 12.01 5.6 12.01 4.57V4.44C12.01 3.41 12.41 3.01 13.44 3.01H15.67C19.67 3.01 21 4.34 21 8.34V17.17H18V8.13ZM10.57 21H8.34C4.34 21 3.01 19.67 3.01 15.67V6.84H6.01V15.87C6.01 17.47 6.54 18 8.14 18H10.57C11.6 18 12 18.4 12 19.43V19.56C12 20.59 11.6 20.99 10.57 20.99V21ZM0.429999 5.83L3.63 1.76C4.3 0.929997 4.76 0.929997 5.43 1.76L8.63 5.86C9.2 6.56 8.96 6.99 8.06 6.99H0.989999C0.0599991 6.99 -0.140001 6.56 0.419999 5.82L0.429999 5.83ZM23.57 18.17L20.37 22.24C19.7 23.07 19.24 23.07 18.57 22.24L15.37 18.14C14.8 17.44 15.04 17.01 15.94 17.01H23.01C23.94 17.01 24.14 17.44 23.58 18.18L23.57 18.17Z"/>
        </svg>
        <span>Flip Board</span>
      </button>
    </div>
  );
};
