const CreditService = require('../services/CreditService');
const ResponseUtil = require('../utils/response');
const logger = require('../services/logger');

/**
 * Credit limit checking middleware
 * Validates if user has sufficient credits before allowing service usage
 */
class CreditLimitMiddleware {
  /**
   * Create credit check middleware for specific service
   * @param {string} service - Service type (tts, music, voice-clone, etc.)
   * @param {Function} paramExtractor - Function to extract parameters from request
   * @returns {Function} Express middleware
   */
  static requireCredits(service, paramExtractor = null) {
    return async (req, res, next) => {
      try {
        const userId = req.user.id;
        
        // Extract parameters for credit calculation
        let params = {};
        if (paramExtractor && typeof paramExtractor === 'function') {
          params = paramExtractor(req);
        } else {
          // Default parameter extraction
          params = this.extractDefaultParams(req, service);
        }

        // Check credit availability and get user plan info
        const creditCheck = await CreditService.checkCreditAvailability(userId, service, params);
        const userCreditInfo = await CreditService.getUserCreditInfo(userId);

        if (!creditCheck.hasEnoughCredits) {
          logger.warn(`Credit limit exceeded for user ${userId}:`, {
            service,
            required: creditCheck.required,
            available: creditCheck.available,
            shortfall: creditCheck.shortfall
          });

          return res.status(403).json({
            success: false,
            error: 'INSUFFICIENT_CREDITS',
            redirectUrl: '/pricing',
            message: 'Insufficient credits',
            details: {
              required: creditCheck.required,
              available: creditCheck.available,
              shortfall: creditCheck.shortfall,
              service
            }
          });
        }

        // Attach credit info to request for consumption after successful operation
        req.creditInfo = {
          service,
          params,
          cost: creditCheck.required,
          availableBefore: creditCheck.available,
          plan: userCreditInfo.plan // Add plan info
        };

        logger.debug(`Credit check passed for user ${userId}:`, {
          service,
          cost: creditCheck.required,
          available: creditCheck.available
        });

        next();
      } catch (error) {
        logger.error('Credit limit middleware error:', error);
        return ResponseUtil.serverError(res, 'Failed to check credit limits');
      }
    };
  }

  /**
   * Middleware to consume credits after successful operation
   * Should be used after the main service operation is completed
   */
  static consumeCredits() {
    return async (req, res, next) => {
      try {
        if (!req.creditInfo) {
          logger.warn('Credit consumption attempted without credit info');
          return next();
        }

        const userId = req.user.id;
        const { service, cost, params } = req.creditInfo;

        // Consume the credits
        const consumption = await CreditService.consumeCredits(userId, service, cost, {
          requestId: req.requestId || req.headers['x-request-id'],
          endpoint: req.path,
          method: req.method,
          ...params
        });

        // Attach consumption info to response
        req.creditConsumption = consumption;

        logger.debug(`Credits consumed for user ${userId}:`, {
          service,
          consumed: cost,
          remaining: consumption.remainingCredits
        });

        next();
      } catch (error) {
        logger.error('Credit consumption middleware error:', error);
        // Don't fail the request if credit consumption fails
        // The operation was already successful
        next();
      }
    };
  }

  /**
   * Extract default parameters from request based on service type
   * @param {Object} req - Express request object
   * @param {string} service - Service type
   * @returns {Object} Extracted parameters
   */
  static extractDefaultParams(req, service) {
    const body = req.body || {};
    const query = req.query || {};

    switch (service) {
      case 'tts':
        return {
          characterCount: (body.text || body.content || query.text || '').length
        };

      case 'music':
        return {
          duration: parseInt(body.duration || query.duration || 30)
        };

      case 'voice-clone-creation':
        return {
          // Voice cloning creation is a fixed cost
        };

      case 'voice-clone-usage':
        return {
          characterCount: (body.text || body.content || query.text || '').length
        };

      case 'voice-isolator':
        return {
          duration: parseInt(body.duration || query.duration || 60) // Default 1 minute
        };

      default:
        return {};
    }
  }

