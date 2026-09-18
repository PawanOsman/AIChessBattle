const API_BASE_URL = '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryable: boolean;

  constructor(message: string, status: number, code?: string, retryable = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

  async getLegalMoves(gameId: string, square?: string): Promise<MoveResult['move'][]> {
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

  async getAIMove(request: AIMoveRequest, signal?: AbortSignal): Promise<AIMoveResponse> {
    // The server owns provider retries. Retrying this POST here multiplies both
    // paid requests and latency, and can replay a turn after resetting the game.
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 180_000);

    try {
      const response = await fetch(`${API_BASE_URL}/ai/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new ApiError('The server returned an unreadable AI response.', response.status, 'INVALID_RESPONSE');
      }
      if (!response.ok || (isRecord(data) && data.success === false)) {
        const message = isRecord(data) && typeof data.details === 'string' ? data.details
          : isRecord(data) && typeof data.error === 'string' ? data.error
          : `Failed to get AI move (${response.status}).`;
        throw new ApiError(message, response.status,
          isRecord(data) && typeof data.code === 'string' ? data.code : undefined,
          isRecord(data) && data.retryable === true);
      }
      if (!isRecord(data) || data.success !== true || typeof data.move !== 'string'
        || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(data.move)) {
        throw new ApiError('The server did not return a valid chess move.', response.status, 'INVALID_RESPONSE');
      }
      return {
        success: true,
        provider: typeof data.provider === 'string' ? data.provider : request.provider,
        model: typeof data.model === 'string' ? data.model : request.model,
        move: data.move,
        reasoning: typeof data.reasoning === 'string' ? data.reasoning : undefined,
        confidence: typeof data.confidence === 'number' && Number.isFinite(data.confidence)
          && data.confidence >= 0 && data.confidence <= 1 ? data.confidence : undefined,
      };
    } catch (err) {
      if (signal?.aborted) throw new DOMException('AI move request cancelled.', 'AbortError');
      if (timedOut) throw new ApiError('The AI request timed out. Resume to try this turn again.', 504, 'TIMEOUT', true);
      throw err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
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
