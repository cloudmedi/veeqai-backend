require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');

// Professional services
const logger = require('./services/logger');
const RedisManager = require('./services/redis/RedisManager');
const EventBus = require('./services/events/EventBus');
const WebSocketManager = require('./services/websocket/WebSocketManager');
const JobQueue = require('./services/queue/JobQueue');

// Routes
const authRoutes = require('./routes/auth');
const musicRoutes = require('./routes/music');
const speechRoutes = require('./routes/speech');
const adminRoutes = require('./routes/admin');

// Monitoring
const promClient = require('prom-client');

class VeeqAIServer {
  constructor() {
    this.app = express();
    this.server = null;
    this.isShuttingDown = false;
    
    // Metrics
    this.metrics = {
      httpRequestsTotal: new promClient.Counter({
        name: 'http_requests_total',
        help: 'Total number of HTTP requests',
        labelNames: ['method', 'route', 'status_code']
      }),
      httpRequestDuration: new promClient.Histogram({
        name: 'http_request_duration_seconds',
        help: 'Duration of HTTP requests in seconds',
        labelNames: ['method', 'route']
      }),
      activeConnections: new promClient.Gauge({
        name: 'websocket_connections_active',
        help: 'Number of active WebSocket connections'
      })
    };
  }

  async initialize() {
    try {
      logger.info('🚀 [SERVER] Initializing VeeqAI server...');

      // Setup Express middleware
      await this.setupMiddleware();
      
      // Connect to MongoDB
      await this.connectMongoDB();
      
      // Initialize Redis
      await RedisManager.initialize();
      
      // Initialize Event Bus
      await EventBus.initialize();
      
      // Initialize Job Queue
      await JobQueue.initialize();
      
      // Setup routes
      this.setupRoutes();
      
      // Create HTTP server
      this.server = http.createServer(this.app);
      
      // Initialize WebSocket
      await WebSocketManager.initialize(this.server);
      
      // Setup error handling
      this.setupErrorHandling();
      
      // Setup graceful shutdown
      this.setupGracefulShutdown();
      
      // Setup monitoring endpoints
      this.setupMonitoring();
      
      logger.info('✅ [SERVER] Server initialization completed');
      
    } catch (error) {
      logger.error('❌ [SERVER] Initialization failed:', error);
      throw error;
    }
  }

