import type { PieceRenderObject } from './types';

// Custom pieces using local PNG images
export const customPieces: PieceRenderObject = {
  wP: () => <img src="/images/pieces/wp.png" alt="White Pawn" style={{ width: '100%', height: '100%' }} />,
  wN: () => <img src="/images/pieces/wn.png" alt="White Knight" style={{ width: '100%', height: '100%' }} />,
  wB: () => <img src="/images/pieces/wb.png" alt="White Bishop" style={{ width: '100%', height: '100%' }} />,
  wR: () => <img src="/images/pieces/wr.png" alt="White Rook" style={{ width: '100%', height: '100%' }} />,
  wQ: () => <img src="/images/pieces/wq.png" alt="White Queen" style={{ width: '100%', height: '100%' }} />,
  wK: () => <img src="/images/pieces/wk.png" alt="White King" style={{ width: '100%', height: '100%' }} />,
  bP: () => <img src="/images/pieces/bp.png" alt="Black Pawn" style={{ width: '100%', height: '100%' }} />,
  bN: () => <img src="/images/pieces/bn.png" alt="Black Knight" style={{ width: '100%', height: '100%' }} />,
  bB: () => <img src="/images/pieces/bb.png" alt="Black Bishop" style={{ width: '100%', height: '100%' }} />,
  bR: () => <img src="/images/pieces/br.png" alt="Black Rook" style={{ width: '100%', height: '100%' }} />,
  bQ: () => <img src="/images/pieces/bq.png" alt="Black Queen" style={{ width: '100%', height: '100%' }} />,
  bK: () => <img src="/images/pieces/bk.png" alt="Black King" style={{ width: '100%', height: '100%' }} />,
};
