const crypto = require('crypto');
const logger = require('../logger');
const Payment = require('../../models/Payment');
const Transaction = require('../../models/Transaction');
const IyzicoService = require('./IyzicoService');

class WebhookHandler {
  constructor() {
    this.webhookSecret = process.env.IYZICO_WEBHOOK_SECRET;
    this.isConfigured = !!this.webhookSecret;
    
    if (!this.isConfigured) {
      logger.warn('⚠️ [WEBHOOK] Webhook secret not configured');
    } else {
      logger.info('✅ [WEBHOOK] Handler initialized successfully');
    }
  }

  /**
   * Verify webhook signature
   */
  verifySignature(payload, signature, timestamp) {
    if (!this.isConfigured) {
      logger.warn('⚠️ [WEBHOOK] Signature verification skipped - not configured');
      return true; // Allow in development
    }

    try {
      // Iyzico webhook signature verification
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(timestamp + payload)
        .digest('hex');

      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );

      if (!isValid) {
        logger.error('❌ [WEBHOOK] Invalid signature', { 
          expected: expectedSignature, 
          received: signature 
        });
      }

      return isValid;

    } catch (error) {
      logger.error('❌ [WEBHOOK] Signature verification error', { error: error.message });
      return false;
    }
  }

  /**
   * Process webhook payload
   */
  async processWebhook(payload, headers) {
    try {
      const signature = headers['x-iyz-signature'];
      const timestamp = headers['x-iyz-timestamp'];
      const eventType = headers['x-iyz-event-type'] || 'unknown';

      logger.info('📨 [WEBHOOK] Received webhook', { 
        eventType, 
        timestamp,
        hasSignature: !!signature
      });

      // Verify signature
      if (!this.verifySignature(JSON.stringify(payload), signature, timestamp)) {
        throw new Error('Invalid webhook signature');
      }

      // Parse payload
      const webhookData = typeof payload === 'string' ? JSON.parse(payload) : payload;
      
      // Process based on event type
      switch (eventType) {
        case 'payment.success':
          return await this.handlePaymentSuccess(webhookData);
        
        case 'payment.failed':
          return await this.handlePaymentFailed(webhookData);
        
        case 'refund.success':
          return await this.handleRefundSuccess(webhookData);
        
        case 'refund.failed':
          return await this.handleRefundFailed(webhookData);
        
        case 'chargeback':
          return await this.handleChargeback(webhookData);
        
        default:
          logger.warn('⚠️ [WEBHOOK] Unknown event type', { eventType, data: webhookData });
          return { success: true, message: 'Event type not handled' };
      }

    } catch (error) {
      logger.error('❌ [WEBHOOK] Processing error', { error: error.message });
      throw error;
    }
  }

  /**
   * Handle successful payment webhook
   */
  async handlePaymentSuccess(webhookData) {
    try {
      const { paymentId, conversationId, status, paymentTransactionId } = webhookData;

      logger.info('✅ [WEBHOOK] Processing payment success', { 
        paymentId, 
        conversationId 
      });

      // Find payment record
      let payment;
      if (conversationId) {
        payment = await Payment.findByConversationId(conversationId);
      } else if (paymentId) {
        payment = await Payment.findOne({ paymentId });
      }

      if (!payment) {
        logger.error('❌ [WEBHOOK] Payment record not found', { 
          paymentId, 
          conversationId 
        });
        return { success: false, error: 'Payment not found' };
      }

      // Check if already processed
      if (payment.status === 'success') {
        logger.info('ℹ️ [WEBHOOK] Payment already processed', { 
          paymentId: payment._id 
        });
        return { success: true, message: 'Already processed' };
      }

      // Update payment status
      await payment.updateStatus('success', webhookData);

      // Create or update transaction record
      let transaction = await Transaction.findOne({ 
        paymentId: payment._id, 
        type: 'payment' 
      });

      if (transaction) {
        await transaction.markAsProcessed(webhookData);
      } else {
        transaction = new Transaction({
          paymentId: payment._id,
          userId: payment.userId,
          type: 'payment',
          status: 'success',
          amount: payment.amount,
          currency: payment.currency,
          iyzicoTransactionId: paymentTransactionId,
          processedAt: new Date(),
          webhookData
        });
        
        await transaction.save();
      }

      // Activate subscription if not already done
      if (!payment.subscriptionId) {
        await IyzicoService.activateUserSubscription(payment);
      }

      logger.info('✅ [WEBHOOK] Payment success processed', { 
        paymentId: payment._id,
        transactionId: transaction._id
      });

      return { 
        success: true, 
        paymentId: payment._id, 
        transactionId: transaction._id 
      };

    } catch (error) {
      logger.error('❌ [WEBHOOK] Payment success handling error', { 
        error: error.message, 
        webhookData 
      });
      throw error;
    }
  }

  /**
   * Handle failed payment webhook
   */
  async handlePaymentFailed(webhookData) {
    try {
      const { paymentId, conversationId, errorCode, errorMessage, errorGroup } = webhookData;

      logger.info('❌ [WEBHOOK] Processing payment failure', { 
        paymentId, 
        conversationId, 
        errorCode 
      });

      // Find payment record
      let payment;
      if (conversationId) {
        payment = await Payment.findByConversationId(conversationId);
      } else if (paymentId) {
        payment = await Payment.findOne({ paymentId });
      }

      if (!payment) {
        logger.error('❌ [WEBHOOK] Payment record not found for failure', { 
          paymentId, 
          conversationId 
        });
        return { success: false, error: 'Payment not found' };
      }

      // Update payment status
      payment.status = 'failed';
      payment.errorCode = errorCode;
      payment.errorMessage = errorMessage;
      payment.errorGroup = errorGroup;
      payment.iyzicoData = { ...payment.iyzicoData, webhook: webhookData };
      
      await payment.save();

      // Create failed transaction record
      const transaction = new Transaction({
        paymentId: payment._id,
        userId: payment.userId,
        type: 'payment',
        status: 'failed',
        amount: payment.amount,
        currency: payment.currency,
        errorCode,
        errorMessage,
        errorGroup,
        webhookData
      });

      await transaction.save();

      logger.info('✅ [WEBHOOK] Payment failure processed', { 
        paymentId: payment._id,
        errorCode,
        errorMessage
      });

      return { 
        success: true, 
        paymentId: payment._id, 
        transactionId: transaction._id 
      };

    } catch (error) {
      logger.error('❌ [WEBHOOK] Payment failure handling error', { 
        error: error.message, 
        webhookData 
      });
      throw error;
    }
  }

  /**
   * Handle refund success webhook
   */
  async handleRefundSuccess(webhookData) {
    try {
      const { paymentTransactionId, refundTransactionId, price } = webhookData;

      logger.info('✅ [WEBHOOK] Processing refund success', { 
        paymentTransactionId, 
        refundTransactionId, 
        amount: price 
      });

      // Find original payment
      const payment = await Payment.findOne({ 
        'iyzicoData.paymentId': paymentTransactionId 
      });

      if (!payment) {
        logger.error('❌ [WEBHOOK] Payment not found for refund', { 
          paymentTransactionId 
        });
        return { success: false, error: 'Payment not found' };
      }

      // Create refund transaction
      const transaction = new Transaction({
        paymentId: payment._id,
        userId: payment.userId,
        type: 'refund',
        status: 'success',
        amount: parseFloat(price),
        currency: payment.currency,
        iyzicoTransactionId: refundTransactionId,
        processedAt: new Date(),
        webhookData
      });

      await transaction.save();

      // Update payment status if fully refunded
      const totalRefunded = await Transaction.aggregate([
        { $match: { paymentId: payment._id, type: 'refund', status: 'success' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]);

      const refundedAmount = totalRefunded[0]?.total || 0;
      if (refundedAmount >= payment.amount) {
        payment.status = 'refunded';
        payment.refundedAt = new Date();
        payment.refundAmount = refundedAmount;
        await payment.save();
      }

      logger.info('✅ [WEBHOOK] Refund success processed', { 
        paymentId: payment._id,
        transactionId: transaction._id,
        refundAmount: price
      });

      return { 
        success: true, 
        paymentId: payment._id, 
        transactionId: transaction._id 
      };

    } catch (error) {
      logger.error('❌ [WEBHOOK] Refund success handling error', { 
        error: error.message, 
        webhookData 
      });
      throw error;
    }
  }

  /**
   * Handle refund failure webhook
   */
  async handleRefundFailed(webhookData) {
    try {
      const { paymentTransactionId, errorCode, errorMessage } = webhookData;

      logger.info('❌ [WEBHOOK] Processing refund failure', { 
        paymentTransactionId, 
        errorCode 
      });

      // Find original payment
      const payment = await Payment.findOne({ 
        'iyzicoData.paymentId': paymentTransactionId 
      });

      if (!payment) {
        logger.error('❌ [WEBHOOK] Payment not found for refund failure', { 
          paymentTransactionId 
        });
        return { success: false, error: 'Payment not found' };
      }

      // Create failed refund transaction
      const transaction = new Transaction({
        paymentId: payment._id,
        userId: payment.userId,
        type: 'refund',
        status: 'failed',
        amount: 0,
        currency: payment.currency,
        errorCode,
        errorMessage,
        webhookData
      });

      await transaction.save();

      logger.info('✅ [WEBHOOK] Refund failure processed', { 
        paymentId: payment._id,
        transactionId: transaction._id,
        errorCode
      });

      return { 
        success: true, 
        paymentId: payment._id, 
        transactionId: transaction._id 
      };

    } catch (error) {
      logger.error('❌ [WEBHOOK] Refund failure handling error', { 
        error: error.message, 
        webhookData 
      });
      throw error;
    }
  }

  /**
   * Handle chargeback webhook
   */
  async handleChargeback(webhookData) {
    try {
      const { paymentTransactionId, chargebackAmount } = webhookData;

      logger.info('⚠️ [WEBHOOK] Processing chargeback', { 
        paymentTransactionId, 
        chargebackAmount 
      });

      // Find original payment
      const payment = await Payment.findOne({ 
        'iyzicoData.paymentId': paymentTransactionId 
      });

      if (!payment) {
        logger.error('❌ [WEBHOOK] Payment not found for chargeback', { 
          paymentTransactionId 
        });
        return { success: false, error: 'Payment not found' };
      }

      // Create chargeback transaction
      const transaction = new Transaction({
        paymentId: payment._id,
        userId: payment.userId,
        type: 'chargeback',
        status: 'success',
        amount: parseFloat(chargebackAmount),
        currency: payment.currency,
        processedAt: new Date(),
        webhookData
      });

      await transaction.save();

      // Update payment status
      payment.status = 'refunded'; // Treated as refunded
      payment.iyzicoData = { ...payment.iyzicoData, chargeback: webhookData };
      await payment.save();

      // Deactivate subscription if active
      const Subscription = require('../../models/Subscription');
      await Subscription.updateMany(
        { userId: payment.userId, status: 'active' },
        { 
          $set: { 
            status: 'cancelled',
            isActive: false,
            cancelledAt: new Date(),
            cancelReason: 'Chargeback'
          }
        }
      );

      logger.info('✅ [WEBHOOK] Chargeback processed', { 
        paymentId: payment._id,
        transactionId: transaction._id,
        chargebackAmount
      });

      return { 
        success: true, 
        paymentId: payment._id, 
        transactionId: transaction._id 
      };

    } catch (error) {
      logger.error('❌ [WEBHOOK] Chargeback handling error', { 
        error: error.message, 
        webhookData 
      });
      throw error;
    }
  }

  /**
   * Get health status
   */
  getHealth() {
    return {
      service: 'WebhookHandler',
      status: this.isConfigured ? 'healthy' : 'not_configured',
      configured: this.isConfigured
    };
  }
}

module.exports = new WebhookHandler();