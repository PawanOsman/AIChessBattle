import { Router } from 'express';
import { AIService, AIMoveRequest } from '../services/aiService';

const router = Router();
export const aiService = new AIService();

console.log('🔧 Registering AI routes...');

// Search models (OpenRouter only)
router.get('/models/search', (req, res) => {
  // console.log('🔍 Search endpoint hit! Path:', req.path, 'Query:', req.query);
  try {
    const { q } = req.query;
    const query = typeof q === 'string' ? q : '';
    
    const models = aiService.searchModels('openrouter', query);
    // console.log(`✅ Found ${models.length} models`);
    res.json({ models });
  } catch (error) {
    console.error('❌ Search error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to search models', details: errorMessage });
  }
});

// Get available AI providers with their models
router.get('/providers', (req, res) => {
  try {
    const availableProviders = aiService.getAvailableProviders();
    const providers = availableProviders.map(provider => ({
      id: provider,
      name: provider,
      models: aiService.getModels(provider)
    }));
    res.json({ providers });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to get providers', details: errorMessage });
  }
});

// Get AI move suggestion
router.post('/move', async (req, res) => {
  try {
    const { provider, model, fen, moveHistory, playerColor, legalMoves, piecesMoves } = req.body;

    if (!provider || !fen || !playerColor) {
      return res.status(400).json({ 
        error: 'Missing required fields: provider, fen, playerColor' 
      });
    }

    const request: AIMoveRequest = {
      fen,
      moveHistory: moveHistory || [],
      playerColor,
      model,
      legalMoves,
      piecesMoves,
    };

    const response = await aiService.getMove(provider, request);
    
    res.json({
      success: true,
      provider,
      model,
      move: response.move,
      reasoning: response.reasoning,
      confidence: response.confidence,
    });
  } catch (error) {
    console.error('AI move error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to get AI move', 
      details: errorMessage 
    });
  }
});

// Analyze position with multiple AI providers
router.post('/analyze', async (req, res) => {
  try {
    const { providers, fen, moveHistory, playerColor } = req.body;

    if (!providers || !Array.isArray(providers) || !fen || !playerColor) {
      return res.status(400).json({ 
        error: 'Missing required fields: providers (array), fen, playerColor' 
      });
    }

    const request: AIMoveRequest = {
      fen,
      moveHistory: moveHistory || [],
      playerColor,
    };

    const results = await Promise.allSettled(
      providers.map(async (provider: string) => {
        const response = await aiService.getMove(provider, request);
        return { provider, ...response };
      })
    );

    const analysis = results
      .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
      .map(result => result.value);

    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => ({
        provider: result.reason,
        error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
      }));

    res.json({
      success: true,
      analysis,
      errors,
      totalRequested: providers.length,
      successful: analysis.length,
    });
  } catch (error) {
    console.error('AI analysis error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to analyze position', 
      details: errorMessage 
    });
  }
});

export { router as aiRoutes };
