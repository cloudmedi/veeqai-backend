const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const RedisManager = require('../redis/RedisManager');
const EventBus = require('../events/EventBus');
const JWTService = require('../../utils/jwt');
const User = require('../../models/User');
const logger = require('../logger');

class WebSocketManager {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> Set of socket IDs
    this.socketUsers = new Map(); // socketId -> user data
    this.rooms = new Map(); // room -> Set of socket IDs
    
    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      messagesSent: 0,
      messagesReceived: 0,
      errors: 0,
      startTime: Date.now()
    };

    // Rate limiting configuration
    this.rateLimits = new Map(); // userId -> { count, resetTime }
    this.maxMessagesPerMinute = 60;
  }

  async initialize(server) {
    try {
      // Initialize Socket.IO with Redis adapter
      this.io = new Server(server, {
        cors: {
          origin: [
            'https://app.veeq.ai',
            'https://veeq.ai', 
            'https://www.veeq.ai',
            'http://localhost:3000',
            'http://localhost:5173',
            'http://localhost:5174',
            'http://localhost:5175'
          ],
          credentials: true,
          methods: ['GET', 'POST']
        },
        transports: ['websocket', 'polling'],
        pingTimeout: 60000,
        pingInterval: 25000,
        upgradeTimeout: 30000,
        maxHttpBufferSize: 1e6, // 1MB
        allowEIO3: true
      });

      // Skip Redis adapter for now
      logger.warn('⚠️ [WEBSOCKET] Running without Redis adapter');
      
      // Setup authentication middleware
      this.setupAuthMiddleware();
      
      // Setup connection handling
      this.setupConnectionHandling();
      
      // Skip EventBus subscription
      logger.warn('⚠️ [WEBSOCKET] EventBus disabled');
      
      // Setup monitoring and health checks
      this.setupMonitoring();
      
      logger.info('✅ [WEBSOCKET] Initialized successfully');
      return true;
    } catch (error) {
      logger.error('❌ [WEBSOCKET] Initialization failed:', error);
      throw error;
    }
  }

  async setupRedisAdapter() {
    try {
      // Only setup Redis adapter if Redis is available and connected
      if (RedisManager.isConnected && process.env.ENABLE_REDIS_ADAPTER !== 'false') {
        const websocketPool = RedisManager.getWebSocketPool();
        if (websocketPool) {
          const redisAdapter = createAdapter({
            pubClient: websocketPool,
            subClient: websocketPool.duplicate()
          });
          
          this.io.adapter(redisAdapter);
          logger.info('📡 [WEBSOCKET] Redis adapter configured for multi-instance support');
          return true;
        }
      }
      
      logger.warn('⚠️ [WEBSOCKET] Redis adapter not configured - using default memory adapter');
      return false;
    } catch (error) {
      logger.warn('⚠️ [WEBSOCKET] Failed to setup Redis adapter, falling back to memory adapter:', error.message);
      // Don't throw - fallback to memory adapter
      return false;
    }
  }

  setupAuthMiddleware() {
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth?.token;
        
        // Allow anonymous connections for public features (like pricing page)
        if (!token) {
          socket.user = {
            id: 'anonymous_' + socket.id,
            name: 'Anonymous',
            email: 'anonymous@public',
            role: 'public',
            plan: null
          };
          socket.isAnonymous = true;
          return next();
        }

        // Verify JWT token for authenticated users
        const decoded = JWTService.verifyToken(token, 'access');
        if (!decoded) {
          return next(new Error('Invalid token'));
        }

        // Get user data
        const user = await User.findById(decoded.id).select('-password');
        if (!user || user.status !== 'active') {
          return next(new Error('User not found or inactive'));
        }

        // Attach user to socket
        socket.user = {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          plan: user.plan
        };
        socket.isAnonymous = false;

        // Rate limiting check
        if (await this.isRateLimited(socket.user.id)) {
          return next(new Error('Rate limit exceeded'));
        }

        // User authenticated successfully
        next();
      } catch (error) {
        logger.error('❌ [WEBSOCKET] Authentication failed:', error);
        next(new Error('Authentication failed'));
      }
    });
  }

  setupConnectionHandling() {
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });
  }

  async handleConnection(socket) {
    const userId = socket.user.id;
    const userRole = socket.user.role;
    
    // Update metrics
    this.metrics.totalConnections++;
    this.metrics.activeConnections++;
    
    // Store connection mappings
    if (!this.connectedUsers.has(userId)) {
      this.connectedUsers.set(userId, new Set());
    }
    this.connectedUsers.get(userId).add(socket.id);
    this.socketUsers.set(socket.id, socket.user);
    
    // Join appropriate rooms
    await this.joinUserRooms(socket, userId, userRole);
    
    // Setup socket event handlers
    this.setupSocketEvents(socket);
    
    // Log connection
    logger.info(`🔌 [WEBSOCKET] User connected: ${socket.user.email} (${socket.id})`);
    
    // Update user's last activity
    await this.updateUserActivity(userId);
    
    // Send welcome message
    socket.emit('connected', {
      message: 'Connected to VeeqAI real-time service',
      timestamp: Date.now(),
      instanceId: process.env.INSTANCE_ID
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      this.handleDisconnection(socket, reason);
    });
  }

  async joinUserRooms(socket, userId, userRole) {
    // Anonymous users join public room only
    if (socket.isAnonymous) {
      await socket.join('public');
      await socket.join('pricing_updates');
      return;
    }
    
    // User-specific room
    await socket.join(`user:${userId}`);
    
    // Role-based rooms
    if (userRole === 'superadmin') {
      await socket.join('superadmin');
      await socket.join('admins');
    } else if (userRole === 'admin') {
      await socket.join('admins');
    }
    
    // General user room
    await socket.join('users');
    
    // Plan-based room if applicable
    if (socket.user.plan) {
      await socket.join(`plan:${socket.user.plan}`);
    }
    
    // User joined appropriate rooms
  }

  setupSocketEvents(socket) {
    const userId = socket.user.id;
    
    // Heartbeat/ping-pong
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });
    
    // Subscribe to specific events
    socket.on('subscribe', async (data) => {
      await this.handleSubscription(socket, data);
    });
    
    socket.on('unsubscribe', async (data) => {
      await this.handleUnsubscription(socket, data);
    });
    
    // Handle user activity
    socket.on('activity', async (data) => {
      await this.updateUserActivity(userId, data);
    });
    
    // Handle custom messages (with rate limiting)
    socket.on('message', async (data) => {
      await this.handleCustomMessage(socket, data);
    });
    
    // Error handling
    socket.on('error', (error) => {
      logger.error(`❌ [WEBSOCKET] Socket error for ${socket.user.email}:`, error);
      this.metrics.errors++;
    });
  }

  async handleSubscription(socket, data) {
    try {
      const { type, targets } = data;
      
      // Validate subscription permissions
      if (!await this.canSubscribeTo(socket.user, type, targets)) {
        socket.emit('subscription_error', { 
          message: 'Permission denied for subscription',
          type 
        });
        return;
      }
      
      // Join specific rooms based on subscription type
      switch (type) {
        case 'models':
          if (targets && Array.isArray(targets)) {
            for (const modelId of targets) {
              await socket.join(`model:${modelId}`);
            }
          } else {
            await socket.join('models:all');
          }
          break;
          
        case 'plans':
          await socket.join('plans:updates');
          break;
          
        case 'system':
          if (socket.user.role === 'superadmin') {
            await socket.join('system:updates');
          }
          break;
          
        default:
          logger.warn(`🔔 [WEBSOCKET] Unknown subscription type: ${type}`);
          return;
      }
      
      socket.emit('subscribed', { type, targets, timestamp: Date.now() });
      logger.debug(`🔔 [WEBSOCKET] User subscribed to ${type}:`, socket.user.email);
      
    } catch (error) {
      logger.error('❌ [WEBSOCKET] Subscription error:', error);
      socket.emit('subscription_error', { message: 'Subscription failed' });
    }
  }

  async handleUnsubscription(socket, data) {
    try {
      const { type, targets } = data;
      
      // Leave rooms based on subscription type
      switch (type) {
        case 'models':
          if (targets && Array.isArray(targets)) {
            for (const modelId of targets) {
              socket.leave(`model:${modelId}`);
            }
          } else {
            socket.leave('models:all');
          }
          break;
          
        case 'plans':
          socket.leave('plans:updates');
          break;
          
        case 'system':
          socket.leave('system:updates');
          break;
      }
      
      socket.emit('unsubscribed', { type, targets, timestamp: Date.now() });
      logger.debug(`🔕 [WEBSOCKET] User unsubscribed from ${type}:`, socket.user.email);
      
    } catch (error) {
      logger.error('❌ [WEBSOCKET] Unsubscription error:', error);
    }
  }

  async handleCustomMessage(socket, data) {
    try {
      // Rate limiting check
      if (await this.isRateLimited(socket.user.id)) {
        socket.emit('rate_limited', { message: 'Too many messages. Please slow down.' });
        return;
      }
      
      this.metrics.messagesReceived++;
      
      // Process different message types
      switch (data.type) {
        case 'heartbeat':
          await this.updateUserActivity(socket.user.id);
          break;
          
        case 'feedback':
          await this.handleFeedback(socket, data);
          break;
          
        default:
          logger.debug(`📨 [WEBSOCKET] Unknown message type: ${data.type}`);
      }
      
    } catch (error) {
      logger.error('❌ [WEBSOCKET] Message handling error:', error);
      socket.emit('message_error', { message: 'Failed to process message' });
    }
  }

  handleDisconnection(socket, reason) {
    const userId = socket.user.id;
    
    // Update metrics
    this.metrics.activeConnections--;
    
    // Remove from connection mappings
    if (this.connectedUsers.has(userId)) {
      this.connectedUsers.get(userId).delete(socket.id);
      
      if (this.connectedUsers.get(userId).size === 0) {
        this.connectedUsers.delete(userId);
      }
    }
    
    this.socketUsers.delete(socket.id);
    
    // Clean up rate limiting
    this.rateLimits.delete(userId);
    
    logger.info(`🔌 [WEBSOCKET] User disconnected: ${socket.user.email} (${reason})`);
  }

  // ===============================
  // EVENT BUS INTEGRATION
  // ===============================

  subscribeToEventBus() {
    // Subscribe to WebSocket-specific events
    EventBus.subscribe('websocket.broadcast', this.handleBroadcast.bind(this));
    EventBus.subscribe('websocket.user_specific', this.handleUserSpecific.bind(this));
    EventBus.subscribe('websocket.room_specific', this.handleRoomSpecific.bind(this));
    
    // Subscribe to plan events for real-time updates
    EventBus.subscribe(EventBus.channels.PLAN, this.handlePlanEvent.bind(this));
    
    // Subscribed to EventBus
  }

  async handleBroadcast(data, metadata) {
    try {
      const { type, targetRoom = 'users', ...payload } = data;
      
      if (type === 'PLAN_UPDATED') {
        // Send to all connected users for pricing page updates
        this.io.emit('plan_updated', {
          type: payload.eventType,
          plan: payload.plan,
          timestamp: payload.timestamp
        });
      } else {
        this.io.to(targetRoom).emit(type, {
          ...payload,
          timestamp: Date.now(),
          instanceId: process.env.INSTANCE_ID
        });
      }
      
      this.metrics.messagesSent++;
      logger.debug(`📡 [WEBSOCKET] Broadcast sent to ${targetRoom}: ${type}`);
      
    } catch (error) {
      logger.error('❌ [WEBSOCKET] Broadcast error:', error);
      this.metrics.errors++;
    }
  }

  async handleUserSpecific(data, metadata) {
    try {
      const { userId, type, ...payload } = data;
      
      this.io.to(`user:${userId}`).emit(type, {
        ...payload,
        timestamp: Date.now(),
        instanceId: process.env.INSTANCE_ID
      });
      
      this.metrics.messagesSent++;
      logger.debug(`📡 [WEBSOCKET] User-specific message sent to ${userId}:`, type);
      
    } catch (error) {
      logger.error('❌ [WEBSOCKET] User-specific message error:', error);
      this.metrics.errors++;
    }
  }

  async handleRoomSpecific(data, metadata) {
    try {
      const { room, type, ...payload } = data;
      
      this.io.to(room).emit(type, {
        ...payload,
        timestamp: Date.now(),
        instanceId: process.env.INSTANCE_ID
      });
      
      this.metrics.messagesSent++;
      logger.debug(`📡 [WEBSOCKET] Room-specific message sent to ${room}:`, type);
      
    } catch (error) {
      logger.error('❌ [WEBSOCKET] Room-specific message error:', error);
      this.metrics.errors++;
    }
  }

  async handlePlanEvent(event) {
    try {
      // Skip if this instance originated the event (avoid loops)
      if (event.metadata?.instanceId === process.env.INSTANCE_ID) {
        return;
      }
      
      // Broadcast to all users (pricing page should update)
      this.io.emit('plan_updated', {
        type: event.type,
        plan: event.data,
        timestamp: event.metadata.timestamp,
        updatedBy: event.metadata.updatedBy
      });
      
      this.metrics.messagesSent++;
      
    } catch (error) {
      logger.error('❌ [WEBSOCKET] Plan event error:', error);
      this.metrics.errors++;
    }
  }

  // ===============================
  // UTILITY METHODS
  // ===============================

  async canSubscribeTo(user, type, targets) {
    // Basic permission check
    switch (type) {
      case 'models':
      case 'plans':
        return true; // All authenticated users can subscribe
        
      case 'system':
        return user.role === 'superadmin';
        
      default:
        return false;
    }
  }

  async isRateLimited(userId) {
    const now = Date.now();
    const userLimit = this.rateLimits.get(userId);
    
    if (!userLimit) {
      this.rateLimits.set(userId, { count: 1, resetTime: now + 60000 });
      return false;
    }
    
    if (now > userLimit.resetTime) {
      this.rateLimits.set(userId, { count: 1, resetTime: now + 60000 });
      return false;
    }
    
    if (userLimit.count >= this.maxMessagesPerMinute) {
      return true;
    }
    
    userLimit.count++;
    return false;
  }

  async updateUserActivity(userId, activity = {}) {
    try {
      // Skip Redis cache - store in memory for now
      logger.debug('📊 [WEBSOCKET] User activity updated:', { userId, lastSeen: Date.now(), ...activity });
      
    } catch (error) {
      logger.error('❌ [WEBSOCKET] Failed to update user activity:', error);
    }
  }

  // ===============================
  // MONITORING & METRICS
  // ===============================

  setupMonitoring() {
    // Periodic cleanup of stale connections
    setInterval(() => {
      this.cleanupStaleConnections();
    }, 300000); // 5 minutes
    
    // Metrics reporting
    setInterval(() => {
      this.reportMetrics();
    }, 60000); // 1 minute
  }

  cleanupStaleConnections() {
    // Clean up rate limits
    const now = Date.now();
    for (const [userId, limit] of this.rateLimits) {
      if (now > limit.resetTime) {
        this.rateLimits.delete(userId);
      }
    }
    
    logger.debug('🧹 [WEBSOCKET] Cleaned up stale connections and rate limits');
  }

  reportMetrics() {
    const metrics = this.getMetrics();
    logger.info('📊 [WEBSOCKET] Metrics:', metrics);
    
    // Send metrics to monitoring system if configured
    // This could be Prometheus, DataDog, etc.
  }

  getMetrics() {
    return {
      ...this.metrics,
      uptime: Date.now() - this.metrics.startTime,
      connectedUsers: this.connectedUsers.size,
      totalSockets: this.socketUsers.size,
      rateLimitedUsers: this.rateLimits.size
    };
  }

  getHealth() {
    const metrics = this.getMetrics();
    
    return {
      status: this.io ? 'healthy' : 'unhealthy',
      metrics,
      redis: 'disabled',
      timestamp: Date.now()
    };
  }

  // ===============================
  // GRACEFUL SHUTDOWN
  // ===============================

  async shutdown() {
    logger.info('🔌 [WEBSOCKET] Shutting down WebSocket manager...');
    
    try {
      // Disconnect all clients
      this.io.disconnectSockets(true);
      
      // Clear connection mappings
      this.connectedUsers.clear();
      this.socketUsers.clear();
      this.rateLimits.clear();
      
      // Close server
      if (this.io) {
        this.io.close();
      }
      
      logger.info('✅ [WEBSOCKET] WebSocket manager shut down successfully');
    } catch (error) {
      logger.error('❌ [WEBSOCKET] Error during shutdown:', error);
    }
  }
}

// Export singleton instance
module.exports = new WebSocketManager();