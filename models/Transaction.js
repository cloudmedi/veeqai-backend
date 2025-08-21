const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  // Payment Reference
  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment',
    required: true,
    index: true
  },
  
  // User Reference
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Transaction Type
  type: {
    type: String,
    required: true,
    enum: ['payment', 'refund', 'chargeback', 'partial_refund'],
    index: true
  },
  
  // Transaction Status
  status: {
    type: String,
    required: true,
    enum: ['pending', 'success', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  
  // Amount Information
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'TRY',
    enum: ['TRY', 'USD', 'EUR']
  },
  
  // Iyzico Transaction Details
  iyzicoTransactionId: {
    type: String,
    index: true
  },
  iyzicoPaymentTransactionId: String,
  
  // Commission and Fees
  merchantCommissionRate: Number,
  merchantCommissionRateAmount: Number,
  iyziCommissionRateAmount: Number,
  iyziCommissionFee: Number,
  blockageRate: Number,
  blockageRateAmountMerchant: Number,
  blockageRateAmountSubMerchant: Number,
  
  // Card Information
  cardType: String,
  cardAssociation: String,
  cardFamily: String,
  cardToken: String,
  binNumber: String,
  lastFourDigits: String,
  
  // Processing Information
  processedAt: Date,
  iyzicoProcessedAt: Date,
  
  // Raw Webhook Data
  webhookData: {
    type: mongoose.Schema.Types.Mixed
  },
  
  // Error Information
  errorCode: String,
  errorMessage: String,
  errorGroup: String,
  
  // Additional Metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Compound Indexes
transactionSchema.index({ paymentId: 1, type: 1 });
transactionSchema.index({ userId: 1, status: 1 });
transactionSchema.index({ iyzicoTransactionId: 1 });
transactionSchema.index({ createdAt: -1 });

// Instance Methods
transactionSchema.methods.markAsProcessed = function(iyzicoData = null) {
  this.status = 'success';
  this.processedAt = new Date();
  if (iyzicoData) {
    this.webhookData = { ...this.webhookData, ...iyzicoData };
    if (iyzicoData.processedDate) {
      this.iyzicoProcessedAt = new Date(iyzicoData.processedDate);
    }
  }
  return this.save();
};

transactionSchema.methods.markAsFailed = function(errorCode, errorMessage, errorGroup = null) {
  this.status = 'failed';
  this.errorCode = errorCode;
  this.errorMessage = errorMessage;
  this.errorGroup = errorGroup;
  return this.save();
};

// Static Methods
transactionSchema.statics.findByPayment = function(paymentId) {
  return this.find({ paymentId }).sort({ createdAt: -1 });
};

transactionSchema.statics.findByIyzicoId = function(iyzicoTransactionId) {
  return this.findOne({ iyzicoTransactionId });
};

transactionSchema.statics.getUserTransactions = function(userId, type = null) {
  const query = { userId };
  if (type) query.type = type;
  return this.find(query)
    .populate('paymentId')
    .sort({ createdAt: -1 });
};

transactionSchema.statics.getTransactionStats = function(startDate = null, endDate = null) {
  const matchStage = {};
  if (startDate || endDate) {
    matchStage.createdAt = {};
    if (startDate) matchStage.createdAt.$gte = startDate;
    if (endDate) matchStage.createdAt.$lte = endDate;
  }

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: {
          type: '$type',
          status: '$status'
        },
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
        avgAmount: { $avg: '$amount' }
      }
    },
    {
      $sort: { '_id.type': 1, '_id.status': 1 }
    }
  ]);
};

transactionSchema.statics.getDailyStats = function(days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return this.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate },
        status: 'success'
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        },
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' }
      }
    },
    {
      $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
    }
  ]);
};

module.exports = mongoose.model('Transaction', transactionSchema);