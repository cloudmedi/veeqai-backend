const Iyzipay = require('iyzipay');
const { v4: uuidv4 } = require('uuid');
const logger = require('../logger');

// Lazy load models to avoid circular dependency
let Payment, Transaction, Plan, User;

class IyzicoService {
  // Lazy load models
  getModels() {
    if (!Payment) {
      Payment = require('../../models/Payment');
      Transaction = require('../../models/Transaction');
      Plan = require('../../models/Plan');
      User = require('../../models/User');
    }
    return { Payment, Transaction, Plan, User };
  }

  constructor() {
    this.iyzipay = new Iyzipay({
      apiKey: process.env.IYZICO_API_KEY,
      secretKey: process.env.IYZICO_SECRET_KEY,
      uri: process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com'
    });
    
    this.isConfigured = !!(process.env.IYZICO_API_KEY && process.env.IYZICO_SECRET_KEY);
    this.multiCurrencyEnabled = process.env.IYZICO_MULTI_CURRENCY === 'true';
    this.supportedCurrencies = (process.env.SUPPORTED_CURRENCIES || 'TRY').split(',').map(c => c.trim());
    
    if (!this.isConfigured) {
      logger.warn('⚠️ [IYZICO] API credentials not configured');
    } else {
      logger.info('✅ [IYZICO] Service initialized successfully');
      if (this.multiCurrencyEnabled) {
        logger.info('💰 [IYZICO] Multi-currency enabled:', this.supportedCurrencies.join(', '));
      }
    }
  }

  /**
   * Check if Iyzico is properly configured
   */
  isReady() {
    return this.isConfigured;
  }

  /**
   * Validate currency support
   */
  isCurrencySupported(currency) {
    return this.supportedCurrencies.includes(currency.toUpperCase());
  }

  /**
   * Get supported currencies
   */
  getSupportedCurrencies() {
    return this.supportedCurrencies;
  }

