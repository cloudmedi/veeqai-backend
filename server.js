console.log('🔄 [DEBUG] Starting server.js file...');

const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

console.log('🔄 [DEBUG] Basic imports loaded successfully');

// Load environment variables
dotenv.config();

// Professional services
console.log('🔄 [DEBUG] Loading logger...');
const logger = require('./services/logger');
console.log('🔄 [DEBUG] Logger loaded');

console.log('🔄 [DEBUG] Loading RedisManager...');
const RedisManager = require('./services/redis/RedisManager');
console.log('🔄 [DEBUG] RedisManager loaded');

console.log('🔄 [DEBUG] Loading EventBus...');
const EventBus = require('./services/events/EventBus');
console.log('🔄 [DEBUG] EventBus loaded');

console.log('🔄 [DEBUG] Loading JobQueue...');
const JobQueue = require('./services/queue/JobQueue');
console.log('🔄 [DEBUG] JobQueue loaded');

console.log('🔄 [DEBUG] Loading WebSocketManager...');
const WebSocketManager = require('./services/websocket/WebSocketManager');
console.log('🔄 [DEBUG] WebSocketManager loaded');

console.log('🔄 [DEBUG] Loading MusicProcessor...');
const MusicProcessor = require('./services/MusicProcessor');
console.log('🔄 [DEBUG] MusicProcessor loaded');

console.log('🔄 [DEBUG] Loading monitoring...');
const monitoring = require('./services/monitoring');
console.log('🔄 [DEBUG] All services loaded successfully');

// Security middleware
console.log('🔄 [DEBUG] Loading security middleware...');
const { securityHeaders } = require('./middleware/securityHeaders');
console.log('🔄 [DEBUG] Security middleware loaded');

// Create Express app and HTTP server
console.log('🔄 [DEBUG] Creating Express app...');
const app = express();
const server = http.createServer(app);
console.log('🔄 [DEBUG] Express app created');

// Security headers (apply to all routes)
console.log('🔄 [DEBUG] Applying security headers...');
app.use(securityHeaders);
console.log('🔄 [DEBUG] Security headers applied');

// Middleware
console.log('🔄 [DEBUG] Applying CORS...');
app.use(cors({
  origin: true,
  credentials: true
}));
console.log('🔄 [DEBUG] CORS applied');

console.log('🔄 [DEBUG] Applying JSON middleware...');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
console.log('🔄 [DEBUG] JSON middleware applied');

// Monitoring middleware - track all API calls
console.log('🔄 [DEBUG] Applying monitoring middleware...');
app.use(monitoring.middleware());
console.log('🔄 [DEBUG] Monitoring middleware applied');

// Routes will be loaded after DB connection
function loadRoutes() {
  console.log('🔄 [DEBUG] Loading routes...');
  console.log('🔄 [DEBUG] Loading auth routes...');
  app.use('/api/auth', require('./routes/auth'));
  console.log('🔄 [DEBUG] Loading public routes...');
  app.use('/api/public', require('./routes/public')); // Public routes - NO AUTH
  console.log('🔄 [DEBUG] Loading music routes...');
  app.use('/api/music', require('./routes/music'));
  console.log('🔄 [DEBUG] Loading speech routes...');
  app.use('/api/speech', require('./routes/speech'));
  console.log('🔄 [DEBUG] Loading voices routes...');
  app.use('/api/voices', require('./routes/voices')); // Voice models and TTS
  console.log('🔄 [DEBUG] Loading payment routes...');
  app.use('/api/payment', require('./routes/payment')); // Production payment routes with Iyzico
  console.log('🔄 [DEBUG] Payment routes loaded');
  console.log('🔄 [DEBUG] Loading admin routes...');
  app.use('/api/admin', require('./routes/admin'));
  console.log('🔄 [DEBUG] All routes loaded successfully');
}

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
    console.log('🔄 [DEBUG] Step 1 - Starting MongoDB connection...');
    // Connect to MongoDB
    console.log('MONGO_URL:', process.env.MONGO_URL);
    console.log('MONGODB_URI:', process.env.MONGODB_URI);
    await mongoose.connect(process.env.MONGO_URL || process.env.MONGODB_URI || 'mongodb://localhost:27017/veeqai');
    console.log('🔄 [DEBUG] Step 2 - MongoDB connected successfully');
    logger.info('✅ [DATABASE] MongoDB connected successfully');
    
    // Load routes AFTER MongoDB connection
    console.log('🔄 [DEBUG] Step 2.5 - Loading routes after DB connection...');
    loadRoutes();
    console.log('🔄 [DEBUG] Routes loaded successfully after DB connection');
    
    console.log('🔄 [DEBUG] Step 3 - Starting WebSocket initialization...');
    // Initialize WebSocket without Redis
    try {
      await WebSocketManager.initialize(server);
      console.log('🔄 [DEBUG] Step 4 - WebSocket initialized successfully');
      logger.info('✅ [SERVICES] WebSocket initialized without Redis');
    } catch (wsError) {
      console.log('🔄 [DEBUG] Step 4 - WebSocket failed:', wsError.message);
      logger.warn('⚠️ [WEBSOCKET] Failed to initialize:', wsError.message);
    }
    
    console.log('🔄 [DEBUG] Step 5 - Starting server...');
    logger.info('✅ [SERVICES] Basic services initialized successfully');
    
    // Start server
    const PORT = process.env.PORT || 5000;
    const HOST = process.env.HOST || '0.0.0.0';
    console.log('Starting server on HOST:', HOST, 'PORT:', PORT);
    server.listen(PORT, HOST, () => {
      console.log('🔄 [DEBUG] Step 6 - Server started successfully on', HOST + ':' + PORT);
      logger.info(`🚀 [SERVER] Running on ${HOST}:${PORT}`);
    });
    
    console.log('🔄 [DEBUG] Step 7 - Initialization completed');
    
  } catch (error) {
    console.error('❌ [SERVER] Initialization failed:', error);
    console.error('❌ [SERVER] Stack trace:', error.stack);
    logger.error('❌ [SERVER] Initialization failed:', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ [UNCAUGHT EXCEPTION]:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ [UNHANDLED REJECTION] at:', promise, 'reason:', reason);
  process.exit(1);
});

// Initialize everything
console.log('🔄 [DEBUG] About to call initializeServices...');
initializeServices()
.then(() => {
  console.log('🔄 [DEBUG] initializeServices completed successfully');
})
.catch((error) => {
  console.error('🔄 [DEBUG] initializeServices failed:', error);
  console.error('🔄 [DEBUG] Stack:', error.stack);
});