  async setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: false, // Disable CSP completely
    }));

    // Compression
    this.app.use(compression());

    // CORS
    this.app.use(cors({
      origin: [
        process.env.FRONTEND_URL || 'http://localhost:5173',
        process.env.SUPER_ADMIN_URL || 'http://localhost:5174'
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // limit each IP to 1000 requests per windowMs
      message: 'Too many requests from this IP',
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use(limiter);

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging and metrics
    this.app.use((req, res, next) => {
      const start = Date.now();
      
      res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;
        const route = req.route ? req.route.path : req.path;
        
        // Update metrics
        this.metrics.httpRequestsTotal
          .labels(req.method, route, res.statusCode.toString())
          .inc();
        
        this.metrics.httpRequestDuration
          .labels(req.method, route)
          .observe(duration);
        
        // Log request
        logger.http(`${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}s`);
      });
      
      next();
    });

    logger.info('🔧 [SERVER] Middleware setup completed');
  }

  async connectMongoDB() {
    try {
      const mongoOptions = {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        bufferMaxEntries: 0,
        bufferCommands: false,
      };

      await mongoose.connect(process.env.MONGODB_URI, mongoOptions);
      
      mongoose.connection.on('error', (error) => {
        logger.error('❌ [MONGODB] Connection error:', error);
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('⚠️ [MONGODB] Disconnected');
      });

      mongoose.connection.on('reconnected', () => {
        logger.info('🔄 [MONGODB] Reconnected');
      });

      logger.info('✅ [MONGODB] Connected successfully');
      
    } catch (error) {
      logger.error('❌ [MONGODB] Connection failed:', error);
      throw error;
    }
  }

  setupRoutes() {
    // API routes
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/music', musicRoutes);
    this.app.use('/api/speech', speechRoutes);
    this.app.use('/api/admin', adminRoutes);

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        message: 'Route not found',
        path: req.originalUrl,
        timestamp: new Date().toISOString()
      });
    });

    logger.info('🛣️ [SERVER] Routes setup completed');
  }

  setupErrorHandling() {
    // Global error handler
    this.app.use((err, req, res, next) => {
      logger.error('❌ [SERVER] Unhandled error:', err);

      // Don't leak error details in production
      const isDev = process.env.NODE_ENV === 'development';
      
      res.status(err.status || 500).json({
        success: false,
        message: isDev ? err.message : 'Internal server error',
        ...(isDev && { stack: err.stack }),
        timestamp: new Date().toISOString()
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('❌ [SERVER] Uncaught Exception:', error);
      this.gracefulShutdown('SIGTERM', 1);
    });

    // Handle unhandled rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('❌ [SERVER] Unhandled Rejection at:', promise, 'reason:', reason);
      this.gracefulShutdown('SIGTERM', 1);
    });

    logger.info('⚠️ [SERVER] Error handling setup completed');
  }

  setupMonitoring() {
    // Health check endpoint
    this.app.get('/health', async (req, res) => {
      try {
        const [redisHealth, wsHealth, queueHealth] = await Promise.all([
          RedisManager.getConnectionStats(),
          WebSocketManager.getHealth(),
          JobQueue.getHealth()
        ]);

        const health = {
          status: 'healthy',
          timestamp: Date.now(),
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          services: {
            mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
            redis: redisHealth,
            websocket: wsHealth,
            jobQueue: queueHealth
          }
        };

        res.json(health);
      } catch (error) {
        logger.error('❌ [SERVER] Health check failed:', error);
        res.status(503).json({
          status: 'unhealthy',
          error: error.message,
          timestamp: Date.now()
        });
      }
    });

    // Metrics endpoint (Prometheus format)
    this.app.get('/metrics', async (req, res) => {
      try {
        // Update WebSocket connections metric
        const wsMetrics = WebSocketManager.getMetrics();
        this.metrics.activeConnections.set(wsMetrics.connectedUsers);

        res.set('Content-Type', promClient.register.contentType);
        res.end(await promClient.register.metrics());
      } catch (error) {
        logger.error('❌ [SERVER] Metrics collection failed:', error);
        res.status(500).json({ error: 'Failed to collect metrics' });
      }
    });

    logger.info('📊 [SERVER] Monitoring endpoints setup completed');
  }

  setupGracefulShutdown() {
    const shutdownSignals = ['SIGTERM', 'SIGINT', 'SIGQUIT'];
    
    shutdownSignals.forEach((signal) => {
      process.on(signal, () => {
        logger.info(`📡 [SERVER] Received ${signal}, starting graceful shutdown...`);
        this.gracefulShutdown(signal);
      });
    });

    logger.info('🛡️ [SERVER] Graceful shutdown handlers registered');
  }

  async gracefulShutdown(signal, exitCode = 0) {
    if (this.isShuttingDown) {
      logger.warn('⚠️ [SERVER] Shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;
    logger.info(`🔄 [SERVER] Graceful shutdown initiated (${signal})`);

    const shutdownTimeout = setTimeout(() => {
      logger.error('❌ [SERVER] Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 30000); // 30 seconds timeout

    try {
      // Stop accepting new connections
      if (this.server) {
        this.server.close(() => {
          logger.info('🔌 [SERVER] HTTP server closed');
        });
      }

      // Shutdown services in reverse order of initialization
      await WebSocketManager.shutdown();
      await JobQueue.shutdown();
      await EventBus.emit('shutdown');
      await RedisManager.disconnect();
      
      // Close MongoDB connection
      await mongoose.connection.close();
      logger.info('🔌 [MONGODB] Connection closed');

      clearTimeout(shutdownTimeout);
      logger.info('✅ [SERVER] Graceful shutdown completed');
      process.exit(exitCode);

    } catch (error) {
      logger.error('❌ [SERVER] Error during shutdown:', error);
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  }

  async start() {
    try {
      await this.initialize();
      
      const PORT = process.env.PORT || 5000;
      
      this.server.listen(PORT, () => {
        logger.info(`🚀 [SERVER] VeeqAI server running on port ${PORT}`);
        logger.info(`🏠 [SERVER] Environment: ${process.env.NODE_ENV || 'development'}`);
        logger.info(`🆔 [SERVER] Instance ID: ${process.env.INSTANCE_ID || 'unknown'}`);
      });

    } catch (error) {
      logger.error('❌ [SERVER] Failed to start server:', error);
      process.exit(1);
    }
  }
}

// Start the server
const server = new VeeqAIServer();
server.start().catch((error) => {
  logger.error('❌ [SERVER] Startup failed:', error);
  process.exit(1);
});

// Export for testing
module.exports = VeeqAIServer;