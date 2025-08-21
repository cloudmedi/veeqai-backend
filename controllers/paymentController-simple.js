const logger = require('../services/logger');

const paymentController = {
  async initiatePayment(req, res) {
    try {
      const { planId, billingInfo = {} } = req.body;

      // Basic validation
      if (!planId) {
        return res.status(400).json({
          success: false,
          error: 'Plan ID is required'
        });
      }

      logger.info('💳 [PAYMENT] Payment initiation requested', { planId });

      // For now, return success with mock payment URL
      return res.json({
        success: true,
        data: {
          conversationId: 'mock-conversation-' + Date.now(),
          paymentPageUrl: 'https://sandbox-pp.iyzipay.com/mock-payment-page',
          token: 'mock-token-' + Date.now()
        },
        message: 'Payment initialized successfully'
      });

    } catch (error) {
      logger.error('❌ [PAYMENT] Initiation error', { error: error.message });
      return res.status(500).json({ 
        success: false, 
        error: 'Payment could not be initiated. Please try again.' 
      });
    }
  },

  async getHealth(req, res) {
    try {
      return res.json({
        success: true,
        data: {
          iyzico: { status: 'healthy', service: 'mock' },
          overall: 'healthy'
        }
      });

    } catch (error) {
      logger.error('❌ [PAYMENT] Health check error', { error: error.message });
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
};

module.exports = paymentController;