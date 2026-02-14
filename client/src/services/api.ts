const API_BASE_URL = '/api';

// Retry utility function
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      console.log(`⚠️ API Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
      
      if (attempt < maxRetries) {
        const delay = delayMs * attempt; // Exponential backoff
        console.log(`⏳ Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error('All retry attempts failed');
}

export interface GameState {
  gameId: string;
  fen: string;
  turn: 'w' | 'b';
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isDraw: boolean;
  moveHistory: string[];
  pgn: string;
}

export interface MoveResult {
  success: boolean;
  move: {
    from: string;
    to: string;
    piece: string;
    captured?: string;
    promotion?: string;
    san: string;
  };
  fen: string;
  turn: 'w' | 'b';
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isDraw: boolean;
  gameOver: boolean;
}

export interface ProviderInfo {
  id: string;
  name: string;
  models: { id: string; name: string }[];
}

export interface PieceMoves {
  piece: string;
  square: string;
  moves: string[];
}

export interface AIMoveRequest {
  provider: string;
  model?: string;
  fen: string;
  moveHistory: string[];
  playerColor: 'w' | 'b';
  legalMoves?: string[];
  piecesMoves?: PieceMoves[];
}

export interface AIMoveResponse {
  success: boolean;
  provider: string;
  model?: string;
  move: string;
  reasoning?: string;
  confidence?: number;
}

export interface AIAnalysis {
  success: boolean;
  analysis: Array<{
    provider: string;
    move: string;
    reasoning?: string;
    confidence?: number;
  }>;
  errors: Array<{
    provider: string;
    error: string;
  }>;
  totalRequested: number;
  successful: number;
}

class ApiService {
  async startGame(gameId: string): Promise<GameState> {
    const response = await fetch(`${API_BASE_URL}/game/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId }),
    });
    if (!response.ok) throw new Error(`Failed to start game: ${response.statusText}`);
    return response.json();
  }

  async getGameState(gameId: string): Promise<GameState> {
    const response = await fetch(`${API_BASE_URL}/game/state/${gameId}`);
    if (!response.ok) throw new Error(`Failed to get game state: ${response.statusText}`);
    return response.json();
  }

  async makeMove(gameId: string, from: string, to: string, promotion?: string): Promise<MoveResult> {
    const response = await fetch(`${API_BASE_URL}/game/move/${gameId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, promotion }),
    });
    if (!response.ok) throw new Error(`Failed to make move: ${response.statusText}`);
    return response.json();
  }

  async getLegalMoves(gameId: string, square?: string): Promise<any[]> {
    const url = square 
      ? `${API_BASE_URL}/game/moves/${gameId}/${square}`
      : `${API_BASE_URL}/game/moves/${gameId}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to get legal moves: ${response.statusText}`);
    const data = await response.json();
    return data.moves;
  }

  async getProviders(): Promise<ProviderInfo[]> {
    const response = await fetch(`${API_BASE_URL}/ai/providers`);
    if (!response.ok) throw new Error(`Failed to get providers: ${response.statusText}`);
    const data = await response.json();
    return data.providers;
  }

  async searchModels(query: string): Promise<{ id: string; name: string }[]> {
    const response = await fetch(`${API_BASE_URL}/ai/models/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error(`Failed to search models: ${response.statusText}`);
    const data = await response.json();
    return data.models;
  }

  async getAIMove(request: AIMoveRequest): Promise<AIMoveResponse> {
    return retryWithBackoff(async () => {
      const response = await fetch(`${API_BASE_URL}/ai/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error(`Failed to get AI move: ${response.statusText}`);
      return response.json();
    }, 3, 1000);
  }

  async analyzePosition(requests: AIMoveRequest[]): Promise<AIAnalysis> {
    const response = await fetch(`${API_BASE_URL}/ai/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providers: requests.map(r => r.provider),
        fen: requests[0]?.fen,
        moveHistory: requests[0]?.moveHistory,
        playerColor: requests[0]?.playerColor,
      }),
    });
    if (!response.ok) throw new Error(`Failed to analyze position: ${response.statusText}`);
    return response.json();
  }
}

export const apiService = new ApiService();
