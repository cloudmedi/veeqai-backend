const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const Usage = require('../models/Usage');
const RedisManager = require('./redis/RedisManager');
const logger = require('./logger');

class CreditService {
  constructor() {
    this.cacheTTL = 300; // 5 minutes cache for credit calculations
  }

  /**
   * Get user's current credit usage for the month
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Credit usage statistics
   */
  async getUserCreditUsage(userId) {
    try {
      const cacheKey = `credit:usage:${userId}:${this.getCurrentMonth()}`;
      
      // Try cache first
      const cached = await RedisManager.getCache(cacheKey);
      if (cached) {
        return cached;
      }

      // Calculate from database
      const startOfMonth = this.getStartOfMonth();
      const usage = await Usage.aggregate([
        {
          $match: {
            user: userId,
            createdAt: { $gte: startOfMonth },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: '$service',
            totalCredits: { $sum: '$billing.credits' },
            count: { $sum: 1 }
          }
        }
      ]);

      // Calculate total credits used
      const creditUsage = {
        totalUsed: 0,
        byService: {},
        period: {
          startDate: startOfMonth,
          endDate: new Date()
        }
      };

      usage.forEach(item => {
        creditUsage.byService[item._id] = {
          credits: item.totalCredits || 0,
          count: item.count
        };
        creditUsage.totalUsed += item.totalCredits || 0;
      });

      // Cache the result
      await RedisManager.setCache(cacheKey, creditUsage, this.cacheTTL);
      
      return creditUsage;
    } catch (error) {
      logger.error('Failed to get user credit usage:', error);
      throw error;
    }
  }

  /**
   * Get user's subscription and remaining credits
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Subscription and credit information
   */
  async getUserCreditInfo(userId) {
    try {
      const cacheKey = `credit:info:${userId}`;
      
      // Try cache first
      const cached = await RedisManager.getCache(cacheKey);
      if (cached) {
        return cached;
      }

      // Get active subscription
      let subscription = await Subscription.findOne({
        user: userId,
        status: 'active'
      }).populate('plan');

      console.log(`🔍 Existing subscription found:`, {
        found: !!subscription,
        hasplan: !!subscription?.plan,
        userId
      });

      // If no subscription found, create free subscription
      if (!subscription) {
        console.log(`Creating free subscription for user: ${userId}`);
        
        // Find free plan
        const freePlan = await Plan.findOne({ name: 'free' });
        if (!freePlan) {
          throw new Error('Free plan not found. Please seed plans first.');
        }

        // Create free subscription with credits
        subscription = new Subscription({
          user: userId,
          plan: freePlan._id,
          planName: 'Free Plan',
          pricing: {
            amount: 0,
            currency: 'USD',
            interval: 'monthly'
          },
          credits: {
            monthly: freePlan.credits.monthly,
            used: 0,
            rollover: 0,
            periodStart: new Date(),
            usageByService: {
              tts: 0,
              music: 0,
              voiceClone: 0,
              voiceIsolator: 0
            },
            history: []
          },
          status: 'active',
          metadata: {
            source: 'auto-created'
          }
        });

        await subscription.save();
        
        // Populate the plan
        subscription = await Subscription.findById(subscription._id).populate('plan');
        console.log(`✅ Created free subscription for user: ${userId}`);
        console.log(`📋 Subscription plan populated:`, subscription.plan ? 'YES' : 'NO');
      }

      // Debug logging
      console.log(`🔍 Final subscription check:`, {
        hasSubscription: !!subscription,
        hasPlan: !!subscription?.plan,
        subscriptionId: subscription?._id,
        planId: subscription?.plan?._id
      });

      if (!subscription || !subscription.plan) {
        console.error(`❌ Subscription validation failed:`, {
          subscription: !!subscription,
          plan: !!subscription?.plan,
          userId
        });
        throw new Error('Failed to create or find subscription');
      }

      // Get current usage
      const usage = await this.getUserCreditUsage(userId);
      
      // Get rollover credits if applicable
      const rolloverCredits = await this.getRolloverCredits(userId);

      // Use subscription.credits.used instead of calculated usage for more accuracy
      const subscriptionUsed = subscription.credits?.used || 0;
      
      // Use actual subscription credits, not plan defaults
      const actualMonthlyCredits = subscription.credits?.monthly || subscription.plan.credits.monthly;
      
      console.log(`💳 [CREDIT-DEBUG] User ${userId} credit calculation:`, {
        subscriptionCredits: subscription.credits?.monthly,
        planCredits: subscription.plan.credits.monthly,
        actualMonthlyCredits,
        used: subscriptionUsed,
        rollover: rolloverCredits,
        available: actualMonthlyCredits + rolloverCredits - subscriptionUsed
      });
      
      const creditInfo = {
        plan: {
          id: subscription.plan._id,
          name: subscription.plan.displayName,
          monthly: actualMonthlyCredits,
          rolloverEnabled: subscription.plan.credits.rollover.enabled
        },
        usage: subscriptionUsed,
        available: Math.max(0, actualMonthlyCredits + rolloverCredits - subscriptionUsed),
        rollover: rolloverCredits,
        total: actualMonthlyCredits + rolloverCredits,
        utilizationPercent: Math.round((subscriptionUsed / (actualMonthlyCredits + rolloverCredits)) * 100),
        resetDate: this.getNextMonthStart(),
        byService: usage.byService
      };

      // Cache for shorter time due to dynamic nature
      await RedisManager.setCache(cacheKey, creditInfo, 60); // 1 minute cache
      
      return creditInfo;
    } catch (error) {
      logger.error('Failed to get user credit info:', error);
      throw error;
    }
  }

