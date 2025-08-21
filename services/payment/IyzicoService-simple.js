const Iyzipay = require('iyzipay');
const { v4: uuidv4 } = require('uuid');
const logger = require('../logger');

class IyzicoService {
  constructor() {
    this.iyzipay = new Iyzipay({
      apiKey: process.env.IYZICO_API_KEY,
      secretKey: process.env.IYZICO_SECRET_KEY,
      uri: process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com'
    });
    
    this.isConfigured = !!(process.env.IYZICO_API_KEY && process.env.IYZICO_SECRET_KEY);
    
    if (!this.isConfigured) {
      logger.warn('⚠️ [IYZICO] API credentials not configured');
    } else {
      logger.info('✅ [IYZICO] Service initialized successfully');
    }
  }

  isReady() {
    return this.isConfigured;
  }

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