import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';

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
      console.log(`⚠️ Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
      
      if (attempt < maxRetries) {
        const delay = delayMs * attempt; // Exponential backoff
        console.log(`⏳ Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error('All retry attempts failed');
}

// Save AI request and response payload to JSON file for debugging
function saveRequestResponseToFile(
  provider: string, 
  request: AIMoveRequest, 
  prompt: string, 
  response?: AIMoveResponse
): string {
  try {
    const logsDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${provider}_${timestamp}.json`;
    const filepath = path.join(logsDir, filename);
    
    const payload: any = {
      timestamp: new Date().toISOString(),
      provider,
      request: {
        fen: request.fen,
        moveHistory: request.moveHistory,
        playerColor: request.playerColor,
        model: request.model
      },
      prompt
    };
    
    if (response) {
      payload.response = response;
    }
    
    fs.writeFileSync(filepath, JSON.stringify(payload, null, 2));
    // console.log(`📝 Saved ${response ? 'request+response' : 'request'} to: ${filename}`);
    return filepath;
  } catch (error) {
    console.error('Failed to save to file:', error);
    return '';
  }
}

// Convert FEN to human-readable board representation
function fenToReadableBoard(fen: string): string {
  const pieceNames: Record<string, string> = {
    'K': 'White King', 'Q': 'White Queen', 'R': 'White Rook', 
    'B': 'White Bishop', 'N': 'White Knight', 'P': 'White Pawn',
    'k': 'Black King', 'q': 'Black Queen', 'r': 'Black Rook',
    'b': 'Black Bishop', 'n': 'Black Knight', 'p': 'Black Pawn'
  };
  
  const boardPart = fen.split(' ')[0];
  const ranks = boardPart.split('/');
  const pieces: string[] = [];
  
  for (let rankIdx = 0; rankIdx < ranks.length; rankIdx++) {
    const rank = ranks[rankIdx];
    const rankNumber = 8 - rankIdx;
    let fileIdx = 0;
    
    for (const char of rank) {
      if (char >= '1' && char <= '8') {
        fileIdx += parseInt(char);
      } else {
        const file = String.fromCharCode(97 + fileIdx); // 'a' + fileIdx
        const square = file + rankNumber;
        pieces.push(`${square}: ${pieceNames[char]}`);
        fileIdx++;
      }
    }
  }
  
  return pieces.join(', ');
}

export interface PieceMoves {
  piece: string;
  square: string;
  moves: string[];
}

export interface AIMoveRequest {
  fen: string;
  moveHistory: string[];
  playerColor: 'w' | 'b';
  model?: string;
  legalMoves?: string[];
  piecesMoves?: PieceMoves[];
}

export interface AIMoveResponse {
  move: string;
  confidence?: number;
  reasoning?: string;
}

export interface AIProvider {
  name: string;
  models: { id: string; name: string }[];
  loadModels(): Promise<void>;
  getMove(request: AIMoveRequest): Promise<AIMoveResponse>;
}

export class OpenRouterProvider implements AIProvider {
  name = 'openrouter';
  models: { id: string; name: string }[] = [];
  private allModels: { id: string; name: string }[] = [];
  private openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    });
  }

  async loadModels(): Promise<void> {
    try {
      const response = await this.openai.models.list();
      const models: { id: string; name: string }[] = [];
      
      for (const model of response.data) {
        if (model.id.includes('gemini') || model.id.includes('gpt') || model.id.includes('claude') || model.id.includes('deepseek')) {
          // Use full model ID as the display name for clarity
          models.push({ 
            id: model.id, 
            name: model.id
          });
        }
      }
      
      this.allModels = models;
      this.models = models.slice(0, 50); // Limit to first 50 models
      console.log(`  OpenRouter: loaded ${this.models.length} models (filtered from ${models.length} total)`);
    } catch (err) {
      console.error('  OpenRouter: failed to load models, using fallback', err);
      this.models = [
        { id: 'google/gemini-2.0-flash-001', name: 'google/gemini-2.0-flash-001' },
        { id: 'openai/gpt-4o', name: 'openai/gpt-4o' },
        { id: 'anthropic/claude-sonnet-4', name: 'anthropic/claude-sonnet-4' },
      ];
      this.allModels = this.models;
    }
  }

  async searchModels(query: string): Promise<{ id: string; name: string }[]> {
    if (!query) return this.models;
    
    const lowerQuery = query.toLowerCase();
    return this.allModels.filter(model => 
      model.id.toLowerCase().includes(lowerQuery) || 
      model.name.toLowerCase().includes(lowerQuery)
    ).slice(0, 50);
  }

  async getMove(request: AIMoveRequest): Promise<AIMoveResponse> {
    return await retryWithBackoff(async () => {
      const prompt = this.buildPrompt(request);
      const model = request.model || this.models[0]?.id || 'google/gemini-2.0-flash-001';

      const completion = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: 'You are a chess grandmaster. Always respond with valid JSON containing from/to squares.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_completion_tokens: 200,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'chess_move',
            schema: {
              type: 'object',
              required: ['from', 'to', 'reasoning'],
              properties: {
                from: { type: 'string', description: 'Starting square (e.g., e2)' },
                to: { type: 'string', description: 'Destination square (e.g., e4)' },
                reasoning: { type: 'string', description: 'Brief explanation' },
              },
              additionalProperties: true,
            },
          },
        },
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) throw new Error('No response from OpenRouter');

      try {
        const parsed = JSON.parse(content);
        
        // Validate from/to squares are in correct format (2 characters each)
        const from = String(parsed.from || '').toLowerCase().trim().substring(0, 2);
        const to = String(parsed.to || '').toLowerCase().trim().substring(0, 2);
        
        // Validate promotion is a single character (q/r/b/n) or empty
        let promotion = '';
        if (parsed.promotion) {
          const p = String(parsed.promotion).toLowerCase().trim();
          if (p.length > 0 && 'qrbn'.includes(p[0])) {
            promotion = p[0];
          }
        }
        
        // Validate square format (letter a-h, number 1-8)
        const isValidSquare = (sq: string) => {
          return sq.length === 2 && 
                 sq[0] >= 'a' && sq[0] <= 'h' && 
                 sq[1] >= '1' && sq[1] <= '8';
        };
        
        if (!isValidSquare(from) || !isValidSquare(to)) {
          throw new Error(`Invalid square format: from=${from}, to=${to}`);
        }
        
        // Convert from/to format to UCI notation
        const move = from + to + promotion;
        const result = { move, reasoning: parsed.reasoning };
        
        // Save request and response to file (disabled for production)
        // saveRequestResponseToFile('openrouter', request, prompt, result);
        
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to parse OpenRouter response: ${errorMessage}`);
      }
    });
  }

  private buildPrompt(request: AIMoveRequest): string {
    const colorName = request.playerColor === 'w' ? 'White' : 'Black';
    const moveHistoryStr = request.moveHistory.length > 0 
      ? request.moveHistory.join(', ') 
      : 'Game start';
    
    let movesSection = '';
    if (request.piecesMoves && request.piecesMoves.length > 0) {
      movesSection = '*** LEGAL MOVES BY PIECE ***\n';
      for (const pm of request.piecesMoves) {
        movesSection += `${pm.piece} on ${pm.square}: ${pm.moves.join(', ')}\n`;
      }
    } else if (request.legalMoves && request.legalMoves.length > 0) {
      movesSection = `*** LEGAL MOVES AVAILABLE ***\nYou MUST choose one of these moves (in UCI format):\n${request.legalMoves.join(', ')}\n`;
    } else {
      movesSection = '*** LEGAL MOVES AVAILABLE ***\nNot provided\n';
    }
    
    const prompt = `You are playing chess as ${colorName}. Analyze the position and choose the BEST legal move.

CRITICAL RULES:
1. You MUST respond with separate "from" and "to" squares
2. The move MUST be one of the legal moves listed below
3. Square format: files a-h, ranks 1-8 (e.g., e2, d4, h8)
4. Examples:
   - Pawn move: from="e2", to="e4"
   - Knight move: from="g1", to="f3"
   - Pawn promotion: from="e7", to="e8", promotion="q"

CURRENT POSITION (after all moves have been played):
FEN: ${request.fen}
Board (human-readable): ${fenToReadableBoard(request.fen)}
Move History (already played): ${moveHistoryStr}

${movesSection}
*** IT IS YOUR TURN ***
YOU ARE PLAYING AS: ${colorName}
YOU MUST MOVE A ${colorName} PIECE
${colorName.toUpperCase()} TO MOVE

IMPORTANT:
- You MUST select one move from the legal moves list above
- DO NOT make up moves that are not in the legal moves list
- The board position shows the CURRENT state AFTER all moves in the history
- DO NOT repeat any move from the move history
- You can ONLY move ${colorName} pieces

INSTRUCTIONS:
1. Review the legal moves for each piece carefully
2. Evaluate each legal move for tactical opportunities (checks, captures, threats)
3. Choose the strongest move from the available options
4. Extract the "from" and "to" squares from your chosen move
5. Respond with valid JSON

Example: If you choose move "e2e4", respond with from="e2", to="e4"

Provide your response as JSON with "from" (starting square), "to" (destination square), optional "promotion" (q/r/b/n if the move includes it), and "reasoning" (brief explanation).`;
    
    return prompt;
  }
}