  /**
   * Calculate credit cost for a service operation
   * @param {string} planId - Plan ID
   * @param {string} service - Service type
   * @param {Object} params - Service parameters
   * @returns {Promise<number>} Credit cost
   */
  async calculateCreditCost(planId, service, params = {}) {
    try {
      const plan = await this.getPlanFromCache(planId);
      return plan.calculateCreditCost(service, params);
    } catch (error) {
      logger.error('Failed to calculate credit cost:', error);
      throw error;
    }
  }

  /**
   * Check if user has enough credits for operation
   * @param {string} userId - User ID
   * @param {string} service - Service type
   * @param {Object} params - Service parameters
   * @returns {Promise<Object>} Credit check result
   */
  async checkCreditAvailability(userId, service, params = {}) {
    try {
      const creditInfo = await this.getUserCreditInfo(userId);
      const requiredCredits = await this.calculateCreditCost(creditInfo.plan.id, service, params);

      const result = {
        hasEnoughCredits: creditInfo.available >= requiredCredits,
        required: requiredCredits,
        available: creditInfo.available,
        shortfall: Math.max(0, requiredCredits - creditInfo.available),
        utilizationAfter: Math.round(((creditInfo.usage + requiredCredits) / creditInfo.total) * 100)
      };

      logger.debug(`Credit check for user ${userId}:`, {
        service,
        required: requiredCredits,
        available: creditInfo.available,
        sufficient: result.hasEnoughCredits
      });

      return result;
    } catch (error) {
      logger.error('Failed to check credit availability:', error);
      throw error;
    }
  }

  /**
   * Consume credits for a service operation
   * @param {string} userId - User ID
   * @param {string} service - Service type
   * @param {number} credits - Credits to consume
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} Consumption result
   */
  async consumeCredits(userId, service, credits, metadata = {}) {
    try {
      // Double-check credit availability
      const creditInfo = await this.getUserCreditInfo(userId);
      
      if (creditInfo.available < credits) {
        throw new Error(`Insufficient credits: ${credits} required, ${creditInfo.available} available`);
      }

      // Update subscription credits in database
      const Subscription = require('../models/Subscription');
      await Subscription.findOneAndUpdate(
        { user: userId, status: 'active' },
        {
          $inc: { 'credits.used': credits },
          $push: {
            'credits.history': {
              date: new Date(),
              service,
              credits,
              metadata
            }
          }
        }
      );

      // Clear cache to ensure fresh data next time
      const cacheKey = `credit:info:${userId}`;
      await RedisManager.deleteCache(cacheKey);
      
      const usageCacheKey = `credit:usage:${userId}:${this.getCurrentMonth()}`;
      await RedisManager.deleteCache(usageCacheKey);

      // Log the consumption
      logger.info(`Credits consumed for user ${userId}:`, {
        service,
        credits,
        remainingBefore: creditInfo.available,
        remainingAfter: creditInfo.available - credits,
        metadata
      });

      // Publish event for analytics
      const EventBus = require('./events/EventBus');
      await EventBus.publishSystemEvent('credit.consumed', {
        userId,
        service,
        credits,
        metadata,
        remainingCredits: creditInfo.available - credits
      });

      return {
        success: true,
        creditsConsumed: credits,
        remainingCredits: creditInfo.available - credits,
        utilizationPercent: Math.round(((creditInfo.usage + credits) / creditInfo.total) * 100)
      };
    } catch (error) {
      logger.error('Failed to consume credits:', error);
      throw error;
    }
  }