  /**
   * Initialize payment for a plan
   */
  async initiatePayment(userId, planId, billingInfo = {}) {
    try {
      if (!this.isConfigured) {
        throw new Error('Iyzico not configured');
      }

      // Get user and plan details
      const User = require('../../models/User');
      const Plan = require('../../models/Plan');
      const Payment = require('../../models/Payment');
      const user = await User.findById(userId);
      const plan = await Plan.findById(planId);
      
      if (!user) {
        throw new Error('User not found');
      }
      
      if (!plan || plan.status !== 'active') {
        throw new Error('Plan not found or inactive');
      }

      // Use default currency (USD for global sales)
      const planCurrency = plan.pricing.monthly.currency || process.env.DEFAULT_CURRENCY || 'USD';
      if (this.multiCurrencyEnabled && !this.isCurrencySupported(planCurrency)) {
        throw new Error(`Currency ${planCurrency} is not supported. Supported currencies: ${this.supportedCurrencies.join(', ')}`);
      }

      // Ensure currency is always uppercase for Iyzico API
      const currency = planCurrency.toUpperCase();

      logger.info('💰 [IYZICO] Payment currency:', currency);
      logger.info('💳 [IYZICO] Plan found:', { id: plan._id, name: plan.name });
      logger.info('💳 [IYZICO] Plan pricing:', JSON.stringify(plan.pricing, null, 2));
      logger.info('💳 [IYZICO] Payment amount:', plan.pricing?.monthly?.amount);

      // Generate unique conversation ID
      const conversationId = `conv_${uuidv4()}`;
      
      // Create payment record
      const payment = new Payment({
        userId,
        planId,
        conversationId,
        amount: plan.pricing.monthly.amount,
        currency,
        billingInfo: {
          contactName: billingInfo.contactName || user.name,
          city: billingInfo.city || 'Istanbul',
          country: billingInfo.country || 'Turkey',
          address: billingInfo.address || 'Address',
          zipCode: billingInfo.zipCode || '34000',
          registrationAddress: billingInfo.registrationAddress || 'Address',
          ip: billingInfo.ip || '127.0.0.1'
        },
        successUrl: process.env.PAYMENT_SUCCESS_URL || 'https://app.veeq.ai/payment/success',
        failureUrl: process.env.PAYMENT_FAILURE_URL || 'https://app.veeq.ai/payment/failed',
        callbackUrl: process.env.PAYMENT_CALLBACK_URL || 'https://api.veeq.ai/api/payment/callback'
      });

      await payment.save();

      // Prepare Iyzico request
      const request = {
        locale: 'tr',
        conversationId,
        price: payment.amount.toString(),
        paidPrice: payment.amount.toString(),
        currency: payment.currency,
        basketId: `basket_${payment._id}`,
        paymentGroup: 'PRODUCT',
        callbackUrl: payment.callbackUrl,
        enabledInstallments: [1],
        buyer: {
          id: user._id.toString(),
          name: user.name.split(' ')[0] || 'User',
          surname: user.name.split(' ')[1] || 'Surname',
          gsmNumber: user.phone || '+905555555555',
          email: user.email,
          identityNumber: '11111111111',
          lastLoginDate: new Date().toISOString().split('T')[0] + ' 00:00:00',
          registrationDate: user.createdAt.toISOString().split('T')[0] + ' 00:00:00',
          registrationAddress: payment.billingInfo.registrationAddress,
          ip: payment.billingInfo.ip,
          city: payment.billingInfo.city,
          country: payment.billingInfo.country,
          zipCode: payment.billingInfo.zipCode
        },
        shippingAddress: {
          contactName: payment.billingInfo.contactName,
          city: payment.billingInfo.city,
          country: payment.billingInfo.country,
          address: payment.billingInfo.address,
          zipCode: payment.billingInfo.zipCode
        },
        billingAddress: {
          contactName: payment.billingInfo.contactName,
          city: payment.billingInfo.city,
          country: payment.billingInfo.country,
          address: payment.billingInfo.address,
          zipCode: payment.billingInfo.zipCode
        },
        basketItems: [
          {
            id: plan._id.toString(),
            name: plan.displayName,
            category1: 'Subscription',
            category2: 'AI Services',
            itemType: 'VIRTUAL',
            price: payment.amount.toString()
          }
        ]
      };

      logger.info('🔄 [IYZICO] Initializing payment', { 
        conversationId, 
        userId, 
        planId, 
        amount: payment.amount 
      });

      // Create checkout form initialize request
      const result = await new Promise((resolve, reject) => {
        this.iyzipay.checkoutFormInitialize.create(request, (err, result) => {
          if (err) {
            logger.error('❌ [IYZICO] Payment initialization failed', { error: err, conversationId });
            reject(err);
          } else {
            resolve(result);
          }
        });
      });

      // Update payment with Iyzico response
      payment.iyzicoData = result;
      payment.paymentId = result.paymentId;
      
      if (result.status === 'success') {
        payment.status = 'processing';
        await payment.save();
        
        logger.info('✅ [IYZICO] Payment initialized successfully', { 
          conversationId, 
          paymentPageUrl: result.paymentPageUrl,
          token: result.token 
        });

        const responseData = {
          success: true,
          conversationId,
          paymentId: result.paymentId,
          paymentPageUrl: result.paymentPageUrl,
          token: result.token
        };

        logger.info('💰 [IYZICO] Returning response data:', JSON.stringify(responseData, null, 2));
        return responseData;
      } else {
        payment.status = 'failed';
        payment.errorCode = result.errorCode;
        payment.errorMessage = result.errorMessage;
        payment.errorGroup = result.errorGroup;
        await payment.save();
        
        logger.error('❌ [IYZICO] Payment initialization failed', { 
          conversationId, 
          error: result 
        });

        throw new Error(result.errorMessage || 'Payment initialization failed');
      }

    } catch (error) {
      logger.error('❌ [IYZICO] Payment initiation error', { error: error.message, userId, planId });
      throw error;
    }
  }

