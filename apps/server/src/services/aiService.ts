import OpenAI from 'openai';
import { Chess, Move } from 'chess.js';
import { setTimeout as delay } from 'node:timers/promises';

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
  // Kept for API compatibility. Only chess.js on the server determines legality.
  legalMoves?: string[];
  piecesMoves?: PieceMoves[];
}

export interface AIMoveResponse {
  move: string;
  model?: string;
  confidence?: number;
  reasoning?: string;
}

export class AIServiceError extends Error {
  retryAfterMs?: number;

  constructor(
    message: string,
    public readonly status = 502,
    public readonly code = 'AI_PROVIDER_ERROR',
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'AIServiceError';
  }
}

type ModelInfo = { id: string; name: string };
type OutputMode = 'schema' | 'json' | 'text';
interface ModelMetadata {
  id: string;
  name?: string;
  supported_parameters?: string[];
  architecture?: { output_modalities?: string[] };
  top_provider?: { max_completion_tokens?: number | null };
  reasoning?: { supported_efforts?: string[] | null; supports_max_tokens?: boolean };
}

export interface AIProvider {
  name: string;
  models: ModelInfo[];
  loadModels(): Promise<void>;
  searchModels?(query: string): Promise<ModelInfo[]>;
  getMove(request: AIMoveRequest, signal?: AbortSignal): Promise<AIMoveResponse>;
}

export interface OpenRouterOptions {
  client?: OpenAI;
  maxAttempts?: number;
  requestTimeoutMs?: number;
  moveTimeoutMs?: number;
  maxTokens?: number;
  maxRetryTokens?: number;
  retryBaseMs?: number;
  defaultModel?: string;
}

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

const uci = (move: Move): string => move.from + move.to + (move.promotion || '');

function preparePosition(request: AIMoveRequest): { game: Chess; moves: Move[] } {
  if (typeof request.fen !== 'string' || request.fen.length > 200 ||
      !['w', 'b'].includes(request.playerColor) || !Array.isArray(request.moveHistory) ||
      request.moveHistory.length > 2000 || request.moveHistory.some(move => typeof move !== 'string' || move.length > 20) ||
      (request.model !== undefined && (typeof request.model !== 'string' || !request.model.trim() || request.model.length > 200))) {
    throw new AIServiceError('Invalid chess move request.', 400, 'INVALID_REQUEST');
  }
  let game: Chess;
  try {
    game = new Chess(request.fen);
  } catch {
    throw new AIServiceError('Invalid FEN position.', 400, 'INVALID_POSITION');
  }
  if (game.turn() !== request.playerColor) {
    throw new AIServiceError('Player color does not match the side to move.', 400, 'WRONG_TURN');
  }
  // Restore repetition information only when the supplied history reproduces this FEN.
  // Custom positions and stale histories still use the authoritative FEN alone.
  if (request.moveHistory.length) {
    try {
      const replay = new Chess();
      for (const move of request.moveHistory) replay.move(move);
      if (replay.fen() === game.fen()) game = replay;
    } catch { /* An unverified history must not influence the position or prompt. */ }
  }
  if (game.isGameOver()) {
    throw new AIServiceError('The game is already over; there is no move to request.', 409, 'GAME_OVER');
  }
  return { game, moves: game.moves({ verbose: true }) };
}

function buildPrompt(game: Chess, moves: Move[]): string {
  const color = game.turn() === 'w' ? 'White' : 'Black';
  const recentHistory = game.history().slice(-16).join(' ');
  return `Choose the strongest legal move for ${color} in this current position.
FEN: ${game.fen()}
Board (uppercase White, lowercase Black):
${game.ascii()}
${game.inCheck() ? 'Your king is in check. You must escape check.\n' : ''}${recentHistory ? `Recent moves already played (SAN): ${recentHistory}\n` : ''}
Legal moves, UCI followed by SAN (x = capture, + = check, # = mate):
${moves.map(move => `${uci(move)} (${move.san})`).join(', ')}

Check for immediate mates, then the opponent's forcing replies, captures and threats.
Avoid hanging pieces and unsafe king moves; favor sound development and king safety.
Consider repetition and draws in the context of the position. Previously played moves may be legal again.
Select exactly one listed UCI move, including its promotion suffix when present.
Return only JSON: {"move":"<listed UCI move>","reasoning":"<one short sentence explaining the choice>"}.
Put move first and keep the explanation under 30 words.`;
}

