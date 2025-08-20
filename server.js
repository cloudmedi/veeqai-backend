const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Professional services
const logger = require('./services/logger');
const RedisManager = require('./services/redis/RedisManager');
const EventBus = require('./services/events/EventBus');
const JobQueue = require('./services/queue/JobQueue');
const WebSocketManager = require('./services/websocket/WebSocketManager');
const MusicProcessor = require('./services/MusicProcessor');
const monitoring = require('./services/monitoring');

// Security middleware
const { securityHeaders } = require('./middleware/securityHeaders');

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Security headers (apply to all routes)
app.use(securityHeaders);

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5175',
    process.env.FRONTEND_URL
  ].filter(Boolean),
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Monitoring middleware - track all API calls
app.use(monitoring.middleware());

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/public', require('./routes/public')); // Public routes - NO AUTH
app.use('/api/music', require('./routes/music'));
app.use('/api/speech', require('./routes/speech'));
app.use('/api/voices', require('./routes/voices')); // Voice models and TTS
// app.use('/api/preferences', require('./routes/preferences')); // Disabled due to dependency conflicts
app.use('/api/admin', require('./routes/admin'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Metrics endpoint for Prometheus
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', 'text/plain');
    const metrics = await monitoring.getMetrics();
    res.send(metrics);
  } catch (error) {
    logger.error('Error generating metrics:', error);
    res.status(500).send('Error generating metrics');
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Server error:', err);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Initialize services
async function initializeServices() {
  try {
    // Connect to MongoDB
    console.log('MONGO_URL:', process.env.MONGO_URL);
    console.log('MONGODB_URI:', process.env.MONGODB_URI);
    await mongoose.connect(process.env.MONGO_URL || process.env.MONGODB_URI || 'mongodb://localhost:27017/veeqai');
    logger.info('✅ [DATABASE] MongoDB connected successfully');
    
    // Skip Redis initialization for now
    logger.warn('⚠️ [SERVICES] Redis disabled - continuing without real-time features');
    
    // Start server without Redis
    logger.info('✅ [SERVICES] Basic services initialized successfully');
    
    // Start server
    const PORT = process.env.PORT || 5000;
    console.log('Starting server on PORT:', PORT);
    server.listen(PORT, () => {
      logger.info(`🚀 [SERVER] Running on port ${PORT}`);
    });
    
  } catch (error) {
    logger.error('❌ [SERVER] Initialization failed:', error);
    process.exit(1);
  }
}

// Initialize everything
initializeServices();