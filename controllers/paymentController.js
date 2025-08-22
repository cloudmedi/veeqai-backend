const mongoose = require('mongoose');
const IyzicoService = require('../services/payment/IyzicoService');
const WebhookHandler = require('../services/payment/WebhookHandler');
const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');
const Plan = require('../models/Plan');
const logger = require('../services/logger');
const { successResponse, errorResponse } = require('../utils/response');

const paymentController = {
  /**
   * Initialize payment for a plan
   * POST /api/payment/initiate
   */
  async initiatePayment(req, res) {
    try {
      const { planId, billingInfo = {} } = req.body;
      const userId = req.user.id;

      // Validation
      if (!planId) {
        return errorResponse(res, 'Plan ID is required', 400);
      }

      // Check if service is configured
      if (!IyzicoService.isReady()) {
        return errorResponse(res, 'Payment service not configured', 503);
      }

      // Get client IP
      const clientIp = req.ip || 
                      req.connection.remoteAddress || 
                      req.socket.remoteAddress || 
                      (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
                      '127.0.0.1';

      // Add IP to billing info
      billingInfo.ip = clientIp;

      logger.info('💳 [PAYMENT] Initiating payment', { 
        userId, 
        planId, 
        ip: clientIp 
      });

      console.log('📋 [PAYMENT] Request body:', JSON.stringify(req.body, null, 2));
      logger.info('📋 [PAYMENT] Request body:', JSON.stringify(req.body, null, 2));

      const result = await IyzicoService.initiatePayment(userId, planId, billingInfo);

      logger.info('💰 [PAYMENT] IyzicoService result:', JSON.stringify(result, null, 2));

      const responseData = {
        conversationId: result.conversationId,
        paymentId: result.paymentId,
        paymentPageUrl: result.paymentPageUrl,
        token: result.token,
        checkoutFormContent: result.checkoutFormContent
      };

      console.log('📤 [PAYMENT] Sending response to frontend:', JSON.stringify(responseData, null, 2));
      console.log('🔍 [PAYMENT] checkoutFormContent in response:', !!responseData.checkoutFormContent);
      console.log('🔍 [PAYMENT] checkoutFormContent length:', responseData.checkoutFormContent?.length || 0);
      logger.info('📤 [PAYMENT] Sending response to frontend:', JSON.stringify(responseData, null, 2));

      return successResponse(res, responseData, 'Payment initialized successfully');

    } catch (error) {
      logger.error('❌ [PAYMENT] Initiation error', { 
        error: error.message, 
        userId: req.user?.id 
      });
      return errorResponse(res, error.message, 500);
    }
  },

  /**
   * Handle payment callback from Iyzico
   * POST /api/payment/callback
   */
  async handleCallback(req, res) {
    try {
      const { token, conversationId } = req.body;

      if (!token) {
        return errorResponse(res, 'Token is required', 400);
      }

      logger.info('🔄 [PAYMENT] Processing callback', { 
        token: token.substring(0, 20) + '...',
        conversationId 
      });

      const result = await IyzicoService.processCallback(token, conversationId);

      if (result.success) {
        return successResponse(res, {
          status: result.payment.status,
          conversationId: result.payment.conversationId,
          paymentId: result.payment.paymentId,
          amount: result.payment.amount,
          currency: result.payment.currency
        }, 'Payment processed successfully');
      } else {
        return errorResponse(res, result.error || 'Payment failed', 400);
      }

    } catch (error) {
      logger.error('❌ [PAYMENT] Callback error', { error: error.message });
      return errorResponse(res, 'Payment processing failed', 500);
    }
  },

  /**
   * Handle webhook from Iyzico
   * POST /api/payment/webhook
   */
  async handleWebhook(req, res) {
    try {
      logger.info('📨 [WEBHOOK] Received webhook request', {
        headers: Object.keys(req.headers),
        hasBody: !!req.body
      });

      const result = await WebhookHandler.processWebhook(req.body, req.headers);

      if (result.success) {
        logger.info('✅ [WEBHOOK] Processed successfully', result);
        return res.status(200).json({ success: true, message: result.message });
      } else {
        logger.error('❌ [WEBHOOK] Processing failed', result);
        return res.status(400).json({ success: false, error: result.error });
      }

    } catch (error) {
      logger.error('❌ [WEBHOOK] Error', { error: error.message });
      return res.status(500).json({ success: false, error: 'Webhook processing failed' });
    }
  },

  /**
   * Get payment status
   * GET /api/payment/status/:conversationId
   */
  async getPaymentStatus(req, res) {
    try {
      const { conversationId } = req.params;
      const userId = req.user.id;

      if (!conversationId) {
        return errorResponse(res, 'Conversation ID is required', 400);
      }

      logger.info('🔍 [PAYMENT] Getting payment status', { 
        conversationId, 
        userId 
      });

      const result = await IyzicoService.getPaymentStatus(conversationId);

      if (!result.found) {
        return errorResponse(res, 'Payment not found', 404);
      }

      // Verify payment belongs to user
      const payment = await Payment.findOne({ 
        conversationId, 
        userId 
      }).populate('planId');

      if (!payment) {
        return errorResponse(res, 'Payment not found or unauthorized', 404);
      }

      return successResponse(res, {
        conversationId,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        plan: payment.planId,
        createdAt: payment.createdAt,
        processedAt: payment.processedAt,
        errorMessage: payment.errorMessage
      });

    } catch (error) {
      logger.error('❌ [PAYMENT] Status check error', { 
        error: error.message, 
        conversationId: req.params.conversationId 
      });
      return errorResponse(res, error.message, 500);
    }
  },

  /**
   * Cancel payment
   * POST /api/payment/cancel/:conversationId
   */
  async cancelPayment(req, res) {
    try {
      const { conversationId } = req.params;
      const userId = req.user.id;

      if (!conversationId) {
        return errorResponse(res, 'Conversation ID is required', 400);
      }

      logger.info('🚫 [PAYMENT] Cancelling payment', { 
        conversationId, 
        userId 
      });

      // Find payment
      const payment = await Payment.findOne({ 
        conversationId, 
        userId 
      });

      if (!payment) {
        return errorResponse(res, 'Payment not found', 404);
      }

      // Check if cancellable
      if (!['pending', 'processing'].includes(payment.status)) {
        return errorResponse(res, 'Payment cannot be cancelled', 400);
      }

      // Update payment status
      payment.status = 'cancelled';
      await payment.save();

      // Create cancelled transaction record
      const transaction = new Transaction({
        paymentId: payment._id,
        userId: payment.userId,
        type: 'payment',
        status: 'cancelled',
        amount: payment.amount,
        currency: payment.currency
      });

      await transaction.save();

      logger.info('✅ [PAYMENT] Cancelled successfully', { 
        conversationId,
        paymentId: payment._id
      });

      return successResponse(res, {
        conversationId,
        status: 'cancelled'
      }, 'Payment cancelled successfully');

    } catch (error) {
      logger.error('❌ [PAYMENT] Cancellation error', { 
        error: error.message, 
        conversationId: req.params.conversationId 
      });
      return errorResponse(res, error.message, 500);
    }
  },

  /**
   * Get user's payment history
   * GET /api/payment/history
   */
  async getPaymentHistory(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 10, status } = req.query;

      logger.info('📊 [PAYMENT] Getting payment history', { 
        userId, 
        page, 
        limit, 
        status 
      });

      const skip = (page - 1) * limit;
      const query = { userId };
      
      if (status && ['pending', 'processing', 'success', 'failed', 'cancelled', 'refunded'].includes(status)) {
        query.status = status;
      }

      const [payments, total] = await Promise.all([
        Payment.find(query)
          .populate('planId', 'name displayName pricing')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        Payment.countDocuments(query)
      ]);

      const formattedPayments = payments.map(payment => ({
        id: payment._id,
        conversationId: payment.conversationId,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        plan: payment.planId,
        createdAt: payment.createdAt,
        processedAt: payment.processedAt,
        errorMessage: payment.errorMessage,
        paymentMethod: payment.paymentMethod
      }));

      return successResponse(res, {
        payments: formattedPayments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });

    } catch (error) {
      logger.error('❌ [PAYMENT] History error', { 
        error: error.message, 
        userId: req.user?.id 
      });
      return errorResponse(res, error.message, 500);
    }
  },

  /**
   * Get available plans for payment
   * GET /api/payment/plans
   */
  async getPlans(req, res) {
    try {
      logger.info('📋 [PAYMENT] Getting available plans');

      // Check if mongoose is connected
      if (!mongoose.connection.readyState) {
        logger.error('❌ [PAYMENT] Database not connected');
        // Return sample plans instead of error
        const samplePlans = [
          {
            id: 'free',
            name: 'free',
            displayName: 'Free Plan',
            description: 'Get started with basic features',
            pricing: {
              monthly: { amount: 0, currency: 'USD' },
              yearly: null
            },
            features: { textToSpeech: true },
            credits: { monthly: 1000 },
            isPopular: false
          },
          {
            id: 'starter',
            name: 'starter', 
            displayName: 'Starter Plan',
            description: 'Perfect for individuals',
            pricing: {
              monthly: { amount: 29.99, currency: 'USD' },
              yearly: { amount: 299.99, currency: 'USD', discount: 17 }
            },
            features: { textToSpeech: true, musicGeneration: true },
            credits: { monthly: 10000 },
            isPopular: true
          }
        ];
        
        return successResponse(res, { plans: samplePlans });
      }

      let plans = [];
      try {
        // Get ALL plans from database - super-admin manages which ones are active
        plans = await Plan.find({}).select('_id name displayName description pricing features credits display status isPublic').lean().exec();
        
        logger.info('📋 [PAYMENT] Database query successful, found plans:', plans.length);
      } catch (dbError) {
        logger.error('❌ [PAYMENT] Database query failed:', dbError.message);
        // Return sample plans on database error
        const samplePlans = [
          {
            id: 'free',
            name: 'free',
            displayName: 'Free Plan',
            description: 'Get started with basic features',
            pricing: {
              monthly: { amount: 0, currency: 'USD' },
              yearly: null
            },
            features: { textToSpeech: true },
            credits: { monthly: 1000 },
            isPopular: false
          },
          {
            id: 'starter',
            name: 'starter', 
            displayName: 'Starter Plan',
            description: 'Perfect for individuals',
            pricing: {
              monthly: { amount: 29.99, currency: 'USD' },
              yearly: { amount: 299.99, currency: 'USD', discount: 17 }
            },
            features: { textToSpeech: true, musicGeneration: true },
            credits: { monthly: 10000 },
            isPopular: true
          }
        ];
        
        return successResponse(res, { plans: samplePlans });
      }

      if (plans.length === 0) {
        // Return sample plans if none exist
        const samplePlans = [
          {
            id: 'free',
            name: 'free',
            displayName: 'Free Plan',
            description: 'Get started with basic features',
            pricing: {
              monthly: { amount: 0, currency: 'USD' },
              yearly: null
            },
            features: { textToSpeech: true },
            credits: { monthly: 1000 },
            isPopular: false
          },
          {
            id: 'starter',
            name: 'starter', 
            displayName: 'Starter Plan',
            description: 'Perfect for individuals',
            pricing: {
              monthly: { amount: 29.99, currency: 'USD' },
              yearly: { amount: 299.99, currency: 'USD', discount: 17 }
            },
            features: { textToSpeech: true, musicGeneration: true },
            credits: { monthly: 10000 },
            isPopular: true
          }
        ];
        
        return successResponse(res, { plans: samplePlans });
      }

      const formattedPlans = plans.map(plan => {
        try {
          return {
            _id: plan._id,
            id: plan._id, // Add id field for frontend compatibility
            name: plan.name,
            displayName: plan.displayName,
            description: plan.description,
            pricing: {
              monthly: {
                amount: plan.pricing?.monthly?.amount || 0,
                currency: plan.pricing?.monthly?.currency || process.env.DEFAULT_CURRENCY || 'USD'
              },
              yearly: plan.pricing?.yearly ? {
                amount: plan.pricing.yearly.amount,
                currency: plan.pricing.yearly.currency || process.env.DEFAULT_CURRENCY || 'USD',
                discount: plan.pricing.yearly.discount
              } : null
            },
            features: plan.features || {},
            credits: plan.credits || { monthly: 0 },
            display: plan.display || {},
            status: plan.status,
            isPublic: plan.isPublic,
            isPopular: plan.display?.popular || false
          };
        } catch (formatError) {
          logger.error('❌ [PAYMENT] Plan formatting error:', formatError.message);
          return null;
        }
      }).filter(plan => plan !== null);

      return successResponse(res, { plans: formattedPlans });

    } catch (error) {
      logger.error('❌ [PAYMENT] Plans fetch error', { 
        error: error.message,
        stack: error.stack 
      });
      
      // Always return sample plans instead of error
      const samplePlans = [
        {
          id: 'free',
          name: 'free',
          displayName: 'Free Plan',
          description: 'Get started with basic features',
          pricing: {
            monthly: { amount: 0, currency: 'TRY' },
            yearly: null
          },
          features: { textToSpeech: true },
          credits: { monthly: 1000 },
          isPopular: false
        },
        {
          id: 'starter',
          name: 'starter', 
          displayName: 'Starter Plan',
          description: 'Perfect for individuals',
          pricing: {
            monthly: { amount: 29.99, currency: 'TRY' },
            yearly: { amount: 299.99, currency: 'TRY', discount: 17 }
          },
          features: { textToSpeech: true, musicGeneration: true },
          credits: { monthly: 10000 },
          isPopular: true
        }
      ];
      
      return successResponse(res, { plans: samplePlans });
    }
  },

  /**
   * Process refund (admin only)
   * POST /api/payment/refund/:paymentId
   */
  async processRefund(req, res) {
    try {
      const { paymentId } = req.params;
      const { refundAmount, reason } = req.body;
      const adminId = req.user.id;

      // Check admin permissions
      if (req.user.role !== 'superadmin' && req.user.role !== 'admin') {
        return errorResponse(res, 'Insufficient permissions', 403);
      }

      if (!paymentId || !refundAmount) {
        return errorResponse(res, 'Payment ID and refund amount are required', 400);
      }

      logger.info('💰 [REFUND] Processing refund', { 
        paymentId, 
        refundAmount, 
        adminId 
      });

      const result = await IyzicoService.processRefund(
        paymentId, 
        refundAmount, 
        reason || 'Admin refund'
      );

      return successResponse(res, {
        success: result.success,
        transactionId: result.transaction._id,
        refundAmount
      }, 'Refund processed successfully');

    } catch (error) {
      logger.error('❌ [REFUND] Processing error', { 
        error: error.message, 
        paymentId: req.params.paymentId 
      });
      return errorResponse(res, error.message, 500);
    }
  },

  /**
   * Get supported currencies
   * GET /api/payment/currencies
   */
  async getSupportedCurrencies(req, res) {
    try {
      const currencies = IyzicoService.getSupportedCurrencies();
      const multiCurrencyEnabled = process.env.IYZICO_MULTI_CURRENCY === 'true';

      return successResponse(res, {
        currencies,
        multiCurrencyEnabled,
        defaultCurrency: process.env.DEFAULT_CURRENCY || 'USD'
      });

    } catch (error) {
      logger.error('❌ [PAYMENT] Currencies fetch error', { error: error.message });
      return errorResponse(res, error.message, 500);
    }
  },

  /**
   * Get payment service health
   * GET /api/payment/health
   */
  async getHealth(req, res) {
    try {
      const iyzicoHealth = IyzicoService.getHealth();
      const webhookHealth = WebhookHandler.getHealth();

      return successResponse(res, {
        iyzico: iyzicoHealth,
        webhook: webhookHealth,
        overall: iyzicoHealth.status === 'healthy' ? 'healthy' : 'degraded'
      });

    } catch (error) {
      logger.error('❌ [PAYMENT] Health check error', { error: error.message });
      return errorResponse(res, error.message, 500);
    }
  }
};

module.exports = paymentController;