function providerFailure(status: number, retryAfterMs?: number): AIServiceError {
  const messages: Record<number, string> = {
    400: 'OpenRouter rejected the request or model parameters.',
    401: 'OpenRouter authentication failed. Check the server API key.',
    402: 'OpenRouter credits are exhausted. Check the account balance.',
    403: 'OpenRouter denied access to this model or request.',
    404: 'The selected OpenRouter model or a compatible endpoint is unavailable.',
    408: 'OpenRouter timed out.',
    422: 'OpenRouter could not process the model parameters.',
    429: 'OpenRouter rate limit reached. Wait before resuming the game.',
  };
  const retryable = [408, 409, 425, 429].includes(status) || status >= 500;
  const code = status === 429 ? 'AI_RATE_LIMITED' : status === 401 ? 'AI_AUTH_ERROR'
    : status === 402 ? 'AI_CREDITS_EXHAUSTED' : 'AI_PROVIDER_ERROR';
  const error = new AIServiceError(messages[status] || 'OpenRouter is temporarily unavailable.',
    status === 429 ? 429 : status === 408 ? 504 : 502, code, retryable);
  error.retryAfterMs = retryAfterMs;
  return error;
}

function retryAfter(headers: Headers | undefined): number | undefined {
  const value = headers?.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
}

function normalizeError(error: unknown): AIServiceError {
  if (error instanceof AIServiceError) return error;
  if (error instanceof OpenAI.APIError && error.status) {
    const waitMs = retryAfter(error.headers);
    const metadata = record(record(error.error)?.metadata);
    // A 402 with this explicit marker is temporary reserved spending capacity,
    // not an empty account. Ordinary 402 responses must still fail immediately.
    if (error.status === 402 && metadata?.limit_source === 'openrouter_in_flight_budget' && waitMs !== undefined) {
      const capacityError = new AIServiceError('OpenRouter spending capacity is busy. Wait before resuming.', 429, 'AI_CAPACITY_LIMIT', true);
      capacityError.retryAfterMs = waitMs;
      return capacityError;
    }
    return providerFailure(error.status, waitMs);
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new AIServiceError('OpenRouter request timed out.', 504, 'AI_TIMEOUT', true);
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new AIServiceError('Could not connect to OpenRouter.', 502, 'AI_CONNECTION_ERROR', true);
  }
  return new AIServiceError('Unexpected error while requesting an AI move.', 500, 'AI_INTERNAL_ERROR');
}

function formatUnsupported(error: unknown): boolean {
  // Downgrade only for explicit format incompatibility, never for auth, outages or bad JSON.
  if (!(error instanceof OpenAI.APIError) || ![400, 404, 422].includes(error.status || 0)) return false;
  return /response.?format|json.?schema|structured.?outputs?|json mode/i.test(error.message) &&
    /not support|unsupported|not available|no endpoints|cannot|not compatible/i.test(error.message);
}

