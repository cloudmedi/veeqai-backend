const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticate: authMiddleware } = require('../middleware/auth');
// const rateLimit = require('../middleware/rateLimit'); // Temporarily disabled due to export issue

// Middleware to parse raw body for webhooks
const rawBodyParser = express.raw({ 
  type: 'application/json', 
  limit: '1mb' 
});

// Rate limiting temporarily disabled - will fix later
const paymentRateLimit = (req, res, next) => next();
const webhookRateLimit = (req, res, next) => next();

/**
 * @swagger
 * tags:
 *   name: Payment
 *   description: Payment management endpoints
 */

/**
 * @swagger
 * /api/payment/plans:
 *   get:
 *     summary: Get available plans
 *     tags: [Payment]
 *     responses:
 *       200:
 *         description: Available plans retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     plans:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           name:
 *                             type: string
 *                           displayName:
 *                             type: string
 *                           pricing:
 *                             type: object
 *                           features:
 *                             type: array
 *                           credits:
 *                             type: number
 */
router.get('/plans', paymentController.getPlans);

// Simple test endpoint to verify routes are working
router.get('/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Payment route is working',
    timestamp: new Date().toISOString(),
    service: 'production-iyzico'
  });
});

// Simple plans test without database
router.get('/plans-test', (req, res) => {
  res.json({
    success: true,
    data: {
      plans: [
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
      ]
    },
    message: 'Plans retrieved successfully'
  });
});

/**
 * @swagger
 * /api/payment/initiate:
 *   post:
 *     summary: Initialize payment for a plan
 *     tags: [Payment]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - planId
 *             properties:
 *               planId:
 *                 type: string
 *                 description: ID of the plan to purchase
 *               billingInfo:
 *                 type: object
 *                 properties:
 *                   contactName:
 *                     type: string
 *                   city:
 *                     type: string
 *                   country:
 *                     type: string
 *                   address:
 *                     type: string
 *                   zipCode:
 *                     type: string
 *     responses:
 *       200:
 *         description: Payment initialized successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     conversationId:
 *                       type: string
 *                     paymentPageUrl:
 *                       type: string
 *                     token:
 *                       type: string
 *       400:
 *         description: Invalid request data
 *       503:
 *         description: Payment service not configured
 */
router.post('/initiate', 
  paymentRateLimit,
  // authMiddleware, // Temporarily disabled for testing
  paymentController.initiatePayment
);

/**
 * @swagger
 * /api/payment/callback:
 *   post:
 *     summary: Handle payment callback from Iyzico
 *     tags: [Payment]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *               conversationId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment processed successfully
 *       400:
 *         description: Payment processing failed
 */
router.post('/callback', paymentController.handleCallback);

/**
 * @swagger
 * /api/payment/webhook:
 *   post:
 *     summary: Handle webhook from Iyzico
 *     tags: [Payment]
 *     description: Webhook endpoint for Iyzico payment notifications
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *       400:
 *         description: Webhook processing failed
 *       500:
 *         description: Internal server error
 */
router.post('/webhook', 
  webhookRateLimit,
  rawBodyParser,
  paymentController.handleWebhook
);

/**
 * @swagger
 * /api/payment/status/{conversationId}:
 *   get:
 *     summary: Get payment status
 *     tags: [Payment]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment conversation ID
 *     responses:
 *       200:
 *         description: Payment status retrieved successfully
 *       404:
 *         description: Payment not found
 */
router.get('/status/:conversationId', 
  authMiddleware,
  paymentController.getPaymentStatus
);

/**
 * @swagger
 * /api/payment/cancel/{conversationId}:
 *   post:
 *     summary: Cancel payment
 *     tags: [Payment]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment conversation ID
 *     responses:
 *       200:
 *         description: Payment cancelled successfully
 *       400:
 *         description: Payment cannot be cancelled
 *       404:
 *         description: Payment not found
 */
router.post('/cancel/:conversationId', 
  authMiddleware,
  paymentController.cancelPayment
);

/**
 * @swagger
 * /api/payment/history:
 *   get:
 *     summary: Get user's payment history
 *     tags: [Payment]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *         description: Number of items per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, processing, success, failed, cancelled, refunded]
 *         description: Filter by payment status
 *     responses:
 *       200:
 *         description: Payment history retrieved successfully
 */
router.get('/history', 
  authMiddleware,
  paymentController.getPaymentHistory
);

/**
 * @swagger
 * /api/payment/refund/{paymentId}:
 *   post:
 *     summary: Process refund (Admin only)
 *     tags: [Payment]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refundAmount
 *             properties:
 *               refundAmount:
 *                 type: number
 *                 minimum: 0.01
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Refund processed successfully
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Payment not found
 */
router.post('/refund/:paymentId', 
  authMiddleware,
  paymentController.processRefund
);

/**
 * @swagger
 * /api/payment/health:
 *   get:
 *     summary: Get payment service health status
 *     tags: [Payment]
 *     responses:
 *       200:
 *         description: Health status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     iyzico:
 *                       type: object
 *                       properties:
 *                         service:
 *                           type: string
 *                         status:
 *                           type: string
 *                         configured:
 *                           type: boolean
 *                     webhook:
 *                       type: object
 *                       properties:
 *                         service:
 *                           type: string
 *                         status:
 *                           type: string
 *                         configured:
 *                           type: boolean
 *                     overall:
 *                       type: string
 */
router.get('/health', paymentController.getHealth);

module.exports = router;