  /**
   * Retrieve payment status
   */
  async retrieveCheckoutForm(token) {
    try {
      if (!this.isConfigured) {
        throw new Error('Iyzico not configured');
      }

      const request = {
        locale: 'tr',
        conversationId: `retrieve_${Date.now()}`,
        token
      };

      logger.info('🔍 [IYZICO] Retrieving checkout form', { token });

      const result = await new Promise((resolve, reject) => {
        this.iyzipay.checkoutForm.retrieve(request, (err, result) => {
          if (err) {
            logger.error('❌ [IYZICO] Checkout form retrieval failed', { error: err, token });
            reject(err);
          } else {
            resolve(result);
          }
        });
      });

      return result;

    } catch (error) {
      logger.error('❌ [IYZICO] Checkout form retrieval error', { error: error.message, token });
      throw error;
    }
  }

  /**
   * Process payment callback
   */
  async processCallback(token, conversationId = null) {
    try {
      // Retrieve payment details from Iyzico
      const iyzicoResult = await this.retrieveCheckoutForm(token);
      
      // Find payment record
      let payment;
      if (conversationId) {
        payment = await Payment.findByConversationId(conversationId);
      } else if (iyzicoResult.paymentId) {
        payment = await Payment.findOne({ paymentId: iyzicoResult.paymentId });
      }

      if (!payment) {
        logger.error('❌ [IYZICO] Payment record not found', { token, conversationId });
        throw new Error('Payment record not found');
      }

      // Update payment with latest data
      payment.iyzicoData = { ...payment.iyzicoData, callback: iyzicoResult };
      
      if (iyzicoResult.paymentStatus === 'SUCCESS') {
        payment.status = 'success';
        payment.processedAt = new Date();
        payment.paymentMethod = iyzicoResult.cardType;
        payment.cardFamily = iyzicoResult.cardFamily;
        payment.cardAssociation = iyzicoResult.cardAssociation;
        
        await payment.save();

        // Create transaction record
        const transaction = new Transaction({
          paymentId: payment._id,
          userId: payment.userId,
          type: 'payment',
          status: 'success',
          amount: payment.amount,
          currency: payment.currency,
          iyzicoTransactionId: iyzicoResult.paymentId,
          processedAt: new Date(),
          webhookData: iyzicoResult
        });
        
        await transaction.save();

        logger.info('✅ [IYZICO] Payment processed successfully', { 
          conversationId: payment.conversationId,
          paymentId: iyzicoResult.paymentId,
          amount: payment.amount
        });

        // Activate user subscription (to be implemented)
        await this.activateUserSubscription(payment);

        return { success: true, payment, transaction };

      } else {
        payment.status = 'failed';
        payment.errorCode = iyzicoResult.errorCode;
        payment.errorMessage = iyzicoResult.errorMessage;
        payment.errorGroup = iyzicoResult.errorGroup;
        
        await payment.save();

        logger.warn('⚠️ [IYZICO] Payment failed', { 
          conversationId: payment.conversationId,
          error: iyzicoResult.errorMessage 
        });

        return { success: false, payment, error: iyzicoResult.errorMessage };
      }

    } catch (error) {
      logger.error('❌ [IYZICO] Callback processing error', { error: error.message, token });
      throw error;
    }
  }