function parseCompletion(completion: unknown, legalMoves: Set<string>): AIMoveResponse {
  const root = record(completion);
  const envelopeError = record(root?.error);
  if (envelopeError) throw providerFailure(Number(envelopeError.code) || 502);
  const choices = root?.choices;
  const choice = Array.isArray(choices) ? record(choices[0]) : undefined;
  const choiceError = record(choice?.error);
  if (choiceError) throw providerFailure(Number(choiceError.code) || 502);
  const message = record(choice?.message);
  if (message?.refusal || choice?.finish_reason === 'content_filter') {
    throw new AIServiceError('The selected model declined to provide a chess move.', 502, 'AI_REFUSAL');
  }
  if (choice?.finish_reason === 'length') {
    throw new AIServiceError('The model exhausted its output budget before completing a move.', 502, 'AI_OUTPUT_TRUNCATED', true);
  }
  if (choice?.finish_reason === 'error') throw providerFailure(502);
  const content = message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new AIServiceError('OpenRouter returned no move content.', 502, 'AI_EMPTY_RESPONSE', true);
  }
  let parsed: Record<string, unknown> | undefined;
  try {
    // Accept a complete Markdown JSON fence for models without native structured output.
    // Never repair partial JSON or extract a move from free text/reasoning.
    const text = content.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1');
    parsed = record(JSON.parse(text));
  } catch {
    throw new AIServiceError('The model returned incomplete or malformed JSON.', 502, 'AI_INVALID_JSON', true);
  }
  if (!parsed || typeof parsed.move !== 'string' || typeof parsed.reasoning !== 'string' ||
      Object.keys(parsed).some(key => key !== 'move' && key !== 'reasoning')) {
    throw new AIServiceError('The model must return a JSON object with move and reasoning strings.', 502, 'AI_INVALID_RESPONSE', true);
  }
  const move = parsed.move.trim().toLowerCase();
  if (!legalMoves.has(move)) {
    throw new AIServiceError('The model selected a move outside the legal move list.', 502, 'AI_ILLEGAL_MOVE', true);
  }
  return { move, reasoning: parsed.reasoning.trim().slice(0, 500) };
}

export class OpenRouterProvider implements AIProvider {
  name = 'openrouter';
  models: ModelInfo[] = [];
  private allModels: ModelInfo[] = [];
  private metadata = new Map<string, ModelMetadata>();
  private outputModes = new Map<string, OutputMode>();
  private openai: OpenAI;
  private config: Required<Omit<OpenRouterOptions, 'client' | 'defaultModel'>> & { defaultModel?: string };

