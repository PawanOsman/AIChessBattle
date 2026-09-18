import { ErrorRequestHandler, Request, Response, Router } from 'express';
import { AIService, AIServiceError, AIMoveRequest } from '../services/aiService';

type AIRouteService = Pick<AIService,
  'searchModels' | 'getAvailableProviders' | 'getModels' | 'getMove'>;

class InvalidRequest extends Error {}

function readBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new InvalidRequest('Expected a JSON object.');
  }
  return body as Record<string, unknown>;
}

function readString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new InvalidRequest(`${field} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value.trim();
}

function readMoveRequest(body: Record<string, unknown>): AIMoveRequest {
  const fen = readString(body.fen, 'fen', 200);
  if (body.playerColor !== 'w' && body.playerColor !== 'b') {
    throw new InvalidRequest('playerColor must be "w" or "b".');
  }
  const moveHistory = body.moveHistory ?? [];
  if (!Array.isArray(moveHistory) || moveHistory.length > 2000 ||
      moveHistory.some(move => typeof move !== 'string' || !move.trim() || move.length > 20)) {
    throw new InvalidRequest('moveHistory must contain at most 2000 non-empty move strings (20 characters each).');
  }
  return {
    fen,
    moveHistory,
    playerColor: body.playerColor,
    ...(body.model !== undefined ? { model: readString(body.model, 'model', 200) } : {}),
  };
}

function describeError(error: unknown) {
  if (error instanceof InvalidRequest) {
    return { status: 400, code: 'INVALID_REQUEST', retryable: false, details: error.message };
  }
  if (error instanceof AIServiceError) {
    return { status: error.status, code: error.code, retryable: error.retryable, details: error.message };
  }
  console.error('Unexpected AI route error:', error);
  return { status: 500, code: 'INTERNAL_ERROR', retryable: false, details: 'An unexpected AI service error occurred.' };
}

function sendError(res: Response, error: unknown, message: string): void {
  if (res.destroyed || res.headersSent) return;
  const { status, ...failure } = describeError(error);
  res.status(status).json({ success: false, error: message, ...failure });
}

function requestCancellation(req: Request, res: Response) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const onClose = () => {
    if (!res.writableEnded) abort();
  };
  req.once('aborted', abort);
  res.once('close', onClose);
  if (req.aborted || res.destroyed) abort();
  return {
    signal: controller.signal,
    dispose: () => {
      req.off('aborted', abort);
      res.off('close', onClose);
    },
  };
}

// Mount after the API routes so invalid JSON also gets a machine-readable error.
export const aiJsonErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (!req.path.startsWith('/api/ai/')) return next(error);
  if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
    const oversized = error.type === 'entity.too.large';
    res.status(oversized ? 413 : 400).json({
      success: false,
      error: oversized ? 'Request body is too large.' : 'Request body must be valid JSON.',
      code: oversized ? 'REQUEST_TOO_LARGE' : 'INVALID_JSON',
      retryable: false,
    });
    return;
  }
  next(error);
};

export function createAIRouter(service: AIRouteService): Router {
  const router = Router();

  router.get('/models/search', async (req, res) => {
    try {
      const { q } = req.query;
      if (q !== undefined && (typeof q !== 'string' || q.length > 256)) {
        throw new InvalidRequest('q must be a string of at most 256 characters.');
      }
      const models = await service.searchModels('openrouter', typeof q === 'string' ? q.trim() : '');
      res.json({ models });
    } catch (error) {
      sendError(res, error, 'Failed to search models');
    }
  });

  router.get('/providers', (_req, res) => {
    try {
      const providers = service.getAvailableProviders().map(provider => ({
        id: provider,
        name: provider,
        models: service.getModels(provider),
      }));
      res.json({ providers });
    } catch (error) {
      sendError(res, error, 'Failed to get providers');
    }
  });

  router.post('/move', async (req, res) => {
    const cancellation = requestCancellation(req, res);
    try {
      const body = readBody(req.body);
      const provider = readString(body.provider, 'provider', 100);
      const request = readMoveRequest(body);
      const response = await service.getMove(provider, request, cancellation.signal);
      if (!cancellation.signal.aborted) {
        res.json({ success: true, provider, model: request.model, ...response });
      }
    } catch (error) {
      if (!cancellation.signal.aborted) sendError(res, error, 'Failed to get AI move');
    } finally {
      cancellation.dispose();
    }
  });

  router.post('/analyze', async (req, res) => {
    const cancellation = requestCancellation(req, res);
    try {
      const body = readBody(req.body);
      if (!Array.isArray(body.providers) || !body.providers.length || body.providers.length > 8) {
        throw new InvalidRequest('providers must be an array containing between 1 and 8 provider names.');
      }
      const providers = body.providers.map(provider => readString(provider, 'provider', 100));
      if (new Set(providers).size !== providers.length) {
        throw new InvalidRequest('providers must not contain duplicate names.');
      }
      const request = readMoveRequest(body);
      const results = await Promise.allSettled(
        providers.map(async provider => ({
          provider,
          ...await service.getMove(provider, request, cancellation.signal),
        })),
      );
      if (cancellation.signal.aborted) return;

      const analysis = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
      const errors = results.flatMap((result, index) => {
        if (result.status !== 'rejected') return [];
        const { details, ...failure } = describeError(result.reason);
        return [{ provider: providers[index], error: details, ...failure }];
      });
      const allFailed = analysis.length === 0;
      const status = allFailed
        ? (errors.every(error => error.status === errors[0].status) ? errors[0].status : 502)
        : 200;
      res.status(status).json({
        success: !allFailed,
        analysis,
        errors,
        totalRequested: providers.length,
        successful: analysis.length,
        ...(allFailed ? {
          error: 'All AI providers failed',
          code: 'ANALYSIS_FAILED',
          retryable: errors.some(error => error.retryable),
        } : {}),
      });
    } catch (error) {
      if (!cancellation.signal.aborted) sendError(res, error, 'Failed to analyze position');
    } finally {
      cancellation.dispose();
    }
  });

  return router;
}

export const aiService = new AIService();
export const aiRoutes = createAIRouter(aiService);
