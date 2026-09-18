import React, { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { MoveHighlight } from './MoveHighlight';
import { PieceAnimation } from './PieceAnimation';
import './MoveHighlight.css';

interface ChessBoardProps {
  fen?: string;
  onMove?: (move: { from: string; to: string; promotion?: string }) => void;
  orientation?: 'white' | 'black';
  isInteractive?: boolean;
  lastMove?: { from: string; to: string };
  selectedSquare?: string;
  onSquareSelect?: (square: string | null) => void;
}

export const ChessBoard: React.FC<ChessBoardProps> = ({
  fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  onMove,
  orientation = 'white',
  isInteractive = true,
  lastMove,
  selectedSquare,
  onSquareSelect,
}) => {
  const boardRef = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState(() => new Chess(fen));
  const [legalMoves, setLegalMoves] = useState<string[]>([]);
  const [draggedPiece, setDraggedPiece] = useState<{ square: string; piece: string } | null>(null);
  const [animatingPiece, setAnimatingPiece] = useState<{ from: string; to: string; piece: { color: string; type: string } } | null>(null);
  const prevFenRef = useRef(fen);

  // Handle piece animation when FEN changes
  useEffect(() => {
    if (fen !== prevFenRef.current && lastMove) {
      // Get the piece that's moving from the OLD position
      const oldGame = new Chess(prevFenRef.current);
      const piece = oldGame.get(lastMove.from as any);
      
      if (piece) {
        // Start animation
        setAnimatingPiece({
          from: lastMove.from,
          to: lastMove.to,
          piece: { color: piece.color, type: piece.type },
        });
        
        // Delay updating the game state until animation completes
        setTimeout(() => {
          const newGame = new Chess(fen);
          setGame(newGame);
          setLegalMoves([]);
          prevFenRef.current = fen;
        }, 300);
      } else {
        // No animation needed, update immediately
        const newGame = new Chess(fen);
        setGame(newGame);
        setLegalMoves([]);
        prevFenRef.current = fen;
      }
    } else if (fen !== prevFenRef.current) {
      // FEN changed but no lastMove, update immediately
      const newGame = new Chess(fen);
      setGame(newGame);
      setLegalMoves([]);
      prevFenRef.current = fen;
    }
  }, [fen, lastMove]);

  const handleAnimationComplete = () => {
    setAnimatingPiece(null);
  };

  const isSquareAnimating = (square: string) => {
    if (!animatingPiece) return false;
    return square === animatingPiece.from || square === animatingPiece.to;
  };

  // Piece image URLs (local images)
  const pieceUrl = (color: string, type: string) => {
    return `/images/pieces/${color}${type}.png`;
  };

  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];

  const getSquareColor = (file: number, rank: number) => {
    return (file + rank) % 2 === 0 ? 'light' : 'dark';
  };

  const getSquareFromCoords = (x: number, y: number, boardRect: DOMRect) => {
    const squareSize = boardRect.width / 8;
    const file = Math.floor((x - boardRect.left) / squareSize);
    const rank = Math.floor((y - boardRect.top) / squareSize);
    
    if (file >= 0 && file < 8 && rank >= 0 && rank < 8) {
      const adjustedFile = orientation === 'white' ? file : 7 - file;
      const adjustedRank = orientation === 'white' ? 7 - rank : rank;
      return files[adjustedFile] + ranks[adjustedRank];
    }
    return null;
  };

  const handleSquareClick = (square: string) => {
    if (!isInteractive) return;

    const piece = game.get(square as any);
    
    if (selectedSquare === square) {
      // Deselect if clicking the same square
      onSquareSelect?.(null);
      setLegalMoves([]);
    } else if (selectedSquare && legalMoves.includes(square)) {
      // Make move if clicking a legal destination
      const move: { from: string; to: string; promotion?: string } = { from: selectedSquare, to: square };
      
      // Check for promotion
      const movingPiece = game.get(selectedSquare as any);
      if (movingPiece?.type === 'p') {
        const promoRank = movingPiece.color === 'w' ? '8' : '1';
        if (square[1] === promoRank) {
          // For now, auto-promote to queen
          move.promotion = 'q';
        }
      }
      
      onMove?.(move);
      onSquareSelect?.(null);
      setLegalMoves([]);
    } else if (piece && piece.color === game.turn()) {
      // Select piece if it's the current player's turn
      onSquareSelect?.(square);
      const moves = game.moves({ square: square as any, verbose: true });
      setLegalMoves(moves.map(m => m.to));
    } else {
      // Deselect if clicking empty square or opponent's piece
      onSquareSelect?.(null);
      setLegalMoves([]);
    }
  };

  const handleMouseDown = (e: React.MouseEvent, square: string) => {
    if (!isInteractive) return;
    
    const piece = game.get(square as any);
    if (piece && piece.color === game.turn()) {
      setDraggedPiece({ square, piece: piece.color + piece.type });
      
      // Select the piece and show legal moves
      onSquareSelect?.(square);
      const moves = game.moves({ square: square as any, verbose: true });
      setLegalMoves(moves.map(m => m.to));
      
      e.preventDefault();
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!draggedPiece || !isInteractive) return;
    
    const boardRect = boardRef.current?.getBoundingClientRect();
    if (!boardRect) return;
    
    const targetSquare = getSquareFromCoords(e.clientX, e.clientY, boardRect);
    
    if (targetSquare && targetSquare !== draggedPiece.square && legalMoves.includes(targetSquare)) {
      const move: { from: string; to: string; promotion?: string } = { 
        from: draggedPiece.square, 
        to: targetSquare 
      };
      
      // Check for promotion
      const movingPiece = game.get(draggedPiece.square as any);
      if (movingPiece?.type === 'p') {
        const promoRank = movingPiece.color === 'w' ? '8' : '1';
        if (targetSquare[1] === promoRank) {
          move.promotion = 'q';
        }
      }
      
      onMove?.(move);
    }
    
    setDraggedPiece(null);
    onSquareSelect?.(null);
    setLegalMoves([]);
  };

  const renderBoard = () => {
    const squares = [];
    const board = game.board();
    
    // Determine check highlight
    let kingSquare = null;
    if (game.inCheck()) {
      const turn = game.turn();
      for (let rank = 0; rank < 8; rank++) {
        for (let file = 0; file < 8; file++) {
          const piece = board[rank][file];
          if (piece && piece.type === 'k' && piece.color === turn) {
            kingSquare = files[file] + ranks[rank];
            break;
          }
        }
      }
    }

    // Render from top to bottom, left to right
    // For white orientation: rank 8 at top (rank 0), a-file at left (file 0)
    // For black orientation: rank 1 at top (rank 7), h-file at left (file 7)
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        // Map display position to actual chess position
        const boardRank = orientation === 'white' ? rank : 7 - rank;
        const boardFile = orientation === 'white' ? file : 7 - file;
        const square = files[boardFile] + ranks[boardRank];
        const piece = board[boardRank][boardFile];
        const color = getSquareColor(file, rank);
        
        const isLastMoveFrom = lastMove?.from === square;
        const isLastMoveTo = lastMove?.to === square;
        const isSelected = selectedSquare === square;
        const isLegalMove = legalMoves.includes(square);
        const isCheck = kingSquare === square;

        squares.push(
          <div
            key={square}
            className={`square ${color} 
              ${isLastMoveFrom || isLastMoveTo ? 'lastmove' : ''}
              ${isSelected ? 'selected' : ''}
              ${isCheck ? 'check' : ''}
            `}
            data-square={square}
            onClick={() => handleSquareClick(square)}
            onMouseDown={(e) => handleMouseDown(e, square)}
            onMouseUp={handleMouseUp}
            style={{
              position: 'absolute',
              left: `${file * 12.5}%`,
              top: `${rank * 12.5}%`,
              width: '12.5%',
              height: '12.5%',
              backgroundColor: color === 'light' ? '#ebecd0' : '#779556',
              cursor: isInteractive && piece ? 'pointer' : 'default',
            }}
          >
            {/* Coordinates */}
            {file === 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '2px',
                  left: '3px',
                  fontSize: '10px',
                  fontWeight: 'bold',
                  color: color === 'light' ? '#779556' : '#ebecd0',
                  pointerEvents: 'none',
                }}
              >
                {ranks[boardRank]}
              </span>
            )}
            {rank === 7 && (
              <span
                style={{
                  position: 'absolute',
                  bottom: '2px',
                  right: '3px',
                  fontSize: '10px',
                  fontWeight: 'bold',
                  color: color === 'light' ? '#779556' : '#ebecd0',
                  pointerEvents: 'none',
                }}
              >
                {files[boardFile]}
              </span>
            )}

            {/* Piece */}
            {piece && !isSquareAnimating(square) && (
              <img
                src={pieceUrl(piece.color, piece.type)}
                alt={`${piece.color}${piece.type}`}
                draggable={false}
                className="chess-piece"
                style={{
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                }}
              />
            )}

            {/* Legal move hint */}
            {isLegalMove && (
              <div
                style={{
                  position: 'absolute',
                  width: piece ? '100%' : '30%',
                  height: piece ? '100%' : '30%',
                  borderRadius: piece ? '50%' : '50%',
                  backgroundColor: piece ? 'transparent' : 'rgba(0, 0, 0, 0.12)',
                  border: piece ? '7px solid rgba(0, 0, 0, 0.12)' : 'none',
                  boxSizing: 'border-box',
                  pointerEvents: 'none',
                  left: piece ? '0' : '35%',
                  top: piece ? '0' : '35%',
                }}
              />
            )}

            {/* Check highlight */}
            {isCheck && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'radial-gradient(ellipse at center, rgba(255,0,0,0.85) 0%, rgba(200,0,0,0.45) 40%, transparent 68%)',
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        );
      }
    }

    return squares;
  };

  return (
    <div
      ref={boardRef}
      className="chess-board chess-board-container"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#262421',
        borderRadius: '4px',
        overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      }}
    >
      {renderBoard()}
      {animatingPiece && (
        <PieceAnimation
          from={animatingPiece.from}
          to={animatingPiece.to}
          piece={animatingPiece.piece}
          boardFlipped={orientation === 'black'}
          onComplete={handleAnimationComplete}
        />
      )}
      {lastMove && (
        <MoveHighlight
          from={lastMove.from}
          to={lastMove.to}
          boardFlipped={orientation === 'black'}
        />
      )}
    </div>
  );
};