  /**
   * Activate user subscription after successful payment
   */
  async activateUserSubscription(payment) {
    try {
      const Subscription = require('../../models/Subscription');
      const user = await User.findById(payment.userId);
      const plan = await Plan.findById(payment.planId);

      if (!user || !plan) {
        throw new Error('User or plan not found');
      }

      // Create or update subscription
      let subscription = await Subscription.findOne({ userId: payment.userId, status: 'active' });
      
      if (subscription) {
        // Update existing subscription
        subscription.planId = payment.planId;
        subscription.status = 'active';
        subscription.currentPeriodStart = new Date();
        subscription.currentPeriodEnd = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)); // 30 days
        subscription.lastPaymentDate = new Date();
        subscription.lastPaymentAmount = payment.amount;
      } else {
        // Create new subscription
        subscription = new Subscription({
          userId: payment.userId,
          planId: payment.planId,
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)), // 30 days
          lastPaymentDate: new Date(),
          lastPaymentAmount: payment.amount,
          isActive: true
        });
      }

      await subscription.save();

      // Update user credits
      user.credits = (user.credits || 0) + plan.credits;
      await user.save();

      // Link payment to subscription
      payment.subscriptionId = subscription._id;
      await payment.save();

      logger.info('✅ [IYZICO] User subscription activated', { 
        userId: user._id, 
        planId: plan._id,
        subscriptionId: subscription._id,
        credits: plan.credits
      });

      return subscription;

    } catch (error) {
      logger.error('❌ [IYZICO] Subscription activation error', { 
        error: error.message, 
        paymentId: payment._id 
      });
      throw error;
    }
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(conversationId) {
    try {
      const payment = await Payment.findByConversationId(conversationId)
        .populate('planId')
        .populate('subscriptionId');
      
      if (!payment) {
        return { found: false };
      }

      return {
        found: true,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        plan: payment.planId,
        subscription: payment.subscriptionId,
        processedAt: payment.processedAt,
        createdAt: payment.createdAt
      };

    } catch (error) {
      logger.error('❌ [IYZICO] Get payment status error', { error: error.message, conversationId });
      throw error;
    }
  }

  /**
   * Process refund
   */
  async processRefund(paymentId, refundAmount, reason = 'Customer request') {
    try {
      if (!this.isConfigured) {
        throw new Error('Iyzico not configured');
      }

      const payment = await Payment.findById(paymentId);
      if (!payment || payment.status !== 'success') {
        throw new Error('Payment not found or not eligible for refund');
      }

      const conversationId = `refund_${uuidv4()}`;
      
      const request = {
        locale: 'tr',
        conversationId,
        paymentTransactionId: payment.iyzicoData.paymentId,
        price: refundAmount.toString(),
        currency: payment.currency,
        ip: '127.0.0.1'
      };

      logger.info('🔄 [IYZICO] Processing refund', { 
        paymentId, 
        refundAmount, 
        conversationId 
      });

      const result = await new Promise((resolve, reject) => {
        this.iyzipay.refund.create(request, (err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        });
      });

      if (result.status === 'success') {
        // Update payment record
        await payment.markAsRefunded(refundAmount, result);

        // Create refund transaction
        const transaction = new Transaction({
          paymentId: payment._id,
          userId: payment.userId,
          type: 'refund',
          status: 'success',
          amount: refundAmount,
          currency: payment.currency,
          iyzicoTransactionId: result.paymentTransactionId,
          processedAt: new Date(),
          webhookData: result
        });

        await transaction.save();

        logger.info('✅ [IYZICO] Refund processed successfully', { 
          paymentId, 
          refundAmount,
          transactionId: result.paymentTransactionId
        });

        return { success: true, transaction, refundData: result };

      } else {
        logger.error('❌ [IYZICO] Refund failed', { 
          paymentId, 
          error: result 
        });
        
        throw new Error(result.errorMessage || 'Refund failed');
      }

    } catch (error) {
      logger.error('❌ [IYZICO] Refund error', { error: error.message, paymentId });
      throw error;
    }
  }

  /**
   * Get health status
   */
  getHealth() {
    return {
      service: 'IyzicoService',
      status: this.isConfigured ? 'healthy' : 'not_configured',
      configured: this.isConfigured,
      baseUrl: process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com'
    };
  }
}

module.exports = new IyzicoService();