  /**
   * Middleware to add credit info to response headers
   * Useful for client-side credit tracking
   */
  static addCreditHeaders() {
    return async (req, res, next) => {
      try {
        if (req.user?.id) {
          const creditInfo = await CreditService.getUserCreditInfo(req.user.id);
          
          // Add credit info to response headers
          res.set({
            'X-Credits-Available': creditInfo.available.toString(),
            'X-Credits-Total': creditInfo.total.toString(),
            'X-Credits-Used': creditInfo.usage.toString(),
            'X-Credits-Utilization': `${creditInfo.utilizationPercent}%`,
            'X-Credits-Reset-Date': creditInfo.resetDate instanceof Date ? creditInfo.resetDate.toISOString() : new Date(creditInfo.resetDate).toISOString()
          });

          // If credits were consumed in this request, add consumption info
          if (req.creditConsumption) {
            res.set({
              'X-Credits-Consumed': req.creditConsumption.creditsConsumed.toString(),
              'X-Credits-Remaining': req.creditConsumption.remainingCredits.toString()
            });
          }
        }
        
        next();
      } catch (error) {
        logger.error('Credit headers middleware error:', error);
        // Don't fail the request if header addition fails
        next();
      }
    };
  }

  /**
   * Middleware for checking concurrent generation limits
   * @param {string} service - Service type
   * @returns {Function} Express middleware
   */
  static checkConcurrentLimit(service) {
    return async (req, res, next) => {
      try {
        const userId = req.user.id;
        
        // Check how many active generations user has
        const Usage = require('../models/Usage');
        const activeGenerations = await Usage.countDocuments({
          user: userId,
          service,
          status: { $in: ['pending', 'processing'] }
        });

        // Get user's plan concurrent limit
        const creditInfo = await CreditService.getUserCreditInfo(userId);
        const plan = await CreditService.getPlanFromCache(creditInfo.plan.id);
        const concurrentLimit = plan.limits.concurrentGenerations;

        if (activeGenerations >= concurrentLimit) {
          return ResponseUtil.forbidden(res, 'Concurrent generation limit exceeded', {
            error: 'CONCURRENT_LIMIT_EXCEEDED',
            details: {
              current: activeGenerations,
              limit: concurrentLimit,
              service
            }
          });
        }

        next();
      } catch (error) {
        logger.error('Concurrent limit middleware error:', error);
        return ResponseUtil.serverError(res, 'Failed to check concurrent limits');
      }
    };
  }

  /**
   * Middleware to validate single operation limits
   * @param {string} service - Service type
   * @returns {Function} Express middleware
   */
  static validateOperationLimits(service) {
    return async (req, res, next) => {
      try {
        const userId = req.user.id;
        const creditInfo = await CreditService.getUserCreditInfo(userId);
        const plan = await CreditService.getPlanFromCache(creditInfo.plan.id);

        let validation = { valid: true, message: '' };

        switch (service) {
          case 'tts':
            const textLength = (req.body.text || '').length;
            if (textLength > plan.limits.maxTtsLength) {
              validation = {
                valid: false,
                message: `Text too long. Maximum ${plan.limits.maxTtsLength} characters allowed.`,
                limit: plan.limits.maxTtsLength,
                current: textLength
              };
            }
            break;

          case 'music':
            const duration = parseInt(req.body.duration || 30);
            if (duration > plan.limits.maxMusicDuration) {
              validation = {
                valid: false,
                message: `Duration too long. Maximum ${plan.limits.maxMusicDuration} seconds allowed.`,
                limit: plan.limits.maxMusicDuration,
                current: duration
              };
            }
            break;
        }

        if (!validation.valid) {
          return ResponseUtil.badRequest(res, validation.message, {
            error: 'OPERATION_LIMIT_EXCEEDED',
            details: validation
          });
        }

        next();
      } catch (error) {
        logger.error('Operation limits validation error:', error);
        return ResponseUtil.serverError(res, 'Failed to validate operation limits');
      }
    };
  }
}

module.exports = CreditLimitMiddleware;