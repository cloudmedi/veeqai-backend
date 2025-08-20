const Redis = require('ioredis');
const EventEmitter = require('events');
const logger = require('../logger');

class RedisManager extends EventEmitter {
  constructor() {
    super(); // EventEmitter constructor
    this.publisher = null;
    this.subscriber = null;
    this.cache = null;
    this.sentinel = null;
    this.isConnected = false;
    
    // Connection pools for different purposes
    this.pools = new Map();
    
    // Circuit breaker state
    this.circuitBreaker = {
      failures: 0,
      maxFailures: 5,
      timeout: 30000,
      state: 'CLOSED' // CLOSED, OPEN, HALF_OPEN
    };
  }

  async initialize() {
    try {
      // Set a timeout for the entire initialization process
      const initTimeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis initialization timeout')), 10000)
      );

      const initProcess = async () => {
        const redisConfig = this.getRedisConfig();
        
        // Initialize Redis connections with retry strategy
        this.publisher = new Redis(redisConfig.publisher);
        this.subscriber = new Redis(redisConfig.subscriber);
        this.cache = new Redis(redisConfig.cache);
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Initialize connection pools
        await this.initializePools();
        
        // Health check
        await this.performHealthCheck();
        
        this.isConnected = true;
        logger.info('✅ [REDIS] Connected successfully');
        
        return true;
      };

      // Race between initialization and timeout
      return await Promise.race([initProcess(), initTimeout]);
      
    } catch (error) {
      logger.error('❌ [REDIS] Initialization failed:', error);
      this.isConnected = false;
      await this.handleConnectionFailure(error);
      throw error;
    }
  }

  getRedisConfig() {
    // Use REDIS_URL if available (Railway format)
    if (process.env.REDIS_URL) {
      const baseConfig = {
        url: process.env.REDIS_URL,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        keepAlive: 30000,
        family: 4,
        connectTimeout: 10000,
        commandTimeout: 5000
      };
      
      return {
        publisher: baseConfig,
        subscriber: baseConfig,
        cache: baseConfig
      };
    }
    
    // Fallback to individual configs
    const baseConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keepAlive: 30000,
      family: 4,
      connectTimeout: 10000,
      commandTimeout: 5000
    };

    // Sentinel configuration for HA
    if (process.env.REDIS_SENTINEL_URL) {
      const sentinelConfig = {
        sentinels: [
          { host: process.env.REDIS_SENTINEL_HOST || 'localhost', port: 26379 }
        ],
        name: 'mymaster',
        ...baseConfig
      };
      
      return {
        publisher: sentinelConfig,
        subscriber: sentinelConfig,
        cache: sentinelConfig
      };
    }

    return {
      publisher: baseConfig,
      subscriber: baseConfig,
      cache: baseConfig
    };
  }

  setupEventHandlers() {
    // Publisher events
    this.publisher.on('connect', () => {
      this.resetCircuitBreaker();
    });

    this.publisher.on('error', (error) => {
      logger.error('❌ [REDIS] Publisher error:', error);
      this.handleConnectionFailure(error);
    });

    // Subscriber events
    this.subscriber.on('error', (error) => {
      logger.error('❌ [REDIS] Subscriber error:', error);
      this.handleConnectionFailure(error);
    });

    // Cache events
    this.cache.on('error', (error) => {
      logger.error('❌ [REDIS] Cache error:', error);
    });
  }

  async initializePools() {
    const baseConfig = this.getRedisConfig().cache;
    
    // Check if we should use cluster mode
    const useCluster = process.env.REDIS_CLUSTER_MODE === 'true';
    
    if (useCluster) {
      // WebSocket session pool with cluster
      this.pools.set('websocket', new Redis.Cluster([
        { host: process.env.REDIS_HOST || 'localhost', port: parseInt(process.env.REDIS_PORT) || 6379 }
      ], {
        enableReadyCheck: false,
        maxRetriesPerRequest: null,
        retryDelayOnFailover: 100,
        ...baseConfig
      }));
    } else {
      // WebSocket session pool with single instance
      this.pools.set('websocket', new Redis({
        ...baseConfig,
        maxRetriesPerRequest: null
      }));
    }

    // Job queue pool (always single instance for Bull compatibility)
    this.pools.set('jobs', new Redis({
      ...baseConfig,
      maxRetriesPerRequest: null
    }));
  }

  async performHealthCheck() {
    try {
      await this.publisher.ping();
      await this.subscriber.ping();
      await this.cache.ping();
      
      // Health check passed
      return true;
    } catch (error) {
      logger.error('❌ [REDIS] Health check failed:', error);
      throw error;
    }
  }

  // Circuit Breaker Pattern Implementation
  async executeWithCircuitBreaker(operation, fallback = null) {
    if (this.circuitBreaker.state === 'OPEN') {
      if (Date.now() - this.circuitBreaker.lastFailureTime < this.circuitBreaker.timeout) {
        logger.warn('⚡ [REDIS] Circuit breaker OPEN - operation rejected');
        return fallback ? await fallback() : null;
      } else {
        this.circuitBreaker.state = 'HALF_OPEN';
        logger.info('⚡ [REDIS] Circuit breaker HALF_OPEN - attempting operation');
      }
    }

    try {
      const result = await operation();
      
      if (this.circuitBreaker.state === 'HALF_OPEN') {
        this.resetCircuitBreaker();
      }
      
      return result;
    } catch (error) {
      await this.handleConnectionFailure(error);
      
      if (fallback) {
        logger.warn('🔄 [REDIS] Fallback executed due to failure:', error.message);
        return await fallback();
      }
      
      throw error;
    }
  }

  async handleConnectionFailure(error) {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureTime = Date.now();
    
    if (this.circuitBreaker.failures >= this.circuitBreaker.maxFailures) {
      this.circuitBreaker.state = 'OPEN';
      logger.error('⚡ [REDIS] Circuit breaker OPEN due to repeated failures');
      
      // Attempt to reconnect after timeout
      setTimeout(() => {
        this.attemptReconnection();
      }, this.circuitBreaker.timeout);
    }
    
    // Emit failure event for monitoring
    this.emit('connection_failure', error);
  }

  resetCircuitBreaker() {
    this.circuitBreaker.failures = 0;
    this.circuitBreaker.state = 'CLOSED';
    this.circuitBreaker.lastFailureTime = null;
    // Circuit breaker restored
  }

  async attemptReconnection() {
    try {
      logger.info('🔄 [REDIS] Attempting reconnection...');
      await this.performHealthCheck();
      this.resetCircuitBreaker();
      this.isConnected = true;
    } catch (error) {
      logger.error('❌ [REDIS] Reconnection failed:', error);
    }
  }

  // High-level Redis operations with error handling
  async publish(channel, message) {
    return await this.executeWithCircuitBreaker(async () => {
      const serializedMessage = JSON.stringify({
        ...message,
        timestamp: Date.now(),
        instanceId: process.env.INSTANCE_ID || 'unknown'
      });
      
      const result = await this.publisher.publish(channel, serializedMessage);
      logger.debug(`📡 [REDIS] Published to ${channel}:`, message);
      return result;
    });
  }

  async subscribe(channels, callback) {
    return await this.executeWithCircuitBreaker(async () => {
      await this.subscriber.subscribe(...channels);
      
      this.subscriber.on('message', (channel, message) => {
        try {
          const parsedMessage = JSON.parse(message);
          logger.debug(`📡 [REDIS] Received from ${channel}:`, parsedMessage);
          callback(channel, parsedMessage);
        } catch (error) {
          logger.error('❌ [REDIS] Failed to parse message:', error);
        }
      });
      
      // Subscribed to channels successfully
    });
  }

  async setCache(key, value, ttl = 3600) {
    return await this.executeWithCircuitBreaker(async () => {
      const serializedValue = JSON.stringify(value);
      return await this.cache.setex(key, ttl, serializedValue);
    });
  }

  async getCache(key) {
    return await this.executeWithCircuitBreaker(async () => {
      const value = await this.cache.get(key);
      return value ? JSON.parse(value) : null;
    });
  }

  async deleteCache(key) {
    return await this.executeWithCircuitBreaker(async () => {
      return await this.cache.del(key);
    });
  }

  // Connection pool getters
  getWebSocketPool() {
    return this.pools.get('websocket');
  }

  getJobsPool() {
    return this.pools.get('jobs');
  }

  // Graceful shutdown
  async disconnect() {
    logger.info('🔌 [REDIS] Shutting down connections...');
    
    try {
      await Promise.all([
        this.publisher?.disconnect(),
        this.subscriber?.disconnect(),
        this.cache?.disconnect()
      ]);
      
      // Disconnect pools
      for (const [name, pool] of this.pools) {
        await pool.disconnect();
        logger.info(`🔌 [REDIS] ${name} pool disconnected`);
      }
      
      this.isConnected = false;
      logger.info('✅ [REDIS] All connections closed gracefully');
    } catch (error) {
      logger.error('❌ [REDIS] Error during shutdown:', error);
    }
  }

  // Monitoring and metrics
  getConnectionStats() {
    return {
      isConnected: this.isConnected,
      circuitBreakerState: this.circuitBreaker.state,
      failures: this.circuitBreaker.failures,
      poolSizes: Array.from(this.pools.entries()).map(([name, pool]) => ({
        name,
        status: pool.status
      }))
    };
  }
}

// Export singleton instance
module.exports = new RedisManager();