  /**
   * Get rollover credits for user
   * @param {string} userId - User ID
   * @returns {Promise<number>} Rollover credit amount
   */
  async getRolloverCredits(userId) {
    try {
      // Check if user has rollover credits from previous months
      const rolloverKey = `credit:rollover:${userId}`;
      const rolloverData = await RedisManager.getCache(rolloverKey);
      
      if (!rolloverData) {
        return 0;
      }

      // Check if rollover credits are still valid (within max rollover months)
      const monthsOld = this.getMonthsDifference(new Date(rolloverData.expiresAt), new Date());
      
      if (monthsOld <= 0) {
        return rolloverData.credits || 0;
      }

      // Expired rollover credits
      await RedisManager.deleteCache(rolloverKey);
      return 0;
    } catch (error) {
      logger.error('Failed to get rollover credits:', error);
      return 0;
    }
  }

  /**
   * Process monthly credit rollover
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Rollover processing result
   */
  async processMonthlyRollover(userId) {
    try {
      const subscription = await Subscription.findOne({
        user: userId,
        status: 'active'
      }).populate('plan');

      if (!subscription?.plan?.credits?.rollover?.enabled) {
        return { rolledOver: 0, reason: 'Rollover not enabled for plan' };
      }

      const usage = await this.getUserCreditUsage(userId);
      const unusedCredits = Math.max(0, subscription.plan.credits.monthly - usage.totalUsed);

      if (unusedCredits > 0) {
        const rolloverKey = `credit:rollover:${userId}`;
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + subscription.plan.credits.rollover.maxMonths);

        await RedisManager.setCache(rolloverKey, {
          credits: unusedCredits,
          expiresAt: expiresAt.toISOString(),
          originalMonth: this.getCurrentMonth()
        }, subscription.plan.credits.rollover.maxMonths * 30 * 24 * 60 * 60); // TTL in seconds

        logger.info(`Rolled over ${unusedCredits} credits for user ${userId}`);

        return { rolledOver: unusedCredits, expiresAt };
      }

      return { rolledOver: 0, reason: 'No unused credits to rollover' };
    } catch (error) {
      logger.error('Failed to process monthly rollover:', error);
      throw error;
    }
  }

  /**
   * Get plan from cache or database
   * @param {string} planId - Plan ID
   * @returns {Promise<Object>} Plan object
   */
  async getPlanFromCache(planId) {
    const cacheKey = `plan:${planId}`;
    const cached = await RedisManager.getCache(cacheKey);
    
    if (cached) {
      // Restore methods to cached plan
      const plan = { ...cached };
      Object.setPrototypeOf(plan, Plan.prototype);
      return plan;
    }

    console.log('🔍 [CREDIT] Looking for plan:', planId);
    const plan = await Plan.findById(planId);
    console.log('🔍 [CREDIT] Plan found:', !!plan, plan?.name);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    await RedisManager.setCache(cacheKey, plan, 1800); // 30 minutes cache
    return plan;
  }

  // Utility Methods
  getStartOfMonth() {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  getNextMonthStart() {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth() + 1, 1);
  }

  getCurrentMonth() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  getMonthsDifference(date1, date2) {
    return (date2.getFullYear() - date1.getFullYear()) * 12 + date2.getMonth() - date1.getMonth();
  }

  /**
   * Get credit usage analytics for admin
   * @param {Object} filters - Query filters
   * @returns {Promise<Object>} Usage analytics
   */
  async getCreditAnalytics(filters = {}) {
    try {
      const { startDate, endDate, service, plan } = filters;
      const matchStage = {
        status: 'completed',
        createdAt: {
          $gte: startDate || this.getStartOfMonth(),
          $lte: endDate || new Date()
        }
      };

      if (service) matchStage.service = service;

      const analytics = await Usage.aggregate([
        { $match: matchStage },
        {
          $lookup: {
            from: 'subscriptions',
            localField: 'user',
            foreignField: 'user',
            as: 'subscription'
          }
        },
        {
          $lookup: {
            from: 'plans',
            localField: 'subscription.plan',
            foreignField: '_id',
            as: 'plan'
          }
        },
        {
          $group: {
            _id: {
              service: '$service',
              plan: { $arrayElemAt: ['$plan.displayName', 0] }
            },
            totalCredits: { $sum: '$billing.credits' },
            totalRequests: { $sum: 1 },
            uniqueUsers: { $addToSet: '$user' },
            avgCreditsPerRequest: { $avg: '$billing.credits' }
          }
        },
        {
          $addFields: {
            uniqueUserCount: { $size: '$uniqueUsers' }
          }
        },
        {
          $project: {
            uniqueUsers: 0 // Remove the array, keep only count
          }
        }
      ]);

      return analytics;
    } catch (error) {
      logger.error('Failed to get credit analytics:', error);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new CreditService();