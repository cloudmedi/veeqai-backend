const RedisManager = require('../redis/RedisManager');
const logger = require('../logger');
const EventEmitter = require('events');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.subscriptions = new Map();
    this.eventHandlers = new Map();
    this.metrics = {
      published: 0,
      consumed: 0,
      errors: 0,
      lastActivity: null
    };
    
    // Event channels configuration
    this.channels = {
      SYSTEM: 'veeq:system',
      USER: 'veeq:user',
      MODEL: 'veeq:model',
      PLAN: 'veeq:plan',
      NOTIFICATION: 'veeq:notification',
      WEBSOCKET: 'veeq:websocket',
      AUDIT: 'veeq:audit'
    };
  }

  async initialize() {
    try {
      // Ensure Redis is connected
      if (!RedisManager.isConnected) {
        await RedisManager.initialize();
      }

      // Subscribe to all event channels
      await this.subscribeToChannels();
      
      // Setup built-in event handlers
      this.setupBuiltinHandlers();
      
      logger.info('✅ [EVENTBUS] Initialized successfully');
      return true;
    } catch (error) {
      logger.error('❌ [EVENTBUS] Initialization failed:', error);
      throw error;
    }
  }

  async subscribeToChannels() {
    const channelList = Object.values(this.channels);
    
    await RedisManager.subscribe(channelList, (channel, message) => {
      this.handleIncomingEvent(channel, message);
    });
    
    // Subscribed to Redis channels
  }

  setupBuiltinHandlers() {
    // Model events
    this.on('model.status.changed', this.handleModelStatusChange.bind(this));
    this.on('model.created', this.handleModelCreated.bind(this));
    this.on('model.deleted', this.handleModelDeleted.bind(this));
    
    // Plan events
    this.on('plan.created', this.handlePlanCreated.bind(this));
    this.on('plan.updated', this.handlePlanUpdated.bind(this));
    this.on('plan.deleted', this.handlePlanDeleted.bind(this));
    
    // User events
    this.on('user.status.changed', this.handleUserStatusChange.bind(this));
    this.on('user.subscription.changed', this.handleSubscriptionChange.bind(this));
    
    // System events
    this.on('system.maintenance', this.handleMaintenanceMode.bind(this));
    this.on('system.settings.updated', this.handleSystemSettings.bind(this));
  }

  // ===============================
  // PUBLISHING METHODS
  // ===============================

  async publishModelEvent(eventType, modelData, metadata = {}) {
    const event = {
      type: `model.${eventType}`,
      data: modelData,
      metadata: {
        ...metadata,
        source: 'admin-panel',
        timestamp: Date.now(),
        instanceId: process.env.INSTANCE_ID
      }
    };

    await this.publish(this.channels.MODEL, event);
    logger.info(`📡 [EVENTBUS] Published model event: ${eventType}`, { modelId: modelData.id });
  }

  async publishPlanEvent(eventType, planData, metadata = {}) {
    const event = {
      type: `plan.${eventType}`,
      data: planData,
      metadata: {
        ...metadata,
        source: 'admin-panel',
        timestamp: Date.now(),
        instanceId: process.env.INSTANCE_ID
      }
    };

    await this.publish(this.channels.PLAN, event);
    
    // Also broadcast to WebSocket for real-time updates
    await this.publishWebSocketEvent('broadcast', {
      type: 'PLAN_UPDATED',
      targetRoom: 'users',
      plan: planData,
      eventType: `plan.${eventType}`,
      timestamp: Date.now()
    });
    
    logger.info(`📡 [EVENTBUS] Published plan event: ${eventType}`, { planId: planData._id });
  }

  async publishUserEvent(eventType, userData, metadata = {}) {
    const event = {
      type: `user.${eventType}`,
      data: userData,
      metadata: {
        ...metadata,
        timestamp: Date.now(),
        instanceId: process.env.INSTANCE_ID
      }
    };

    await this.publish(this.channels.USER, event);
    logger.info(`📡 [EVENTBUS] Published user event: ${eventType}`, { userId: userData.id });
  }

  async publishSystemEvent(eventType, systemData, metadata = {}) {
    const event = {
      type: `system.${eventType}`,
      data: systemData,
      metadata: {
        ...metadata,
        timestamp: Date.now(),
        instanceId: process.env.INSTANCE_ID,
        priority: 'high'
      }
    };

    await this.publish(this.channels.SYSTEM, event);
    logger.info(`📡 [EVENTBUS] Published system event: ${eventType}`);
  }

  async publishNotification(notification, targetUsers = []) {
    const event = {
      type: 'notification.send',
      data: notification,
      metadata: {
        targetUsers,
        timestamp: Date.now(),
        instanceId: process.env.INSTANCE_ID
      }
    };

    await this.publish(this.channels.NOTIFICATION, event);
    logger.info(`📡 [EVENTBUS] Published notification:`, { type: notification.type, targets: targetUsers.length });
  }

  async publishWebSocketEvent(eventType, socketData, metadata = {}) {
    const event = {
      type: `websocket.${eventType}`,
      data: socketData,
      metadata: {
        ...metadata,
        timestamp: Date.now(),
        instanceId: process.env.INSTANCE_ID
      }
    };

    await this.publish(this.channels.WEBSOCKET, event);
    logger.debug(`📡 [EVENTBUS] Published WebSocket event: ${eventType}`);
  }

  // ===============================
  // CORE PUBLISHING METHOD
  // ===============================

  async publish(channel, event) {
    try {
      await RedisManager.publish(channel, event);
      this.metrics.published++;
      this.metrics.lastActivity = Date.now();
      
      // Emit locally as well for same-instance listeners
      this.emit(event.type, event.data, event.metadata);
      
      return true;
    } catch (error) {
      this.metrics.errors++;
      logger.error('❌ [EVENTBUS] Failed to publish event:', error);
      throw error;
    }
  }

  // ===============================
  // EVENT HANDLING
  // ===============================

  handleIncomingEvent(channel, message) {
    try {
      this.metrics.consumed++;
      this.metrics.lastActivity = Date.now();
      
      // Skip events from same instance to prevent loops (except WebSocket events)
      if (message.metadata?.instanceId === process.env.INSTANCE_ID && channel !== this.channels.WEBSOCKET) {
        return;
      }
      
      logger.debug(`📥 [EVENTBUS] Received event from ${channel}:`, message.type);
      
      // Handle WebSocket events specially
      if (channel === this.channels.WEBSOCKET) {
        this.handleWebSocketEvent(message);
        return;
      }
      
      // Emit the event locally
      this.emit(message.type, message.data, message.metadata);
      
      // Execute registered handlers
      if (this.eventHandlers.has(message.type)) {
        const handlers = this.eventHandlers.get(message.type);
        handlers.forEach(handler => {
          this.safeExecuteHandler(handler, message.data, message.metadata);
        });
      }
    } catch (error) {
      this.metrics.errors++;
      logger.error('❌ [EVENTBUS] Error handling incoming event:', error);
    }
  }

  handleWebSocketEvent(message) {
    try {
      // Import WebSocketManager here to avoid circular dependency
      const WebSocketManager = require('../websocket/WebSocketManager');
      
      switch (message.type) {
        case 'websocket.broadcast':
          WebSocketManager.handleBroadcast(message.data, message.metadata);
          break;
        case 'websocket.user_specific':
          WebSocketManager.handleUserSpecific(message.data, message.metadata);
          break;
        case 'websocket.room_specific':
          WebSocketManager.handleRoomSpecific(message.data, message.metadata);
          break;
        default:
          logger.debug(`📡 [EVENTBUS] Unknown WebSocket event type: ${message.type}`);
      }
    } catch (error) {
      logger.error('❌ [EVENTBUS] WebSocket event handling failed:', error);
    }
  }

  async safeExecuteHandler(handler, data, metadata) {
    try {
      await handler(data, metadata);
    } catch (error) {
      logger.error('❌ [EVENTBUS] Handler execution failed:', error);
      // Don't throw - we don't want one handler failure to affect others
    }
  }

  // ===============================
  // BUILT-IN EVENT HANDLERS
  // ===============================

  async handleModelStatusChange(modelData, metadata) {
    logger.info('🤖 [EVENTBUS] Processing model status change:', modelData);
    
    // Broadcast to WebSocket clients
    await this.publishWebSocketEvent('broadcast', {
      type: 'MODEL_STATUS_CHANGED',
      modelId: modelData.id,
      status: modelData.status,
      updatedBy: metadata.updatedBy
    });

    // Create audit log
    await this.publishSystemEvent('audit', {
      action: 'model_status_change',
      resource: `model:${modelData.id}`,
      details: { oldStatus: modelData.oldStatus, newStatus: modelData.status },
      userId: metadata.updatedBy?.id
    });

    // Cache invalidation
    await RedisManager.deleteCache(`model:${modelData.id}`);
    await RedisManager.deleteCache('models:active');
  }

  async handleModelCreated(modelData, metadata) {
    logger.info('🤖 [EVENTBUS] Processing model creation:', modelData);
    
    // Broadcast to WebSocket clients
    await this.publishWebSocketEvent('broadcast', {
      type: 'MODEL_CREATED',
      modelId: modelData.id,
      model: modelData,
      createdBy: metadata.updatedBy
    });

    // Cache invalidation
    await RedisManager.deleteCache('models:active');
    await RedisManager.deleteCache('models:all');
  }

  async handleModelDeleted(modelData, metadata) {
    logger.info('🤖 [EVENTBUS] Processing model deletion:', modelData);
    
    // Broadcast to WebSocket clients
    await this.publishWebSocketEvent('broadcast', {
      type: 'MODEL_DELETED',
      modelId: modelData.id,
      deletedBy: metadata.updatedBy
    });

    // Cache invalidation
    await RedisManager.deleteCache(`model:${modelData.id}`);
    await RedisManager.deleteCache('models:active');
    await RedisManager.deleteCache('models:all');
  }

  async handlePlanCreated(planData, metadata) {
    logger.info('💰 [EVENTBUS] Processing plan creation:', planData);
    
    // Broadcast to all users
    await this.publishWebSocketEvent('broadcast', {
      type: 'PLAN_CREATED',
      plan: planData,
      createdBy: metadata.updatedBy
    });

    // Cache invalidation
    await RedisManager.deleteCache('plans:active');
    await RedisManager.deleteCache('plans:all');
  }

  async handlePlanUpdated(planData, metadata) {
    logger.info('💰 [EVENTBUS] Processing plan update:', planData);
    
    // Broadcast to all users
    await this.publishWebSocketEvent('broadcast', {
      type: 'PLAN_UPDATED',
      plan: planData,
      changeType: metadata.changeType
    });

    // Notify affected users if price changed
    if (metadata.priceChanged) {
      await this.publishNotification({
        type: 'plan_price_update',
        title: 'Pricing Updated',
        message: `Plan "${planData.displayName}" pricing has been updated`,
        data: planData
      });
    }

    // Cache invalidation
    await RedisManager.deleteCache('plans:active');
    await RedisManager.deleteCache(`plan:${planData.id}`);
  }

  async handlePlanDeleted(planData, metadata) {
    logger.info('💰 [EVENTBUS] Processing plan deletion:', planData);
    
    // Broadcast to all users
    await this.publishWebSocketEvent('broadcast', {
      type: 'PLAN_DELETED',
      planId: planData.id,
      deletedBy: metadata.updatedBy
    });

    // Cache invalidation
    await RedisManager.deleteCache('plans:active');
    await RedisManager.deleteCache('plans:all');
    await RedisManager.deleteCache(`plan:${planData.id}`);
  }

  async handleUserStatusChange(userData, metadata) {
    logger.info('👤 [EVENTBUS] Processing user status change:', userData);
    
    // Send personal notification to user
    await this.publishWebSocketEvent('user_specific', {
      type: 'USER_STATUS_CHANGED',
      userId: userData.id,
      status: userData.status,
      data: userData
    });

    // Create audit log
    await this.publishSystemEvent('audit', {
      action: 'user_status_change',
      resource: `user:${userData.id}`,
      details: { oldStatus: userData.oldStatus, newStatus: userData.status },
      userId: metadata.updatedBy?.id
    });
  }

  async handleSubscriptionChange(subscriptionData, metadata) {
    logger.info('💳 [EVENTBUS] Processing subscription change:', subscriptionData);
    
    // Send personal notification to user
    await this.publishWebSocketEvent('user_specific', {
      type: 'SUBSCRIPTION_CHANGED',
      userId: subscriptionData.userId,
      subscription: subscriptionData,
      data: subscriptionData
    });

    // Create audit log
    await this.publishSystemEvent('audit', {
      action: 'subscription_change',
      resource: `subscription:${subscriptionData.id}`,
      details: { 
        oldPlan: subscriptionData.oldPlan, 
        newPlan: subscriptionData.newPlan,
        userId: subscriptionData.userId
      },
      userId: metadata.updatedBy?.id
    });

    // Cache invalidation
    await RedisManager.deleteCache(`user:${subscriptionData.userId}:subscription`);
  }

  async handleMaintenanceMode(maintenanceData, metadata) {
    logger.info('🔧 [EVENTBUS] Processing maintenance mode:', maintenanceData);
    
    // Broadcast to all users
    await this.publishWebSocketEvent('broadcast', {
      type: 'MAINTENANCE_MODE',
      enabled: maintenanceData.enabled,
      message: maintenanceData.message,
      estimatedDuration: maintenanceData.estimatedDuration,
      scheduledStart: maintenanceData.scheduledStart
    });

    // Send system notification
    await this.publishNotification({
      type: 'system_maintenance',
      title: maintenanceData.enabled ? 'System Maintenance Started' : 'System Maintenance Ended',
      message: maintenanceData.message,
      priority: 'high'
    });
  }

  async handleSystemSettings(settingsData, metadata) {
    logger.info('⚙️ [EVENTBUS] Processing system settings update:', Object.keys(settingsData));
    
    // Broadcast to all connected clients
    await this.publishWebSocketEvent('broadcast', {
      type: 'SYSTEM_SETTINGS_UPDATED',
      settings: settingsData,
      updatedBy: metadata.updatedBy
    });

    // Cache update
    await RedisManager.setCache('system:settings', settingsData, 86400); // 24h TTL
  }

  // ===============================
  // SUBSCRIPTION MANAGEMENT
  // ===============================

  subscribe(eventType, handler) {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    
    this.eventHandlers.get(eventType).add(handler);
    // Handler subscribed successfully
  }

  unsubscribe(eventType, handler) {
    if (this.eventHandlers.has(eventType)) {
      this.eventHandlers.get(eventType).delete(handler);
      
      if (this.eventHandlers.get(eventType).size === 0) {
        this.eventHandlers.delete(eventType);
      }
    }
    
    logger.debug(`📥 [EVENTBUS] Handler unsubscribed from: ${eventType}`);
  }

  // ===============================
  // MONITORING & METRICS
  // ===============================

  getMetrics() {
    return {
      ...this.metrics,
      subscriptions: this.subscriptions.size,
      handlers: Array.from(this.eventHandlers.entries()).map(([type, handlers]) => ({
        type,
        count: handlers.size
      })),
      uptime: Date.now() - (this.metrics.lastActivity || Date.now())
    };
  }

  async getHealth() {
    try {
      // Test Redis connection
      await RedisManager.performHealthCheck();
      
      return {
        status: 'healthy',
        redis: 'connected',
        metrics: this.getMetrics(),
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        metrics: this.getMetrics(),
        timestamp: Date.now()
      };
    }
  }
}

// Export singleton instance
module.exports = new EventBus();