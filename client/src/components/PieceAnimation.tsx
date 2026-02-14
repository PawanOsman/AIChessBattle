import React, { useEffect, useRef } from 'react';

interface PieceAnimationProps {
  from: string;
  to: string;
  piece: { color: string; type: string };
  boardFlipped?: boolean;
  onComplete: () => void;
}

export const PieceAnimation: React.FC<PieceAnimationProps> = ({
  from,
  to,
  piece,
  boardFlipped = false,
  onComplete,
}) => {
  const pieceRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!pieceRef.current) return;

    const SQ = 12.5; // Each square is 12.5% of board

    function getPos(square: string) {
      const file = square.charCodeAt(0) - 96;
      const rank = parseInt(square[1]);
      return {
        x: (boardFlipped ? 8 - file : file - 1) * SQ,
        y: (boardFlipped ? rank - 1 : 8 - rank) * SQ,
      };
    }

    const fromPos = getPos(from);
    const toPos = getPos(to);

    // Start at 'from' position
    pieceRef.current.style.left = `${fromPos.x}%`;
    pieceRef.current.style.top = `${fromPos.y}%`;
    pieceRef.current.style.transform = 'translate(0, 0)';

    // Force reflow to ensure starting position is applied
    pieceRef.current.offsetHeight;

    // Calculate translation
    const deltaX = toPos.x - fromPos.x;
    const deltaY = toPos.y - fromPos.y;

    // Animate to 'to' position
    requestAnimationFrame(() => {
      if (pieceRef.current) {
        pieceRef.current.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        pieceRef.current.style.transform = `translate(${deltaX}%, ${deltaY}%)`;
      }
    });

    // Call onComplete after animation
    const timer = setTimeout(onComplete, 300);

    return () => clearTimeout(timer);
  }, [from, to, boardFlipped, onComplete]);

  const pieceUrl = `/images/pieces/${piece.color}${piece.type}.png`;

  return (
    <img
      ref={pieceRef}
      src={pieceUrl}
      alt={`${piece.color}${piece.type}`}
      style={{
        position: 'absolute',
        width: '12.5%',
        height: '12.5%',
        pointerEvents: 'none',
        zIndex: 100,
        willChange: 'transform',
      }}
    />
  );
};
