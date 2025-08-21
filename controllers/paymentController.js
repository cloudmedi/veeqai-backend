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
      const userId = req.user?.id || 'test-user-id'; // Temporary for testing

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

      const result = await IyzicoService.initiatePayment(userId, planId, billingInfo);

      return successResponse(res, {
        conversationId: result.conversationId,
        paymentId: result.paymentId,
        paymentPageUrl: result.paymentPageUrl,
        token: result.token
      }, 'Payment initialized successfully');

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

      const plans = await Plan.find({ 
        isActive: true 
      }).select('name displayName description pricing features credits isPopular');

      const formattedPlans = plans.map(plan => ({
        id: plan._id,
        name: plan.name,
        displayName: plan.displayName,
        description: plan.description,
        pricing: {
          monthly: {
            amount: plan.pricing.monthly.amount,
            currency: plan.pricing.monthly.currency
          },
          yearly: plan.pricing.yearly ? {
            amount: plan.pricing.yearly.amount,
            currency: plan.pricing.yearly.currency,
            discount: plan.pricing.yearly.discount
          } : null
        },
        features: plan.features,
        credits: plan.credits,
        isPopular: plan.isPopular
      }));

      return successResponse(res, { plans: formattedPlans });

    } catch (error) {
      logger.error('❌ [PAYMENT] Plans fetch error', { error: error.message });
      return errorResponse(res, error.message, 500);
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