export class AIService {
  private providers: Map<string, AIProvider> = new Map();
  private initialized = false;

  constructor() {
    if (process.env.OPENROUTER_API_KEY) {
      this.providers.set('openrouter', new OpenRouterProvider(process.env.OPENROUTER_API_KEY));
    }

    console.log(`✅ Loaded AI providers: ${this.getAvailableProviders().join(', ') || 'none'}`);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.log('⏳ Loading models from provider APIs...');
    
    const loadPromises = Array.from(this.providers.values()).map(provider => 
      provider.loadModels().catch(err => {
        console.error(`Failed to load models for ${provider.name}:`, err);
      })
    );
    
    await Promise.all(loadPromises);
    this.initialized = true;
    console.log('✅ Model loading complete');
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  getModels(provider: string): { id: string; name: string }[] {
    const p = this.providers.get(provider);
    return p ? p.models : [];
  }

  async searchModels(provider: string, query: string): Promise<{ id: string; name: string }[]> {
    const p = this.providers.get(provider);
    if (!p) return [];
    
    if ('searchModels' in p) {
      return (p as any).searchModels(query);
    }
    
    return p.models.filter(model => 
      model.id.toLowerCase().includes(query.toLowerCase()) || 
      model.name.toLowerCase().includes(query.toLowerCase())
    );
  }

  async getMove(provider: string, request: AIMoveRequest): Promise<AIMoveResponse> {
    const p = this.providers.get(provider);
    if (!p) {
      throw new Error(`Provider ${provider} not available`);
    }
    
    return await p.getMove(request);
  }
}