  constructor(apiKey: string, options: OpenRouterOptions = {}) {
    this.config = {
      maxAttempts: options.maxAttempts ?? envNumber('AI_MAX_ATTEMPTS', 3, 1, 5),
      requestTimeoutMs: options.requestTimeoutMs ?? envNumber('AI_REQUEST_TIMEOUT_MS', 45000, 1000, 120000),
      moveTimeoutMs: options.moveTimeoutMs ?? envNumber('AI_MOVE_TIMEOUT_MS', 120000, 1000, 150000),
      maxTokens: options.maxTokens ?? envNumber('AI_MAX_TOKENS', 4096, 512, 16384),
      maxRetryTokens: options.maxRetryTokens ?? envNumber('AI_MAX_RETRY_TOKENS', 8192, 512, 32768),
      retryBaseMs: options.retryBaseMs ?? 750,
      defaultModel: options.defaultModel ?? process.env.OPENROUTER_DEFAULT_MODEL,
    };
    this.openai = options.client ?? new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      // Exactly one retry layer: the bounded loop below, including validation failures.
      maxRetries: 0,
      timeout: this.config.requestTimeoutMs,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/PawanOsman/AIChessBattle',
        'X-Title': 'AI Chess Battle',
      },
    });
  }

  async loadModels(): Promise<void> {
    try {
      const response = await this.openai.models.list({ timeout: 15000, maxRetries: 0 });
      if (!Array.isArray(response.data) || !response.data.length) throw new Error('Empty model catalog');
      const models = response.data as unknown as ModelMetadata[];
      this.metadata.clear();
      this.outputModes.clear();
      this.allModels = models.filter(model => typeof model.id === 'string' &&
        (!model.architecture?.output_modalities || model.architecture.output_modalities.includes('text')))
        .map(model => {
          this.metadata.set(model.id, model);
          return { id: model.id, name: typeof model.name === 'string' && model.name.trim() ? model.name : model.id };
        });
      // Prefer structured-output models in the initial menu; search includes all text models.
      this.allModels.sort((a, b) => Number(this.modeFor(b.id) === 'schema') - Number(this.modeFor(a.id) === 'schema') || a.id.localeCompare(b.id));
      if (!this.allModels.length) throw new Error('No text models in catalog');
      this.models = this.allModels.slice(0, 50);
      console.log(`OpenRouter: loaded ${this.models.length} models (${this.allModels.length} searchable)`);
    } catch {
      console.warn('OpenRouter model catalog unavailable; configured model and automatic routing remain available.');
      const id = this.config.defaultModel || 'openrouter/auto';
      this.models = [{ id, name: id }];
      this.allModels = this.models;
    }
  }

  async searchModels(query: string): Promise<ModelInfo[]> {
    const lowerQuery = query.trim().toLowerCase();
    return lowerQuery ? this.allModels.filter(model => model.id.toLowerCase().includes(lowerQuery) || model.name.toLowerCase().includes(lowerQuery)).slice(0, 50) : this.models;
  }

  private modeFor(model: string): OutputMode {
    const cached = this.outputModes.get(model);
    if (cached) return cached;
    const parameters = this.metadata.get(model)?.supported_parameters;
    if (!parameters || parameters.includes('structured_outputs')) return 'schema';
    return parameters.includes('response_format') ? 'json' : 'text';
  }

  async getMove(request: AIMoveRequest, signal?: AbortSignal): Promise<AIMoveResponse> {
    const { game, moves } = preparePosition(request);
    const legalMoves = new Set(moves.map(uci));
    const model = request.model?.trim() || this.config.defaultModel || this.models[0]?.id || 'openrouter/auto';
    const metadata = this.metadata.get(model);
    let mode = this.modeFor(model);
    const modelLimit = metadata?.top_provider?.max_completion_tokens || Infinity;
    let tokens = Math.min(this.config.maxTokens, modelLimit);
    const tokenLimit = Math.min(Math.max(this.config.maxTokens, this.config.maxRetryTokens), modelLimit);
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: 'You are a careful chess player. The supplied FEN and legal move list are authoritative. Return only the requested JSON object, with a legal UCI move and a concise explanation.' },
      { role: 'user', content: buildPrompt(game, moves) },
    ];
    const deadline = Date.now() + this.config.moveTimeoutMs;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), this.config.moveTimeoutMs);
    const checkCancellation = () => {
      if (signal?.aborted) throw new AIServiceError('AI move request cancelled.', 499, 'AI_CANCELLED');
      if (controller.signal.aborted || Date.now() >= deadline) {
        throw new AIServiceError('AI move time limit reached. Resume to try again.', 504, 'AI_TIMEOUT', true);
      }
    };
    try {
      for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
        checkCancellation();
        const parameters = metadata?.supported_parameters;
        const supportsReasoning = parameters?.includes('reasoning') || parameters?.includes('reasoning_effort');
        const efforts = metadata?.reasoning?.supported_efforts;
        const effort = Array.isArray(efforts)
          ? ['low', 'minimal', 'medium', 'high', 'xhigh', 'max'].find(value => efforts.includes(value))
          : efforts === null || !metadata?.reasoning ? 'low' : undefined;
        const reasoning = supportsReasoning ? {
          exclude: true,
          ...(effort ? { effort } : metadata?.reasoning?.supports_max_tokens && tokens > 1024
            ? { max_tokens: Math.max(1024, Math.floor(tokens / 4)) } : {}),
        } : undefined;
        const body: OpenAI.ChatCompletionCreateParamsNonStreaming & {
          provider?: { require_parameters: boolean };
          reasoning?: { effort?: string; max_tokens?: number; exclude: boolean };
        } = {
          model, messages, stream: false, max_tokens: tokens,
          ...(parameters?.includes('temperature') && !supportsReasoning ? { temperature: 0.2 } : {}),
          ...(reasoning ? { reasoning } : {}),
        };
        if (mode !== 'text') {
          body.provider = { require_parameters: true };
          body.response_format = mode === 'json' ? { type: 'json_object' } : {
            type: 'json_schema',
            json_schema: {
              name: 'chess_move', strict: true,
              schema: {
                type: 'object',
                properties: {
                  move: { type: 'string', enum: [...legalMoves], description: 'Exactly one legal UCI move, including promotion if present.' },
                  reasoning: { type: 'string', description: 'A short explanation, under 30 words.' },
                },
                required: ['move', 'reasoning'], additionalProperties: false,
              },
            },
          };
        }
        try {
          const completion = await this.openai.chat.completions.create(body, {
            signal: controller.signal,
            timeout: Math.min(this.config.requestTimeoutMs, deadline - Date.now()),
            maxRetries: 0,
          });
          checkCancellation();
          const result = parseCompletion(completion, legalMoves);
          this.outputModes.set(model, mode);
          return { ...result, model: typeof completion.model === 'string' && completion.model ? completion.model : model };
        } catch (caught) {
          checkCancellation();
          let error = normalizeError(caught);
          const incompatibleFormat = mode !== 'text' && formatUnsupported(caught);
          if (incompatibleFormat) {
            mode = mode === 'schema' ? 'json' : 'text';
            error = new AIServiceError('This model requires a different JSON output mode.', 502, 'AI_FORMAT_UNSUPPORTED', true);
          }
          if (!error.retryable || attempt === this.config.maxAttempts) throw error;
          if (error.code === 'AI_OUTPUT_TRUNCATED') {
            if (tokens >= tokenLimit) throw error;
            tokens = Math.min(tokens * 2, tokenLimit);
          }
          if (['AI_INVALID_JSON', 'AI_INVALID_RESPONSE', 'AI_ILLEGAL_MOVE', 'AI_OUTPUT_TRUNCATED', 'AI_EMPTY_RESPONSE'].includes(error.code)) {
            // Replace correction rather than growing the prompt with broken completions.
            messages.splice(2, messages.length, {
              role: 'user', content: `The previous attempt failed: ${error.message} Return a complete JSON object with move first, copied exactly from the legal UCI list, and a short reasoning string.`,
            });
          }
          const backoff = incompatibleFormat ? 0 : this.config.retryBaseMs * 2 ** (attempt - 1) * (1 + Math.random() * 0.25);
          const waitMs = Math.max(backoff, error.retryAfterMs || 0);
          if (waitMs >= deadline - Date.now()) throw error;
          console.warn(`OpenRouter attempt ${attempt}/${this.config.maxAttempts}: ${error.code}; retrying.`);
          if (waitMs > 0) {
            try { await delay(waitMs, undefined, { signal: controller.signal }); }
            catch { checkCancellation(); }
          }
        }
      }
      throw new AIServiceError('AI move attempts exhausted.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

export class AIService {
  private providers = new Map<string, AIProvider>();
  private initialization?: Promise<void>;

  constructor() {
    if (process.env.OPENROUTER_API_KEY) {
      this.providers.set('openrouter', new OpenRouterProvider(process.env.OPENROUTER_API_KEY));
    }
    console.log(`Loaded AI providers: ${this.getAvailableProviders().join(', ') || 'none'}`);
  }

  initialize(): Promise<void> {
    this.initialization ??= Promise.all([...this.providers.values()].map(provider => provider.loadModels())).then(() => undefined);
    return this.initialization;
  }

  getAvailableProviders(): string[] { return [...this.providers.keys()]; }

  getModels(provider: string): ModelInfo[] { return this.providers.get(provider)?.models || []; }

  async searchModels(provider: string, query: string): Promise<ModelInfo[]> {
    const selected = this.providers.get(provider);
    if (!selected) return [];
    return selected.searchModels ? selected.searchModels(query)
      : selected.models.filter(model => model.name.toLowerCase().includes(query.toLowerCase()));
  }

  async getMove(provider: string, request: AIMoveRequest, signal?: AbortSignal): Promise<AIMoveResponse> {
    const selected = this.providers.get(provider);
    if (!selected) throw new AIServiceError(`Provider ${provider} is not configured.`, 400, 'PROVIDER_UNAVAILABLE');
    return selected.getMove(request, signal);
  }
}
