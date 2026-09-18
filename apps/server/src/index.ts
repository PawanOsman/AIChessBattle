import "dotenv/config";
import express from 'express';
import cors from 'cors';
import path from 'path';
import { gameRoutes } from './routes/game';
import { aiRoutes, aiService } from './routes/ai';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/game', gameRoutes);
app.use('/api/ai', aiRoutes);

console.log('📋 Routes mounted: /api/game, /api/ai');

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve the frontend index.html for SPA routing
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Init models then start server
aiService.initialize().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 AI Chess Server running on port ${PORT}`);
    console.log(`📱 Frontend available at http://localhost:${PORT}`);
  });
});
