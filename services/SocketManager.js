const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('./logger');

/**
 * WebSocket Manager for Real-time Credit Updates
 * Enterprise-grade WebSocket connection management
 */
class SocketManager {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> Set<socketId>
    this.socketToUser = new Map(); // socketId -> userId
  }

  /**
   * Initialize WebSocket server
   */
  initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    this.setupMiddleware();
    this.setupEventHandlers();
    
    console.log('📡 [WEBSOCKET] SocketManager initialized');
  }

  /**
   * Authentication middleware for WebSocket connections
   */
  setupMiddleware() {
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (!decoded || !decoded.id) {
          return next(new Error('Invalid token'));
        }

        // Attach user info to socket
        socket.userId = decoded.id;
        socket.userEmail = decoded.email;
        
        console.log(`🔐 [WEBSOCKET] User authenticated: ${decoded.email} (${decoded.id})`);
        next();
      } catch (error) {
        console.error('❌ [WEBSOCKET] Authentication failed:', error.message);
        next(new Error('Authentication failed'));
      }
    });
  }

  /**
   * Setup WebSocket event handlers
   */
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      const userId = socket.userId;
      
      console.log(`✅ [WEBSOCKET] User connected: ${socket.userEmail} (Socket: ${socket.id})`);
      
      // Track user connections
      this.addUserConnection(userId, socket.id);
      
      // Send initial credit info
      this.sendInitialCreditInfo(socket);
      
      // Handle credit info requests
      socket.on('request_credit_info', async () => {
        await this.sendCreditInfo(socket);
      });
      
      // Handle disconnect
      socket.on('disconnect', (reason) => {
        console.log(`🔌 [WEBSOCKET] User disconnected: ${socket.userEmail} (${reason})`);
        this.removeUserConnection(userId, socket.id);
      });
      
      // Handle connection errors
      socket.on('error', (error) => {
        console.error(`❌ [WEBSOCKET] Socket error for user ${socket.userEmail}:`, error);
      });
      
      // Heartbeat for connection health
      socket.on('ping', () => {
        socket.emit('pong');
      });
    });
  }

  /**
   * Track user connections
   */
  addUserConnection(userId, socketId) {
    if (!this.connectedUsers.has(userId)) {
      this.connectedUsers.set(userId, new Set());
    }
    
    this.connectedUsers.get(userId).add(socketId);
    this.socketToUser.set(socketId, userId);
    
    console.log(`📊 [WEBSOCKET] User ${userId} now has ${this.connectedUsers.get(userId).size} active connections`);
  }

  /**
   * Remove user connection tracking
   */
  removeUserConnection(userId, socketId) {
    if (this.connectedUsers.has(userId)) {
      this.connectedUsers.get(userId).delete(socketId);
      
      if (this.connectedUsers.get(userId).size === 0) {
        this.connectedUsers.delete(userId);
      }
    }
    
    this.socketToUser.delete(socketId);
  }

  /**
   * Send initial credit information to newly connected socket
   */
  async sendInitialCreditInfo(socket) {
    try {
      const EnterpriseCreditService = require('./EnterpriseCreditService');
      const creditInfo = await EnterpriseCreditService.getUserCreditInfo(socket.userId);
      
      socket.emit('credit_info', {
        credits: creditInfo.available,
        used: creditInfo.used,
        total: creditInfo.total,
        reserved: creditInfo.reserved,
        plan: creditInfo.plan.name,
        timestamp: new Date().toISOString()
      });
      
      console.log(`📤 [WEBSOCKET] Initial credit info sent to ${socket.userEmail}: ${creditInfo.available} credits`);
    } catch (error) {
      console.error(`❌ [WEBSOCKET] Failed to send initial credit info to ${socket.userEmail}:`, error);
    }
  }

  /**
   * Send current credit information to socket
   */
  async sendCreditInfo(socket) {
    try {
      const EnterpriseCreditService = require('./EnterpriseCreditService');
      const creditInfo = await EnterpriseCreditService.getUserCreditInfo(socket.userId);
      
      socket.emit('credit_info', {
        credits: creditInfo.available,
        used: creditInfo.used,
        total: creditInfo.total,
        reserved: creditInfo.reserved,
        plan: creditInfo.plan.name,
        timestamp: new Date().toISOString()
      });
      
      console.log(`📤 [WEBSOCKET] Credit info sent to ${socket.userEmail}: ${creditInfo.available} credits`);
    } catch (error) {
      console.error(`❌ [WEBSOCKET] Failed to send credit info to ${socket.userEmail}:`, error);
    }
  }

  /**
   * Emit event to specific user (all their connected sockets)
   */
  emitToUser(userId, event, data) {
    if (!this.connectedUsers.has(userId)) {
      console.log(`⚠️ [WEBSOCKET] User ${userId} not connected, skipping emit`);
      return false;
    }

    const userSockets = this.connectedUsers.get(userId);
    let emittedCount = 0;
    
    for (const socketId of userSockets) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit(event, data);
        emittedCount++;
      }
    }
    
    console.log(`📡 [WEBSOCKET] Event '${event}' emitted to ${emittedCount} sockets for user ${userId}`);
    return emittedCount > 0;
  }

  /**
   * Emit event to all connected users
   */
  emitToAll(event, data) {
    this.io.emit(event, data);
    console.log(`📡 [WEBSOCKET] Event '${event}' emitted to all connected users`);
  }

  /**
   * Get connection statistics
   */
  getStats() {
    const totalConnections = this.socketToUser.size;
    const uniqueUsers = this.connectedUsers.size;
    
    return {
      totalConnections,
      uniqueUsers,
      connectionsPerUser: totalConnections > 0 ? (totalConnections / uniqueUsers).toFixed(2) : 0
    };
  }

  /**
   * Health check for WebSocket server
   */
  healthCheck() {
    const stats = this.getStats();
    
    return {
      status: 'healthy',
      server: this.io ? 'running' : 'not_initialized',
      connections: stats,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Graceful shutdown
   */
  shutdown() {
    if (this.io) {
      console.log('🛑 [WEBSOCKET] Shutting down WebSocket server...');
      
      // Notify all clients about shutdown
      this.emitToAll('server_shutdown', {
        message: 'Server is shutting down',
        timestamp: new Date().toISOString()
      });
      
      // Close all connections
      this.io.close();
      
      // Clear tracking maps
      this.connectedUsers.clear();
      this.socketToUser.clear();
      
      console.log('✅ [WEBSOCKET] WebSocket server shutdown complete');
    }
  }
}

// Export singleton instance
module.exports = new SocketManager();