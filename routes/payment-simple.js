const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController-simple');

// Health check endpoint with full Iyzico service
router.get('/health', paymentController.getHealth);

// Payment initiation endpoint (returns error for now)
router.post('/initiate', paymentController.initiatePayment);

// Simple test endpoint
router.get('/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Payment route is working',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;