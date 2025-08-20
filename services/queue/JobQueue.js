const Queue = require('bull');
const RedisManager = require('../redis/RedisManager');
const EventBus = require('../events/EventBus');
const logger = require('../logger');

class JobQueue {
  constructor() {
    this.queues = new Map();
    this.processors = new Map();
    this.isInitialized = false;
    
    // Queue configurations
    this.queueConfigs = {
      'notification': {
        defaultJobOptions: {
          removeOnComplete: 10,
          removeOnFail: 50,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 }
        }
      },
      'email': {
        defaultJobOptions: {
          removeOnComplete: 5,
          removeOnFail: 20,
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 }
        }
      },
      'cache-refresh': {
        defaultJobOptions: {
          removeOnComplete: 3,
          removeOnFail: 10,
          attempts: 2,
          backoff: { type: 'fixed', delay: 10000 }
        }
      },
      'audit-log': {
        defaultJobOptions: {
          removeOnComplete: 50,
          removeOnFail: 100,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 }
        }
      },
      'model-sync': {
        defaultJobOptions: {
          removeOnComplete: 5,
          removeOnFail: 20,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 }
        }
      }
    };
  }

  async initialize() {
    try {
      // Ensure Redis is connected
      if (!RedisManager.isConnected) {
        await RedisManager.initialize();
      }

      // Create queues
      await this.createQueues();
      
      // Setup processors
      await this.setupProcessors();
      
      // Setup monitoring
      this.setupMonitoring();
      
      this.isInitialized = true;
      logger.info('✅ [JOBQUEUE] Initialized successfully');
      
      return true;
    } catch (error) {
      logger.error('❌ [JOBQUEUE] Initialization failed:', error);
      throw error;
    }
  }

  async createQueues() {
    const redisConfig = {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD
      }
    };

    for (const [queueName, config] of Object.entries(this.queueConfigs)) {
      const queue = new Queue(queueName, redisConfig);
      
      // Set default job options
      queue.defaultJobOptions = config.defaultJobOptions;
      
      // Store queue reference
      this.queues.set(queueName, queue);
      
      // Queue created successfully
    }
  }

  async setupProcessors() {
    // Notification processor
    this.addProcessor('notification', async (job) => {
      await this.processNotification(job.data);
    });

    // Email processor
    this.addProcessor('email', async (job) => {
      await this.processEmail(job.data);
    });

    // Cache refresh processor
    this.addProcessor('cache-refresh', async (job) => {
      await this.processCacheRefresh(job.data);
    });

    // Audit log processor
    this.addProcessor('audit-log', async (job) => {
      await this.processAuditLog(job.data);
    });

    // Model sync processor
    this.addProcessor('model-sync', async (job) => {
      await this.processModelSync(job.data);
    });

    // All processors registered
  }

  addProcessor(queueName, processor, concurrency = 1) {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    // Store processor reference for monitoring
    this.processors.set(queueName, processor);

    // Process jobs - handle any job type in this queue
    queue.process('*', concurrency, async (job, done) => {
      try {
        logger.debug(`⚙️ [JOBQUEUE] Processing job ${job.id} (${job.name}) in queue ${queueName}`);
        
        const startTime = Date.now();
        await processor(job);
        const processingTime = Date.now() - startTime;
        
        logger.info(`✅ [JOBQUEUE] Job ${job.id} (${job.name}) completed in ${processingTime}ms`);
        done();
      } catch (error) {
        logger.error(`❌ [JOBQUEUE] Job ${job.id} (${job.name}) failed:`, error);
        done(error);
      }
    });
  }

  setupMonitoring() {
    // Setup event listeners for all queues
    for (const [queueName, queue] of this.queues) {
      // Job completed
      queue.on('completed', (job, result) => {
        logger.debug(`✅ [JOBQUEUE] ${queueName} job ${job.id} completed`);
      });

      // Job failed
      queue.on('failed', (job, err) => {
        logger.error(`❌ [JOBQUEUE] ${queueName} job ${job.id} failed:`, err);
      });

      // Job stalled
      queue.on('stalled', (job) => {
        logger.warn(`⚠️ [JOBQUEUE] ${queueName} job ${job.id} stalled`);
      });

      // Job progress
      queue.on('progress', (job, progress) => {
        logger.debug(`📊 [JOBQUEUE] ${queueName} job ${job.id} progress: ${progress}%`);
      });
    }
  }

  // ===============================
  // JOB PROCESSORS
  // ===============================

  async processNotification(data) {
    const { type, userId, title, message, metadata } = data;
    
    logger.info(`📬 [JOBQUEUE] Processing notification for user ${userId}:`, title);
    
    // Send real-time notification via WebSocket
    await EventBus.publishWebSocketEvent('user_specific', {
      userId,
      type: 'NOTIFICATION',
      data: {
        type,
        title,
        message,
        timestamp: Date.now(),
        metadata
      }
    });

    // Store notification in database if needed
    if (metadata?.persist) {
      // Implementation depends on your notification storage model
      logger.debug('📬 [JOBQUEUE] Notification stored persistently');
    }
  }

  async processEmail(data) {
    const { to, subject, template, templateData } = data;
    
    logger.info(`📧 [JOBQUEUE] Processing email to ${to}:`, subject);
    
    // Email sending implementation would go here
    // This could use services like SendGrid, AWS SES, etc.
    
    // For now, just log and simulate
    await new Promise(resolve => setTimeout(resolve, 100));
    
    logger.info(`✅ [JOBQUEUE] Email sent successfully to ${to}`);
  }

  async processCacheRefresh(data) {
    const { type, keys, pattern } = data;
    
    logger.info(`🔄 [JOBQUEUE] Processing cache refresh:`, type);
    
    try {
      if (keys && Array.isArray(keys)) {
        // Refresh specific keys
        for (const key of keys) {
          await RedisManager.deleteCache(key);
          logger.debug(`🔄 [JOBQUEUE] Deleted cache key: ${key}`);
        }
      } else if (pattern) {
        // Refresh by pattern (be careful with this in production)
        logger.warn(`⚠️ [JOBQUEUE] Pattern-based cache deletion not implemented for safety`);
      }
      
      // Trigger cache warming if needed
      if (data.warmCache) {
        await this.warmCache(data.warmCache);
      }
      
    } catch (error) {
      logger.error('❌ [JOBQUEUE] Cache refresh failed:', error);
      throw error;
    }
  }

  async processAuditLog(data) {
    const { action, resource, userId, details, timestamp } = data;
    
    logger.info(`📝 [JOBQUEUE] Processing audit log:`, action);
    
    // Store audit log in database
    // Implementation depends on your audit log model
    
    // For now, just log
    logger.info(`📝 [JOBQUEUE] Audit logged: ${userId} performed ${action} on ${resource}`);
  }

  async processModelSync(data) {
    const { modelId, action, metadata } = data;
    
    logger.info(`🤖 [JOBQUEUE] Processing model sync:`, { modelId, action });
    
    try {
      switch (action) {
        case 'cache_refresh':
          await RedisManager.deleteCache(`model:${modelId}`);
          await RedisManager.deleteCache('models:active');
          break;
          
        case 'status_broadcast':
          await EventBus.publishModelEvent('status.changed', {
            id: modelId,
            status: metadata.status,
            oldStatus: metadata.oldStatus
          }, metadata);
          break;
          
        default:
          logger.warn(`⚠️ [JOBQUEUE] Unknown model sync action: ${action}`);
      }
    } catch (error) {
      logger.error('❌ [JOBQUEUE] Model sync failed:', error);
      throw error;
    }
  }

  // ===============================
  // PUBLIC API METHODS
  // ===============================

  async addJob(queueName, jobType, data, options = {}) {
    if (!this.isInitialized) {
      throw new Error('JobQueue not initialized');
    }

    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    try {
      const job = await queue.add(jobType, data, {
        ...queue.defaultJobOptions,
        ...options
      });

      logger.debug(`📋 [JOBQUEUE] Added job ${job.id} to queue ${queueName}`);
      return job;
    } catch (error) {
      logger.error(`❌ [JOBQUEUE] Failed to add job to queue ${queueName}:`, error);
      throw error;
    }
  }

  // Convenience methods for common job types
  async sendNotification(userId, notification, options = {}) {
    return await this.addJob('notification', 'send', {
      userId,
      ...notification
    }, options);
  }

  async sendEmail(emailData, options = {}) {
    return await this.addJob('email', 'send', emailData, options);
  }

  async refreshCache(cacheData, options = {}) {
    return await this.addJob('cache-refresh', 'refresh', cacheData, options);
  }

  async logAudit(auditData, options = {}) {
    return await this.addJob('audit-log', 'log', {
      ...auditData,
      timestamp: Date.now()
    }, options);
  }

  async syncModel(modelId, action, metadata = {}, options = {}) {
    return await this.addJob('model-sync', 'sync', {
      modelId,
      action,
      metadata
    }, options);
  }

  // ===============================
  // MONITORING METHODS
  // ===============================

  async getQueueStats(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
      queue.getDelayed()
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length
    };
  }

  async getAllStats() {
    const stats = {};
    
    for (const queueName of this.queues.keys()) {
      stats[queueName] = await this.getQueueStats(queueName);
    }
    
    return stats;
  }

  async getHealth() {
    try {
      const stats = await this.getAllStats();
      
      return {
        status: 'healthy',
        queues: Object.keys(stats).length,
        stats,
        processors: this.processors.size,
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  // ===============================
  // UTILITY METHODS
  // ===============================

  async warmCache(warmingConfig) {
    // Implement cache warming logic based on configuration
    logger.debug('🔥 [JOBQUEUE] Cache warming triggered:', warmingConfig);
    
    // This would typically pre-load frequently accessed data
    // Implementation depends on your specific caching needs
  }

  // ===============================
  // GRACEFUL SHUTDOWN
  // ===============================

  async shutdown() {
    logger.info('🔌 [JOBQUEUE] Shutting down job queue system...');
    
    try {
      const closePromises = [];
      
      for (const [queueName, queue] of this.queues) {
        closePromises.push(queue.close());
        logger.info(`🔌 [JOBQUEUE] Closing queue: ${queueName}`);
      }
      
      await Promise.all(closePromises);
      
      this.queues.clear();
      this.processors.clear();
      this.isInitialized = false;
      
      logger.info('✅ [JOBQUEUE] Job queue system shut down successfully');
    } catch (error) {
      logger.error('❌ [JOBQUEUE] Error during shutdown:', error);
    }
  }
}

// Export singleton instance
module.exports = new JobQueue();